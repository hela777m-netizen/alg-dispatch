"use client";

import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "@/components/AppContext";
import CycleRibbon from "@/components/CycleRibbon";
import Composer from "@/components/Composer";
import EntryList from "@/components/EntryList";
import { ReportSlot } from "@/components/Report";
import { Status } from "@/components/bits";
import { cycleRange } from "@/convex/lib/cycles";
import { rangeLabel } from "@/lib/format";

export default function DeskPage() {
  const { member, cycle, currentCycle, loggable, anchor, geoName } = useApp();
  const mine = useQuery(api.entries.forCycle, { cycle, mineOnly: true });
  const slots = useQuery(api.reports.mine, { cycle });
  const history = useQuery(api.reports.myHistory);

  const perDay = (mine ?? []).reduce<Record<string, number>>((acc, e) => {
    acc[e.date] = (acc[e.date] ?? 0) + 1;
    return acc;
  }, {});
  const first = member.name.split(" ")[0];
  const defaultGeo = member.geographies[0] ?? loggable[0]?.key ?? "uae";
  const canLog = cycle === currentCycle;

  return (
    <>
      <CycleRibbon perDay={perDay} title={cycle === currentCycle ? `${first}'s desk` : undefined} />

      <div className="section grid-2">
        <div className="stack" style={{ gap: 28 }}>
          {canLog ? (
            <Composer defaultGeography={defaultGeo} />
          ) : (
            <p className="notice">You&apos;re looking at a past cycle. Go back to this cycle to log new updates.</p>
          )}
          <section>
            <div className="section-head">
              <h2 className="h2">My updates</h2>
              <span className="small faint">{mine?.length ?? 0} this cycle</span>
            </div>
            <div className="panel">
              <EntryList entries={mine} showAuthor={false} empty="Nothing logged in this cycle yet. Talk it through above." />
            </div>
          </section>
        </div>

        <section className="stack" style={{ gap: 16 }}>
          <div className="section-head" style={{ marginBottom: 0 }}>
            <h2 className="h2">Biweekly report</h2>
          </div>
          {slots === undefined && <p className="faint">Loading</p>}
          {slots?.length === 0 && (
            <p className="muted">Nothing to report on yet. Log an update and a report slot appears for that geography.</p>
          )}
          {slots?.map((s) => (
            <ReportSlot key={`${cycle}-${s.geography}`} {...s} />
          ))}

          {history && history.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <h3 className="h3" style={{ marginBottom: 8 }}>Earlier reports</h3>
              <table className="table">
                <tbody>
                  {history.map((r) => {
                    const range = cycleRange(r.cycle, anchor);
                    return (
                      <tr key={r._id}>
                        <td>
                          <div>{geoName(r.geography)}</div>
                          <div className="small faint">{rangeLabel(range.start, range.end)}{r.comments ? `, ${r.comments} comment${r.comments === 1 ? "" : "s"}` : ""}</div>
                        </td>
                        <td className="right"><Status status={r.status} /></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
