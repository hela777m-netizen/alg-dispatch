"use client";

import { KIND_LABEL, STAGES, STATUS_LABEL, type Kind, type Stage } from "@/lib/format";

export function Status({ status }: { status: string }) {
  return <span className={`status ${status}`}>{STATUS_LABEL[status] ?? status}</span>;
}

export function KindMark({ kind }: { kind: Kind }) {
  return <span className={`kind ${kind}`}>{KIND_LABEL[kind]}</span>;
}

export function StageTrack({ stage }: { stage: Stage }) {
  const open = STAGES.slice(0, 5);
  const idx = stage === "closed" ? 5 : stage === "lost" ? -1 : open.indexOf(stage);
  return (
    <span className={`stage-track ${stage === "lost" ? "lost" : ""}`} aria-hidden="true">
      {open.map((s, i) => <i key={s} className={i <= idx || stage === "closed" ? "on" : ""} />)}
    </span>
  );
}

export function Spark({ values, label }: { values: number[]; label: string }) {
  const w = 120;
  const h = 34;
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? w / (values.length - 1) : w;
  const pts = values.map((v, i) => [i * step, h - 4 - (v / max) * (h - 10)] as const);
  const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  return (
    <svg className="spark" viewBox={`-3 0 ${w + 6} ${h}`} preserveAspectRatio="none" role="img" aria-label={label}>
      <path d={line} fill="none" stroke="var(--ink-3)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      {last && <circle cx={last[0]} cy={last[1]} r="3" fill="var(--lapis)" />}
    </svg>
  );
}

export function Mix({ counts, total }: { counts: Record<Kind, number>; total: number }) {
  if (!total) return <div className="mix" aria-hidden="true" />;
  return (
    <div className="mix" role="img" aria-label={Object.entries(counts).filter(([, n]) => n).map(([k, n]) => `${n} ${KIND_LABEL[k as Kind].toLowerCase()}`).join(", ")}>
      {(Object.keys(counts) as Kind[]).map((k) =>
        counts[k] ? <span key={k} style={{ width: `${(counts[k] / total) * 100}%`, background: `var(--k-${k})` }} /> : null,
      )}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}
