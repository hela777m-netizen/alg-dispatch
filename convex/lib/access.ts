import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { DEFAULT_ANCHOR } from "./cycles";
import { countryById } from "./countries";

type Ctx = QueryCtx | MutationCtx;

/** The signed-in member, or null when not signed in or not on the access list. */
export async function currentMember(ctx: Ctx): Promise<Doc<"members"> | null> {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;
  const member = await ctx.db
    .query("members")
    .withIndex("by_userId", (q) => q.eq("userId", identity.subject))
    .unique();
  if (!member || !member.active) return null;
  return member;
}

export async function requireMember(ctx: Ctx): Promise<Doc<"members">> {
  const member = await currentMember(ctx);
  if (!member) throw new ConvexError("You don't have access to this dashboard yet.");
  return member;
}

export async function requireOwner(ctx: Ctx): Promise<Doc<"members">> {
  const member = await requireMember(ctx);
  if (member.role !== "owner") throw new ConvexError("Only the dashboard owner can do this.");
  return member;
}

export async function requireLead(ctx: Ctx): Promise<Doc<"members">> {
  const member = await requireMember(ctx);
  if (!isLead(member)) throw new ConvexError("Only managers can do this.");
  return member;
}

/** Owner and managers see everything. */
export function isLead(member: Doc<"members">): boolean {
  return member.role === "owner" || member.role === "manager";
}

/**
 * Geographic visibility: leads see every geography; everyone else sees the geographies
 * assigned to them. Where someone posts never widens what they can see.
 */
export function canSee(member: Doc<"members">, geography: string): boolean {
  return isLead(member) || member.geographies.includes(geography);
}

/** One update: visible if its geography is visible, or the viewer wrote it. */
export function canSeeEntry(member: Doc<"members">, entry: Doc<"entries">): boolean {
  return entry.authorId === member._id || canSee(member, entry.geography);
}

/** Plain-language summary of what a member can do. Built from the same rules the server enforces. */
export function effectiveAccess(member: Doc<"members">) {
  const lead = isLead(member);
  return {
    sees: lead ? "all" : member.geographies,
    postsTo: "any",
    reviewsReports: lead,
    administers: member.role === "owner",
  } as const;
}

/**
 * Resolves the geography an update belongs to. Any office or market in the register is fine.
 * "iso:NNN" picks a country: an existing geography for that country, or a new market,
 * never an office. Returns the geography key.
 */
export async function resolveGeography(
  ctx: MutationCtx,
  geography: string,
  onCreate?: (g: Doc<"geographies">) => Promise<void>,
): Promise<string> {
  if (geography.startsWith("iso:")) {
    const country = countryById(geography.slice(4));
    if (!country) throw new ConvexError("Pick a country from the list.");
    const existing = await ctx.db.query("geographies").withIndex("by_country", (q) => q.eq("country", country.id)).first();
    if (existing) {
      if (!existing.active) throw new ConvexError(`${existing.name} is switched off on the Team page. Ask the administrator to switch it back on.`);
      return existing.key;
    }
    let key = country.name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", key)).first()) key = `${key}-${country.id}`;
    const count = (await ctx.db.query("geographies").collect()).length;
    const id = await ctx.db.insert("geographies", {
      key, name: country.name, region: "", timezone: "UTC", lat: country.lat, lng: country.lng,
      order: count, active: true, office: false, country: country.id,
    });
    if (onCreate) await onCreate((await ctx.db.get(id))!);
    return key;
  }
  const geo = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", geography)).unique();
  if (!geo || !geo.active) throw new ConvexError("Pick a geography from the list.");
  return geo.key;
}

/** Read-only check that a geography key exists and is active. */
export async function geographyExists(ctx: Ctx, key: string): Promise<boolean> {
  const geo = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", key)).unique();
  return Boolean(geo?.active);
}

export function isOffice(g: Doc<"geographies">): boolean {
  return g.office !== false;
}

export async function getAnchor(ctx: Ctx): Promise<string> {
  const row = await ctx.db
    .query("settings")
    .withIndex("by_key", (q) => q.eq("key", "cycleAnchor"))
    .unique();
  return row?.value ?? DEFAULT_ANCHOR;
}

export function clean(text: string | undefined, max = 4000): string | undefined {
  if (text === undefined) return undefined;
  const t = text.trim();
  if (!t) return undefined;
  return t.slice(0, max);
}
