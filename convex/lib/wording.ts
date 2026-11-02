// Date wording for the Word business update, in the house style:
// "Tuesday 20 October, 14:00 to 15:00", "Wednesday 28 to Thursday 29 October".
// Shared by the server and the browser.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function parts(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return { y, m, d, dow: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
}

/** "Tuesday 20 October", with ", 14:00 to 15:00" or ", 14:00" when times are given. */
export function whenText(date: string, startTime?: string, endTime?: string): string {
  const p = parts(date);
  const day = `${DAYS[p.dow]} ${p.d} ${MONTHS[p.m - 1]}`;
  if (!startTime) return day;
  return `${day}, ${startTime}${endTime ? ` to ${endTime}` : ""}`;
}

/** "Friday 30 October", "Wednesday 28 to Thursday 29 October", "Friday 30 October to Monday 2 November". */
export function spanText(start: string, end: string): string {
  if (start === end) return whenText(start);
  const a = parts(start);
  const b = parts(end);
  const right = `${DAYS[b.dow]} ${b.d} ${MONTHS[b.m - 1]}`;
  if (a.y === b.y && a.m === b.m) return `${DAYS[a.dow]} ${a.d} to ${right}`;
  return `${DAYS[a.dow]} ${a.d} ${MONTHS[a.m - 1]} to ${right}`;
}

/** "21 December 2026 to 2 January 2027" */
export function plainSpan(start: string, end: string): string {
  const f = (x: string) => {
    const p = parts(x);
    return `${p.d} ${MONTHS[p.m - 1]} ${p.y}`;
  };
  return start === end ? f(start) : `${f(start)} to ${f(end)}`;
}

/** "261029" for 2026-10-29. */
export function stamp(date: string): string {
  return date.slice(2, 4) + date.slice(5, 7) + date.slice(8, 10);
}

/** "29/10/2026" */
export function slashDate(date: string): string {
  return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`;
}

/** "Q4" and the quarter's last day, for the leave section. */
export function quarterOf(date: string): { label: string; end: string } {
  const { y, m } = parts(date);
  const q = Math.floor((m - 1) / 3) + 1;
  const endMonth = q * 3;
  const lastDay = new Date(Date.UTC(y, endMonth, 0)).getUTCDate();
  return { label: `Q${q}`, end: `${y}-${String(endMonth).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}` };
}

export function addDays(date: string, days: number): string {
  const { y, m, d } = parts(date);
  return new Date(Date.UTC(y, m - 1, d) + days * 86_400_000).toISOString().slice(0, 10);
}
