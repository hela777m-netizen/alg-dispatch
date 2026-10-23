"use client";

import { useState } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useApp } from "./AppContext";
import { useDictation } from "@/lib/useDictation";
import { errorText, timeAgo } from "@/lib/format";

/** Replies on one update: read the thread, then speak or type a response, tidy it with Claude, and post. */
export default function ResponseBox({ entryId, about, authorName }: { entryId: Id<"entries">; about: string; authorName: string }) {
  const { toast, member } = useApp();
  const thread = useQuery(api.entries.responses, { entryId });
  const respond = useMutation(api.entries.respond);
  const polish = useAction(api.ai.polish);
  const [text, setText] = useState("");
  const [original, setOriginal] = useState<string | null>(null);
  const [usedVoice, setUsedVoice] = useState(false);
  const [busy, setBusy] = useState<"tidy" | "post" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const dictation = useDictation((phrase) => {
    setUsedVoice(true);
    setOriginal(null);
    setText((t) => (t ? `${t.trimEnd()} ${phrase}` : phrase));
  });
  const firstName = authorName.split(" ")[0];
  const isAuthorOwn = authorName === member.name;

  return (
    <div className="reply">
      {thread && thread.length > 0 && (
        <div className="thread">
          {thread.map((r) => (
            <div key={r._id} className={`bubble ${r.mine ? "mine" : ""}`}>
              <div className="by">{r.mine ? "You" : r.authorName}, {timeAgo(r.createdAt)}{r.source === "voice" ? ", dictated" : ""}</div>
              <div style={{ whiteSpace: "pre-wrap" }}>{r.body}</div>
            </div>
          ))}
        </div>
      )}

      <div className="reply-compose">
        {dictation.supported && (
          <button
            type="button"
            className={`mic sm ${dictation.listening ? "live" : ""}`}
            aria-label={dictation.listening ? "Stop dictation" : "Record a response"}
            aria-pressed={dictation.listening}
            onClick={() => (dictation.listening ? dictation.stop() : dictation.start("en-GB"))}
          >
            {dictation.listening ? (
              <svg width="14" height="14" viewBox="0 0 20 20" aria-hidden="true"><rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" /><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
            )}
          </button>
        )}
        <textarea
          className="textarea"
          rows={2}
          aria-label={`Response to ${firstName}`}
          placeholder={isAuthorOwn ? "Add a reply" : `Speak or type your response to ${firstName}`}
          value={text}
          onChange={(e) => { setText(e.target.value); setOriginal(null); }}
        />
      </div>
      {dictation.interim && <p className="interim small" style={{ margin: 0 }}>{dictation.interim}</p>}
      {err && <p className="notice error" style={{ margin: 0 }}>{err}</p>}
      <div className="row end">
        {original !== null && (
          <button className="btn quiet sm" onClick={() => { setText(original); setOriginal(null); }}>Undo tidy</button>
        )}
        <button
          className="btn quiet sm"
          disabled={busy !== null || text.trim().length < 4 || original !== null}
          onClick={async () => {
            dictation.stop();
            setErr(null);
            setBusy("tidy");
            try {
              const tidy = await polish({ text, about });
              setOriginal(text);
              setText(tidy);
            } catch (e) {
              setErr(errorText(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "tidy" ? "Tidying" : "Tidy with Claude"}
        </button>
        <button
          className="btn sm"
          disabled={busy !== null || !text.trim()}
          onClick={async () => {
            dictation.stop();
            setErr(null);
            setBusy("post");
            try {
              await respond({ entryId, body: text, source: usedVoice ? "voice" : "typed" });
              setText("");
              setOriginal(null);
              setUsedVoice(false);
              toast(isAuthorOwn ? "Reply posted" : `Response sent to ${firstName}`);
            } catch (e) {
              setErr(errorText(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          {busy === "post" ? "Posting" : "Post response"}
        </button>
      </div>
    </div>
  );
}
