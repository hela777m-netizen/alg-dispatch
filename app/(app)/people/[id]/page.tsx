"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useApp } from "@/components/AppContext";
import EntryList from "@/components/EntryList";
import { Empty, Status } from "@/components/bits";
import { MyPresence, PresenceTag } from "@/components/Presence";
import { cycleRange } from "@/convex/lib/cycles";
import { rangeLabel } from "@/lib/format";

const ROLE = { owner: "Owner", manager: "Manager", reporter: "Reporter" } as const;

export default function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { member, currentCycle, anchor, geoName } = useApp();
  const person = useQuery(api.members.person, { id: id as Id<"members"> });
  const entries = useQuery(api.entries.forPerson, { memberId: id as Id<"members">, fromCycle: currentCycle - 2 });

  if (person === undefined) return <p className="faint">Loading</p>;
  if (person === null) return <Empty>This profile isn&apos;t available to you. <Link href="/">Back to overview</Link></Empty>;

  const isMe = person._id === member._id;
  const thisCycle = entries?.filter((e) => e.cycle === currentCycle);
  const earlier = entries?.filter((e) => e.cycle < currentCycle);
  const geos = person.geographies;
  const blockers = thisCycle?.filter((e) => e.kind === "blocker" || e.kind === "ask").length ?? 0;

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="headline">{person.name}</h1>
          <p className="muted">
            {ROLE[person.role]}
            {person.title ? `, ${person.title}` : ""}
            {person.reportsToName ? `. Reports to ${person.reportsToName}` : ""}
            {person.left ? ". Has left ALG." : !person.linked ? ". Hasn't signed in yet." : ""}
          </p>
          <div style={{ marginTop: 14 }}>{isMe ? <MyPresence variant="card" /> : <PresenceTag p={person} />}</div>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><span className="num">{thisCycle?.length ?? " "}</span><span className="label">Updates this cycle</span></div>
        <div className="kpi"><span className="num">{blockers}</span><span className="label">Open blockers and asks</span></div>
        <div className="kpi"><span className="num">{person.reports.length}</span><span className="label">Reports sent</span></div>
        <div className="kpi" style={{ gridColumn: "span 2" }}>
          <span className="label" style={{ marginTop: 0 }}>Geographies</span>
          <div className="chips" style={{ marginTop: 10 }}>
            {geos.length === 0 && <span className="small faint">All, as {ROLE[person.role].toLowerCase()}</span>}
            {geos.map((g) => <Link key={g} href={`/geo/${g}`} className="chip" style={{ textDecoration: "none" }}>{geoName(g)}</Link>)}
          </div>
        </div>
      </div>

      <div className="section grid-2">
        <div className="stack" style={{ gap: 28 }}>
          <section>
            <div className="section-head"><h2 className="h2">This cycle</h2></div>
            <div className="panel"><EntryList entries={thisCycle} showAuthor={false} empty="Nothing logged this cycle yet." /></div>
          </section>
          <section>
            <div className="section-head"><h2 className="h2">Previous two cycles</h2></div>
            <div className="panel"><EntryList entries={earlier} showAuthor={false} empty="Nothing logged in the previous two cycles." /></div>
          </section>
        </div>
        <section>
          <div className="section-head"><h2 className="h2">Reports</h2></div>
          <div className="panel">
            {person.reports.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>No reports sent yet.</p>
            ) : (
              <table className="table">
                <tbody>
                  {person.reports.map((r) => {
                    const range = cycleRange(r.cycle, anchor);
                    return (
                      <tr key={r._id}>
                        <td>
                          <div>{geoName(r.geography)}</div>
                          <div className="small faint">{rangeLabel(range.start, range.end)}</div>
                        </td>
                        <td className="right">
                          {member.role !== "reporter" ? <Link href={`/reviews?report=${r._id}`}><Status status={r.status} /></Link> : <Status status={r.status} />}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}
