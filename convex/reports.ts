import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { canLogTo, clean, isLead, requireLead, requireMember } from "./lib/access";

async function findReport(ctx: QueryCtx, authorId: Doc<"members">["_id"], cycle: number, geography: string) {
  return await ctx.db
    .query("reports")
    .withIndex("by_author_cycle_geo", (q) => q.eq("authorId", authorId).eq("cycle", cycle).eq("geography", geography))
    .unique();
}

async function commentCount(ctx: QueryCtx, reportId: Doc<"reports">["_id"]) {
  return (await ctx.db.query("comments").withIndex("by_report", (q) => q.eq("reportId", reportId)).collect()).length;
}

/** The viewer's reports for a cycle: one slot per geography they report on or logged against. */
export const mine = query({
  args: { cycle: v.number() },
  handler: async (ctx, { cycle }) => {
    const me = await requireMember(ctx);
    const logged = await ctx.db.query("entries").withIndex("by_author_cycle", (q) => q.eq("authorId", me._id).eq("cycle", cycle)).collect();
    const keys = [...new Set([...me.geographies, ...logged.map((e) => e.geography)])];
    const slots = [];
    for (const geography of keys) {
      const report = await findReport(ctx, me._id, cycle, geography);
      slots.push({
        geography,
        expected: me.geographies.includes(geography),
        entryCount: logged.filter((e) => e.geography === geography).length,
        report,
        comments: report ? await commentCount(ctx, report._id) : 0,
      });
    }
    return slots;
  },
});

/** Past reports for the viewer, newest first. */
export const myHistory = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const rows = (await ctx.db.query("reports").collect()).filter((r) => r.authorId === me._id && r.status !== "draft");
    rows.sort((a, b) => b.cycle - a.cycle);
    return await Promise.all(rows.slice(0, 20).map(async (r) => ({ ...r, comments: await commentCount(ctx, r._id) })));
  },
});

export const save = mutation({
  args: {
    geography: v.string(),
    cycle: v.number(),
    summary: v.string(),
    submit: v.boolean(),
  },
  handler: async (ctx, { geography, cycle, summary, submit }) => {
    const me = await requireMember(ctx);
    if (!canLogTo(me, geography)) throw new ConvexError("You don't report on that geography.");
    const text = clean(summary, 12000) ?? "";
    if (submit && text.length < 20) throw new ConvexError("Write a few lines before sending.");
    const now = Date.now();
    const existing = await findReport(ctx, me._id, cycle, geography);
    if (existing && (existing.status === "submitted" || existing.status === "reviewed")) {
      throw new ConvexError("This report was already sent. Ask for it back if you need to change it.");
    }
    const status = submit ? "submitted" : (existing?.status === "needs_info" ? "needs_info" : "draft");
    const fields = { summary: text, status, updatedAt: now, submittedAt: submit ? now : existing?.submittedAt } as const;
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    return await ctx.db.insert("reports", { authorId: me._id, geography, cycle, ...fields });
  },
});

export const setStatus = mutation({
  args: { id: v.id("reports"), status: v.union(v.literal("reviewed"), v.literal("needs_info")) },
  handler: async (ctx, { id, status }) => {
    const me = await requireLead(ctx);
    const report = await ctx.db.get(id);
    if (!report) throw new ConvexError("That report was deleted.");
    if (report.status === "draft") throw new ConvexError("This report hasn't been sent yet.");
    await ctx.db.patch(id, { status, reviewedBy: me._id, reviewedAt: Date.now() });
  },
});

/** Reports for managers: everything sent in a cycle, or everything still waiting. */
export const forReview = query({
  args: { cycle: v.optional(v.number()) },
  handler: async (ctx, { cycle }) => {
    await requireLead(ctx);
    const rows = cycle === undefined
      ? await ctx.db.query("reports").withIndex("by_status", (q) => q.eq("status", "submitted")).collect()
      : await ctx.db.query("reports").withIndex("by_cycle", (q) => q.eq("cycle", cycle)).collect();
    const sent = rows.filter((r) => r.status !== "draft");
    sent.sort((a, b) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0));
    return await Promise.all(
      sent.map(async (r) => ({
        ...r,
        authorName: (await ctx.db.get(r.authorId))?.name ?? "Former member",
        comments: await commentCount(ctx, r._id),
      })),
    );
  },
});

/** One report with its thread. Visible to its author and to managers. */
export const get = query({
  args: { id: v.id("reports") },
  handler: async (ctx, { id }) => {
    const me = await requireMember(ctx);
    const report = await ctx.db.get(id);
    if (!report) return null;
    if (report.authorId !== me._id && !isLead(me)) return null;
    const author = await ctx.db.get(report.authorId);
    const reviewer = report.reviewedBy ? await ctx.db.get(report.reviewedBy) : null;
    const thread = await ctx.db.query("comments").withIndex("by_report", (q) => q.eq("reportId", id)).collect();
    const comments = await Promise.all(
      thread.map(async (c) => ({ ...c, authorName: (await ctx.db.get(c.authorId))?.name ?? "Former member", mine: c.authorId === me._id })),
    );
    return { ...report, authorName: author?.name ?? "Former member", reviewerName: reviewer?.name, comments };
  },
});

export const comment = mutation({
  args: { reportId: v.id("reports"), body: v.string() },
  handler: async (ctx, { reportId, body }) => {
    const me = await requireMember(ctx);
    const report = await ctx.db.get(reportId);
    if (!report) throw new ConvexError("That report was deleted.");
    if (report.authorId !== me._id && !isLead(me)) throw new ConvexError("You can't comment on this report.");
    const text = clean(body, 4000);
    if (!text) throw new ConvexError("Write a comment first.");
    await ctx.db.insert("comments", { reportId, authorId: me._id, body: text, createdAt: Date.now() });
  },
});
