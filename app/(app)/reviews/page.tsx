"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useApp } from "@/components/AppContext";
import EntryList from "@/components/EntryList";
import { Thread } from "@/components/Report";
import { Empty, Status } from "@/components/bits";
import { cycleRange } from "@/convex/lib/cycles";
import { errorText, rangeLabel, timeAgo } from "@/lib/format";

export default function ReviewsPage() {
  return (
    <Suspense fallback={null}>
      <Reviews />
    </Suspense>
  );
}

function Reviews() {
  const { isLead, cycle, anchor, geoName } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [view, setView] = useState<"waiting" | "cycle">("waiting");
  const list = useQuery(api.reports.forReview, isLead ? (view === "waiting" ? {} : { cycle }) : "skip");
  const selected = params.get("report") as Id<"reports"> | null;

  if (!isLead) return <Empty>Reviews are for managers.</Empty>;

  const range = cycleRange(cycle, anchor);
  const select = (id: Id<"reports">) => router.replace(`/reviews?report=${id}`, { scroll: false });

  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="headline">Reviews</h1>
          <p className="muted">Read each report, comment, then mark it reviewed or send it back for more information.</p>
        </div>
        <div className="segmented" role="group" aria-label="Which reports">
          <button aria-pressed={view === "waiting"} onClick={() => setView("waiting")}>Waiting for review</button>
          <button aria-pressed={view === "cycle"} onClick={() => setView("cycle")}>{rangeLabel(range.start, range.end)}</button>
        </div>
      </div>

      <div className="split">
        <div className="panel flush">
          {list === undefined && <p className="faint" style={{ padding: 16 }}>Loading</p>}
          {list?.length === 0 && (
            <p className="muted" style={{ padding: 16, margin: 0 }}>
              {view === "waiting" ? "All caught up. Nothing waiting for review." : "No reports sent in this cycle yet."}
            </p>
          )}
          {list?.map((r) => {
            const rr = cycleRange(r.cycle, anchor);
            return (
              <button key={r._id} className="pick" aria-current={selected === r._id} onClick={() => select(r._id)}>
                <span className="row between" style={{ width: "100%" }}>
                  <strong>{r.authorName}</strong>
                  <Status status={r.status} />
                </span>
                <span className="small faint">
                  {geoName(r.geography)}, {rangeLabel(rr.start, rr.end)}
                  {r.submittedAt ? `, sent ${timeAgo(r.submittedAt)}` : ""}
                  {r.comments ? `, ${r.comments} comment${r.comments === 1 ? "" : "s"}` : ""}
                </span>
              </button>
            );
          })}
        </div>
        <div>{selected ? <ReportDetail id={selected} /> : <Empty>Pick a report to read it.</Empty>}</div>
      </div>
    </>
  );
}

function ReportDetail({ id }: { id: Id<"reports"> }) {
  const { geoName, anchor, toast } = useApp();
  const report = useQuery(api.reports.get, { id });
  const setStatus = useMutation(api.reports.setStatus);
  const entries = useQuery(api.entries.forCycle, report ? { cycle: report.cycle, geography: report.geography } : "skip");
  const [err, setErr] = useState<string | null>(null);

  if (report === undefined) return <p className="faint">Loading</p>;
  if (report === null) return <Empty>That report isn&apos;t available.</Empty>;

  const range = cycleRange(report.cycle, anchor);
  const own = entries?.filter((e) => e.authorId === report.authorId);

  async function mark(status: "reviewed" | "needs_info") {
    setErr(null);
    try {
      await setStatus({ id, status });
      toast(status === "reviewed" ? "Marked reviewed" : "Sent back for more information");
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 24 }}>
      <article className="panel stack">
        <div className="row between">
          <div>
            <h2 className="h2">{report.authorName}, {geoName(report.geography)}</h2>
            <p className="small faint" style={{ margin: "4px 0 0" }}>
              {rangeLabel(range.start, range.end)}
              {report.reviewerName && report.reviewedAt ? `. ${report.status === "reviewed" ? "Reviewed" : "Sent back"} by ${report.reviewerName} ${timeAgo(report.reviewedAt)}` : ""}
            </p>
          </div>
          <Status status={report.status} />
        </div>
        <p className="report-text">{report.summary}</p>
        {err && <p className="notice error">{err}</p>}
        <div className="row end">
          <button className="btn quiet sm" disabled={report.status === "needs_info"} onClick={() => mark("needs_info")}>Ask for more info</button>
          <button className="btn sm" disabled={report.status === "reviewed"} onClick={() => mark("reviewed")}>Mark reviewed</button>
        </div>
        <h3 className="h3" style={{ marginTop: 8 }}>Comments</h3>
        <Thread reportId={id} />
      </article>

      <section>
        <div className="section-head"><h2 className="h2">Updates behind this report</h2></div>
        <div className="panel">
          <EntryList entries={own} showAuthor={false} showGeo={false} empty="No individual updates were logged for this report." />
        </div>
      </section>
    </div>
  );
}
