"use client";

import { useState } from "react";
import { useApp } from "./AppContext";
import { COUNTRIES, countryById } from "@/convex/lib/countries";
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

/**
 * Where the update belongs: any ALG office, any market already in use, or any other country.
 * A country not yet in the register is sent as "iso:NNN" and opened as a market when saved.
 * This never changes what the person can see.
 */
function GeographyPicker({ value, onChange, idPrefix }: { value: string; onChange: (g: string) => void; idPrefix: string }) {
  const { loggable, member } = useApp();
  const picked = value.startsWith("iso:") ? countryById(value.slice(4)) : undefined;
  const [other, setOther] = useState(Boolean(picked));
  const [query, setQuery] = useState(picked?.name ?? "");
  const mine = loggable.filter((g) => member.geographies.includes(g.key) || member.extraGeographies.includes(g.key));
  const offices = loggable.filter((g) => !mine.includes(g) && g.office !== false);
  const markets = loggable.filter((g) => !mine.includes(g) && g.office === false);
  const listId = `${idPrefix}-countries`;

  if (other) {
    return (
      <label className="field">
        <span>Country</span>
        <input
          className="input"
          list={listId}
          value={query}
          placeholder="Start typing a country"
          onChange={(e) => {
            setQuery(e.target.value);
            const hit = COUNTRIES.find((c) => c.name.toLowerCase() === e.target.value.trim().toLowerCase());
            const existing = hit ? loggable.find((g) => g.country === hit.id) : undefined;
            if (existing) onChange(existing.key);
            else if (hit) onChange(`iso:${hit.id}`);
          }}
        />
        <datalist id={listId}>{COUNTRIES.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        <button type="button" className="link-btn small" onClick={() => { setOther(false); onChange(mine[0]?.key ?? loggable[0]?.key ?? ""); }}>
          Back to the list
        </button>
      </label>
    );
  }
  return (
    <label className="field">
      <span>Geography</span>
      <select
        className="select"
        value={value}
        onChange={(e) => {
          if (e.target.value === "__other") { setOther(true); setQuery(""); return; }
          onChange(e.target.value);
        }}
      >
        {mine.length > 0 && <optgroup label="Yours">{mine.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}</optgroup>}
        {offices.length > 0 && <optgroup label="ALG offices">{offices.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}</optgroup>}
        {markets.length > 0 && <optgroup label="Markets">{markets.map((g) => <option key={g.key} value={g.key}>{g.name}</option>)}</optgroup>}
        <option value="__other">Another country</option>
      </select>
    </label>
  );
}

export default function EntryForm({ value, onChange, idPrefix }: { value: EntryDraft; onChange: (d: EntryDraft) => void; idPrefix: string }) {
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
        <GeographyPicker value={value.geography} onChange={(g) => set("geography", g)} idPrefix={idPrefix} />
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
