import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import { currentMember, geographyExists, getAnchor, isOffice } from "./lib/access";
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
