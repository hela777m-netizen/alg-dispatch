/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { cycleOf, cycleRange, todayISO } from "../convex/lib/cycles";

const modules = import.meta.glob(["../convex/**/*.ts", "../convex/_generated/*.js", "!../convex/**/*.d.ts"]);

// Placeholder people. No staff names in the repository.
const OWNER = { subject: "user_owner", email: "owner@alg.test" };
const MANAGER = { subject: "user_mgr", email: "manager@alg.test" };
const KSA = { subject: "user_ksa", email: "ksa@alg.test" };
const US1 = { subject: "user_us1", email: "us1@alg.test" };
const US2 = { subject: "user_us2", email: "us2@alg.test" };
const UAE = { subject: "user_uae", email: "uae@alg.test" };
const UKR = { subject: "user_uk", email: "uk@alg.test" };
const STRANGER = { subject: "user_x", email: "x@elsewhere.test" };

const PEOPLE = [
  { who: MANAGER, name: "Manager One", role: "manager" as const, geographies: [], extraGeographies: [] },
  { who: KSA, name: "Reporter KSA", role: "reporter" as const, geographies: ["ksa"], extraGeographies: ["uae", "uk", "nigeria"] },
  { who: US1, name: "Reporter US One", role: "reporter" as const, geographies: ["new-york"], extraGeographies: [] },
  { who: US2, name: "Reporter US Two", role: "reporter" as const, geographies: ["new-york"], extraGeographies: [] },
  { who: UAE, name: "Reporter Abu Dhabi", role: "reporter" as const, geographies: ["uae"], extraGeographies: [] },
  { who: UKR, name: "Reporter UK", role: "reporter" as const, geographies: ["uk"], extraGeographies: [] },
  { who: null, name: "Reporter China", role: "reporter" as const, geographies: ["greater-china"], extraGeographies: [] },
];

const today = todayISO();

async function setup() {
  process.env.OWNER_EMAIL = OWNER.email;
  delete process.env.ANTHROPIC_API_KEY;
  const t = convexTest(schema, modules);
  // Owner's first sign-in seeds the geographies; the owner then adds the team.
  expect(await t.mutation(internal.members.link, { userId: OWNER.subject, email: OWNER.email, name: "Owner" })).toBe(true);
  const owner = t.withIdentity(OWNER);
  const ids: Record<string, string> = {};
  for (const p of PEOPLE) {
    ids[p.name] = await owner.mutation(api.members.save, {
      name: p.name, email: p.who?.email, role: p.role, geographies: p.geographies, extraGeographies: p.extraGeographies, active: true,
    });
    if (p.who) expect(await t.mutation(internal.members.link, { userId: p.who.subject, email: p.who.email })).toBe(true);
  }
  return {
    t, ids, owner,
    manager: t.withIdentity(MANAGER), ksa: t.withIdentity(KSA), us1: t.withIdentity(US1), us2: t.withIdentity(US2),
    uae: t.withIdentity(UAE), uk: t.withIdentity(UKR),
  };
}
type Ctx = Awaited<ReturnType<typeof setup>>;

const entry = (geography: string, title: string, extra: Record<string, unknown> = {}) => ({
  geography, kind: "activity" as const, title, date: today, ...extra,
});

async function memberArgs(c: Ctx, name: string) {
  const m = (await c.owner.query(api.members.list, {})).find((x) => x.name === name)!;
  return { id: m._id, name: m.name, email: m.email, title: m.title, role: m.role, geographies: m.geographies, extraGeographies: m.extraGeographies, active: m.active, reportsTo: m.reportsTo };
}

describe("existing access rules", () => {
  let c: Ctx;
  beforeEach(async () => { c = await setup(); });

  test("seed creates the offices and the first market, with no staff names", async () => {
    const me = await c.owner.query(api.members.me, {});
    if (me.state !== "member") throw new Error();
    expect(me.geographies.map((g) => g.key)).toEqual(["uae", "ksa", "brazil", "new-york", "uk", "nigeria", "greater-china", "kazakhstan"]);
    expect(me.geographies.find((g) => g.key === "kazakhstan")?.office).toBe(false);
    expect(me.geographies.find((g) => g.key === "new-york")?.name).toBe("United States");
    expect(me.member.role).toBe("owner");
    expect(me.cycle).toBe(cycleOf(today));
    expect((await c.owner.query(api.members.list, {})).length).toBe(PEOPLE.length + 1);
  });

  test("strangers and unlinked logins get nothing, and the refusal is logged", async () => {
    expect(await c.t.mutation(internal.members.link, { userId: STRANGER.subject, email: STRANGER.email })).toBe(false);
    const s = c.t.withIdentity(STRANGER);
    expect((await s.query(api.members.me, {})).state).toBe("unlinked");
    await expect(s.query(api.entries.forCycle, { cycle: 0 })).rejects.toThrow();
    await expect(s.query(api.dashboard.overview, { cycle: 0 })).rejects.toThrow();
    await expect(s.mutation(api.files.uploadUrl, {})).rejects.toThrow();
    await expect(s.action(api.ai.structure, { text: "Met the PIF team today", defaultGeography: "ksa" })).rejects.toThrow(/access/);
    // A second login can't take over an email already linked to someone else.
    expect(await c.t.mutation(internal.members.link, { userId: "user_other", email: KSA.email })).toBe(false);
    const log = await c.owner.query(api.members.history, {});
    expect(log.filter((r) => r.action === "signin.refused").length).toBe(2);
    expect(log.find((r) => r.action === "signin.refused" && r.targetName?.includes("elsewhere.test"))).toBeDefined();
  });

  test("only the author or owner can edit and delete", async () => {
    const [id] = await c.us1.mutation(api.entries.addMany, { entries: [entry("new-york", "US1's")], source: "typed" });
    await expect(c.us2.mutation(api.entries.update, { id, ...entry("new-york", "Hijacked") })).rejects.toThrow();
    await expect(c.us2.mutation(api.entries.remove, { id })).rejects.toThrow();
    await c.owner.mutation(api.entries.update, { id, ...entry("new-york", "Fixed by owner") });
    const rows = await c.us1.query(api.entries.forCycle, { cycle: cycleOf(today), mineOnly: true });
    expect(rows[0].title).toBe("Fixed by owner");
    expect(rows[0].editedBy).toBeDefined();
    expect((await c.owner.query(api.members.history, {})).some((r) => r.action === "update.edited_by_owner")).toBe(true);
  });

  test("report flow: draft, send, comment, send back, resend, review", async () => {
    const cy = cycleOf(today);
    await c.ksa.mutation(api.entries.addMany, { entries: [entry("ksa", "Deal X", { kind: "deal", dealStage: "terms", dealValue: 40 })], source: "typed" });
    const slots = await c.ksa.query(api.reports.mine, { cycle: cy });
    expect(slots.map((s) => s.geography)).toEqual(["ksa"]);

    const id = await c.ksa.mutation(api.reports.save, { geography: "ksa", cycle: cy, summary: "Draft text", submit: false });
    expect((await c.manager.query(api.reports.forReview, {})).length).toBe(0);
    await expect(c.ksa.mutation(api.reports.save, { geography: "ksa", cycle: cy, summary: "short", submit: true })).rejects.toThrow();
    await c.ksa.mutation(api.reports.save, { geography: "ksa", cycle: cy, summary: "Highlights: Deal X moved to terms.", submit: true });

    const waiting = await c.manager.query(api.reports.forReview, {});
    expect(waiting.map((r) => r.authorName)).toEqual(["Reporter KSA"]);
    await expect(c.us1.query(api.reports.get, { id })).resolves.toBeNull();
    await expect(c.us1.mutation(api.reports.comment, { reportId: id, body: "hi" })).rejects.toThrow();
    await expect(c.ksa.mutation(api.reports.setStatus, { id, status: "reviewed" })).rejects.toThrow();

    await c.manager.mutation(api.reports.comment, { reportId: id, body: "What's the timeline?" });
    await c.manager.mutation(api.reports.setStatus, { id, status: "needs_info" });
    await c.ksa.mutation(api.reports.comment, { reportId: id, body: "Close by December." });
    await c.ksa.mutation(api.reports.save, { geography: "ksa", cycle: cy, summary: "Highlights: Deal X at terms, close by December.", submit: true });
    await c.manager.mutation(api.reports.setStatus, { id, status: "reviewed" });

    const full = await c.ksa.query(api.reports.get, { id });
    expect(full?.status).toBe("reviewed");
    expect(full?.comments.map((x) => x.authorName)).toEqual(["Manager One", "Reporter KSA"]);
    await expect(c.ksa.mutation(api.reports.save, { geography: "ksa", cycle: cy, summary: "Edit after review", submit: false })).rejects.toThrow();

    const ov = await c.manager.query(api.dashboard.overview, { cycle: cy });
    expect(ov.totals.activeDeals).toBe(1);
    expect(ov.totals.openValue).toBe(40);
    expect(ov.roster.find((r) => r.name === "Reporter KSA" && r.geography === "ksa")?.status).toBe("reviewed");
    expect(ov.roster.find((r) => r.name === "Reporter China")?.status).toBe("missing");
  });

  test("pipeline keeps the latest stage per deal", async () => {
    await c.ksa.mutation(api.entries.addMany, { entries: [entry("ksa", "Project Falcon", { kind: "deal", dealStage: "lead", date: "2026-10-06" })], source: "typed" });
    await c.ksa.mutation(api.entries.addMany, { entries: [entry("ksa", "project falcon", { kind: "deal", dealStage: "diligence", dealValue: 120, date: "2026-10-10" })], source: "typed" });
    const ov = await c.owner.query(api.dashboard.overview, { cycle: cycleOf("2026-10-10") });
    expect(ov.pipeline.length).toBe(1);
    expect(ov.pipeline[0].stage).toBe("diligence");
  });

  test("team admin is owner-only and the owner can't lock themselves out", async () => {
    const me = await c.owner.query(api.members.me, {});
    if (me.state !== "member") throw new Error();
    await expect(c.manager.mutation(api.members.save, { name: "X", role: "reporter", geographies: [], extraGeographies: [], active: true })).rejects.toThrow();
    await expect(c.ksa.mutation(api.members.save, { ...(await memberArgs(c, "Reporter KSA")), role: "owner" })).rejects.toThrow(/owner/);
    await expect(c.owner.mutation(api.members.save, { id: me.member._id, name: "Owner", email: OWNER.email, role: "reporter", geographies: [], extraGeographies: [], active: true })).rejects.toThrow(/own owner/);
    await expect(c.owner.mutation(api.members.save, { name: "Dup", email: US1.email, role: "reporter", geographies: [], extraGeographies: [], active: true })).rejects.toThrow(/already uses/);
  });
});

describe("geography: visibility versus where an update belongs", () => {
  let c: Ctx;
  beforeEach(async () => { c = await setup(); });

  test("an Abu Dhabi reporter posts a UK deal without gaining UK visibility", async () => {
    const cy = cycleOf(today);
    const [others] = await c.uk.mutation(api.entries.addMany, { entries: [entry("uk", "Restricted UK mandate", { kind: "deal" })], source: "typed" });
    // 1. Posts to the UK with no UK assignment.
    const [mine] = await c.uae.mutation(api.entries.addMany, { entries: [entry("uk", "UK secondary sale", { kind: "deal", dealStage: "engaged" })], source: "typed" });
    // 2. Sees and edits their own UK entry later.
    expect((await c.uae.query(api.entries.forCycle, { cycle: cy, mineOnly: true })).map((e) => e.title)).toEqual(["UK secondary sale"]);
    await c.uae.mutation(api.entries.update, { id: mine, ...entry("uk", "UK secondary sale, terms", { kind: "deal", dealStage: "terms" }) });
    // 3. Cannot see another person's UK update, by list, by geography or by guessing the ID.
    expect((await c.uae.query(api.entries.forCycle, { cycle: cy })).map((e) => e.title)).toEqual(["UK secondary sale, terms"]);
    expect((await c.uae.query(api.entries.forCycle, { cycle: cy, geography: "uk" })).map((e) => e.title)).toEqual(["UK secondary sale, terms"]);
    expect(await c.uae.query(api.entries.responses, { entryId: others })).toEqual([]);
    await expect(c.uae.mutation(api.entries.respond, { entryId: others, body: "hi", source: "typed" })).rejects.toThrow();
    const uaeOverview = await c.uae.query(api.dashboard.overview, { cycle: cy });
    expect(uaeOverview.pipeline.map((p) => p.title)).toEqual(["UK secondary sale, terms"]);
    // 4. The UK reporter sees both.
    expect((await c.uk.query(api.entries.forCycle, { cycle: cy, geography: "uk" })).length).toBe(2);
    // 5. The manager sees it in the consolidated view, 6. stored once.
    const all = await c.manager.query(api.entries.forCycle, { cycle: cy });
    expect(all.filter((e) => e._id === mine).length).toBe(1);
    expect(all.length).toBe(2);
    // 7. The author's assigned geographies are unchanged.
    expect((await memberArgs(c, "Reporter Abu Dhabi")).geographies).toEqual(["uae"]);
  });

  test("replies on your own cross-border update reach you", async () => {
    const [id] = await c.uae.mutation(api.entries.addMany, { entries: [entry("uk", "UK blocker", { kind: "blocker" })], source: "typed" });
    await c.manager.mutation(api.entries.respond, { entryId: id, body: "I'll handle it.", source: "typed" });
    expect((await c.uae.query(api.entries.responses, { entryId: id })).length).toBe(1);
    await c.uae.mutation(api.entries.respond, { entryId: id, body: "Thanks.", source: "typed" });
    const inbox = await c.uae.query(api.notifications.list, {});
    expect(inbox[0].entryTitle).toBe("UK blocker");
  });

  test("occasional geographies no longer grant read access", async () => {
    await c.uae.mutation(api.entries.addMany, { entries: [entry("uae", "HQ confidential")], source: "typed" });
    const cy = cycleOf(today);
    expect(await c.ksa.query(api.entries.forCycle, { cycle: cy, geography: "uae" })).toEqual([]);
    expect((await c.ksa.query(api.dashboard.overview, { cycle: cy })).byGeo.map((g) => g.key)).toEqual(["ksa"]);
  });

  test("a new jurisdiction opens as a market, never an office, and owes no report", async () => {
    await c.ksa.mutation(api.entries.addMany, { entries: [entry("iso:398", "Astana grain facility")], source: "typed" });
    await c.ksa.mutation(api.entries.addMany, { entries: [entry("iso:276", "Braunschweig visit")], source: "voice" });
    await c.us1.mutation(api.entries.addMany, { entries: [entry("iso:276", "Frankfurt call")], source: "typed" });
    await expect(c.ksa.mutation(api.entries.addMany, { entries: [entry("iso:999", "Nowhere")], source: "typed" })).rejects.toThrow(/country/);
    await expect(c.ksa.mutation(api.entries.addMany, { entries: [entry("atlantis", "Nowhere")], source: "typed" })).rejects.toThrow(/geography/);
    const me = await c.owner.query(api.members.me, {});
    if (me.state !== "member") throw new Error();
    const germany = me.geographies.filter((g) => g.country === "276");
    expect(germany.length).toBe(1);
    expect(germany[0].office).toBe(false);
    const rows = await c.owner.query(api.entries.forCycle, { cycle: cycleOf(today) });
    expect(rows.find((e) => e.title === "Astana grain facility")?.geography).toBe("kazakhstan");
    // The Saudi reporter can't read the other person's German update.
    expect((await c.ksa.query(api.entries.forCycle, { cycle: cycleOf(today), geography: germany[0].key })).map((e) => e.title)).toEqual(["Braunschweig visit"]);
    expect((await c.owner.query(api.dashboard.overview, { cycle: cycleOf(today) })).roster.some((r) => r.geography === germany[0].key)).toBe(false);
    expect((await c.owner.query(api.members.history, {})).filter((r) => r.action === "market.opened").length).toBe(1);
    expect((await c.ksa.query(api.reports.mine, { cycle: cycleOf(today) })).find((s) => s.geography === "kazakhstan")?.expected).toBe(false);
  });

  test("a retried save with the same request code does not duplicate", async () => {
    const args = { entries: [entry("ksa", "Once only")], source: "typed" as const, requestId: "req-1" };
    const a = await c.ksa.mutation(api.entries.addMany, args);
    const b = await c.ksa.mutation(api.entries.addMany, args);
    expect(b).toEqual(a);
    expect((await c.ksa.query(api.entries.forCycle, { cycle: cycleOf(today), mineOnly: true })).length).toBe(1);
  });
});

describe("drafts, owners and lifecycle", () => {
  let c: Ctx;
  beforeEach(async () => { c = await setup(); });

  test("drafts are private to their author", async () => {
    const cy = cycleOf(today);
    const id = await c.ksa.mutation(api.reports.save, { geography: "ksa", cycle: cy, summary: "Unsent thoughts", submit: false });
    expect(await c.manager.query(api.reports.get, { id })).toBeNull();
    expect(await c.owner.query(api.reports.get, { id })).toBeNull();
    await expect(c.manager.mutation(api.reports.comment, { reportId: id, body: "Early note" })).rejects.toThrow();
    const ov = await c.manager.query(api.dashboard.overview, { cycle: cy });
    const row = ov.roster.find((r) => r.name === "Reporter KSA")!;
    expect(row.status).toBe("draft");
    expect(row.reportId).toBeUndefined();
    expect((await c.ksa.query(api.reports.get, { id }))?.summary).toBe("Unsent thoughts");
  });

  test("owners can't change each other; handover is explicit", async () => {
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Manager One")), role: "owner" });
    const me = await c.owner.query(api.members.me, {});
    if (me.state !== "member") throw new Error();
    const firstOwner = { id: me.member._id, name: "Owner", email: OWNER.email, role: "reporter" as const, geographies: [], extraGeographies: [], active: false };
    await expect(c.manager.mutation(api.members.save, firstOwner)).rejects.toThrow(/also an owner/);
    await expect(c.manager.mutation(api.members.resetSignIn, { id: me.member._id })).rejects.toThrow();
    // Handover to a reporter: they become owner, the giver becomes manager.
    await c.owner.mutation(api.members.transferOwnership, { to: c.ids["Reporter UK"] as never });
    const after = await c.uk.query(api.members.me, {});
    expect(after.state === "member" && after.member.role).toBe("owner");
    const before = await c.owner.query(api.members.me, {});
    expect(before.state === "member" && before.member.role).toBe("manager");
    expect((await c.uk.query(api.members.history, {})).some((r) => r.action === "owner.handover")).toBe(true);
  });

  test("owner edits keep check-in; managers get no login IDs", async () => {
    await c.ksa.mutation(api.members.setPresence, { presence: "travelling", location: "London", until: "2099-01-01" });
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter KSA")), title: "KSA lead" });
    const p = await c.manager.query(api.members.person, { id: c.ids["Reporter KSA"] as never });
    expect(p?.presence).toBe("travelling");
    expect(p?.location).toBe("London");
    const list = await c.manager.query(api.members.list, {});
    expect(list.every((m) => !("userId" in m))).toBe(true);
    expect(list.find((m) => m.name === "Reporter KSA")?.linked).toBe(true);
    expect(list.find((m) => m.name === "Reporter China")?.status).toBe("no_email");
  });

  test("role and geography changes apply at once and are logged", async () => {
    const cy = cycleOf(today);
    await c.uk.mutation(api.entries.addMany, { entries: [entry("uk", "UK item")], source: "typed" });
    expect(await c.uae.query(api.entries.forCycle, { cycle: cy, geography: "uk" })).toEqual([]);
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter Abu Dhabi")), geographies: ["uae", "uk"], reportsTo: c.ids["Manager One"] as never });
    expect((await c.uae.query(api.entries.forCycle, { cycle: cy, geography: "uk" })).length).toBe(1);
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter Abu Dhabi")), role: "manager" });
    expect((await c.uae.query(api.members.list, {})).length).toBeGreaterThan(0);
    const log = await c.owner.query(api.members.history, { id: c.ids["Reporter Abu Dhabi"] as never });
    expect(log.map((r) => r.detail).join(" | ")).toMatch(/geographies uae to uae, uk; reporting manager none to Manager One/);
    expect(log.map((r) => r.detail).join(" | ")).toMatch(/role Reporter to Manager/);
    // Self-promotion is impossible: only the owner can save members.
    await expect(c.us1.mutation(api.members.save, { ...(await memberArgs(c, "Reporter US One")), role: "manager" })).rejects.toThrow();
  });

  test("suspend, reactivate, leave, reset sign-in; history stays", async () => {
    const cy = cycleOf(today);
    await c.us1.mutation(api.entries.addMany, { entries: [entry("new-york", "Investor dinner")], source: "typed" });
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter US One")), active: false });
    expect((await c.us1.query(api.members.me, {})).state).toBe("unlinked");
    await expect(c.us1.query(api.entries.forCycle, { cycle: cy })).rejects.toThrow();
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter US One")), active: true });
    expect((await c.us1.query(api.members.me, {})).state).toBe("member");
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter US One")), left: true });
    expect((await c.us1.query(api.members.me, {})).state).toBe("unlinked");
    const rows = await c.manager.query(api.entries.forCycle, { cycle: cy });
    expect(rows.find((e) => e.title === "Investor dinner")?.authorName).toBe("Reporter US One");
    expect((await c.owner.query(api.members.list, {})).find((m) => m.name === "Reporter US One")?.status).toBe("left");
    // A re-created account for the same email can link after a reset.
    await c.owner.mutation(api.members.save, { ...(await memberArgs(c, "Reporter US Two")) });
    expect(await c.t.mutation(internal.members.link, { userId: "user_us2_new", email: US2.email })).toBe(false);
    await c.owner.mutation(api.members.resetSignIn, { id: c.ids["Reporter US Two"] as never });
    expect(await c.t.mutation(internal.members.link, { userId: "user_us2_new", email: US2.email })).toBe(true);
    const actions = (await c.owner.query(api.members.history, {})).map((r) => r.action);
    for (const a of ["member.suspended", "member.reactivated", "member.left", "member.signin_reset"]) expect(actions).toContain(a);
  });

  test("deleting an update removes its replies and their notifications", async () => {
    const [id] = await c.ksa.mutation(api.entries.addMany, { entries: [entry("ksa", "Sensitive blocker", { kind: "blocker" })], source: "typed" });
    await c.manager.mutation(api.entries.respond, { entryId: id, body: "Private answer", source: "typed" });
    await c.ksa.mutation(api.entries.respond, { entryId: id, body: "Reply", source: "typed" });
    await c.ksa.mutation(api.entries.remove, { id });
    const left = await c.t.run(async (ctx) => ({
      responses: (await ctx.db.query("responses").collect()).length,
      notes: (await ctx.db.query("notifications").collect()).filter((n) => n.entryId === id).length,
    }));
    expect(left).toEqual({ responses: 0, notes: 0 });
    expect((await c.owner.query(api.members.history, {})).some((r) => r.action === "update.deleted")).toBe(true);
  });
});

describe("availability", () => {
  let c: Ctx;
  beforeEach(async () => { c = await setup(); });
  const add = (d: string, n: number) => {
    const [y, m, day] = d.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, day + n)).toISOString().slice(0, 10);
  };

  test("plans set current status only while they run, and never change access", async () => {
    await c.ksa.mutation(api.availability.save, { kind: "travel", start: add(today, -1), end: add(today, 2), place: "London", note: "Roadshow" });
    await c.ksa.mutation(api.availability.save, { kind: "leave", start: add(today, 5), end: add(today, 8), place: "ignored", note: "ignored" });
    const team = await c.manager.query(api.members.team, {});
    const ksa = team.find((m) => m.name === "Reporter KSA")!;
    expect(ksa.presence).toBe("travelling");
    expect(ksa.location).toBe("London");
    const view = await c.manager.query(api.availability.team, {});
    expect(view?.awayNow.map((a) => a.name)).toEqual(["Reporter KSA"]);
    expect(view?.upcoming.map((u) => [u.name, u.kind, u.place, u.note])).toEqual([["Reporter KSA", "leave", undefined, undefined]]);
    // Travelling to London grants no UK visibility.
    await c.uk.mutation(api.entries.addMany, { entries: [entry("uk", "UK only")], source: "typed" });
    expect(await c.ksa.query(api.entries.forCycle, { cycle: cycleOf(today), geography: "uk" })).toEqual([]);
  });

  test("reporters see only their own plans and can change only their own", async () => {
    const id = await c.ksa.mutation(api.availability.save, { kind: "leave", start: add(today, 1), end: add(today, 3) });
    expect(await c.us1.query(api.availability.team, {})).toBeNull();
    expect(await c.us1.query(api.availability.mine, {})).toEqual([]);
    await expect(c.us1.mutation(api.availability.remove, { id })).rejects.toThrow();
    await expect(c.us1.mutation(api.availability.save, { id, kind: "leave", start: today, end: today })).rejects.toThrow();
    await expect(c.ksa.mutation(api.availability.save, { kind: "leave", start: add(today, 3), end: today })).rejects.toThrow(/before/);
    await c.ksa.mutation(api.availability.remove, { id });
    expect(await c.ksa.query(api.availability.mine, {})).toEqual([]);
  });

  test("a reporter away on report day shows as a reporting gap", async () => {
    const due = cycleRange(cycleOf(today)).end;
    await c.us1.mutation(api.availability.save, { kind: "leave", start: today, end: add(due, 1) });
    const view = await c.manager.query(api.availability.team, {});
    expect(view?.gaps.map((g) => g.name)).toEqual(["Reporter US One"]);
  });

  test("past plans drop out of current status", async () => {
    await c.ksa.mutation(api.availability.save, { kind: "leave", start: add(today, -5), end: add(today, -1) });
    expect((await c.manager.query(api.members.team, {})).find((m) => m.name === "Reporter KSA")?.presence).toBeUndefined();
    expect(await c.ksa.query(api.availability.mine, {})).toEqual([]);
  });
});

describe("responses, notifications, uploads and AI", () => {
  let c: Ctx;
  beforeEach(async () => { c = await setup(); });
  afterEach(() => { vi.useRealTimers(); });

  test("manager responds to a blocker, author is notified, outsiders can't respond", async () => {
    const [id] = await c.ksa.mutation(api.entries.addMany, { entries: [entry("ksa", "Bank account opening stuck", { kind: "blocker" })], source: "typed" });
    await c.manager.mutation(api.entries.respond, { entryId: id, body: "I'll call the bank's MD tomorrow.", source: "voice" });
    expect(await c.ksa.query(api.notifications.unreadCount, {})).toBe(1);
    const inbox = await c.ksa.query(api.notifications.list, {});
    expect(inbox[0].actorName).toBe("Manager One");
    expect(inbox[0].entryTitle).toBe("Bank account opening stuck");
    await expect(c.us1.mutation(api.entries.respond, { entryId: id, body: "hi", source: "typed" })).rejects.toThrow();
    expect(await c.us1.query(api.entries.responses, { entryId: id })).toEqual([]);
    await c.ksa.mutation(api.entries.respond, { entryId: id, body: "Thanks, sent you the contact.", source: "typed" });
    expect(await c.manager.query(api.notifications.unreadCount, {})).toBe(1);
    await c.ksa.mutation(api.notifications.markRead, {});
    expect(await c.ksa.query(api.notifications.unreadCount, {})).toBe(0);
  });

  test("check-in is self-service; managers see the team, reporters see only themselves", async () => {
    await c.ksa.mutation(api.members.setPresence, { presence: "leave", location: "Riyadh", until: "2099-10-30" });
    const team = await c.manager.query(api.members.team, {});
    expect(team.find((m) => m.name === "Reporter KSA")?.presence).toBe("leave");
    expect((await c.us1.query(api.members.team, {})).map((m) => m.name)).toEqual(["Reporter US One"]);
    const id = c.ids["Reporter KSA"] as never;
    expect(await c.us1.query(api.members.person, { id })).toBeNull();
    expect(await c.us1.query(api.entries.forPerson, { memberId: id, fromCycle: 0 })).toEqual([]);
  });

  test("review decisions notify the author", async () => {
    const rid = await c.us1.mutation(api.reports.save, { geography: "new-york", cycle: cycleOf(today), summary: "Highlights: two investor meetings.", submit: true });
    await c.manager.mutation(api.reports.setStatus, { id: rid, status: "needs_info" });
    expect((await c.us1.query(api.notifications.list, {}))[0].kind).toBe("report_status");
    expect((await c.owner.query(api.members.history, {})).some((r) => r.action === "report.returned")).toBe(true);
  });

  test("only the uploader can have a file read; others can't touch it", async () => {
    const storageId = await c.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4 test"], { type: "application/pdf" })));
    await c.ksa.mutation(api.files.register, { storageId });
    await expect(c.us1.mutation(api.files.register, { storageId })).rejects.toThrow(/isn't yours/);
    await expect(c.us1.action(api.ai.fromDocument, { storageId, defaultGeography: "ksa" })).rejects.toThrow(/isn't available/);
    expect(await c.t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(true);
    // The owner of the file gets a plain AI-unavailable message (no key in tests), and the file is gone afterwards.
    await expect(c.ksa.action(api.ai.fromDocument, { storageId, defaultGeography: "ksa" })).rejects.toThrow(/AI is unavailable right now \(ref AI-/);
    expect(await c.t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
  });

  test("AI failures are plain for users, detailed for the owner, and logged without text", async () => {
    await expect(c.ksa.action(api.ai.structure, { text: "Met the PIF team about the fund", defaultGeography: "ksa" })).rejects.toThrow(/carry on by typing/);
    await expect(c.owner.action(api.ai.structure, { text: "Met the PIF team about the fund", defaultGeography: "ksa" })).rejects.toThrow(/ANTHROPIC_API_KEY/);
    const log = (await c.owner.query(api.members.history, {})).filter((r) => r.action === "ai.structure");
    expect(log.length).toBe(2);
    expect(log[0].detail).toMatch(/31 characters, failed \(ref AI-/);
    expect(JSON.stringify(log)).not.toContain("PIF");
  });

  test("abandoned uploads are deleted after an hour", async () => {
    vi.useFakeTimers();
    const storageId = await c.t.run((ctx) => ctx.storage.store(new Blob(["%PDF-1.4"], { type: "application/pdf" })));
    await c.ksa.mutation(api.files.register, { storageId });
    vi.advanceTimersByTime(2 * 3_600_000);
    await c.t.mutation(internal.files.cleanup, {});
    expect(await c.t.run(async (ctx) => (await ctx.storage.get(storageId)) !== null)).toBe(false);
    expect(await c.t.run(async (ctx) => (await ctx.db.query("uploads").collect()).length)).toBe(0);
  });
});
