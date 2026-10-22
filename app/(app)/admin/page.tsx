"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useApp } from "@/components/AppContext";
import { Empty } from "@/components/bits";
import { errorText, initials } from "@/lib/format";

type Role = Doc<"members">["role"];
const ROLE_LABEL: Record<Role, string> = { owner: "Owner", manager: "Manager", reporter: "Reporter" };
const ROLE_HELP: Record<Role, string> = {
  owner: "Sees and edits everything, manages the team.",
  manager: "Sees every geography, reviews and comments on reports.",
  reporter: "Logs updates and sends reports for their geographies.",
};

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
      <Geographies />
      <Cycle />
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
          onClick={() => setEditing({ name: "", email: "", title: "", role: "reporter", geographies: [], extraGeographies: [], active: true })}
        >
          Add person
        </button>
      </div>
      {editing && !editing.id && <MemberEditor draft={editing} onClose={() => setEditing(null)} />}
      <div className="panel">
        {members === undefined && <p className="faint">Loading</p>}
        <div className="list">
          {members?.map((m) =>
            editing?.id === m._id ? (
              <div key={m._id} className="item" style={{ gridTemplateColumns: "1fr" }}>
                <MemberEditor draft={editing} onClose={() => setEditing(null)} />
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

function MemberRow({ m, onEdit }: { m: Doc<"members">; onEdit: () => void }) {
  const { geoName } = useApp();
  const access = !m.active ? "Access removed" : !m.email ? "Needs an email" : m.userId ? "Signed in" : "Not signed in yet";
  return (
    <div className="item" style={{ gridTemplateColumns: "40px minmax(0,1fr) auto", opacity: m.active ? 1 : 0.55 }}>
      <span className="avatar">{initials(m.name)}</span>
      <div>
        <div className="title">{m.name}</div>
        <div className="small faint">{m.email || "No email yet"}</div>
        <div className="tags">
          <span>{ROLE_LABEL[m.role]}</span>
          {m.geographies.length > 0 && <span>Reports on {m.geographies.map(geoName).join(", ")}</span>}
          {m.extraGeographies.length > 0 && m.role === "reporter" && <span>Occasionally {m.extraGeographies.map(geoName).join(", ")}</span>}
          <span style={{ color: !m.email ? "var(--wait)" : undefined }}>{access}</span>
        </div>
      </div>
      <button className="btn quiet sm" onClick={onEdit}>Edit</button>
    </div>
  );
}

function MemberEditor({ draft, onClose }: { draft: MemberDraft; onClose: () => void }) {
  const { geographies, member, toast } = useApp();
  const [d, setD] = useState(draft);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = useMutation(api.members.save);
  const isSelf = d.id === member._id;

  const toggle = (list: "geographies" | "extraGeographies", key: string) => {
    const other = list === "geographies" ? "extraGeographies" : "geographies";
    const has = d[list].includes(key);
    setD({ ...d, [list]: has ? d[list].filter((k) => k !== key) : [...d[list], key], [other]: d[other].filter((k) => k !== key) });
  };

  return (
    <div className="sunk stack" style={{ marginBottom: d.id ? 0 : 16 }}>
      <div className="fields">
        <label className="field"><span>Name</span><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="field"><span>Work email</span><input className="input" type="email" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
        <label className="field"><span>Note, shown on their profile</span><input className="input" value={d.title} onChange={(e) => setD({ ...d, title: e.target.value })} /></label>
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
        <span>Reports on every cycle</span>
        <div className="chips">
          {geographies.map((g) => (
            <button key={g.key} type="button" className="chip" aria-pressed={d.geographies.includes(g.key)} onClick={() => toggle("geographies", g.key)}>{g.name}</button>
          ))}
        </div>
      </div>
      {d.role === "reporter" && (
        <div className="field">
          <span>Can also log occasionally, without being chased for a report</span>
          <div className="chips">
            {geographies.map((g) => (
              <button key={g.key} type="button" className="chip soft" aria-pressed={d.extraGeographies.includes(g.key)} onClick={() => toggle("extraGeographies", g.key)}>{g.name}</button>
            ))}
          </div>
        </div>
      )}
      {!isSelf && (
        <label className="row small">
          <input type="checkbox" checked={d.active} onChange={(e) => setD({ ...d, active: e.target.checked })} />
          Has access
        </label>
      )}
      {err && <p className="notice error">{err}</p>}
      <div className="row end">
        <button className="btn quiet sm" onClick={onClose}>Cancel</button>
        <button
          className="btn sm"
          disabled={busy || !d.name.trim()}
          onClick={async () => {
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
                extraGeographies: d.role === "reporter" ? d.extraGeographies : [],
                active: d.active,
              });
              toast(d.id ? "Person updated" : "Person added");
              onClose();
            } catch (e) {
              setErr(errorText(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {d.id ? "Save person" : "Add person"}
        </button>
      </div>
    </div>
  );
}

type GeoDraft = { id?: Id<"geographies">; name: string; region: string; timezone: string; position: string; active: boolean };

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
        <h2 className="h2">Geographies</h2>
        <button className="btn sm quiet" onClick={() => setEditing({ name: "", region: "", timezone: "Asia/Dubai", position: "", active: true })}>Add geography</button>
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
                  <div className="small faint">{g.region}, {g.timezone}{g.active ? "" : ", hidden"}</div>
                </div>
                <button className="btn quiet sm" onClick={() => setEditing({ id: g._id, name: g.name, region: g.region, timezone: g.timezone, position: g.lat !== undefined && g.lng !== undefined ? `${g.lat}, ${g.lng}` : "", active: g.active })}>Edit</button>
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
  const [err, setErr] = useState<string | null>(null);
  const save = useMutation(api.members.saveGeography);
  return (
    <div className="sunk stack" style={{ marginBottom: d.id ? 0 : 16 }}>
      <div className="fields">
        <label className="field"><span>Name</span><input className="input" value={d.name} onChange={(e) => setD({ ...d, name: e.target.value })} /></label>
        <label className="field"><span>City or region</span><input className="input" value={d.region} onChange={(e) => setD({ ...d, region: e.target.value })} /></label>
        <label className="field"><span>Time zone</span><input className="input" value={d.timezone} placeholder="Africa/Lagos" onChange={(e) => setD({ ...d, timezone: e.target.value })} /></label>
        <label className="field"><span>Map position</span><input className="input" value={d.position} placeholder="6.52, 3.38" onChange={(e) => setD({ ...d, position: e.target.value })} /></label>
      </div>
      <p className="small faint" style={{ margin: 0 }}>For the map: in Google Maps, right-click the city and click the numbers at the top to copy them, then paste here.</p>
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
            try {
              await save({ id: d.id, name: d.name, region: d.region, timezone: d.timezone, active: d.active, ...pos });
              toast(d.id ? "Geography updated" : "Geography added");
              onClose();
            } catch (e) {
              setErr(errorText(e));
            }
          }}
        >
          {d.id ? "Save geography" : "Add geography"}
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
