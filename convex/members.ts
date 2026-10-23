import { v, ConvexError } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentMember, getAnchor, requireLead, requireMember, requireOwner, clean } from "./lib/access";
import { presenceValidator, roleValidator } from "./schema";
import { cycleOf, todayISO } from "./lib/cycles";
import type { MutationCtx } from "./_generated/server";

const DEFAULT_GEOGRAPHIES = [
  { key: "uae", name: "UAE", region: "Abu Dhabi HQ", timezone: "Asia/Dubai", lat: 24.45, lng: 54.38 },
  { key: "ksa", name: "Saudi Arabia", region: "Riyadh", timezone: "Asia/Riyadh", lat: 24.71, lng: 46.68 },
  { key: "brazil", name: "Brazil", region: "São Paulo", timezone: "America/Sao_Paulo", lat: -23.55, lng: -46.63 },
  { key: "new-york", name: "United States", region: "New York", timezone: "America/New_York", lat: 40.71, lng: -74.01 },
  { key: "uk", name: "United Kingdom", region: "London", timezone: "Europe/London", lat: 51.51, lng: -0.13 },
  { key: "nigeria", name: "Nigeria", region: "Lagos", timezone: "Africa/Lagos", lat: 6.52, lng: 3.38 },
  { key: "greater-china", name: "Greater China", region: "Hong Kong and Mainland", timezone: "Asia/Hong_Kong", lat: 22.32, lng: 114.17 },
];

const ALL_KEYS = DEFAULT_GEOGRAPHIES.map((g) => g.key);

// Emails are filled in by the owner from the Team page.
const DEFAULT_TEAM = [
  { name: "Amy Swartz", role: "manager" as const, title: "Reviews all reports", geographies: [], extraGeographies: [] },
  { name: "Laurie Meadoff", role: "reporter" as const, title: "New York", geographies: ["new-york"], extraGeographies: [] },
  { name: "Ken Brenner", role: "reporter" as const, title: "New York", geographies: ["new-york"], extraGeographies: [] },
  { name: "Zain Ansari", role: "reporter" as const, title: "KSA, with strategy support for UAE, UK and Nigeria", geographies: ["ksa"], extraGeographies: ["uae", "uk", "nigeria"] },
  { name: "Nancy Muzi Gao", role: "reporter" as const, title: "Greater China", geographies: ["greater-china"], extraGeographies: [] },
];

async function seed(ctx: MutationCtx) {
  const existing = await ctx.db.query("geographies").first();
  if (!existing) {
    for (const [i, g] of DEFAULT_GEOGRAPHIES.entries()) {
      await ctx.db.insert("geographies", { ...g, order: i, active: true });
    }
  }
  const anyMember = await ctx.db.query("members").first();
  if (!anyMember) {
    for (const m of DEFAULT_TEAM) {
      await ctx.db.insert("members", { ...m, active: true });
    }
  }
}

/** Everything the app shell needs about the signed-in person. */
export const me = query({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { state: "signed_out" as const };
    const member = await currentMember(ctx);
    if (!member) return { state: "unlinked" as const };
    const anchor = await getAnchor(ctx);
    const geographies = (await ctx.db.query("geographies").collect())
      .filter((g) => g.active)
      .sort((a, b) => a.order - b.order);
    return {
      state: "member" as const,
      member,
      anchor,
      cycle: cycleOf(todayISO(), anchor),
      today: todayISO(),
      geographies,
    };
  },
});

/** Links a fresh login to its access-list row by verified email. */
export const claim = action({
  args: {},
  handler: async (ctx): Promise<{ ok: boolean; email?: string; reason?: string }> => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) return { ok: false, reason: "signed_out" };

    let email = typeof identity.email === "string" ? identity.email : undefined;
    let name = typeof identity.name === "string" ? identity.name : undefined;

    // Token may not carry the email; ask Clerk directly for the verified primary address.
    if (!email) {
      const secret = process.env.CLERK_SECRET_KEY;
      if (!secret) return { ok: false, reason: "missing_clerk_secret" };
      const res = await fetch(`https://api.clerk.com/v1/users/${encodeURIComponent(identity.subject)}`, {
        headers: { Authorization: `Bearer ${secret}` },
      });
      if (!res.ok) return { ok: false, reason: "clerk_lookup_failed" };
      const user = (await res.json()) as {
        primary_email_address_id?: string;
        email_addresses?: { id: string; email_address: string; verification?: { status?: string } }[];
        first_name?: string;
        last_name?: string;
      };
      const primary = user.email_addresses?.find((e) => e.id === user.primary_email_address_id);
      if (primary && primary.verification?.status === "verified") email = primary.email_address;
      name = name ?? [user.first_name, user.last_name].filter(Boolean).join(" ");
    } else if (identity.emailVerified === false) {
      return { ok: false, reason: "email_unverified" };
    }

    if (!email) return { ok: false, reason: "no_email" };
    const linked: boolean = await ctx.runMutation(internal.members.link, {
      userId: identity.subject,
      email: email.toLowerCase(),
      name: name || undefined,
    });
    return { ok: linked, email, reason: linked ? undefined : "not_on_list" };
  },
});

export const link = internalMutation({
  args: { userId: v.string(), email: v.string(), name: v.optional(v.string()) },
  handler: async (ctx, { userId, email, name }) => {
    const already = await ctx.db
      .query("members")
      .withIndex("by_userId", (q) => q.eq("userId", userId))
      .unique();
    if (already) return already.active;

    const ownerEmail = process.env.OWNER_EMAIL?.toLowerCase().trim();
    const owner = (await ctx.db.query("members").collect()).find((m) => m.role === "owner");

    // First sign-in by the owner sets everything up.
    if (!owner && ownerEmail && email === ownerEmail) {
      await seed(ctx);
      await ctx.db.insert("members", {
        name: name || "Hela Mathlouthi",
        email,
        title: "Group Corporate Strategy",
        role: "owner",
        geographies: ["uae", "ksa", "brazil"],
        extraGeographies: ALL_KEYS.filter((k) => !["uae", "ksa", "brazil"].includes(k)),
        userId,
        active: true,
      });
      return true;
    }

    const row = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!row || !row.active || (row.userId && row.userId !== userId)) return false;
    await ctx.db.patch(row._id, { userId });
    return true;
  },
});

/** Team list, for managers and the owner. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireLead(ctx);
    const members = await ctx.db.query("members").collect();
    const rank = { owner: 0, manager: 1, reporter: 2 };
    return members.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name));
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.id("members")),
    name: v.string(),
    email: v.optional(v.string()),
    title: v.optional(v.string()),
    role: roleValidator,
    geographies: v.array(v.string()),
    extraGeographies: v.array(v.string()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx);
    const email = clean(args.email)?.toLowerCase();
    const name = clean(args.name, 120);
    if (!name) throw new ConvexError("Add a name.");
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ConvexError("That email doesn't look right.");
    if (email) {
      const clash = await ctx.db.query("members").withIndex("by_email", (q) => q.eq("email", email)).first();
      if (clash && clash._id !== args.id) throw new ConvexError(`${clash.name} already uses that email.`);
    }
    const geographies = [...new Set(args.geographies)];
    const extraGeographies = [...new Set(args.extraGeographies)].filter((g) => !geographies.includes(g));
    const fields = { name, email, title: clean(args.title, 160), role: args.role, geographies, extraGeographies, active: args.active };

    if (!args.id) return await ctx.db.insert("members", fields);

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("That person no longer exists.");
    if (existing._id === me._id && (args.role !== "owner" || !args.active)) {
      throw new ConvexError("You can't remove your own owner access.");
    }
    // Changing the email detaches the old login so the new address has to sign in.
    const userId = existing.email === email ? existing.userId : undefined;
    await ctx.db.replace(args.id, { ...fields, userId });
    return args.id;
  },
});

export const saveGeography = mutation({
  args: {
    id: v.optional(v.id("geographies")),
    name: v.string(),
    region: v.string(),
    timezone: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    await requireOwner(ctx);
    const hasPos = args.lat !== undefined && args.lng !== undefined;
    if (hasPos && (Math.abs(args.lat!) > 90 || Math.abs(args.lng!) > 180)) {
      throw new ConvexError("Map position should look like 24.45, 54.38");
    }
    const pos = hasPos ? { lat: args.lat, lng: args.lng } : { lat: undefined, lng: undefined };
    const name = clean(args.name, 60);
    if (!name) throw new ConvexError("Add a name.");
    const region = clean(args.region, 80) ?? "";
    try {
      new Intl.DateTimeFormat("en", { timeZone: args.timezone });
    } catch {
      throw new ConvexError("Use a time zone like Asia/Dubai or America/Sao_Paulo.");
    }
    if (args.id) {
      await ctx.db.patch(args.id, { name, region, timezone: args.timezone, active: args.active, ...pos });
      return args.id;
    }
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const clash = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (clash) throw new ConvexError(`${clash.name} already exists.`);
    const count = (await ctx.db.query("geographies").collect()).length;
    return await ctx.db.insert("geographies", { key, name, region, timezone: args.timezone, order: count, active: args.active, ...pos });
  },
});

export const allGeographies = query({
  args: {},
  handler: async (ctx) => {
    await requireOwner(ctx);
    return (await ctx.db.query("geographies").collect()).sort((a, b) => a.order - b.order);
  },
});

export const setAnchor = mutation({
  args: { anchor: v.string() },
  handler: async (ctx, { anchor }) => {
    await requireOwner(ctx);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(anchor)) throw new ConvexError("Pick a date.");
    const anyReport = await ctx.db.query("reports").first();
    if (anyReport) throw new ConvexError("Cycle dates are locked once the first report exists.");
    for (const e of await ctx.db.query("entries").collect()) {
      await ctx.db.patch(e._id, { cycle: cycleOf(e.date, anchor) });
    }
    const row = await ctx.db.query("settings").withIndex("by_key", (q) => q.eq("key", "cycleAnchor")).unique();
    if (row) await ctx.db.patch(row._id, { value: anchor });
    else await ctx.db.insert("settings", { key: "cycleAnchor", value: anchor });
  },
});

/** Optional check-in: where you are and whether you're working. */
export const setPresence = mutation({
  args: {
    presence: v.optional(presenceValidator),
    location: v.optional(v.string()),
    until: v.optional(v.string()),
  },
  handler: async (ctx, { presence, location, until }) => {
    const me = await requireMember(ctx);
    if (until && !/^\d{4}-\d{2}-\d{2}$/.test(until)) throw new ConvexError("Pick a date.");
    await ctx.db.patch(me._id, {
      presence,
      location: clean(location, 80),
      presenceUntil: presence === "leave" || presence === "travelling" ? until : undefined,
      presenceUpdatedAt: Date.now(),
    });
  },
});

/** One person's profile for the person view. Leads see anyone; others only themselves. */
export const person = query({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const me = await currentMember(ctx);
    if (!me) return null;
    if (id !== me._id && me.role === "reporter") return null;
    const m = await ctx.db.get(id);
    if (!m) return null;
    const reports = (await ctx.db.query("reports").collect())
      .filter((r) => r.authorId === id && r.status !== "draft")
      .sort((a, b) => b.cycle - a.cycle)
      .slice(0, 12);
    return {
      _id: m._id,
      name: m.name,
      title: m.title,
      role: m.role,
      geographies: m.geographies,
      extraGeographies: m.extraGeographies,
      presence: m.presence,
      location: m.location,
      presenceUntil: m.presenceUntil,
      presenceUpdatedAt: m.presenceUpdatedAt,
      linked: Boolean(m.userId),
      reports,
    };
  },
});

/** Where everyone is, for managers. Reporters only get themselves. */
export const team = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentMember(ctx);
    if (!me) return [];
    const rows = (await ctx.db.query("members").collect()).filter((m) => m.active && (me.role !== "reporter" || m._id === me._id));
    const rank = { owner: 0, manager: 1, reporter: 2 };
    return rows
      .sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name))
      .map((m) => ({
        _id: m._id, name: m.name, role: m.role, geographies: m.geographies,
        presence: m.presence, location: m.location, presenceUntil: m.presenceUntil, presenceUpdatedAt: m.presenceUpdatedAt,
      }));
  },
});

/** One-off data fixes the owner's app applies on load. Safe to run repeatedly. */
export const applyFixes = mutation({
  args: {},
  handler: async (ctx) => {
    const me = await currentMember(ctx);
    if (!me || me.role !== "owner") return;
    const ny = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", "new-york")).unique();
    if (ny && ny.name === "New York") await ctx.db.patch(ny._id, { name: "United States", region: "New York" });
  },
});
