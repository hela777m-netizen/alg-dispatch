import type { Id } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";

/**
 * Display name for whoever wrote something. Current and past team members show their name.
 * Someone the owner deleted shows "Name (email), previously active", so their work stays readable.
 */
export function nameResolver(ctx: QueryCtx) {
  const cache = new Map<string, string>();
  return async (id: Id<"members">): Promise<string> => {
    const hit = cache.get(id);
    if (hit) return hit;
    const m = await ctx.db.get(id);
    let name: string;
    if (m) name = m.name;
    else {
      const f = await ctx.db.query("formerMembers").withIndex("by_member", (q) => q.eq("memberId", id)).first();
      name = f ? `${f.name}${f.email ? ` (${f.email})` : ""}, previously active` : "Former member";
    }
    cache.set(id, name);
    return name;
  };
}
