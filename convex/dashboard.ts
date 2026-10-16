import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { canSee, isLead, requireMember } from "./lib/access";

const KINDS = ["activity", "meeting", "deal", "blocker", "ask", "next"] as const;
const TREND_CYCLES = 6;

/** The group picture for one cycle, scoped to what the viewer may see. */
export const overview = query({
  args: { cycle: v.number() },
  handler: async (ctx, { cycle }) => {
    const me = await requireMember(ctx);
    const geographies = (await ctx.db.query("geographies").collect())
      .filter((g) => g.active && canSee(me, g.key))
      .sort((a, b) => a.order - b.order);
    const visible = new Set(geographies.map((g) => g.key));

    // Activity over the last few cycles.
    const recent: Doc<"entries">[] = [];
    for (let c = cycle - TREND_CYCLES + 1; c <= cycle; c++) {
      const rows = await ctx.db.query("entries").withIndex("by_cycle", (q) => q.eq("cycle", c)).collect();
      recent.push(...rows.filter((r) => visible.has(r.geography)));
    }
    const current = recent.filter((e) => e.cycle === cycle);

    const byGeo = geographies.map((g) => {
      const rows = current.filter((e) => e.geography === g.key);
      const counts = Object.fromEntries(KINDS.map((k) => [k, rows.filter((r) => r.kind === k).length])) as Record<(typeof KINDS)[number], number>;
      const trend = Array.from({ length: TREND_CYCLES }, (_, i) => {
        const c = cycle - TREND_CYCLES + 1 + i;
        return recent.filter((e) => e.cycle === c && e.geography === g.key).length;
      });
      const latest = rows.slice().sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime)[0];
      return {
        key: g.key,
        name: g.name,
        region: g.region,
        timezone: g.timezone,
        total: rows.length,
        counts,
        trend,
        latest: latest ? { title: latest.title, kind: latest.kind, date: latest.date } : null,
      };
    });

    // Who owes a report this cycle.
    const members = (await ctx.db.query("members").collect()).filter((m) => m.active);
    const reports = (await ctx.db.query("reports").withIndex("by_cycle", (q) => q.eq("cycle", cycle)).collect());
    const roster = (isLead(me) ? members : members.filter((m) => m._id === me._id))
      .flatMap((m) => m.geographies.filter((g) => visible.has(g)).map((g) => ({ m, g })))
      .map(({ m, g }) => {
        const r = reports.find((x) => x.authorId === m._id && x.geography === g);
        return {
          memberId: m._id,
          name: m.name,
          geography: g,
          status: r?.status ?? ("missing" as const),
          reportId: r?._id,
          linked: Boolean(m.userId),
          entries: current.filter((e) => e.authorId === m._id && e.geography === g).length,
        };
      });

    // Pipeline: latest state of each named deal across all time.
    const allDeals = (await ctx.db.query("entries").collect()).filter((e) => e.kind === "deal" && visible.has(e.geography));
    const latestDeal = new Map<string, Doc<"entries">>();
    for (const d of allDeals.sort((a, b) => a.date.localeCompare(b.date) || a._creationTime - b._creationTime)) {
      latestDeal.set(`${d.geography}::${d.title.toLowerCase()}`, d);
    }
    const names = new Map(members.map((m) => [m._id as string, m.name]));
    const pipeline = [...latestDeal.values()]
      .map((d) => ({
        id: d._id,
        title: d.title,
        geography: d.geography,
        counterparty: d.counterparty,
        stage: d.dealStage ?? "lead",
        value: d.dealValue,
        date: d.date,
        owner: names.get(d.authorId) ?? "Former member",
      }))
      .sort((a, b) => (b.value ?? -1) - (a.value ?? -1));

    const blockers = current
      .filter((e) => e.kind === "blocker" || e.kind === "ask")
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8)
      .map((e) => ({ id: e._id, kind: e.kind, title: e.title, geography: e.geography, author: names.get(e.authorId) ?? "Former member", date: e.date }));

    return {
      totals: {
        updates: current.length,
        meetings: current.filter((e) => e.kind === "meeting").length,
        activeDeals: pipeline.filter((p) => p.stage !== "closed" && p.stage !== "lost").length,
        openValue: pipeline.filter((p) => p.stage !== "closed" && p.stage !== "lost").reduce((s, p) => s + (p.value ?? 0), 0),
        blockers: current.filter((e) => e.kind === "blocker").length,
      },
      byGeo,
      roster,
      pipeline,
      blockers,
      // Updates per day this cycle, for the cycle ribbon.
      perDay: current.reduce<Record<string, number>>((acc, e) => {
        acc[e.date] = (acc[e.date] ?? 0) + 1;
        return acc;
      }, {}),
    };
  },
});
