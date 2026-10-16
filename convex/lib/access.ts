import { ConvexError } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx, MutationCtx } from "../_generated/server";
import { DEFAULT_ANCHOR } from "./cycles";

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

/** Geographies a member may log updates against. */
export function canLogTo(member: Doc<"members">, geography: string): boolean {
  if (isLead(member)) return true;
  return member.geographies.includes(geography) || member.extraGeographies.includes(geography);
}

/** Geographies whose activity a member can read. Reporters see their own geographies' team activity. */
export function canSee(member: Doc<"members">, geography: string): boolean {
  return canLogTo(member, geography);
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
