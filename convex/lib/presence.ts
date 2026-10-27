// Current status rules, shared by the server and the browser so both give the same answer.

export type Presence = "office" | "travelling" | "remote" | "leave";
export type PlanKind = "travel" | "leave" | "remote";

export type PresenceFields = { presence?: Presence; location?: string; presenceUntil?: string };
export type Plan = { kind: PlanKind; start: string; end: string; place?: string; note?: string };

const PLAN_TO_PRESENCE: Record<PlanKind, Presence> = { travel: "travelling", leave: "leave", remote: "remote" };

/** Travel and leave lapse after their end date; office and remote stay until changed. */
export function activePresence(p: PresenceFields, today: string): PresenceFields {
  if ((p.presence === "leave" || p.presence === "travelling") && p.presenceUntil && p.presenceUntil < today) {
    return { location: p.presence === "travelling" ? undefined : p.location };
  }
  return p;
}

/** A plan covering today wins; otherwise the check-in applies. Future plans are never current. */
export function currentStatus(p: PresenceFields, plans: Plan[], today: string): PresenceFields & { fromPlan?: boolean } {
  const now = plans
    .filter((x) => x.start <= today && x.end >= today)
    .sort((a, b) => (a.kind === "leave" ? -1 : b.kind === "leave" ? 1 : a.start.localeCompare(b.start)))[0];
  if (now) {
    return {
      presence: PLAN_TO_PRESENCE[now.kind],
      location: now.kind === "leave" ? undefined : now.place,
      presenceUntil: now.end,
      fromPlan: true,
    };
  }
  return activePresence(p, today);
}
