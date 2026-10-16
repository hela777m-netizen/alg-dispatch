import { v } from "convex/values";
import { internalQuery } from "./_generated/server";
import { canLogTo, currentMember, getAnchor } from "./lib/access";
import { cycleOf, cycleRange, todayISO } from "./lib/cycles";

/** Who is asking, and where they may log. Used by the AI actions. */
export const context = internalQuery({
  args: {},
  handler: async (ctx) => {
    const me = await currentMember(ctx);
    if (!me) return null;
    const geographies = (await ctx.db.query("geographies").collect()).filter((g) => g.active && canLogTo(me, g.key));
    return { name: me.name, today: todayISO(), geographies: geographies.map((g) => ({ key: g.key, name: g.name })) };
  },
});

export const cycleEntries = internalQuery({
  args: { geography: v.string(), cycle: v.number() },
  handler: async (ctx, { geography, cycle }) => {
    const me = await currentMember(ctx);
    if (!me || !canLogTo(me, geography)) return null;
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
