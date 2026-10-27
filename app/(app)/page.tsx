"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "@/components/AppContext";
import CycleRibbon from "@/components/CycleRibbon";
import EntryList from "@/components/EntryList";
import AvailabilityPanel from "@/components/Availability";
import WorldMap from "@/components/WorldMap";
import { PresenceTag } from "@/components/Presence";
import { Empty, KindMark, Mix, Spark, StageTrack, Status } from "@/components/bits";
import { useClock } from "@/lib/useClock";
import { localTime, money, moneyShort, shortDate, STAGE_LABEL } from "@/lib/format";

export default function OverviewPage() {
  const { member } = useApp();
  const router = useRouter();
  const [ready, setReady] = useState(member.role !== "reporter");

  // Reporters land on their desk once per visit; the overview stays one click away.
  useEffect(() => {
    if (member.role !== "reporter") return;
    let landed = false;
    try {
      landed = sessionStorage.getItem("dispatch-landed") === "1";
      sessionStorage.setItem("dispatch-landed", "1");
    } catch { /* storage blocked */ }
    if (landed) setReady(true);
    else router.replace("/desk");
  }, [member.role, router]);

  if (!ready) return null;
  return <Overview />;
}

function Overview() {
  const { cycle, isLead, geoName } = useApp();
  const data = useQuery(api.dashboard.overview, { cycle });
  const entries = useQuery(api.entries.forCycle, { cycle });
  const now = useClock();
  const team = useQuery(api.members.team, isLead ? {} : "skip");
  const [view, setView] = useState<"map" | "list">("map");
  const [selected, setSelected] = useState<string | null>(null);

  // Remember the viewer's choice; phones default to the list.
  useEffect(() => {
    try {
      const saved = localStorage.getItem("overview-view");
      if (saved === "map" || saved === "list") return setView(saved);
    } catch { /* storage blocked */ }
    if (window.matchMedia("(max-width: 640px)").matches) setView("list");
  }, []);
  const chooseView = (v: "map" | "list") => {
    setView(v);
    try { localStorage.setItem("overview-view", v); } catch { /* storage blocked */ }
  };

  return (
    <>
      <CycleRibbon perDay={data?.perDay} />

      <div className="section kpis" aria-label="This cycle in numbers">
        <Kpi value={data?.totals.updates} label="Updates logged" />
        <Kpi value={data?.totals.meetings} label="Meetings" />
        <Kpi value={data?.totals.activeDeals} label="Live deals" />
        <Kpi
          value={data ? moneyShort(data.totals.openValue).value : undefined}
          unit={data ? moneyShort(data.totals.openValue).unit : ""}
          label="Open pipeline, USD"
        />
        <Kpi value={data?.totals.blockers} label="Blockers" />
      </div>

      {isLead && team && team.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h2 className="h2">Team today</h2>
            <span className="small faint">Only what people choose to share</span>
          </div>
          <div className="team-strip">
            {team.map((m) => (
              <Link key={m._id} href={`/people/${m._id}`}>
                <span className="who-name">{m.name}</span>
                <PresenceTag p={m} />
              </Link>
            ))}
          </div>
          <AvailabilityPanel />
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="h2">Geographies</h2>
          <div className="segmented" role="group" aria-label="Geographies view">
            <button aria-pressed={view === "map"} onClick={() => chooseView("map")}>Map</button>
            <button aria-pressed={view === "list"} onClick={() => chooseView("list")}>List</button>
          </div>
        </div>
        {view === "map" && data && (
          <WorldMap
            geos={data.byGeo}
            roster={data.roster}
            entries={entries}
            pipeline={data.pipeline}
            selected={selected}
            onSelect={setSelected}
            now={now}
          />
        )}
        {view === "list" && <div className="panel flush board">
          {data === undefined && <p className="faint" style={{ padding: 20 }}>Loading</p>}
          {data?.byGeo.map((g) => {
            const who = data.roster.filter((r) => r.geography === g.key);
            return (
              <Link key={g.key} href={`/geo/${g.key}`} className="geo-row">
                <div>
                  <div className="geo-name">{g.name}</div>
                  <div className="geo-time">{g.office ? `${g.region}, ${localTime(g.timezone, now)}` : "Market, no ALG office"}</div>
                </div>
                <div className="geo-total">
                  <span className="num">{g.total}</span>
                  <span className="sr-only"> updates</span>
                </div>
                <div>
                  <Spark values={g.trend} label={`Updates per cycle: ${g.trend.join(", ")}`} />
                  <Mix counts={g.counts} total={g.total} />
                </div>
                <div className="geo-latest">
                  {g.latest ? <>{g.latest.title}<span className="faint">, {shortDate(g.latest.date)}</span></> : <span className="faint">Nothing logged yet</span>}
                </div>
                <div className="geo-who">
                  {who.map((w) => (
                    <span key={w.memberId} className="row small" style={{ gap: 6 }}>
                      <span className="faint">{w.name.split(" ")[0]}</span>
                      <Status status={w.status} />
                    </span>
                  ))}
                </div>
              </Link>
            );
          })}
        </div>}
        {data === undefined && view === "map" && <p className="faint">Loading</p>}
      </section>

      <div className="section grid-2">
        <section>
          <div className="section-head">
            <h2 className="h2">Pipeline</h2>
            <span className="small faint">Latest stage of every deal</span>
          </div>
          <div className="panel scroll-x">
            {data && data.pipeline.length === 0 ? (
              <Empty>Deals appear here once someone logs one.</Empty>
            ) : (
              <table className="table">
                <thead>
                  <tr><th>Deal</th><th>Stage</th><th className="right">Size</th></tr>
                </thead>
                <tbody>
                  {data?.pipeline.map((d) => (
                    <tr key={d.id} style={{ opacity: d.stage === "lost" ? 0.55 : 1 }}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{d.title}</div>
                        <div className="small faint">{geoName(d.geography)}, {d.owner}{d.counterparty ? `, with ${d.counterparty}` : ""}</div>
                      </td>
                      <td>
                        <div className="small">{STAGE_LABEL[d.stage]}</div>
                        <StageTrack stage={d.stage} />
                      </td>
                      <td className="right">{money(d.value) || <span className="faint">Not given</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>

        <section>
          <div className="section-head">
            <h2 className="h2">Blockers and asks</h2>
          </div>
          <div className="panel">
            {data && data.blockers.length === 0 ? (
              <p className="muted" style={{ margin: 0 }}>Nothing stuck this cycle.</p>
            ) : (
              <div className="list">
                {data?.blockers.map((b) => (
                  <div key={b.id} className="item" style={{ gridTemplateColumns: "1fr" }}>
                    <div>
                      <div className="title">{b.title}</div>
                      <div className="tags"><KindMark kind={b.kind} /><span>{geoName(b.geography)}</span><span>{b.author}</span></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isLead && (
            <>
              <div className="section-head" style={{ marginTop: 28 }}>
                <h2 className="h2">Reports this cycle</h2>
                <Link href="/reviews" className="small">Open reviews</Link>
              </div>
              <div className="panel">
                <table className="table">
                  <tbody>
                    {data?.roster.map((r) => (
                      <tr key={`${r.memberId}-${r.geography}`}>
                        <td>
                          <Link href={`/people/${r.memberId}`} className="tag-link" style={{ fontWeight: 600 }}>{r.name}</Link>
                          <div className="small faint">{geoName(r.geography)}, {r.entries} update{r.entries === 1 ? "" : "s"}{r.linked ? "" : ", hasn't signed in yet"}</div>
                        </td>
                        <td className="right">
                          {r.reportId ? <Link href={`/reviews?report=${r.reportId}`}><Status status={r.status} /></Link> : <Status status={r.status} />}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-head">
          <h2 className="h2">All updates</h2>
        </div>
        <div className="panel">
          <EntryList entries={entries} empty="No updates in this cycle yet." />
        </div>
      </section>
    </>
  );
}

function Kpi({ value, unit, label }: { value: number | string | undefined; unit?: string; label: string }) {
  return (
    <div className="kpi">
      <span className="num">{value ?? " "}{unit && <span style={{ fontSize: "0.5em", marginLeft: 2 }}>{unit}</span>}</span>
      <span className="label">{label}</span>
    </div>
  );
}
