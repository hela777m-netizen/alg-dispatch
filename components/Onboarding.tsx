"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useApp } from "./AppContext";
import Logo from "./Logo";
import { errorText } from "@/lib/format";

const STEPS = ["About you", "Geographies", "Reporting line", "Where you work"] as const;

/** First sign-in walkthrough: four short steps, pre-filled with what the owner already set. */
export default function Onboarding() {
  const { member, geographies } = useApp();
  const people = useQuery(api.members.directory);
  const finish = useMutation(api.members.completeOnboarding);
  const offices = geographies.filter((g) => g.office !== false);
  const isReporter = member.role === "reporter";

  const [step, setStep] = useState(0);
  const [title, setTitle] = useState(member.title ?? "");
  const [geos, setGeos] = useState<string[]>(member.geographies);
  const [reportsTo, setReportsTo] = useState<string>(member.reportsTo ?? "");
  const [location, setLocation] = useState(member.location ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const first = member.name.split(" ")[0];
  const last = step === STEPS.length - 1;
  const canNext = step !== 1 || !isReporter || geos.length > 0;

  async function submit() {
    setBusy(true);
    setErr(null);
    try {
      await finish({
        title: title || undefined,
        geographies: geos,
        reportsTo: (reportsTo || undefined) as Id<"members"> | undefined,
        location: location || undefined,
      });
    } catch (e) {
      setErr(errorText(e));
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="onboard">
        <Logo height={40} />
        <ol className="onboard-steps" aria-label="Setup steps">
          {STEPS.map((s, i) => (
            <li key={s} aria-current={i === step ? "step" : undefined} className={i < step ? "done" : ""}>{s}</li>
          ))}
        </ol>

        {step === 0 && (
          <section className="stack">
            <h1 className="headline">Welcome, {first}</h1>
            <p className="muted">Four quick questions so your updates and reports land in the right place. It takes under a minute.</p>
            <label className="field">
              <span>Your title</span>
              <input className="input" autoFocus value={title} maxLength={160} placeholder="Head of Saudi Arabia" onChange={(e) => setTitle(e.target.value)} />
            </label>
          </section>
        )}

        {step === 1 && (
          <section className="stack">
            <h1 className="headline">Which geographies do you cover?</h1>
            <p className="muted">
              You&apos;ll see the team&apos;s updates from these, and send a short report on each every two weeks.
              You can still post about any other country whenever you need to.
            </p>
            <div className="chips" role="group" aria-label="Geographies">
              {offices.map((g) => (
                <button key={g.key} type="button" className="chip" aria-pressed={geos.includes(g.key)}
                  onClick={() => setGeos(geos.includes(g.key) ? geos.filter((k) => k !== g.key) : [...geos, g.key])}>
                  {g.name}
                </button>
              ))}
            </div>
            {!isReporter && <p className="small faint" style={{ margin: 0 }}>As a {member.role}, you already see every geography. Pick any you report on yourself.</p>}
          </section>
        )}

        {step === 2 && (
          <section className="stack">
            <h1 className="headline">Who do you report to?</h1>
            <label className="field">
              <span>Reporting manager</span>
              <select className="select" value={reportsTo} onChange={(e) => setReportsTo(e.target.value)}>
                <option value="">Not sure, skip for now</option>
                {(people ?? []).map((p) => <option key={p._id} value={p._id}>{p.name}</option>)}
              </select>
            </label>
          </section>
        )}

        {step === 3 && (
          <section className="stack">
            <h1 className="headline">Where do you usually work?</h1>
            <label className="field">
              <span>City</span>
              <input className="input" autoFocus value={location} maxLength={80} placeholder="Riyadh" list="onboard-cities" onChange={(e) => setLocation(e.target.value)} />
              <datalist id="onboard-cities">
                {[...new Set(offices.map((g) => g.region.replace(/ HQ$/, "")).filter(Boolean))].map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <p className="small faint" style={{ margin: 0 }}>You can set travel, leave and remote days later from your name in the menu.</p>
          </section>
        )}

        {err && <p className="notice error" role="alert">{err}</p>}
        <div className="row between">
          {step > 0 ? <button className="btn quiet" onClick={() => setStep(step - 1)}>Back</button> : <span />}
          {last ? (
            <button className="btn" disabled={busy} onClick={submit}>{busy ? "Saving" : "Finish"}</button>
          ) : (
            <button className="btn" disabled={!canNext} onClick={() => setStep(step + 1)}>Next</button>
          )}
        </div>
      </div>
    </div>
  );
}
