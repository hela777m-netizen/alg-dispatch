import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { currentMember, geographyExists, getAnchor, isLead, isOffice } from "./lib/access";
import { addDays, plainSpan, quarterOf, spanText, whenText } from "./lib/wording";
import { audit } from "./lib/audit";
import { cycleOf, cycleRange, todayISO } from "./lib/cycles";

/** Who is asking, and the geographies an update may be filed under (every office and market). */
export const context = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await currentMember(ctx);
    if (!me) return null;
    const geographies = (await ctx.db.query("geographies").collect()).filter((g) => g.active);
    return {
      name: me.name,
      isOwner: me.role === "owner",
      today: todayISO(),
      location: me.location,
      geographies: geographies.map((g) => ({ key: g.key, name: g.name, region: isOffice(g) ? g.region : "market, no ALG office" })),
    };
  },
});

export const cycleEntries = internalQuery({
  args: { geography: v.string(), cycle: v.number() },
  handler: async (ctx, { geography, cycle }) => {
    const me = await currentMember(ctx);
    if (!me || !(await geographyExists(ctx, geography))) return null;
    const anchor = await getAnchor(ctx);
    const geo = await ctx.db.query("geographies").withIndex("by_key", (q) => q.eq("key", geography)).unique();
    const entries = (await ctx.db
      .query("entries")
      .withIndex("by_author_cycle", (q) => q.eq("authorId", me._id).eq("cycle", cycle))
      .collect()).filter((e) => e.geography === geography);
    entries.sort((a, b) => a.date.localeCompare(b.date));
    return {
      name: me.name,
      geographyName: geo?.name ?? geography,
      range: cycleRange(cycle, anchor),
      current: cycleOf(todayISO(), anchor),
      entries,
    };
  },
});

/** The caller's own pending upload, with its size and type from storage. Null if it isn't theirs. */
export const ownUpload = internalQuery({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const me = await currentMember(ctx);
    if (!me) return null;
    const row = await ctx.db.query("uploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    if (!row || row.ownerId !== me._id) return null;
    const meta = await ctx.db.system.get(storageId);
    if (!meta) return null;
    return { size: meta.size, contentType: meta.contentType };
  },
});

export const forgetUpload = internalMutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const row = await ctx.db.query("uploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    if (row) await ctx.db.delete(row._id);
  },
});

/** One audit row per AI call: who, which action, input size, outcome. Never the text. */
export const logCall = internalMutation({
  args: { action: v.string(), size: v.number(), ok: v.boolean(), ref: v.optional(v.string()) },
  handler: async (ctx, { action, size, ok, ref }) => {
    const me = await currentMember(ctx);
    await audit(ctx, me, `ai.${action}`, undefined, `${size} characters, ${ok ? "succeeded" : `failed${ref ? ` (ref ${ref})` : ""}`}`);
  },
});

/**
 * Everything the Word business update needs for one person and one cycle.
 * The author gets their own; owner and managers can get anyone's. Drafts stay private to their author.
 */
export const businessUpdateData = internalQuery({
  args: { memberId: v.optional(v.id("members")), cycle: v.number() },
  handler: async (ctx, { memberId, cycle }) => {
    const me = await currentMember(ctx);
    if (!me) return null;
    const target = memberId ? await ctx.db.get(memberId) : me;
    if (!target) return null;
    const own = target._id === me._id;
    if (!own && !isLead(me)) return null;

    const anchor = await getAnchor(ctx);
    const range = cycleRange(cycle, anchor);
    const today = todayISO();
    // Mid-cycle, the report runs to today; for a past cycle, to its last day.
    const ending = today >= range.start && today <= range.end ? today : range.end;

    const geos = await ctx.db.query("geographies").collect();
    const geoName = new Map(geos.map((g) => [g.key, g.name]));

    const inCycle = await ctx.db
      .query("entries")
      .withIndex("by_author_cycle", (q) => q.eq("authorId", target._id).eq("cycle", cycle))
      .collect();
    // Events and plans dated in the next month count as upcoming, whichever cycle they sit in.
    const horizon = addDays(ending, 31);
    const ahead: Doc<"entries">[] = [];
    for (let c = cycle + 1; c <= cycle + 3; c++) {
      const rows = await ctx.db
        .query("entries")
        .withIndex("by_author_cycle", (q) => q.eq("authorId", target._id).eq("cycle", c))
        .collect();
      ahead.push(...rows.filter((e) => (e.kind === "event" || e.kind === "next") && e.date <= horizon));
    }
    const entries = [...inCycle, ...ahead].sort((a, b) => a.date.localeCompare(b.date) || (a.startTime ?? "").localeCompare(b.startTime ?? ""));

    const reports = (await ctx.db
      .query("reports")
      .withIndex("by_author_cycle_geo", (q) => q.eq("authorId", target._id).eq("cycle", cycle))
      .collect())
      .filter((r) => own || r.status !== "draft")
      .filter((r) => r.summary.trim());

    const plans = await ctx.db.query("availability").withIndex("by_member", (q) => q.eq("memberId", target._id)).collect();
    const quarter = quarterOf(ending);
    const travel = plans
      .filter((p) => p.kind === "travel" && p.end >= range.start && p.start <= addDays(ending, 14))
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((p) => ({ lead: `${p.place ?? "Travel"} (${spanText(p.start, p.end)}).`, text: p.note ?? "" }));
    const leave = plans
      .filter((p) => p.kind === "leave" && p.end >= ending && p.start <= quarter.end)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((p) => `Annual leave: ${plainSpan(p.start, p.end)}.`);

    return {
      requesterIsOwner: me.role === "owner",
      name: target.name,
      title: target.title ?? "",
      range,
      ending,
      quarter: quarter.label,
      entries: entries.map((e) => ({
        kind: e.kind,
        upcoming: e.date > ending,
        geography: geoName.get(e.geography) ?? e.geography,
        when: whenText(e.date, e.startTime, e.endTime),
        title: e.title,
        details: e.details,
        counterparty: e.counterparty,
        dealStage: e.dealStage,
        dealValue: e.dealValue,
      })),
      reports: reports.map((r) => ({ geography: geoName.get(r.geography) ?? r.geography, status: r.status, text: r.summary })),
      travel,
      leave,
    };
  },
});
