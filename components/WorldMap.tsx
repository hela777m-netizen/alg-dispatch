"use client";

import Link from "next/link";
import { useMemo } from "react";
import { geoNaturalEarth1, geoPath } from "d3-geo";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { FeatureCollection } from "geojson";
import land110 from "world-atlas/land-110m.json";
import type { Doc } from "@/convex/_generated/dataModel";
import { KindMark, StageTrack, Status } from "./bits";
import { localTime, money, shortDate, STAGE_LABEL, type Kind, type Stage } from "@/lib/format";

/** Where to place pins for the starting geographies, if no position was saved. */
const FALLBACK: Record<string, [number, number]> = {
  uae: [24.45, 54.38],
  ksa: [24.71, 46.68],
  brazil: [-23.55, -46.63],
  "new-york": [40.71, -74.01],
  uk: [51.51, -0.13],
  nigeria: [6.52, 3.38],
  "greater-china": [22.32, 114.17],
};

/** Labels that sit left of their pin to avoid neighbours. */
const LABEL_LEFT = new Set(["ksa", "new-york", "uk"]);

const W = 960;
const H = 470;

type Geo = {
  key: string;
  name: string;
  region: string;
  timezone: string;
  lat?: number;
  lng?: number;
  total: number;
  counts: Record<Kind, number>;
};

type RosterRow = { memberId: string; name: string; geography: string; status: string };
type Entry = Doc<"entries"> & { authorName: string };
type Deal = { id: string; title: string; geography: string; counterparty?: string; stage: Stage; value?: number; owner: string };

export type PinState = "reviewed" | "submitted" | "pending" | "none";

/** One colour per geography, from the reports expected there this cycle. */
export function pinState(rows: RosterRow[]): PinState {
  if (rows.length === 0) return "none";
  if (rows.every((r) => r.status === "reviewed")) return "reviewed";
  if (rows.every((r) => r.status === "reviewed" || r.status === "submitted")) return "submitted";
  return "pending";
}

const PIN_LABEL: Record<PinState, string> = {
  reviewed: "All reports reviewed",
  submitted: "Reports sent, awaiting review",
  pending: "Report missing or in draft",
  none: "No regular reporter",
};

export default function WorldMap({
  geos,
  roster,
  entries,
  pipeline,
  selected,
  onSelect,
  now,
}: {
  geos: Geo[];
  roster: RosterRow[];
  entries: Entry[] | undefined;
  pipeline: Deal[];
  selected: string | null;
  onSelect: (key: string | null) => void;
  now: Date;
}) {
  const { landPath, project } = useMemo(() => {
    const topo = land110 as unknown as Topology<{ land: GeometryCollection }>;
    const land = feature(topo, topo.objects.land) as unknown as FeatureCollection;
    // Frame the inhabited world; leave out Antarctica.
    const frame = { type: "MultiPoint" as const, coordinates: [[-168, 74], [180, 74], [-168, -50], [180, -50]] };
    const projection = geoNaturalEarth1().fitExtent([[8, 8], [W - 8, H - 8]], frame);
    const path = geoPath(projection);
    return { landPath: path(land) ?? "", project: (lng: number, lat: number) => projection([lng, lat]) };
  }, []);

  const pins = geos
    .map((g) => {
      const pos = g.lat !== undefined && g.lng !== undefined ? [g.lat, g.lng] : FALLBACK[g.key];
      if (!pos) return null;
      const xy = project(pos[1], pos[0]);
      if (!xy) return null;
      const rows = roster.filter((r) => r.geography === g.key);
      return { g, x: xy[0], y: xy[1], state: pinState(rows), blocked: g.counts.blocker > 0 };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null);

  const unplaced = geos.filter((g) => !pins.some((p) => p.g.key === g.key));
  const current = geos.find((g) => g.key === selected) ?? null;

  return (
    <div className="map-card">
      <div className="map-stage">
        <svg viewBox={`0 0 ${W} ${H}`} className="map-svg" role="group" aria-label="Map of reporting locations">
          <path d={landPath} className="map-land" />
          {pins.map((p) => {
            const left = LABEL_LEFT.has(p.g.key);
            const active = selected === p.g.key;
            return (
              <g
                key={p.g.key}
                transform={`translate(${p.x.toFixed(1)} ${p.y.toFixed(1)})`}
                className={`pin pin-${p.state} ${active ? "is-active" : ""}`}
                role="button"
                tabIndex={0}
                aria-pressed={active}
                aria-label={`${p.g.name}: ${PIN_LABEL[p.state]}${p.blocked ? ", has blockers" : ""}`}
                onClick={() => onSelect(active ? null : p.g.key)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(active ? null : p.g.key);
                  }
                }}
              >
                <circle r="22" className="pin-hit" />
                {p.blocked && <circle r="14" className="pin-ring" />}
                <circle r={active ? 10 : 8} className="pin-dot" />
                <text x={left ? -18 : 18} y="6" textAnchor={left ? "end" : "start"} className="pin-label">
                  {p.g.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="map-legend" aria-hidden="true">
          <span><i className="lg lg-reviewed" />Reviewed</span>
          <span><i className="lg lg-submitted" />Sent</span>
          <span><i className="lg lg-pending" />Missing or draft</span>
          <span><i className="lg lg-ring" />Has blockers</span>
        </div>
        {unplaced.length > 0 && (
          <p className="small faint" style={{ margin: "6px 4px 0" }}>
            Not on the map yet: {unplaced.map((g) => g.name).join(", ")}. Add a map position on the Team page.
          </p>
        )}
      </div>

      <aside className="map-panel" aria-live="polite">
        {current ? (
          <GeoSummary
            geo={current}
            roster={roster.filter((r) => r.geography === current.key)}
            entries={entries?.filter((e) => e.geography === current.key)}
            deals={pipeline.filter((d) => d.geography === current.key && d.stage !== "closed" && d.stage !== "lost")}
            now={now}
            onClose={() => onSelect(null)}
          />
        ) : (
          <div className="stack" style={{ gap: 8 }}>
            <h3 className="h2">Pick a location</h3>
            <p className="muted" style={{ margin: 0 }}>
              Click a pin to see the latest highlights, blockers and deals for that geography this cycle.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function GeoSummary({
  geo,
  roster,
  entries,
  deals,
  now,
  onClose,
}: {
  geo: Geo;
  roster: RosterRow[];
  entries: Entry[] | undefined;
  deals: Deal[];
  now: Date;
  onClose: () => void;
}) {
  const highlights = (entries ?? []).filter((e) => e.kind === "activity" || e.kind === "meeting" || e.kind === "deal").slice(0, 4);
  const blockers = (entries ?? []).filter((e) => e.kind === "blocker" || e.kind === "ask");
  const next = (entries ?? []).filter((e) => e.kind === "next").slice(0, 2);

  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="row between" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
        <div>
          <h3 className="h2">{geo.name}</h3>
          <p className="small faint" style={{ margin: "4px 0 0" }}>{geo.region}, {localTime(geo.timezone, now)} local time</p>
        </div>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
        </button>
      </div>

      {roster.length > 0 && (
        <div className="row" style={{ gap: 8 }}>
          {roster.map((r) => (
            <span key={r.memberId} className="row small" style={{ gap: 6 }}>
              <span className="muted">{r.name.split(" ")[0]}</span>
              <Status status={r.status} />
            </span>
          ))}
        </div>
      )}

      <PanelBlock title="Highlights" empty="Nothing logged this cycle yet.">
        {highlights.map((e) => (
          <li key={e._id}>
            <div className="title">{e.title}</div>
            <div className="tags"><KindMark kind={e.kind} /><span>{shortDate(e.date)}</span>{e.counterparty && <span>With {e.counterparty}</span>}</div>
          </li>
        ))}
      </PanelBlock>

      <PanelBlock title="Blockers and asks" empty="Nothing stuck.">
        {blockers.map((e) => (
          <li key={e._id}>
            <div className="title">{e.title}</div>
            <div className="tags"><KindMark kind={e.kind} /><span>{e.authorName}</span></div>
          </li>
        ))}
      </PanelBlock>

      {deals.length > 0 && (
        <PanelBlock title="Live deals" empty="">
          {deals.slice(0, 3).map((d) => (
            <li key={d.id}>
              <div className="title">{d.title}</div>
              <div className="tags">
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>{STAGE_LABEL[d.stage]} <StageTrack stage={d.stage} /></span>
                {d.value !== undefined && <span>{money(d.value)}</span>}
              </div>
            </li>
          ))}
        </PanelBlock>
      )}

      {next.length > 0 && (
        <PanelBlock title="Next two weeks" empty="">
          {next.map((e) => <li key={e._id}><div className="title">{e.title}</div></li>)}
        </PanelBlock>
      )}

      <Link href={`/geo/${geo.key}`} className="btn quiet sm" style={{ alignSelf: "flex-start" }}>Open {geo.name}</Link>
    </div>
  );
}

function PanelBlock({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const items = Array.isArray(children) ? children.filter(Boolean) : children ? [children] : [];
  return (
    <section>
      <h4 className="h3" style={{ marginBottom: 6 }}>{title}</h4>
      {items.length === 0 ? <p className="small faint" style={{ margin: 0 }}>{empty}</p> : <ul className="panel-list">{children}</ul>}
    </section>
  );
}

