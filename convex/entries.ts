import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import type { QueryCtx } from "./_generated/server";
import { canLogTo, canSee, clean, getAnchor, isLead, requireMember } from "./lib/access";
import { cycleOf } from "./lib/cycles";
import { kindValidator, stageValidator } from "./schema";

const entryFields = {
  geography: v.string(),
  kind: kindValidator,
  title: v.string(),
  details: v.optional(v.string()),
  counterparty: v.optional(v.string()),
  dealStage: v.optional(stageValidator),
  dealValue: v.optional(v.number()),
  date: v.string(),
};

type EntryInput = {
  geography: string;
  kind: Doc<"entries">["kind"];
  title: string;
  details?: string;
  counterparty?: string;
  dealStage?: Doc<"entries">["dealStage"];
  dealValue?: number;
  date: string;
};

function normalise(input: EntryInput, anchor: string) {
  const title = clean(input.title, 200);
  if (!title) throw new ConvexError("Every update needs a short title.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ConvexError("Pick a date for each update.");
  const isDeal = input.kind === "deal";
  const value = isDeal && input.dealValue !== undefined && Number.isFinite(input.dealValue) && input.dealValue >= 0
    ? Math.round(input.dealValue * 100) / 100
    : undefined;
  return {
    geography: input.geography,
    kind: input.kind,
    title,
    details: clean(input.details),
    counterparty: clean(input.counterparty, 160),
    dealStage: isDeal ? (input.dealStage ?? "lead") : undefined,
    dealValue: value,
    date: input.date,
    cycle: cycleOf(input.date, anchor),
  };
}

export const addMany = mutation({
  args: {
    entries: v.array(v.object(entryFields)),
    source: v.union(v.literal("typed"), v.literal("voice")),
  },
  handler: async (ctx, { entries, source }) => {
    const me = await requireMember(ctx);
    if (entries.length === 0) throw new ConvexError("Nothing to save.");
    if (entries.length > 30) throw new ConvexError("Save up to 30 updates at a time.");
    const anchor = await getAnchor(ctx);
    const ids: Id<"entries">[] = [];
    for (const e of entries) {
      if (!canLogTo(me, e.geography)) throw new ConvexError("You can only log updates for your own geographies.");
      ids.push(await ctx.db.insert("entries", { ...normalise(e, anchor), authorId: me._id, source, updatedAt: Date.now() }));
    }
    return ids;
  },
});

export const update = mutation({
  args: { id: v.id("entries"), ...entryFields },
  handler: async (ctx, { id, ...fields }) => {
    const me = await requireMember(ctx);
    const entry = await ctx.db.get(id);
    if (!entry) throw new ConvexError("That update was deleted.");
    if (entry.authorId !== me._id && me.role !== "owner") throw new ConvexError("You can only edit your own updates.");
    if (!canLogTo(me, fields.geography)) throw new ConvexError("You can't move updates to that geography.");
    const anchor = await getAnchor(ctx);
    await ctx.db.patch(id, {
      ...normalise(fields, anchor),
      editedBy: entry.authorId === me._id ? undefined : me._id,
      updatedAt: Date.now(),
    });
  },
});

export const remove = mutation({
  args: { id: v.id("entries") },
  handler: async (ctx, { id }) => {
    const me = await requireMember(ctx);
    const entry = await ctx.db.get(id);
    if (!entry) return;
    if (entry.authorId !== me._id && me.role !== "owner") throw new ConvexError("You can only delete your own updates.");
    await ctx.db.delete(id);
  },
});

export async function withAuthors(ctx: QueryCtx, entries: Doc<"entries">[]) {
  const names = new Map<string, string>();
  for (const e of entries) {
    if (!names.has(e.authorId)) names.set(e.authorId, (await ctx.db.get(e.authorId))?.name ?? "Former member");
  }
  return entries.map((e) => ({ ...e, authorName: names.get(e.authorId)! }));
}

/** Updates in one cycle, limited to what the viewer may see. */
export const forCycle = query({
  args: {
    cycle: v.number(),
    geography: v.optional(v.string()),
    mineOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, { cycle, geography, mineOnly }) => {
    const me = await requireMember(ctx);
    let rows: Doc<"entries">[];
    if (mineOnly) {
      rows = await ctx.db.query("entries").withIndex("by_author_cycle", (q) => q.eq("authorId", me._id).eq("cycle", cycle)).collect();
      if (geography) rows = rows.filter((r) => r.geography === geography);
    } else if (geography) {
      if (!canSee(me, geography)) return [];
      rows = await ctx.db.query("entries").withIndex("by_geo_cycle", (q) => q.eq("geography", geography).eq("cycle", cycle)).collect();
    } else {
      rows = await ctx.db.query("entries").withIndex("by_cycle", (q) => q.eq("cycle", cycle)).collect();
      if (!isLead(me)) rows = rows.filter((r) => canSee(me, r.geography));
    }
    rows.sort((a, b) => b.date.localeCompare(a.date) || b._creationTime - a._creationTime);
    return await withAuthors(ctx, rows);
  },
});
