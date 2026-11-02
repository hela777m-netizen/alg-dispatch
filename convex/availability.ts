import { v, ConvexError } from "convex/values";
import { mutation, query } from "./_generated/server";
import { clean, getAnchor, isLead, requireMember } from "./lib/access";
import { cycleOf, cycleRange, todayISO } from "./lib/cycles";
import { currentStatus } from "./lib/presence";

const kindValidator = v.union(v.literal("travel"), v.literal("leave"), v.literal("remote"));
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const AHEAD_DAYS = 14;

function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function check(start: string, end: string) {
  if (!DATE.test(start) || !DATE.test(end)) throw new ConvexError("Pick a start and end date.");
  if (end < start) throw new ConvexError("The end date is before the start date.");
  if (end > addDays(start, 366)) throw new ConvexError("Plans can run for a year at most.");
}

/** The viewer's own plans that haven't ended. */
export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    const today = todayISO();
    const rows = await ctx.db.query("availability").withIndex("by_member", (q) => q.eq("memberId", me._id)).collect();
    return rows.filter((r) => r.end >= today).sort((a, b) => a.start.localeCompare(b.start));
  },
});

export const save = mutation({
  args: {
    id: v.optional(v.id("availability")),
    kind: kindValidator,
    start: v.string(),
    end: v.string(),
    place: v.optional(v.string()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { id, kind, start, end, place, note }) => {
    const me = await requireMember(ctx);
    check(start, end);
    // Leave never asks where or why.
    const fields = {
      kind, start, end,
      place: kind === "leave" ? undefined : clean(place, 80),
      note: kind === "travel" ? clean(note, 80) : undefined,
      updatedAt: Date.now(),
    };
    if (id) {
      const row = await ctx.db.get(id);
      if (!row || row.memberId !== me._id) throw new ConvexError("You can only change your own plans.");
      await ctx.db.patch(id, fields);
      return id;
    }
    return await ctx.db.insert("availability", { memberId: me._id, ...fields });
  },
});

export const remove = mutation({
  args: { id: v.id("availability") },
  handler: async (ctx, { id }) => {
    const me = await requireMember(ctx);
    const row = await ctx.db.get(id);
    if (!row) return;
    if (row.memberId !== me._id) throw new ConvexError("You can only change your own plans.");
    await ctx.db.delete(id);
  },
});

/**
 * Team availability for managers: who is away now, what is coming up in the next two weeks,
 * and who is away on the day this cycle's reports are due. Reporters get an empty view.
 */
export const team = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireMember(ctx);
    if (!isLead(me)) return null;
    const today = todayISO();
    const horizon = addDays(today, AHEAD_DAYS);
    const anchor = await getAnchor(ctx);
    const due = cycleRange(cycleOf(today, anchor), anchor).end;
    const members = (await ctx.db.query("members").collect()).filter((m) => m.active);
    const names = new Map(members.map((m) => [m._id as string, m]));

    const plans = (await ctx.db.query("availability").withIndex("by_end", (q) => q.gte("end", today)).collect())
      .filter((p) => names.has(p.memberId) && p.start <= horizon);

    const awayNow = [];
    for (const m of members) {
      const mine = plans.filter((p) => p.memberId === m._id);
      const now = currentStatus(m, mine, today);
      if (now.presence === "leave" || now.presence === "travelling") {
        awayNow.push({ memberId: m._id, name: m.name, presence: now.presence, location: now.location, until: now.presenceUntil });
      }
    }
    const upcoming = plans
      .filter((p) => p.start > today)
      .sort((a, b) => a.start.localeCompare(b.start))
      .map((p) => ({ id: p._id, memberId: p.memberId, name: names.get(p.memberId)!.name, kind: p.kind, start: p.start, end: p.end, place: p.place, note: p.note }));

    // Expected reporters who are away on the day reports are due.
    const gaps = [];
    for (const m of members.filter((x) => x.geographies.length > 0)) {
      const mine = plans.filter((p) => p.memberId === m._id);
      const onDue = currentStatus(m, mine, due);
      const checkIn = m.presence === "leave" || m.presence === "travelling" ? m.presenceUntil : undefined;
      const away = (onDue.fromPlan && (onDue.presence === "leave" || onDue.presence === "travelling")) || (checkIn !== undefined && checkIn >= due);
      if (away) gaps.push({ memberId: m._id, name: m.name, geographies: m.geographies, due });
    }
    return { today, due, awayNow, upcoming, gaps };
  },
});
