"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useApp } from "./AppContext";
import { PLAN_LABEL, PRESENCE_LABEL, activePresence, currentStatus, presenceText, short, type PlanKind, type Presence } from "@/lib/presence";
import { errorText } from "@/lib/format";

const OPTIONS: Presence[] = ["office", "travelling", "remote", "leave"];

/** Your own check-in and upcoming plans: one line you can change in two clicks, or ignore. */
export function MyPresence({ variant = "line" }: { variant?: "line" | "card" }) {
  const { member, today, geographies } = useApp();
  const plans = useQuery(api.availability.mine) ?? [];
  const [open, setOpen] = useState(false);
  const now = currentStatus(member, plans, today);
  const text = presenceText(now, today);
  const next = plans.find((p) => p.start > today);
  const ref = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") { setOpen(false); btn.current?.focus(); } };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const cities = geographies.filter((g) => g.office !== false && g.region).map((g) => g.region.replace(/ HQ$/, ""));
  return (
    <div className={`presence ${variant}`} ref={ref}>
      <button ref={btn} type="button" className="presence-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`dot p-${now.presence ?? "none"}`} aria-hidden="true" />
        <span>
          {text ?? "Where are you today?"}
          {next && <span className="faint">{` · ${PLAN_LABEL[next.kind]} from ${short(next.start)}`}</span>}
        </span>
      </button>
      {open && (
        <div className="presence-pop" role="dialog" aria-label="Your status and plans">
          {now.fromPlan ? (
            <p className="small" style={{ margin: 0 }}>{text}, from your plans below.</p>
          ) : (
            <PresenceEditor onDone={() => { setOpen(false); btn.current?.focus(); }} cities={[...new Set(cities)]} />
          )}
          <Plans plans={plans} />
        </div>
      )}
    </div>
  );
}

function PresenceEditor({ onDone, cities }: { onDone: () => void; cities: string[] }) {
  const { member, today, toast } = useApp();
  const current = activePresence(member, today);
  const [presence, setPresence] = useState<Presence | undefined>(current.presence);
  const [location, setLocation] = useState(current.location ?? "");
  const [until, setUntil] = useState(current.presenceUntil ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation(api.members.setPresence);
  const needsDate = presence === "leave" || presence === "travelling";
  const first = useRef<HTMLButtonElement>(null);
  useEffect(() => first.current?.focus(), []);

  async function submit(clear = false) {
    setErr(null);
    try {
      await save(clear ? {} : { presence, location: location || undefined, until: needsDate && until ? until : undefined });
      toast(clear ? "Status cleared" : "Status updated");
      onDone();
    } catch (e) {
      setErr(errorText(e));
    }
  }

  return (
    <div className="stack" style={{ gap: 10 }}>
      <p className="eyebrow">Today</p>
      <div className="chips">
        {OPTIONS.map((o, i) => (
          <button key={o} ref={i === 0 ? first : undefined} type="button" className="chip" aria-pressed={presence === o} onClick={() => setPresence(presence === o ? undefined : o)}>
            {PRESENCE_LABEL[o]}
          </button>
        ))}
      </div>
      {presence !== "leave" && (
        <label className="field">
          <span>City</span>
          <input className="input" list="presence-cities" value={location} placeholder="Abu Dhabi" onChange={(e) => setLocation(e.target.value)} />
          <datalist id="presence-cities">{cities.map((c) => <option key={c} value={c} />)}</datalist>
        </label>
      )}
      {needsDate && (
        <label className="field">
          <span>{presence === "leave" ? "Back on" : "Until"} (optional)</span>
          <input type="date" className="input" value={until} min={today} onChange={(e) => setUntil(e.target.value)} />
        </label>
      )}
      <p className="small faint" style={{ margin: 0 }}>Stays until you change it. Leave and travel clear themselves after the date.</p>
      {err && <p className="notice error" style={{ margin: 0 }}>{err}</p>}
      <div className="row between">
        <button type="button" className="btn quiet sm" onClick={() => submit(true)}>Clear</button>
        <button type="button" className="btn sm" onClick={() => submit()}>Save</button>
      </div>
    </div>
  );
}

/** Upcoming travel, leave and remote days. Scheduling only: plans never change what anyone can see. */
function Plans({ plans }: { plans: Doc<"availability">[] }) {
  const { today, toast } = useApp();
  const [adding, setAdding] = useState(false);
  const [kind, setKind] = useState<PlanKind>("travel");
  const [start, setStart] = useState(today);
  const [end, setEnd] = useState(today);
  const [place, setPlace] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation(api.availability.save);
  const remove = useMutation(api.availability.remove);

  return (
    <div className="stack plans" style={{ gap: 10 }}>
      <p className="eyebrow">Coming up</p>
      {plans.length === 0 && !adding && <p className="small faint" style={{ margin: 0 }}>No trips or leave planned.</p>}
      {plans.map((p) => (
        <div key={p._id} className="row between small">
          <span>
            {PLAN_LABEL[p.kind]}, {short(p.start)}{p.end !== p.start ? ` to ${short(p.end)}` : ""}
            {p.place ? `, ${p.place}` : ""}
            {p.note ? <span className="faint">{` (${p.note})`}</span> : null}
          </span>
          <button
            type="button"
            className="link-btn small"
            aria-label={`Remove ${PLAN_LABEL[p.kind]} from ${short(p.start)}`}
            onClick={async () => {
              try { await remove({ id: p._id }); toast("Plan removed"); } catch (e) { setErr(errorText(e)); }
            }}
          >
            Remove
          </button>
        </div>
      ))}
      {adding ? (
        <div className="stack sunk" style={{ gap: 10 }}>
          <div className="chips">
            {(["travel", "leave", "remote"] as PlanKind[]).map((k) => (
              <button key={k} type="button" className="chip" aria-pressed={kind === k} onClick={() => setKind(k)}>{PLAN_LABEL[k]}</button>
            ))}
          </div>
          <div className="row" style={{ flexWrap: "nowrap" }}>
            <label className="field"><span>From</span><input type="date" className="input" value={start} min={today} onChange={(e) => { setStart(e.target.value); if (end < e.target.value) setEnd(e.target.value); }} /></label>
            <label className="field"><span>To</span><input type="date" className="input" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
          </div>
          {kind !== "leave" && (
            <label className="field"><span>Where (optional)</span><input className="input" value={place} maxLength={80} placeholder="London" onChange={(e) => setPlace(e.target.value)} /></label>
          )}
          {kind === "travel" && (
            <label className="field"><span>What for (optional, short)</span><input className="input" value={note} maxLength={80} placeholder="Investor roadshow" onChange={(e) => setNote(e.target.value)} /></label>
          )}
          {kind === "leave" && <p className="small faint" style={{ margin: 0 }}>Only the dates are shared. No reason is needed.</p>}
          <div className="row between">
            <button type="button" className="btn quiet sm" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button>
            <button
              type="button"
              className="btn sm"
              onClick={async () => {
                setErr(null);
                try {
                  await save({ kind, start, end, place: place || undefined, note: note || undefined });
                  toast("Plan added");
                  setAdding(false);
                  setPlace("");
                  setNote("");
                } catch (e) {
                  setErr(errorText(e));
                }
              }}
            >
              Add plan
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="btn quiet sm" style={{ alignSelf: "flex-start" }} onClick={() => setAdding(true)}>Add travel or leave</button>
      )}
      {err && <p className="notice error" style={{ margin: 0 }}>{err}</p>}
    </div>
  );
}

/** Someone else's status, read-only. */
export function PresenceTag({ p }: { p: { presence?: Presence; location?: string; presenceUntil?: string } }) {
  const { today } = useApp();
  const text = presenceText(p, today);
  if (!text) return <span className="presence-tag faint">No status set</span>;
  return (
    <span className="presence-tag">
      <span className={`dot p-${activePresence(p, today).presence ?? "none"}`} aria-hidden="true" />
      {text}
    </span>
  );
}
