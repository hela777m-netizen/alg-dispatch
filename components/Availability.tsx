"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "./AppContext";
import { PLAN_LABEL, short } from "@/lib/presence";

/** Who is away, what's coming up in the next two weeks, and who is away when reports are due. */
export default function AvailabilityPanel() {
  const { geoName } = useApp();
  const data = useQuery(api.availability.team);
  if (!data) return null;
  const { awayNow, upcoming, gaps, due } = data;
  if (awayNow.length + upcoming.length + gaps.length === 0) {
    return <p className="small faint" style={{ margin: "10px 0 0" }}>Nobody is away now or in the next two weeks.</p>;
  }
  return (
    <div className="avail">
      <div>
        <p className="eyebrow">Away now</p>
        {awayNow.length === 0 && <p className="small faint">Nobody</p>}
        <ul>
          {awayNow.map((a) => (
            <li key={a.memberId}>
              <Link href={`/people/${a.memberId}`}>{a.name}</Link>
              <span className="faint">
                {a.presence === "leave" ? " On leave" : ` Travelling${a.location ? `, ${a.location}` : ""}`}
                {a.until ? `, back ${short(a.until)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="eyebrow">Next two weeks</p>
        {upcoming.length === 0 && <p className="small faint">Nothing planned</p>}
        <ul>
          {upcoming.map((u) => (
            <li key={u.id}>
              <span className="avail-date">{short(u.start)}{u.end !== u.start ? ` to ${short(u.end)}` : ""}</span>
              <Link href={`/people/${u.memberId}`}>{u.name}</Link>
              <span className="faint">
                {` ${PLAN_LABEL[u.kind]}`}{u.place ? `, ${u.place}` : ""}{u.note ? ` (${u.note})` : ""}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="eyebrow">Away when reports are due, {short(due)}</p>
        {gaps.length === 0 && <p className="small faint">Everyone expected is around</p>}
        <ul>
          {gaps.map((g) => (
            <li key={g.memberId}>
              <Link href={`/people/${g.memberId}`}>{g.name}</Link>
              <span className="faint">{` ${g.geographies.map(geoName).join(", ")}`}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
