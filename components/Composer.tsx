"use client";

import { useRef, useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "./AppContext";
import EntryForm, { blankDraft, tidy, type EntryDraft } from "./EntryForm";
import { useDictation } from "@/lib/useDictation";
import { errorText } from "@/lib/format";

const LANGS = [
  { code: "en-GB", label: "English" },
  { code: "ar-AE", label: "Arabic" },
  { code: "fr-FR", label: "French" },
  { code: "pt-BR", label: "Portuguese" },
];

export default function Composer({ defaultGeography }: { defaultGeography: string }) {
  const { today, toast } = useApp();
  const [mode, setMode] = useState<"talk" | "single" | "upload">("talk");
  const [fileName, setFileName] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [lang, setLang] = useState("en-GB");
  const [drafts, setDrafts] = useState<EntryDraft[] | null>(null);
  const [single, setSingle] = useState<EntryDraft>(() => blankDraft(defaultGeography, today));
  const [busy, setBusy] = useState<"structuring" | "saving" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [usedVoice, setUsedVoice] = useState(false);

  const structure = useAction(api.ai.structure);
  const fromDocument = useAction(api.ai.fromDocument);
  const uploadUrl = useMutation(api.files.uploadUrl);
  const registerUpload = useMutation(api.files.register);
  // One code per batch, reused on retry, so a save that reached the server is never stored twice.
  const requestId = useRef<string | null>(null);
  const addMany = useMutation(api.entries.addMany);
  const dictation = useDictation((phrase) => {
    setUsedVoice(true);
    setText((t) => (t ? `${t.trimEnd()} ${phrase}` : phrase));
  });

  async function runStructure() {
    dictation.stop();
    setErr(null);
    setBusy("structuring");
    try {
      const result = await structure({ text, defaultGeography });
      if (result.length === 0) setErr("Couldn't find any updates in that. Add a bit more detail.");
      else setDrafts(result);
    } catch (e) {
      setErr(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function readFile(file: File) {
    setErr(null);
    setFileName(file.name);
    setBusy("structuring");
    try {
      const name = file.name.toLowerCase();
      let result;
      if (name.endsWith(".pdf")) {
        if (file.size > 8 * 1024 * 1024) throw new Error("That file is over 8 MB. Export a smaller PDF or split it.");
        const url = await uploadUrl({});
        const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/pdf" }, body: file });
        if (!res.ok) throw new Error("The upload failed. Try again.");
        const { storageId } = (await res.json()) as { storageId: string };
        await registerUpload({ storageId: storageId as never });
        result = await fromDocument({ storageId: storageId as never, defaultGeography });
      } else if (name.endsWith(".docx")) {
        const mammoth = await import("mammoth/mammoth.browser");
        const { value } = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
        result = await structure({ text: `This is an existing written report.\n\n${value}`, defaultGeography });
      } else if (name.endsWith(".txt") || name.endsWith(".md")) {
        result = await structure({ text: await file.text(), defaultGeography });
      } else {
        throw new Error("Use a PDF or Word (.docx) file. For an old .doc file, save it as .docx or PDF first.");
      }
      if (result.length === 0) setErr("Couldn't find any updates in that file.");
      else setDrafts(result);
    } catch (e) {
      setErr(e instanceof Error && !(e as { data?: unknown }).data ? e.message : errorText(e));
    } finally {
      setBusy(null);
    }
  }

  async function save(list: EntryDraft[], source: "voice" | "typed") {
    setErr(null);
    setBusy("saving");
    try {
      requestId.current ??= crypto.randomUUID();
      await addMany({ entries: list.map(tidy), source, requestId: requestId.current });
      requestId.current = null;
      toast(list.length === 1 ? "Update logged" : `${list.length} updates logged`);
      return true;
    } catch (e) {
      setErr(errorText(e));
      return false;
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="composer" aria-label="Log an update">
      <div className="row between">
        <h2 className="h2">Log an update</h2>
        <div className="segmented" role="group" aria-label="How to log">
          <button aria-pressed={mode === "talk"} onClick={() => setMode("talk")}>Talk it through</button>
          <button aria-pressed={mode === "single"} onClick={() => setMode("single")}>Add one item</button>
          <button aria-pressed={mode === "upload"} onClick={() => setMode("upload")}>Upload a report</button>
        </div>
      </div>

      {mode === "talk" && !drafts && (
        <>
          <div className="row" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 16 }}>
            {dictation.supported && (
              <button
                className={`mic ${dictation.listening ? "live" : ""}`}
                aria-label={dictation.listening ? "Stop dictation" : "Start dictation"}
                aria-pressed={dictation.listening}
                onClick={() => (dictation.listening ? dictation.stop() : dictation.start(lang))}
              >
                {dictation.listening ? <StopIcon /> : <MicIcon />}
              </button>
            )}
            <div className="stack" style={{ flex: 1, gap: 6 }}>
              <textarea
                className="textarea"
                rows={5}
                aria-label="Your update"
                placeholder="Say or type what happened: who you met, deals that moved, what's stuck, what's next."
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
              {dictation.interim && <p className="interim small">{dictation.interim}</p>}
            </div>
          </div>
          <div className="row between">
            <div className="row small faint">
              {dictation.supported ? (
                <>
                  <label htmlFor="dict-lang">Speaking in</label>
                  <select id="dict-lang" className="select" style={{ width: "auto", padding: "4px 8px" }} value={lang} disabled={dictation.listening} onChange={(e) => setLang(e.target.value)}>
                    {LANGS.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}
                  </select>
                </>
              ) : (
                <span>Dictation isn&apos;t available in this browser. Use the mic on your keyboard instead.</span>
              )}
            </div>
            <button className="btn" disabled={busy !== null || text.trim().length < 8} onClick={runStructure}>
              {busy === "structuring" ? "Sorting it out" : "Turn into updates"}
            </button>
          </div>
          {dictation.error && <p className="notice">{dictation.error}</p>}
        </>
      )}

      {mode === "upload" && !drafts && (
        <label className={`dropzone ${busy ? "is-busy" : ""}`}>
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            className="sr-only"
            disabled={busy !== null}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) readFile(f);
            }}
          />
          <strong>{busy === "structuring" ? `Reading ${fileName ?? "the file"}` : "Choose a PDF or Word report"}</strong>
          <span className="small faint">
            {busy === "structuring"
              ? "This can take up to a minute for a long report."
              : "Claude reads it, files each item under the right geography, and you check everything before saving. The file itself isn't kept."}
          </span>
        </label>
      )}

      {mode !== "single" && drafts && (
        <>
          <p className="muted" style={{ margin: 0 }}>
            {drafts.length === 1 ? "One update" : `${drafts.length} updates`} found{mode === "upload" && fileName ? ` in ${fileName}` : ""}. Each is filed under the geography it's about. Check them, fix anything, then save.
          </p>
          {drafts.map((d, i) => (
            <div className="draft-card" key={i}>
              <EntryForm value={d} idPrefix={`draft-${i}`} onChange={(next) => setDrafts(drafts.map((x, j) => (j === i ? next : x)))} />
              <div className="row end">
                <button className="btn quiet sm" onClick={() => setDrafts(drafts.filter((_, j) => j !== i))}>Remove</button>
              </div>
            </div>
          ))}
          <div className="row end">
            <button className="btn quiet" onClick={() => setDrafts(null)}>{mode === "upload" ? "Choose another file" : "Back to text"}</button>
            <button
              className="btn"
              disabled={busy !== null || drafts.length === 0 || drafts.some((d) => !d.title.trim())}
              onClick={async () => {
                if (await save(drafts, usedVoice ? "voice" : "typed")) {
                  setDrafts(null);
                  setText("");
                  setUsedVoice(false);
                }
              }}
            >
              {busy === "saving" ? "Saving" : `Save ${drafts.length === 1 ? "update" : `${drafts.length} updates`}`}
            </button>
          </div>
        </>
      )}

      {mode === "single" && (
        <>
          <EntryForm value={single} onChange={setSingle} idPrefix="single" />
          <div className="row end">
            <button
              className="btn"
              disabled={busy !== null || !single.title.trim()}
              onClick={async () => {
                if (await save([single], "typed")) setSingle(blankDraft(single.geography, today));
              }}
            >
              {busy === "saving" ? "Saving" : "Save update"}
            </button>
          </div>
        </>
      )}

      {err && <p className="notice error" role="alert">{err}</p>}
    </section>
  );
}

function MicIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function StopIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
      <rect x="4" y="4" width="12" height="12" rx="2.5" fill="currentColor" />
    </svg>
  );
}
