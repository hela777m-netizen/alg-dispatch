import { activePresence, currentStatus, type Presence, type Plan, type PlanKind } from "@/convex/lib/presence";
export { activePresence, currentStatus, type Presence, type Plan, type PlanKind };

export const PRESENCE_LABEL: Record<Presence, string> = {
  office: "In the office",
  travelling: "Travelling",
  remote: "Working remotely",
  leave: "On leave",
};

export const PLAN_LABEL: Record<PlanKind, string> = { travel: "Business travel", leave: "Leave", remote: "Working remotely" };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export function short(date: string) {
  const [, m, d] = date.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

type P = { presence?: Presence; location?: string; presenceUntil?: string };

export function presenceText(p: P, today: string): string | null {
  const a = activePresence(p, today);
  if (!a.presence && !a.location) return null;
  const parts: string[] = [];
  if (a.presence === "leave") parts.push(a.presenceUntil ? `On leave until ${short(a.presenceUntil)}` : "On leave");
  else if (a.presence === "travelling") parts.push(a.location ? `Travelling, ${a.location}` : "Travelling");
  else {
    if (a.location) parts.push(a.location);
    if (a.presence) parts.push(a.presence === "office" ? "in the office" : "remote");
  }
  if (a.presence === "travelling" && a.presenceUntil) parts.push(`until ${short(a.presenceUntil)}`);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
