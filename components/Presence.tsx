"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useApp } from "./AppContext";
import { PRESENCE_LABEL, activePresence, presenceText, type Presence } from "@/lib/presence";
import { errorText } from "@/lib/format";

const OPTIONS: Presence[] = ["office", "travelling", "remote", "leave"];

/** Your own check-in: one line you can change in two clicks, or ignore. */
export function MyPresence({ variant = "line" }: { variant?: "line" | "card" }) {
  const { member, today, geographies } = useApp();
  const [open, setOpen] = useState(false);
  const text = presenceText(member, today);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  return (
    <div className={`presence ${variant}`} ref={ref}>
      <button type="button" className="presence-btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className={`dot p-${activePresence(member, today).presence ?? "none"}`} aria-hidden="true" />
        <span>{text ?? "Where are you today?"}</span>
      </button>
      {open && <PresenceEditor onDone={() => setOpen(false)} cities={geographies.map((g) => g.region.replace(/ HQ$/, ""))} />}
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
    <div className="presence-pop" role="dialog" aria-label="Where are you today">
      <div className="chips">
        {OPTIONS.map((o) => (
          <button key={o} type="button" className="chip" aria-pressed={presence === o} onClick={() => setPresence(presence === o ? undefined : o)}>
            {PRESENCE_LABEL[o]}
          </button>
        ))}
      </div>
      {presence !== "leave" && (
        <label className="field">
          <span>City</span>
          <input className="input" list="presence-cities" value={location} placeholder="Abu Dhabi" onChange={(e) => setLocation(e.target.value)} />
          <datalist id="presence-cities">{[...new Set(cities)].map((c) => <option key={c} value={c} />)}</datalist>
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
