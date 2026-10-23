"use client";

import { useApp } from "./AppContext";
import { cycleDays, cycleRange } from "@/convex/lib/cycles";
import { dayParts, rangeLabel } from "@/lib/format";
import { useClock } from "@/lib/useClock";

/** Today's date and time where the viewer is, kept live. */
export function LiveDate() {
  const now = useClock();
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const NAMES: Record<string, string> = { "Asia/Dubai": "UAE", "Asia/Riyadh": "Saudi", "Europe/London": "UK", "America/Sao_Paulo": "São Paulo", "America/New_York": "New York" };
  const city = NAMES[zone] ?? zone.split("/").pop()?.replace(/_/g, " ") ?? "";
  const date = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit" }).format(now);
  return (
    <p className="live-date" suppressHydrationWarning>
      <time dateTime={now.toISOString()}>{date}, {time}</time>
      {city && <span className="faint"> {city} time</span>}
    </p>
  );
}

export default function CycleRibbon({
  perDay = {},
  title,
  note,
}: {
  perDay?: Record<string, number>;
  title?: React.ReactNode;
  note?: React.ReactNode;
}) {
  const { cycle, setCycle, currentCycle, anchor, today } = useApp();
  const days = cycleDays(cycle, anchor);
  const { start, end } = cycleRange(cycle, anchor);
  const max = Math.max(1, ...days.map((d) => perDay[d] ?? 0));
  const daysLeft = days.filter((d) => d >= today).length;
  const isCurrent = cycle === currentCycle;

  return (
    <section className="ribbon-wrap" aria-label="Reporting cycle">
      <div className="page-head" style={{ marginBottom: 6 }}>
        <div>
          <LiveDate />
          <h1 className="headline">{title ?? rangeLabel(start, end)}</h1>
          <p className="muted">
            {note ??
              (isCurrent
                ? `${daysLeft === 1 ? "Last day" : `${daysLeft} days left`} in this reporting cycle.`
                : cycle < currentCycle
                  ? "A past cycle. Reports here are read-only once sent."
                  : "A future cycle.")}
          </p>
        </div>
        <div className="ribbon-nav">
          {!isCurrent && (
            <button className="btn quiet sm" onClick={() => setCycle(currentCycle)}>This cycle</button>
          )}
          <button className="icon-btn" aria-label="Previous cycle" onClick={() => setCycle(cycle - 1)}>
            <Chevron dir="left" />
          </button>
          <button className="icon-btn" aria-label="Next cycle" onClick={() => setCycle(cycle + 1)} disabled={cycle >= currentCycle}>
            <Chevron dir="right" />
          </button>
        </div>
      </div>
      <div className="ribbon">
        {days.map((d, i) => {
          const n = perDay[d] ?? 0;
          const p = dayParts(d);
          const cls = [
            "day",
            d === today ? "today" : "",
            d > today ? "future" : "",
            p.dow === 0 || p.dow === 6 ? "weekend" : "",
            i === 7 ? "split-week" : "",
          ].join(" ");
          return (
            <div key={d} className={cls} title={`${n} update${n === 1 ? "" : "s"}`}>
              <div className="bar-slot">
                <div className={`bar ${n === 0 ? "zero" : ""}`} style={{ height: n === 0 ? 3 : `${Math.max(14, (n / max) * 100)}%` }} />
              </div>
              <div className="date">
                {p.day}
                <b>{p.num}</b>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
      <path d={dir === "left" ? "M9 2 4 7l5 5" : "M5 2l5 5-5 5"} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
