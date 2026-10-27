"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useApp } from "@/components/AppContext";
import { Empty } from "@/components/bits";
import { errorText, initials } from "@/lib/format";
import { COUNTRIES, countryById } from "@/convex/lib/countries";

type Role = Doc<"members">["role"];
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", reporter: "Reporter" };
const ROLE_HELP: Record<Role, string> = {
  owner: "Sees and edits everything, manages the team.",
  manager: "Sees every geography, reviews and comments on reports.",
  reporter: "Sees their assigned geographies. Can post updates about any country.",
};

type Member = NonNullable<ReturnType<typeof useQuery<typeof api.members.list>>>[number];
const STATUS_LABEL: Record<Member["status"], string> = {
  active: "Active",
  not_signed_in: "Not signed in yet",
  no_email: "Needs an email",
  suspended: "Access switched off",
  left: "Left ALG",
};

function when(ms: number) {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(ms);
}

const ACTION_TEXT: Record<string, string> = {
  "member.added": "added",
  "member.changed": "changed",
  "member.suspended": "switched off access for",
  "member.reactivated": "switched on access for",
  "member.left": "marked as left:",
  "member.returned": "marked as returned:",
  "member.first_sign_in": "first sign-in:",
  "member.signin_reset": "reset the sign-in for",
  "signin.refused": "sign-in refused for",
  "owner.handover": "handed over the owner role to",
  "geography.added": "added the office",
  "geography.changed": "changed",
  "market.opened": "opened the market",
  "update.deleted": "deleted an update by",
  "update.edited_by_owner": "edited an update by",
  "report.reviewed": "reviewed a report by",
  "report.returned": "asked for more on a report by",
  "cycle.start_changed": "changed the cycle start date",
};

function HistoryList({ id }: { id?: Id<"members"> }) {
  const rows = useQuery(api.members.history, id ? { id } : {});
  if (rows === undefined) return <p className="small faint">Loading</p>;
  if (rows.length === 0) return <p className="small faint">No changes recorded yet.</p>;
  return (
    <ul className="history">
      {rows.map((r) => {
        const verb = ACTION_TEXT[r.action] ?? (r.action.startsWith("ai.") ? "used AI:" : r.action);
        return (
          <li key={r._id}>
            <time>{when(r.at)}</time>
            {r.actorName} {verb} {r.action.startsWith("ai.") ? r.action.slice(3) : r.targetName ?? ""}
            {r.detail ? <span className="faint">{`. ${r.detail}`}</span> : null}
          </li>
        );
      })}
    </ul>
  );
}

export default function AdminPage() {
  const { isOwner } = useApp();
  if (!isOwner) return <Empty>Only the owner can manage the team.</Empty>;
  return (
    <>
      <div className="page-head">
        <div>
          <h1 className="headline">Team</h1>
          <p className="muted">
            Add someone&apos;s work email here, then send them the link. They sign in with that email and land in their own view.
          </p>
        </div>
      </div>
      <Members />
      <Handover />
      <Geographies />
      <Cycle />
      <section className="section">
        <div className="section-head"><h2 className="h2">Recent changes</h2><span className="small faint">Who changed what. Never includes update or report text.</span></div>
        <div className="panel"><HistoryList /></div>
      </section>
    </>
  );
}

type MemberDraft = {
  id?: Id<"members">;
  name: string;
  email: string;
  title: string;
  role: Role;
  geographies: string[];
  extraGeographies: string[];
  active: boolean;
  reportsTo?: Id<"members">;
  left: boolean;
};

function Members() {
  const members = useQuery(api.members.list);
  const [editing, setEditing] = useState<MemberDraft | null>(null);

  return (
    <section className="section">
      <div className="section-head">
        <h2 className="h2">People</h2>
        <button
          className="btn sm"
          onClick={() => setEditing({ name: "", email: "", title: "", role: "reporter", geographies: [], extraGeographies: [], active: true, left: false })}
        >
          Add person
        </button>
      </div>
      {editing && !editing.id && <MemberEditor draft={editing} members={members ?? []} onClose={() => setEditing(null)} />}
      <div className="panel">
        {members === undefined && <p className="faint">Loading</p>}
        <div className="list">
          {members?.map((m) =>
            editing?.id === m._id ? (
              <div key={m._id} className="item" style={{ gridTemplateColumns: "1fr" }}>
                <MemberEditor draft={editing} members={members ?? []} onClose={() => setEditing(null)} />
              </div>
            ) : (
              <MemberRow
                key={m._id}
                m={m}
                onEdit={() =>
                  setEditing({
                    id: m._id,
                    name: m.name,
                    email: m.email ?? "",
                    title: m.title ?? "",
                    role: m.role,
                    geographies: m.geographies,
                    extraGeographies: m.extraGeographies,
                    active: m.active,
                    reportsTo: m.reportsTo,
                    left: Boolean(m.leftAt),
                  })
                }
              />
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function MemberRow({ m, onEdit }: { m: Member; onEdit: () => void }) {
  const { geoName } = useApp();
  const tone = m.status === "active" ? "" : m.status === "suspended" || m.status === "left" ? "off" : "warn";
  return (
    <div className="item" style={{ gridTemplateColumns: "40px minmax(0,1fr) auto", opacity: m.active ? 1 : 0.6 }}>
      <span className="avatar">{initials(m.name)}</span>
      <div>
        <div className="title"><a href={`/people/${m._id}`} className="tag-link">{m.name}</a></div>
        <div className="small faint">{m.email || "No email yet"}</div>
        <div className="tags">
          <span>{ROLE_LABEL[m.role]}</span>
          {m.geographies.length > 0 && <span>Sees {m.geographies.map(geoName).join(", ")}</span>}
          <span className={`status-pill ${tone}`}>{STATUS_LABEL[m.status]}</span>
        </div>
      </div>
      <button className="btn quiet sm" onClick={onEdit}>Edit</button>
    </div>
  );
}

function MemberEditor({ draft, members, onClose }: { draft: MemberDraft; members: Member[]; onClose: () => void }) {
  const { geographies, member, toast, geoName } = useApp();
  const [d, setD] = useState(draft);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const save = useMutation(api.members.save);
  const resetSignIn = useMutation(api.members.resetSignIn);
  const isSelf = d.id === member._id;
  const original = members.find((m) => m._id === d.id);
  const otherOwner = original?.role === "owner" && !isSelf;
  const offices = geographies.filter((g) => g.office !== false);
  const managers = members.filter((m) => m._id !== d.id && m.active && m.role !== "reporter");

  const toggle = (key: string) => {
    const has = d.geographies.includes(key);
    setD({ ...d, geographies: has ? d.geographies.filter((k) => k !== key) : [...d.geographies, key] });
  };

  /** Asks before the changes that cut access or raise privileges. Routine edits save directly. */
  function confirmRisky(): boolean {
    if (!d.id) {
      if (d.role === "owner") return window.prompt(`Type ${d.name} to give them the owner role.`)?.trim() === d.name.trim();
      return true;
    }
    if (!original) return true;
    const checks: string[] = [];
    if (d.left && !original.leftAt) checks.push(`Mark ${d.name} as having left ALG? Their access stops; their updates and reports stay.`);
    else if (original.active && !d.active) checks.push(`Switch off ${d.name}'s access? It stops immediately.`);
    if ((original.email ?? "") !== d.email.trim().toLowerCase() && original.email) checks.push(`Change ${d.name}'s email? They will need to sign in again with the new address.`);
    if (d.role === "manager" && original.role === "reporter") checks.push(`Make ${d.name} a manager? Managers see every geography and review reports.`);
    for (const c of checks) if (!window.confirm(c)) return false;
    if (d.role === "owner" && original.role !== "owner") {
      return window.prompt(`Owners can change everything, including the team. Type ${d.name} to confirm.`)?.trim() === d.name.trim();
    }
    return true;
  }

  if (otherOwner) {
    return (
      <div className="sunk stack" style={{ marginBottom: 0 }}>
        <p style={{ margin: 0 }}>{d.name} is also an owner. Owners can&apos;t change each other here. They can hand the role on from their own Team page.</p>
        <div className="row end"><button className="btn quiet sm" onClick={onClose}>Close</button></div>
      </div>
    );
  }

  return (
    <div className="sunk stack" style={{ marginBottom: d.id ? 0 : 16 }}>
      <div className="fields">
        <label className="field"><span>Name</span><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="field"><span>Work email</span><input className="input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
        <label className="field"><span>Note, shown on their profile</span><input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
        <label className="field">
          <span>Reports to</span>
          <select className="select" value={d.reportsTo ?? ""} onChange={(e) => setD({ ...d, reportsTo: (e.target.value || undefined) as Id<"members"> | undefined })}>
            <option value="">Nobody set</option>
            {managers.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </select>
        </label>
      </div>
      <div className="field">
        <span>Role</span>
        <div className="segmented" role="group" aria-label="Role">
          {(["reporter", "manager", "owner"] as Role[]).map((r) => (
            <button key={r} type="button" aria-pressed={d.role === r} disabled={isSelf && r !== "owner"} onClick={() => setD({ ...d, role: r })}>
              {ROLE_LABEL[r]}
            </button>
          ))}
        </div>
        <span className="small faint">{ROLE_HELP[d.role]}</span>
      </div>
      <div className="field">
        <span>Assigned geographies: what they see, and owe a report on each cycle</span>
        <div className="chips">
          {offices.map((g) => (
            <button key={g.key} type="button" className="chip" aria-pressed={d.geographies.includes(g.key)} onClick={() => toggle(g.key)}>{g.name}</button>
          ))}
        </div>
        <span className="small faint">Anyone can post an update about any country. That never adds to what they can see.</span>
      </div>
      {!isSelf && (
        <div className="row" style={{ gap: 18 }}>
          <label className="row small">
            <input type="checkbox" checked={d.active && !d.left} disabled={d.left} onChange={(e) => setD({ ...d, active: e.target.checked })} />
            Has access
          </label>
          <label className="row small">
            <input type="checkbox" checked={d.left} onChange={(e) => setD({ ...d, left: e.target.checked, active: e.target.checked ? false : d.active })} />
            Has left ALG
          </label>
        </div>
      )}

      {d.id && original && (
        <dl className="access-card" aria-label="What they can do now">
          <dt>Status</dt><dd>{STATUS_LABEL[original.status]}</dd>
          <dt>Sees</dt><dd>{original.access?.sees === "all" ? "Every geography" : (original.access?.sees as string[] | undefined)?.map(geoName).join(", ") || "Only their own updates"}</dd>
          <dt>Posts to</dt><dd>Any country</dd>
          <dt>Reviews reports</dt><dd>{original.access?.reviewsReports ? "Yes" : "No"}</dd>
          <dt>Manages the team</dt><dd>{original.access?.administers ? "Yes" : "No"}</dd>
        </dl>
      )}

      {err && <p className="notice error" role="alert">{err}</p>}
      <div className="row between">
        <div className="row">
          {d.id && !isSelf && original?.linked && (
            <button
              className="btn quiet sm"
              onClick={async () => {
                if (!window.confirm(`Reset ${d.name}'s sign-in? Use this if they made a new account with the same email. Their next sign-in links again.`)) return;
                setErr(null);
                try { await resetSignIn({ id: d.id! }); toast("Sign-in reset"); } catch (e) { setErr(errorText(e)); }
              }}
            >
              Reset sign-in
            </button>
          )}
          {d.id && <button className="btn quiet sm" onClick={() => setShowHistory((h) => !h)}>{showHistory ? "Hide history" : "History"}</button>}
        </div>
        <div className="row">
          <button className="btn quiet sm" onClick={onClose}>Cancel</button>
          <button
            className="btn sm"
            disabled={busy || !d.name.trim()}
            onClick={async () => {
              if (!confirmRisky()) return;
              setBusy(true);
              setErr(null);
              try {
                await save({
                  id: d.id,
                  name: d.name,
                  email: d.email || undefined,
                  title: d.title || undefined,
                  role: d.role,
                  geographies: d.geographies,
                  extraGeographies: d.extraGeographies,
                  active: d.active,
                  reportsTo: d.reportsTo,
                  left: d.left,
                });
                toast(d.id ? "Saved. New access applies now." : "Person added");
                onClose();
              } catch (e) {
                setErr(`${errorText(e)} Nothing was changed.`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? "Saving" : d.id ? "Save person" : "Add person"}
          </button>
        </div>
      </div>
      {showHistory && d.id && <HistoryList id={d.id} />}
    </div>
  );
}

/** Hands the owner role to someone else. The current owner becomes a manager. */
function Handover() {
  const { member, toast } = useApp();
  const members = useQuery(api.members.list);
  const transfer = useMutation(api.members.transferOwnership);
  const [to, setTo] = useState("");
  const [typed, setTyped] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const candidates = (members ?? []).filter((m) => m._id !== member._id && m.active && m.linked && m.role !== "owner");
  const target = candidates.find((m) => m._id === to);
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="h2">Owner handover</h2>
        {!open && <button className="btn quiet sm" onClick={() => setOpen(true)}>Hand over</button>}
      </div>
      {open && (
        <div className="panel stack" style={{ maxWidth: 560 }}>
          <p className="muted" style={{ margin: 0 }}>The new owner manages the team. You become a manager. Only people who have signed in can take over.</p>
          <select className="select" value={to} onChange={(e) => { setTo(e.target.value); setTyped(""); }}>
            <option value="">Choose a person</option>
            {candidates.map((m) => <option key={m._id} value={m._id}>{m.name}</option>)}
          </select>
          {target && (
            <label className="field"><span>Type {target.name} to confirm</span><input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} /></label>
          )}
          {err && <p className="notice error">{err}</p>}
          <div className="row end">
            <button className="btn quiet sm" onClick={() => { setOpen(false); setTo(""); setTyped(""); }}>Cancel</button>
            <button
              className="btn sm"
              disabled={!target || typed.trim() !== target.name}
              onClick={async () => {
                setErr(null);
                try { await transfer({ to: target!._id }); toast(`${target!.name} is now the owner`); } catch (e) { setErr(errorText(e)); }
              }}
            >
              Hand over the owner role
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

type GeoDraft = { id?: Id<"geographies">; name: string; region: string; timezone: string; position: string; active: boolean; office: boolean; country: string };

function parsePosition(text: string): { lat?: number; lng?: number } | null {
  const t = text.trim();
  if (!t) return {};
  const m = t.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
  if (!m) return null;
  return { lat: Number(m[1]), lng: Number(m[2]) };
}

function Geographies() {
  const geos = useQuery(api.members.allGeographies);
  const [editing, setEditing] = useState<GeoDraft | null>(null);
  return (
    <section className="section">
      <div className="section-head">
        <h2 className="h2">Offices and markets</h2>
        <button className="btn sm quiet" onClick={() => setEditing({ name: "", region: "", timezone: "Asia/Dubai", position: "", active: true, office: true, country: "" })}>Add office or market</button>
      </div>
      {editing && !editing.id && <GeoEditor draft={editing} onClose={() => setEditing(null)} />}
      <div className="panel">
        <div className="list">
          {geos?.map((g) =>
            editing?.id === g._id ? (
              <div key={g._id} className="item" style={{ gridTemplateColumns: "1fr" }}>
                <GeoEditor draft={editing} onClose={() => setEditing(null)} />
              </div>
            ) : (
              <div key={g._id} className="item" style={{ gridTemplateColumns: "minmax(0,1fr) auto", opacity: g.active ? 1 : 0.55 }}>
                <div>
                  <div className="title">{g.name}</div>
                  <div className="small faint">
                    {g.office === false ? "Market, no ALG office" : `ALG office, ${g.region}, ${g.timezone}`}{g.active ? "" : ", switched off"}
                  </div>
                </div>
                <button className="btn quiet sm" onClick={() => setEditing({ id: g._id, name: g.name, region: g.region, timezone: g.timezone, position: g.lat !== undefined && g.lng !== undefined ? `${g.lat}, ${g.lng}` : "", active: g.active, office: g.office !== false, country: g.country ?? "" })}>Edit</button>
              </div>
            ),
          )}
        </div>
      </div>
    </section>
  );
}

function GeoEditor({ draft, onClose }: { draft: GeoDraft; onClose: () => void }) {
  const { toast } = useApp();
  const [d, setD] = useState(draft);
  const [countryText, setCountryText] = useState(countryById(draft.country)?.name ?? "");
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation(api.members.saveGeography);
  return (
    <div className="sunk stack" style={{ marginBottom: d.id ? 0 : 16 }}>
      <div className="segmented" role="group" aria-label="Type">
        <button type="button" aria-pressed={d.office} onClick={() => setD({ ...d, office: true })}>ALG office</button>
        <button type="button" aria-pressed={!d.office} onClick={() => setD({ ...d, office: false })}>Market, no office</button>
      </div>
      <span className="small faint">
        {d.office
          ? "Offices can be assigned to people, who then see its updates and owe a report each cycle."
          : "Markets are places ALG works on without an office. Anyone can post about them; nobody owes a report. People can also open new markets from the update form."}
      </span>
      <div className="fields">
        <label className="field"><span>Name</span><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="field">
          <span>Country</span>
          <input
            className="input"
            list="geo-countries"
            value={countryText}
            placeholder="Start typing"
            onChange={(e) => {
              setCountryText(e.target.value);
              const hit = COUNTRIES.find((c) => c.name.toLowerCase() === e.target.value.trim().toLowerCase());
              setD({ ...d, country: hit?.id ?? "", name: d.name || hit?.name || "", position: d.position || (hit ? `${hit.lat}, ${hit.lng}` : "") });
            }}
          />
          <datalist id="geo-countries">{COUNTRIES.map((c) => <option key={c.id} value={c.name} />)}</datalist>
        </label>
        {d.office && <label className="field"><span>City or region</span><input className="input" value={d.region} onChange={(e) => setD({ ...d, region: e.target.value })} /></label>}
        {d.office && <label className="field"><span>Time zone</span><input className="input" value={d.timezone} placeholder="Africa/Lagos" onChange={(e) => setD({ ...d, timezone: e.target.value })} /></label>}
        <label className="field"><span>Map position</span><input className="input" value={d.position} placeholder="6.52, 3.38" onChange={(e) => setD({ ...d, position: e.target.value })} /></label>
      </div>
      <p className="small faint" style={{ margin: 0 }}>The map position fills in from the country. For a city, right-click it in Google Maps, click the numbers to copy them, and paste here.</p>
      <label className="row small">
        <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
        Show on the dashboard
      </label>
      {err && <p className="notice error">{err}</p>}
      <div className="row end">
        <button className="btn quiet sm" onClick={onClose}>Cancel</button>
        <button
          className="btn sm"
          onClick={async () => {
            setErr(null);
            const pos = parsePosition(d.position);
            if (pos === null) return setErr("Map position should look like 6.52, 3.38");
            if (countryText.trim() && !d.country) return setErr("Pick the country from the list.");
            try {
              await save({
                id: d.id, name: d.name, region: d.office ? d.region : "", timezone: d.office ? d.timezone : "UTC",
                active: d.active, office: d.office, country: d.country || undefined, ...pos,
              });
              toast(d.id ? "Saved" : d.office ? "Office added" : "Market opened");
              onClose();
            } catch (e) {
              setErr(`${errorText(e)} Nothing was changed.`);
            }
          }}
        >
          {d.id ? "Save" : d.office ? "Add office" : "Open market"}
        </button>
      </div>
    </div>
  );
}

function Cycle() {
  const { anchor, toast } = useApp();
  const [value, setValue] = useState(anchor);
  const [err, setErr] = useState<string | null>(null);
  const setAnchor = useMutation(api.members.setAnchor);
  return (
    <section className="section">
      <div className="section-head"><h2 className="h2">Reporting cycle</h2></div>
      <div className="panel stack" style={{ maxWidth: 560 }}>
        <p className="muted" style={{ margin: 0 }}>
          Cycles run for two weeks from this start date. You can change it until the first report is sent.
        </p>
        <div className="row">
          <input type="date" className="input" style={{ width: "auto" }} value={value} onChange={(e) => setValue(e.target.value)} />
          <button
            className="btn sm"
            disabled={value === anchor}
            onClick={async () => {
              setErr(null);
              try {
                await setAnchor({ anchor: value });
                toast("Cycle dates updated");
              } catch (e) {
                setErr(errorText(e));
              }
            }}
          >
            Save start date
          </button>
        </div>
        {err && <p className="notice error">{err}</p>}
      </div>
    </section>
  );
}
