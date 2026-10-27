export const KINDS = ["activity", "meeting", "deal", "blocker", "ask", "next"] as const;
export type Kind = (typeof KINDS)[number];

export const KIND_LABEL: Record<Kind, string> = {
  activity: "Work done",
  meeting: "Meeting",
  deal: "Deal",
  blocker: "Blocker",
  ask: "Ask of HQ",
  next: "Next two weeks",
};

export const STAGES = ["lead", "engaged", "diligence", "terms", "closing", "closed", "lost"] as const;
export type Stage = (typeof STAGES)[number];

export const STAGE_LABEL: Record<Stage, string> = {
  lead: "Lead",
  engaged: "Engaged",
  diligence: "Diligence",
  terms: "Terms",
  closing: "Closing",
  closed: "Closed",
  lost: "Lost",
};

export const STATUS_LABEL: Record<string, string> = {
  missing: "Not started",
  draft: "Draft",
  submitted: "Sent",
  reviewed: "Reviewed",
  needs_info: "Needs info",
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT_MONTHS = MONTHS.map((m) => m.slice(0, 3));
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "5 to 18 October" or "28 September to 11 October" */
export function rangeLabel(start: string, end: string): string {
  const a = parts(start);
  const b = parts(end);
  if (a.m === b.m) return `${a.d} to ${b.d} ${MONTHS[b.m - 1]}`;
  return `${a.d} ${MONTHS[a.m - 1]} to ${b.d} ${MONTHS[b.m - 1]}`;
}

export function shortDate(date: string): string {
  const p = parts(date);
  return `${DAYS[p.dow]} ${p.d} ${SHORT_MONTHS[p.m - 1]}`;
}

export function dayParts(date: string) {
  const p = parts(date);
  return { day: DAYS[p.dow].slice(0, 1), dow: p.dow, num: p.d };
}

export function localTime(timezone: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit" }).format(now);
  } catch {
    return "";
  }
}

export function money(valueM: number | undefined): string {
  if (valueM === undefined) return "";
  if (valueM >= 1000) return `USD ${(valueM / 1000).toFixed(valueM >= 10000 ? 0 : 1)}bn`;
  if (valueM >= 100) return `USD ${Math.round(valueM)}m`;
  return `USD ${valueM.toFixed(valueM % 1 === 0 ? 0 : 1)}m`;
}

export function moneyShort(valueM: number): { value: string; unit: string } {
  if (valueM >= 1000) return { value: (valueM / 1000).toFixed(1), unit: "bn" };
  return { value: valueM >= 100 ? String(Math.round(valueM)) : valueM.toFixed(valueM % 1 === 0 ? 0 : 1), unit: "m" };
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function timeAgo(ms: number, now: number = Date.now()): string {
  const s = Math.round((now - ms) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  return d === 1 ? "yesterday" : `${d} days ago`;
}

export function errorText(err: unknown): string {
  const data = (err as { data?: unknown })?.data;
  if (typeof data === "string") return data;
  // Unexpected server errors carry a request ID; show it so support can find the log line.
  const msg = err instanceof Error ? err.message : "";
  const ref = msg.match(/Request ID: ([\w-]+)/)?.[1];
  if (/connection|network|failed to fetch/i.test(msg)) return "Can't reach the server. Check your connection; nothing was saved.";
  return ref ? `Something went wrong (ref ${ref}). Try again; if it repeats, send the reference to the administrator.` : "Something went wrong. Try again.";
}
