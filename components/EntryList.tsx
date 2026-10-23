"use client";

import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useApp } from "./AppContext";
import EntryForm, { tidy, type EntryDraft } from "./EntryForm";
import { Empty, KindMark, StageTrack } from "./bits";
import ResponseBox from "./ResponseBox";
import Link from "next/link";
import { errorText, money, shortDate, STAGE_LABEL } from "@/lib/format";

type Entry = Doc<"entries"> & { authorName: string; responses?: number };

export default function EntryList({
  entries,
  showAuthor = true,
  showGeo = true,
  empty,
}: {
  entries: Entry[] | undefined;
  showAuthor?: boolean;
  showGeo?: boolean;
  empty: React.ReactNode;
}) {
  if (entries === undefined) return <p className="faint">Loading updates</p>;
  if (entries.length === 0) return <Empty>{empty}</Empty>;
  return (
    <div className="list">
      {entries.map((e) => <Row key={e._id} entry={e} showAuthor={showAuthor} showGeo={showGeo} />)}
    </div>
  );
}

function Row({ entry, showAuthor, showGeo }: { entry: Entry; showAuthor: boolean; showGeo: boolean }) {
  const { member, isOwner, isLead, geoName, toast } = useApp();
  const [editing, setEditing] = useState<EntryDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const update = useMutation(api.entries.update);
  const remove = useMutation(api.entries.remove);
  const canEdit = entry.authorId === member._id || isOwner;

  if (editing) {
    return (
      <div className="item" style={{ gridTemplateColumns: "1fr" }}>
        <EntryForm value={editing} onChange={setEditing} idPrefix={entry._id} />
        {err && <p className="notice error">{err}</p>}
        <div className="row end">
          <button className="btn quiet sm" onClick={() => setEditing(null)}>Cancel</button>
          <button
            className="btn sm"
            disabled={busy || !editing.title.trim()}
            onClick={async () => {
              setBusy(true);
              setErr(null);
              try {
                await update({ id: entry._id, ...tidy(editing) });
                setEditing(null);
                toast("Update saved");
              } catch (e) {
                setErr(errorText(e));
              } finally {
                setBusy(false);
              }
            }}
          >
            Save update
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="item">
      <div className="when meta">{shortDate(entry.date)}</div>
      <div>
        <div className="title">{entry.title}</div>
        {entry.details && <p className="details">{entry.details}</p>}
        <div className="tags">
          <KindMark kind={entry.kind} />
          {showGeo && <span>{geoName(entry.geography)}</span>}
          {entry.counterparty && <span>With {entry.counterparty}</span>}
          {entry.kind === "deal" && entry.dealStage && (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
              {STAGE_LABEL[entry.dealStage]} <StageTrack stage={entry.dealStage} />
            </span>
          )}
          {entry.dealValue !== undefined && <span>{money(entry.dealValue)}</span>}
          {showAuthor && (isLead ? <Link href={`/people/${entry.authorId}`} className="tag-link">{entry.authorName}</Link> : <span>{entry.authorName}</span>)}
          {entry.source === "voice" && <span>Dictated</span>}
          {entry.editedBy && <span>Edited by owner</span>}
          {(() => {
            const n = entry.responses ?? 0;
            const urgent = entry.kind === "blocker" || entry.kind === "ask";
            const own = entry.authorId === member._id;
            if (n === 0 && (own || (!urgent && !isLead))) return null;
            const label = n > 0 ? `${n} response${n === 1 ? "" : "s"}` : "Respond";
            return (
              <button type="button" className={`tag-btn ${urgent && n === 0 ? "is-urgent" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
                {open ? "Hide" : label}
              </button>
            );
          })()}
        </div>
        {open && <ResponseBox entryId={entry._id} about={entry.title} authorName={entry.authorName} />}
      </div>
      {canEdit && (
        <div className="item-actions">
          <button
            onClick={() =>
              setEditing({
                geography: entry.geography,
                kind: entry.kind,
                title: entry.title,
                details: entry.details,
                counterparty: entry.counterparty,
                dealStage: entry.dealStage,
                dealValue: entry.dealValue,
                date: entry.date,
              })
            }
          >
            Edit
          </button>
          <button
            className="del"
            onClick={async () => {
              if (!window.confirm("Delete this update?")) return;
              try {
                await remove({ id: entry._id });
                toast("Update deleted");
              } catch (e) {
                toast(errorText(e));
              }
            }}
          >
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
