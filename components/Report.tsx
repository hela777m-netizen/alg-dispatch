"use client";

import { useEffect, useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useApp } from "./AppContext";
import { Status } from "./bits";
import { errorText, timeAgo } from "@/lib/format";

/** A reporter's biweekly report for one geography: write, draft with AI, send, see feedback. */
export function ReportSlot({
  geography,
  expected,
  entryCount,
  report,
  comments,
}: {
  geography: string;
  expected: boolean;
  entryCount: number;
  report: Doc<"reports"> | null;
  comments: number;
}) {
  const { cycle, currentCycle, geoName, toast } = useApp();
  const [text, setText] = useState(report?.summary ?? "");
  const [busy, setBusy] = useState<"draft" | "save" | "send" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showThread, setShowThread] = useState(false);
  const save = useMutation(api.reports.save);
  const draft = useAction(api.ai.draftSummary);

  useEffect(() => setText(report?.summary ?? ""), [report?._id, report?.summary]);

  const status = report?.status ?? "missing";
  const locked = status === "submitted" || status === "reviewed";
  const dirty = text !== (report?.summary ?? "");
  const past = cycle < currentCycle;

  async function run(kind: "save" | "send") {
    setErr(null);
    setBusy(kind);
    try {
      await save({ geography, cycle, summary: text, submit: kind === "send" });
      toast(kind === "send" ? "Report sent to Amy" : "Draft saved");
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="panel stack">
      <div className="row between">
        <div>
          <h3 className="h2">{geoName(geography)}</h3>
          <p className="small faint" style={{ margin: "4px 0 0" }}>
            {entryCount} update{entryCount === 1 ? "" : "s"} logged{expected ? "" : ", occasional geography"}
          </p>
        </div>
        <Status status={status} />
      </div>

      {status === "needs_info" && <p className="notice error">Amy asked for more information. See the comments, update the report and send it again.</p>}

      {locked ? (
        <p className="report-text">{report?.summary}</p>
      ) : (
        <textarea
          className="textarea"
          rows={9}
          aria-label={`${geoName(geography)} report`}
          placeholder="Highlights, pipeline, blockers and asks, next two weeks. Or draft it from your updates."
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
      )}

      {err && <p className="notice error" role="alert">{err}</p>}

      <div className="row between">
        <div className="row">
          {(report && comments > 0) || report?.status === "needs_info" ? (
            <button className="btn quiet sm" onClick={() => setShowThread((s) => !s)}>
              {showThread ? "Hide comments" : `Comments${comments ? ` (${comments})` : ""}`}
            </button>
          ) : null}
          {report?.submittedAt && <span className="small faint">Sent {timeAgo(report.submittedAt)}</span>}
        </div>
        {!locked && (
          <div className="row">
            <button
              className="btn quiet sm"
              disabled={busy !== null || entryCount === 0}
              title={entryCount === 0 ? "Log updates first" : undefined}
              onClick={async () => {
                if (text.trim() && !window.confirm("Replace what you've written with a fresh draft?")) return;
                setErr(null);
                setBusy("draft");
                try {
                  setText(await draft({ geography, cycle }));
                } catch (e) {
                  setErr(errorText(e));
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === "draft" ? "Drafting" : "Draft from my updates"}
            </button>
            <button className="btn quiet sm" disabled={busy !== null || !dirty} onClick={() => run("save")}>
              {busy === "save" ? "Saving" : "Save draft"}
            </button>
            <button className="btn sm" disabled={busy !== null || text.trim().length < 20} onClick={() => run("send")}>
              {busy === "send" ? "Sending" : past ? "Send late report" : "Send report"}
            </button>
          </div>
        )}
      </div>

      {showThread && report && <Thread reportId={report._id} />}
    </article>
  );
}

export function Thread({ reportId }: { reportId: Id<"reports"> }) {
  const data = useQuery(api.reports.get, { id: reportId });
  const comment = useMutation(api.reports.comment);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (data === undefined) return <p className="faint small">Loading comments</p>;
  if (data === null) return null;

  return (
    <div className="stack">
      <div className="thread">
        {data.comments.length === 0 && <p className="faint small">No comments yet.</p>}
        {data.comments.map((c) => (
          <div key={c._id} className={`bubble ${c.mine ? "mine" : ""}`}>
            <div className="by">{c.mine ? "You" : c.authorName}, {timeAgo(c.createdAt)}</div>
            <div style={{ whiteSpace: "pre-wrap" }}>{c.body}</div>
          </div>
        ))}
      </div>
      <form
        className="row"
        style={{ flexWrap: "nowrap" }}
        onSubmit={async (e) => {
          e.preventDefault();
          if (!body.trim()) return;
          setBusy(true);
          setErr(null);
          try {
            await comment({ reportId, body });
            setBody("");
          } catch (x) {
            setErr(errorText(x));
          } finally {
            setBusy(false);
          }
        }}
      >
        <input className="input" aria-label="Write a comment" placeholder="Write a comment" value={body} onChange={(e) => setBody(e.target.value)} />
        <button className="btn sm" disabled={busy || !body.trim()}>Post</button>
      </form>
      {err && <p className="notice error">{err}</p>}
    </div>
  );
}
