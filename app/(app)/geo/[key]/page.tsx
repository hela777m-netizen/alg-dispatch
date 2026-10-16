"use client";

import { use } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "@/components/AppContext";
import CycleRibbon from "@/components/CycleRibbon";
import EntryList from "@/components/EntryList";
import { Empty, Mix, StageTrack, Status } from "@/components/bits";
import { localTime, money, STAGE_LABEL } from "@/lib/format";
import { useClock } from "@/lib/useClock";

export default function GeographyPage({ params }: { params: Promise<{ key: string }> }) {
  const { key } = use(params);
  const { cycle, geographies, isLead } = useApp();
  const geo = geographies.find((g) => g.key === key);
  const data = useQuery(api.dashboard.overview, { cycle });
  const entries = useQuery(api.entries.forCycle, geo ? { cycle, geography: key } : "skip");
  const now = useClock();

  if (!geo) {
    return <Empty>That geography doesn&apos;t exist or isn&apos;t visible to you. <Link href="/">Back to overview</Link></Empty>;
  }

  const row = data?.byGeo.find((g) => g.key === key);
  const perDay = (entries ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.date] = (acc[e.date] ?? 0) + 1;
    return acc;
  }, {});
  const deals = data?.pipeline.filter((d) => d.geography === key) ?? [];
  const who = data?.roster.filter((r) => r.geography === key) ?? [];

  return (
    <>
      <CycleRibbon
        perDay={perDay}
        title={geo.name}
        note={`${geo.region}, ${localTime(geo.timezone, now)} local time. ${row ? `${row.total} update${row.total === 1 ? "" : "s"} this cycle.` : ""}`}
      />
      {row && <div style={{ maxWidth: 420, marginTop: 4 }}><Mix counts={row.counts} total={row.total} /></div>}

      <div className="section grid-2">
        <section>
          <div className="section-head"><h2 className="h2">Updates</h2></div>
          <div className="panel">
            <EntryList entries={entries} showGeo={false} empty={`No ${geo.name} updates in this cycle.`} />
          </div>
        </section>

        <div className="stack" style={{ gap: 28 }}>
          {who.length > 0 && (
            <section>
              <div className="section-head"><h2 className="h2">Reports</h2></div>
              <div className="panel">
                <table className="table">
                  <tbody>
                    {who.map((w) => (
                      <tr key={w.memberId}>
                        <td>{w.name}<div className="small faint">{w.entries} update{w.entries === 1 ? "" : "s"}</div></td>
                        <td className="right">
                          {isLead && w.reportId ? <Link href={`/reviews?report=${w.reportId}`}><Status status={w.status} /></Link> : <Status status={w.status} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          <section>
            <div className="section-head"><h2 className="h2">Deals</h2></div>
            <div className="panel">
              {deals.length === 0 ? (
                <p className="muted" style={{ margin: 0 }}>No deals logged for {geo.name} yet.</p>
              ) : (
                <table className="table">
                  <tbody>
                    {deals.map((d) => (
                      <tr key={d.id}>
                        <td>
                          <div style={{ fontWeight: 600 }}>{d.title}</div>
                          <div className="small faint">{d.owner}{d.counterparty ? `, with ${d.counterparty}` : ""}</div>
                        </td>
                        <td><div className="small">{STAGE_LABEL[d.stage]}</div><StageTrack stage={d.stage} /></td>
                        <td className="right">{money(d.value)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
