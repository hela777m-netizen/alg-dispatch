import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { canSeeEntry, currentMember, requireMember } from "./lib/access";

export const list = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
      .order("desc")
      .take(50);
    return await Promise.all(
      rows.map(async (n) => {
        const found = n.entryId ? await ctx.db.get(n.entryId) : null;
        // Titles of updates the viewer can no longer see are not shown.
        const entry = found && canSeeEntry(me, found) ? found : null;
        const report = n.reportId ? await ctx.db.get(n.reportId) : null;
        return {
          ...n,
          actorName: (await ctx.db.get(n.actorId))?.name ?? "Someone",
          entryTitle: entry?.title,
          geography: entry?.geography ?? report?.geography,
        };
      }),
    );
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const me = await currentMember(ctx);
    if (!me) return 0;
    const rows = await ctx.db
      .query("notifications")
      .withIndex("by_recipient", (q) => q.eq("recipientId", me._id))
      .order("desc")
      .take(100);
    return rows.filter((n) => !n.readAt).length;
  },
});

export const markRead = mutation({
  args: { ids: v.optional(v.array(v.id("notifications"))) },
  handler: async (ctx, { ids }) => {
    const me = await requireMember(ctx);
    const rows = ids
      ? (await Promise.all(ids.map((id) => ctx.db.get(id)))).filter((n) => n !== null)
      : await ctx.db.query("notifications").withIndex("by_recipient", (q) => q.eq("recipientId", me._id)).collect();
    const now = Date.now();
    for (const n of rows) {
      if (n.recipientId === me._id && !n.readAt) await ctx.db.patch(n._id, { readAt: now });
    }
  },
});
