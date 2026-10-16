// Biweekly reporting cycles, counted from an anchor Monday.
// Shared by the server and the browser so both agree on "this cycle".

export const DEFAULT_ANCHOR = "2026-10-05";
const DAY = 86_400_000;

function toUTC(date: string): number {
  const [y, m, d] = date.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

export function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Today's date in Abu Dhabi time, YYYY-MM-DD. */
export function todayISO(now: number = Date.now()): string {
  return isoDate(now + 4 * 3_600_000);
}

export function cycleOf(date: string, anchor: string = DEFAULT_ANCHOR): number {
  return Math.floor((toUTC(date) - toUTC(anchor)) / (14 * DAY));
}

export function cycleRange(cycle: number, anchor: string = DEFAULT_ANCHOR) {
  const start = toUTC(anchor) + cycle * 14 * DAY;
  return { start: isoDate(start), end: isoDate(start + 13 * DAY) };
}

export function cycleDays(cycle: number, anchor: string = DEFAULT_ANCHOR): string[] {
  const start = toUTC(anchor) + cycle * 14 * DAY;
  return Array.from({ length: 14 }, (_, i) => isoDate(start + i * DAY));
}
