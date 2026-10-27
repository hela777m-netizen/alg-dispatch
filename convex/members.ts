import { v, ConvexError } from "convex/values";
import { action, internalMutation, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { currentMember, effectiveAccess, getAnchor, requireLead, requireMember, requireOwner, clean } from "./lib/access";
import { audit } from "./lib/audit";
import { currentStatus } from "./lib/presence";
import { countryById } from "./lib/countries";
import { presenceValidator, roleValidator } from "./schema";
import { cycleOf, todayISO } from "./lib/cycles";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

const DEFAULT_GEOGRAPHIES = [
  { key: "uae", name: "UAE", region: "Abu Dhabi HQ", timezone: "Asia/Dubai", lat: 24.45, lng: 54.38, country: "784" },
  { key: "ksa", name: "Saudi Arabia", region: "Riyadh", timezone: "Asia/Riyadh", lat: 24.71, lng: 46.68, country: "682" },
  { key: "brazil", name: "Brazil", region: "São Paulo", timezone: "America/Sao_Paulo", lat: -23.55, lng: -46.63, country: "076" },
  { key: "new-york", name: "United States", region: "New York", timezone: "America/New_York", lat: 40.71, lng: -74.01, country: "840" },
  { key: "uk", name: "United Kingdom", region: "London", timezone: "Europe/London", lat: 51.51, lng: -0.13, country: "826" },
  { key: "nigeria", name: "Nigeria", region: "Lagos", timezone: "Africa/Lagos", lat: 6.52, lng: 3.38, country: "566" },
  { key: "greater-china", name: "Greater China", region: "Hong Kong and Mainland", timezone: "Asia/Hong_Kong", lat: 22.32, lng: 114.17, country: "156" },
];

/** Starting activity markets: places ALG works on deals without an office. */
const DEFAULT_MARKETS = [{ key: "kazakhstan", country: "398" }];

const ALL_KEYS = DEFAULT_GEOGRAPHIES.map((g) => g.key);

// A new deployment starts with geographies only. People are added by the owner on the Team page,
// so no staff names live in the code.
async function seed(ctx: MutationCtx) {
  const existing = await ctx.db.query("geographies").first();
  if (!existing) {
    for (const [i, g] of DEFAULT_GEOGRAPHIES.entries()) {
      await ctx.db.insert("geographies", { ...g, order: i, active: true, office: true });
    }
    await ensureMarkets(ctx);
  }
}

async function ensureMarkets(ctx: MutationCtx) {
  for (const m of DEFAULT_MARKETS) {
    const c = countryById(m.country)!;
    const has = await ctx.db.query("geographies").withIndex("by_country", (q) => q.eq("country", c.id)).first();
    if (has) continue;
    const count = (await ctx.db.query("geographies").collect()).length;
    await ctx.db.insert("geographies", { key: m.key, name: c.name, region: "", timezone: "UTC", lat: c.lat, lng: c.lng, order: count, active: true, office: false, country: c.id });
  }
}

/** Status shown on the Team page. */
function accountStatus(m: Doc<"members">): "left" | "suspended" | "no_email" | "not_signed_in" | "active" {
  if (m.leftAt) return "left";
  if (!m.active) return "suspended";
  if (!m.email) return "no_email";
  if (!m.userId) return "not_signed_in";
  return "active";
}

/** Team list fields, without login IDs. */
function publicMember(m: Doc<"members">) {
  const { userId, ...rest } = m;
  return { ...rest, linked: Boolean(userId), status: accountStatus(m) };
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
        name: name || "Owner",
        email,
        title: "Group Corporate Strategy",
        role: "owner",
        geographies: ["uae", "ksa", "brazil"],
        extraGeographies: ALL_KEYS.filter((k) => !["uae", "ksa", "brazil"].includes(k)),
        userId,
        active: true,
      });
      const me = await ctx.db.query("members").withIndex("by_userId", (q) => q.eq("userId", userId)).unique();
      await audit(ctx, me, "member.first_sign_in", { id: me?._id, name: me?.name }, "Owner set up the dashboard");
      return true;
    }

    const row = await ctx.db
      .query("members")
      .withIndex("by_email", (q) => q.eq("email", email))
      .first();
    if (!row || !row.active || (row.userId && row.userId !== userId)) {
      const why = !row ? "email not on the team list" : !row.active ? "access is off" : "this person is linked to another sign-in";
      await audit(ctx, null, "signin.refused", row ? { id: row._id, name: row.name } : { name: `someone at ${email.split("@")[1] ?? "unknown"}` }, why);
      return false;
    }
    await ctx.db.patch(row._id, { userId });
    await audit(ctx, row, "member.first_sign_in", { id: row._id, name: row.name });
    return true;
  },
});

/** Team list, for managers and the owner. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireLead(ctx);
    const members = await ctx.db.query("members").collect();
    const rank = { owner: 0, manager: 1, reporter: 2 };
    return members
      .sort((a, b) => Number(Boolean(a.leftAt)) - Number(Boolean(b.leftAt)) || rank[a.role] - rank[b.role] || a.name.localeCompare(b.name))
      .map((m) => ({ ...publicMember(m), access: me.role === "owner" ? effectiveAccess(m) : undefined }));
  },
});

const ROLE_NAME = { owner: "Owner", manager: "Manager", reporter: "Reporter" } as const;

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
    reportsTo: v.optional(v.id("members")),
    left: v.optional(v.boolean()),
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
    const known = new Set((await ctx.db.query("geographies").collect()).map((g) => g.key));
    const geographies = [...new Set(args.geographies)].filter((g) => known.has(g));
    const extraGeographies = [...new Set(args.extraGeographies)].filter((g) => known.has(g) && !geographies.includes(g));
    if (args.reportsTo) {
      if (args.reportsTo === args.id) throw new ConvexError("Someone can't report to themselves.");
      const boss = await ctx.db.get(args.reportsTo);
      if (!boss || !boss.active) throw new ConvexError("Pick an active reporting manager.");
    }
    const left = Boolean(args.left);
    const active = left ? false : args.active;
    const fields = {
      name, email, title: clean(args.title, 160), role: args.role, geographies, extraGeographies, active,
      reportsTo: args.reportsTo,
    };

    if (!args.id) {
      const id = await ctx.db.insert("members", { ...fields, leftAt: left ? Date.now() : undefined });
      await audit(ctx, me, "member.added", { id, name }, `${ROLE_NAME[args.role]}; sees ${geographies.join(", ") || "no geographies"}`);
      return id;
    }

    const existing = await ctx.db.get(args.id);
    if (!existing) throw new ConvexError("That person no longer exists.");
    if (existing._id === me._id && (args.role !== "owner" || !active)) {
      throw new ConvexError("You can't remove your own owner access. Use owner handover instead.");
    }
    if (existing._id !== me._id && existing.role === "owner") {
      throw new ConvexError(`${existing.name} is also an owner. Owners can't change each other here; ask them to use owner handover.`);
    }
    // Changing the email detaches the old sign-in so the new address has to sign in.
    const emailChanged = (existing.email ?? undefined) !== email;
    // patch, not replace: check-in fields and anything else the owner doesn't edit stay as they are.
    await ctx.db.patch(args.id, {
      ...fields,
      leftAt: left ? (existing.leftAt ?? Date.now()) : undefined,
      ...(emailChanged ? { userId: undefined } : {}),
    });

    const changes: string[] = [];
    if (existing.role !== args.role) changes.push(`role ${ROLE_NAME[existing.role]} to ${ROLE_NAME[args.role]}`);
    const before = [...existing.geographies].sort().join(", ");
    const after = [...geographies].sort().join(", ");
    if (before !== after) changes.push(`geographies ${before || "none"} to ${after || "none"}`);
    if (existing.reportsTo !== args.reportsTo) {
      const n = async (id?: Id<"members">) => (id ? (await ctx.db.get(id))?.name ?? "unknown" : "none");
      changes.push(`reporting manager ${await n(existing.reportsTo)} to ${await n(args.reportsTo)}`);
    }
    if (emailChanged) changes.push("email changed, sign-in detached");
    if (existing.name !== name) changes.push(`name ${existing.name} to ${name}`);
    const target = { id: args.id, name };
    if (left && !existing.leftAt) await audit(ctx, me, "member.left", target);
    else if (!left && existing.leftAt) await audit(ctx, me, "member.returned", target);
    else if (existing.active && !active) await audit(ctx, me, "member.suspended", target);
    else if (!existing.active && active) await audit(ctx, me, "member.reactivated", target);
    if (changes.length) await audit(ctx, me, "member.changed", target, changes.join("; "));
    return args.id;
  },
});

/** Hands the owner role to someone else. The current owner becomes a manager. */
export const transferOwnership = mutation({
  args: { to: v.id("members") },
  handler: async (ctx, { to }) => {
    const me = await requireOwner(ctx);
    const next = await ctx.db.get(to);
    if (!next || !next.active || next.leftAt) throw new ConvexError("Pick an active person.");
    if (next._id === me._id) throw new ConvexError("You're already the owner.");
    if (!next.userId) throw new ConvexError(`${next.name} needs to sign in once before taking over.`);
    await ctx.db.patch(next._id, { role: "owner" });
    await ctx.db.patch(me._id, { role: "manager" });
    await audit(ctx, me, "owner.handover", { id: next._id, name: next.name }, `${me.name} handed the owner role to ${next.name}`);
  },
});

/** Clears a person's linked sign-in, so a new or re-created account with the same email can link. */
export const resetSignIn = mutation({
  args: { id: v.id("members") },
  handler: async (ctx, { id }) => {
    const me = await requireOwner(ctx);
    const m = await ctx.db.get(id);
    if (!m) throw new ConvexError("That person no longer exists.");
    if (m._id === me._id) throw new ConvexError("You can't reset your own sign-in while using it.");
    if (m.role === "owner") throw new ConvexError("Owners can't reset each other's sign-in.");
    await ctx.db.patch(id, { userId: undefined });
    await audit(ctx, me, "member.signin_reset", { id, name: m.name });
  },
});

/** Change history, newest first: one person's, or everything. Owner only. */
export const history = query({
  args: { id: v.optional(v.id("members")) },
  handler: async (ctx, { id }) => {
    await requireOwner(ctx);
    const rows = id
      ? await ctx.db.query("auditLog").withIndex("by_target", (q) => q.eq("targetId", id)).order("desc").take(50)
      : await ctx.db.query("auditLog").withIndex("by_at").order("desc").take(100);
    return rows.map((r) => ({ _id: r._id, at: r.at, actorName: r.actorName, action: r.action, targetName: r.targetName, detail: r.detail }));
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
    office: v.optional(v.boolean()),
    country: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const me = await requireOwner(ctx);
    if (args.country && !countryById(args.country)) throw new ConvexError("Pick a country from the list.");
    if (args.country) {
      const clash = await ctx.db.query("geographies").withIndex("by_country", (q) => q.eq("country", args.country)).first();
      if (clash && clash._id !== args.id) throw new ConvexError(`${clash.name} already covers that country.`);
    }
    const office = args.office ?? true;
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
      const before = await ctx.db.get(args.id);
      await ctx.db.patch(args.id, { name, region, timezone: args.timezone, active: args.active, office, country: args.country, ...pos });
      const what: string[] = [];
      if (before && (before.office !== false) !== office) what.push(office ? "made an ALG office" : "made a market");
      if (before && before.active !== args.active) what.push(args.active ? "switched on" : "switched off");
      await audit(ctx, me, "geography.changed", { id: args.id, name }, what.join("; ") || undefined);
      return args.id;
    }
    const key = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const clash = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", key)).first();
    if (clash) throw new ConvexError(`${clash.name} already exists.`);
    const count = (await ctx.db.query("geographies").collect()).length;
    const id = await ctx.db.insert("geographies", { key, name, region, timezone: args.timezone, order: count, active: args.active, office, country: args.country, ...pos });
    await audit(ctx, me, office ? "geography.added" : "market.opened", { id, name });
    return id;
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
    await audit(ctx, await requireOwner(ctx), "cycle.start_changed", undefined, anchor);
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
    const today = todayISO();
    const plans = await ctx.db.query("availability").withIndex("by_member", (q) => q.eq("memberId", m._id).lte("start", today)).collect();
    const now = currentStatus(m, plans, today);
    return {
      _id: m._id,
      name: m.name,
      title: m.title,
      role: m.role,
      geographies: m.geographies,
      extraGeographies: m.extraGeographies,
      presence: now.presence,
      location: now.location,
      presenceUntil: now.presenceUntil,
      presenceUpdatedAt: m.presenceUpdatedAt,
      linked: Boolean(m.userId),
      reportsToName: m.reportsTo ? (await ctx.db.get(m.reportsTo))?.name : undefined,
      left: Boolean(m.leftAt),
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
    const today = todayISO();
    const out = [];
    for (const m of rows.sort((a, b) => rank[a.role] - rank[b.role] || a.name.localeCompare(b.name))) {
      const plans = await ctx.db.query("availability").withIndex("by_member", (q) => q.eq("memberId", m._id).lte("start", today)).collect();
      const now = currentStatus(m, plans, today);
      out.push({
        _id: m._id, name: m.name, role: m.role, geographies: m.geographies,
        presence: now.presence, location: now.location, presenceUntil: now.presenceUntil, presenceUpdatedAt: m.presenceUpdatedAt,
      });
    }
    return out;
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
    // Add country codes to the starting geographies (additive) and open the starting markets.
    for (const g of DEFAULT_GEOGRAPHIES) {
      const row = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", g.key)).unique();
      if (row && !row.country) await ctx.db.patch(row._id, { country: g.country });
    }
    await ensureMarkets(ctx);
  },
});
