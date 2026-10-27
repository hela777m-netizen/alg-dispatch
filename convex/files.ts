import { v, ConvexError } from "convex/values";
import { internalMutation, mutation } from "./_generated/server";
import { requireMember } from "./lib/access";

const HOUR = 3_600_000;

/** A one-time upload link for a report file. The file is deleted once it has been read. */
export const uploadUrl = mutation({
  args: {},
  handler: async (ctx) => {
    await requireMember(ctx);
    return await ctx.storage.generateUploadUrl();
  },
});

/** Records who uploaded a file, so only they can have it read. Called straight after the upload. */
export const register = mutation({
  args: { storageId: v.id("_storage") },
  handler: async (ctx, { storageId }) => {
    const me = await requireMember(ctx);
    const existing = await ctx.db.query("uploads").withIndex("by_storage", (q) => q.eq("storageId", storageId)).unique();
    if (existing) {
      if (existing.ownerId !== me._id) throw new ConvexError("That upload isn't yours.");
      return;
    }
    if (!(await ctx.db.system.get(storageId))) throw new ConvexError("The upload didn't arrive. Try again.");
    await ctx.db.insert("uploads", { storageId, ownerId: me._id, createdAt: Date.now() });
  },
});

/** Hourly: delete any upload older than an hour, registered or not. */
export const cleanup = internalMutation({
  args: {},
  handler: async (ctx) => {
    const cutoff = Date.now() - HOUR;
    let removed = 0;
    for (const f of await ctx.db.system.query("_storage").collect()) {
      if (f._creationTime < cutoff) {
        await ctx.storage.delete(f._id);
        removed++;
      }
    }
    for (const row of await ctx.db.query("uploads").withIndex("by_created", (q) => q.lt("createdAt", cutoff)).collect()) {
      await ctx.db.delete(row._id);
    }
    if (removed > 0) console.log(`Upload cleanup removed ${removed} file(s)`);
  },
});
