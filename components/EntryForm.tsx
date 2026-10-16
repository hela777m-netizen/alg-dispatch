"use client";

import { useApp } from "./AppContext";
import { KINDS, KIND_LABEL, STAGES, STAGE_LABEL, type Kind, type Stage } from "@/lib/format";

export type EntryDraft = {
  geography: string;
  kind: Kind;
  title: string;
  details?: string;
  counterparty?: string;
  dealStage?: Stage;
  dealValue?: number;
  date: string;
};

export function blankDraft(geography: string, date: string): EntryDraft {
  return { geography, kind: "activity", title: "", date };
}

/** Strips empty optional fields so the server gets clean values. */
export function tidy(d: EntryDraft): EntryDraft {
  return {
    geography: d.geography,
    kind: d.kind,
    title: d.title.trim(),
    details: d.details?.trim() || undefined,
    counterparty: d.counterparty?.trim() || undefined,
    dealStage: d.kind === "deal" ? (d.dealStage ?? "lead") : undefined,
    dealValue: d.kind === "deal" && d.dealValue !== undefined && !Number.isNaN(d.dealValue) ? d.dealValue : undefined,
    date: d.date,
  };
}

export default function EntryForm({ value, onChange, idPrefix }: { value: EntryDraft; onChange: (d: EntryDraft) => void; idPrefix: string }) {
  const { loggable } = useApp();
  const set = <K extends keyof EntryDraft>(k: K, v: EntryDraft[K]) => onChange({ ...value, [k]: v });

  return (
    <div className="stack">
      <div className="segmented" role="group" aria-label="Type of update">
        {KINDS.map((k) => (
          <button key={k} type="button" aria-pressed={value.kind === k} onClick={() => set("kind", k)}>
            {KIND_LABEL[k]}
          </button>
        ))}
      </div>
      <label className="field">
        <span>{value.kind === "deal" ? "Deal or company" : "Headline"}</span>
        <input id={`${idPrefix}-title`} className="input" value={value.title} maxLength={200} onChange={(e) => set("title", e.target.value)} />
      </label>
      <label className="field">
        <span>Details</span>
        <textarea className="textarea" rows={3} value={value.details ?? ""} onChange={(e) => set("details", e.target.value)} />
      </label>
      <div className="fields">
        <label className="field">
          <span>Geography</span>
          <select className="select" value={value.geography} onChange={(e) => set("geography", e.target.value)}>
            {loggable.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}
          </select>
        </label>
        <label className="field">
          <span>Date</span>
          <input type="date" className="input" value={value.date} onChange={(e) => set("date", e.target.value)} />
        </label>
        <label className="field">
          <span>Counterparty</span>
          <input className="input" value={value.counterparty ?? ""} onChange={(e) => set("counterparty", e.target.value)} />
        </label>
        {value.kind === "deal" && (
          <>
            <label className="field">
              <span>Stage</span>
              <select className="select" value={value.dealStage ?? "lead"} onChange={(e) => set("dealStage", e.target.value as Stage)}>
                {STAGES.map((s) => <option key={s} value={s}>{STAGE_LABEL[s]}</option>)}
              </select>
            </label>
            <label className="field">
              <span>Size, USD millions</span>
              <input
                className="input"
                inputMode="decimal"
                value={value.dealValue ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? undefined : Number(e.target.value.replace(/,/g, ""));
                  set("dealValue", n);
                }}
              />
            </label>
          </>
        )}
      </div>
    </div>
  );
}
