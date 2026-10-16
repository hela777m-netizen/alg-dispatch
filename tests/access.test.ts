/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, test } from "vitest";
import schema from "../convex/schema";
import { api, internal } from "../convex/_generated/api";
import { cycleOf, todayISO } from "../convex/lib/cycles";

const modules = import.meta.glob(["../convex/**/*.ts", "../convex/_generated/*.js", "!../convex/**/*.d.ts"]);

const HELA = { subject: "user_hela", email: "hela@alg.test" };
const AMY = { subject: "user_amy", email: "amy@alg.test" };
const ZAIN = { subject: "user_zain", email: "zain@alg.test" };
const KEN = { subject: "user_ken", email: "ken@alg.test" };
const LAURIE = { subject: "user_laurie", email: "laurie@alg.test" };
const STRANGER = { subject: "user_x", email: "x@elsewhere.test" };

const today = todayISO();

async function setup() {
  process.env.OWNER_EMAIL = HELA.email;
  const t = convexTest(schema, modules);
  // Owner's first sign-in seeds geographies and the team.
  expect(await t.mutation(internal.members.link, { userId: HELA.subject, email: HELA.email, name: "Hela Mathlouthi" })).toBe(true);
  const hela = t.withIdentity(HELA);
  const team = await hela.query(api.members.list, {});
  const byName = (n: string) => team.find((m) => m.name === n)!;
  for (const [n, who] of [["Amy Swartz", AMY], ["Zain Ansari", ZAIN], ["Ken Brenner", KEN], ["Laurie Meadoff", LAURIE]] as const) {
    const m = byName(n);
    await hela.mutation(api.members.save, {
      id: m._id, name: m.name, email: who.email, title: m.title, role: m.role,
      geographies: m.geographies, extraGeographies: m.extraGeographies, active: true,
    });
    expect(await t.mutation(internal.members.link, { userId: who.subject, email: who.email })).toBe(true);
  }
  return { t, hela, amy: t.withIdentity(AMY), zain: t.withIdentity(ZAIN), ken: t.withIdentity(KEN), laurie: t.withIdentity(LAURIE) };
}

const entry = (geography: string, title: string, extra: Record<string, unknown> = {}) => ({
  geography, kind: "activity" as const, title, date: today, ...extra,
});

describe("access", () => {
  let ctx: Awaited<ReturnType<typeof setup>>;
  beforeEach(async () => { ctx = await setup(); });

  test("seed creates seven geographies and the team", async () => {
    const me = await ctx.hela.query(api.members.me, {});
    expect(me.state).toBe("member");
    if (me.state !== "member") return;
    expect(me.geographies.map((g) => g.key)).toEqual(["uae", "ksa", "brazil", "new-york", "uk", "nigeria", "greater-china"]);
    expect(me.member.role).toBe("owner");
    expect(me.cycle).toBe(cycleOf(today));
    expect((await ctx.hela.query(api.members.list, {})).length).toBe(6);
  });

  test("strangers and unlinked logins get nothing", async () => {
    expect(await ctx.t.mutation(internal.members.link, { userId: STRANGER.subject, email: STRANGER.email })).toBe(false);
    const s = ctx.t.withIdentity(STRANGER);
    expect((await s.query(api.members.me, {})).state).toBe("unlinked");
    await expect(s.query(api.entries.forCycle, { cycle: 0 })).rejects.toThrow();
    // A second person can't hijack an email already linked to someone else.
    expect(await ctx.t.mutation(internal.members.link, { userId: "user_other", email: ZAIN.email })).toBe(false);
  });

  test("reporters log only to their geographies, including occasional ones", async () => {
    await ctx.zain.mutation(api.entries.addMany, { entries: [entry("ksa", "Met PIF team"), entry("nigeria", "Lagos intro call")], source: "voice" });
    await expect(ctx.zain.mutation(api.entries.addMany, { entries: [entry("brazil", "Nope")], source: "typed" })).rejects.toThrow(/own geographies/);
    await expect(ctx.ken.mutation(api.entries.addMany, { entries: [entry("ksa", "Nope")], source: "typed" })).rejects.toThrow();
    // Owner logs anywhere.
    await ctx.hela.mutation(api.entries.addMany, { entries: [entry("brazil", "BIW agenda locked"), entry("nigeria", "Strategy note")], source: "typed" });
  });

  test("reporters see their geographies only; leads see all", async () => {
    const c = cycleOf(today);
    await ctx.zain.mutation(api.entries.addMany, { entries: [entry("ksa", "KSA item")], source: "typed" });
    await ctx.ken.mutation(api.entries.addMany, { entries: [entry("new-york", "NY item")], source: "typed" });
    await ctx.laurie.mutation(api.entries.addMany, { entries: [entry("new-york", "NY item 2")], source: "typed" });

    const kenSees = await ctx.ken.query(api.entries.forCycle, { cycle: c });
    expect(kenSees.map((e) => e.title).sort()).toEqual(["NY item", "NY item 2"]);
    expect(await ctx.ken.query(api.entries.forCycle, { cycle: c, geography: "ksa" })).toEqual([]);
    expect((await ctx.amy.query(api.entries.forCycle, { cycle: c })).length).toBe(3);

    const kenOverview = await ctx.ken.query(api.dashboard.overview, { cycle: c });
    expect(kenOverview.byGeo.map((g) => g.key)).toEqual(["new-york"]);
    expect(kenOverview.roster.every((r) => r.name === "Ken Brenner")).toBe(true);
    await expect(ctx.ken.query(api.reports.forReview, {})).rejects.toThrow();
    await expect(ctx.ken.query(api.members.list, {})).rejects.toThrow();
  });

  test("only the author or owner can edit and delete", async () => {
    const [id] = await ctx.ken.mutation(api.entries.addMany, { entries: [entry("new-york", "Ken's")], source: "typed" });
    await expect(ctx.laurie.mutation(api.entries.update, { id, ...entry("new-york", "Hijacked") })).rejects.toThrow();
    await expect(ctx.laurie.mutation(api.entries.remove, { id })).rejects.toThrow();
    await ctx.hela.mutation(api.entries.update, { id, ...entry("new-york", "Fixed by Hela") });
    const rows = await ctx.ken.query(api.entries.forCycle, { cycle: cycleOf(today), mineOnly: true });
    expect(rows[0].title).toBe("Fixed by Hela");
    expect(rows[0].editedBy).toBeDefined();
  });

  test("report flow: draft, send, comment, send back, resend, review", async () => {
    const c = cycleOf(today);
    await ctx.zain.mutation(api.entries.addMany, { entries: [entry("ksa", "Deal X", { kind: "deal", dealStage: "terms", dealValue: 40 })], source: "typed" });
    const slots = await ctx.zain.query(api.reports.mine, { cycle: c });
    expect(slots.map((s) => s.geography)).toEqual(["ksa"]);

    const id = await ctx.zain.mutation(api.reports.save, { geography: "ksa", cycle: c, summary: "Draft text", submit: false });
    expect((await ctx.amy.query(api.reports.forReview, {})).length).toBe(0); // drafts are private
    await expect(ctx.zain.mutation(api.reports.save, { geography: "ksa", cycle: c, summary: "short", submit: true })).rejects.toThrow();
    await ctx.zain.mutation(api.reports.save, { geography: "ksa", cycle: c, summary: "Highlights: Deal X moved to terms.", submit: true });

    const waiting = await ctx.amy.query(api.reports.forReview, {});
    expect(waiting.map((r) => r.authorName)).toEqual(["Zain Ansari"]);
    await expect(ctx.ken.query(api.reports.get, { id })).resolves.toBeNull();
    await expect(ctx.ken.mutation(api.reports.comment, { reportId: id, body: "hi" })).rejects.toThrow();
    await expect(ctx.zain.mutation(api.reports.setStatus, { id, status: "reviewed" })).rejects.toThrow();

    await ctx.amy.mutation(api.reports.comment, { reportId: id, body: "What's the timeline?" });
    await ctx.amy.mutation(api.reports.setStatus, { id, status: "needs_info" });
    await ctx.zain.mutation(api.reports.comment, { reportId: id, body: "Close by December." });
    await ctx.zain.mutation(api.reports.save, { geography: "ksa", cycle: c, summary: "Highlights: Deal X at terms, close by December.", submit: true });
    await ctx.amy.mutation(api.reports.setStatus, { id, status: "reviewed" });

    const full = await ctx.zain.query(api.reports.get, { id });
    expect(full?.status).toBe("reviewed");
    expect(full?.comments.map((x) => x.authorName)).toEqual(["Amy Swartz", "Zain Ansari"]);
    await expect(ctx.zain.mutation(api.reports.save, { geography: "ksa", cycle: c, summary: "Edit after review", submit: false })).rejects.toThrow();

    const ov = await ctx.amy.query(api.dashboard.overview, { cycle: c });
    expect(ov.totals.activeDeals).toBe(1);
    expect(ov.totals.openValue).toBe(40);
    expect(ov.roster.find((r) => r.name === "Zain Ansari" && r.geography === "ksa")?.status).toBe("reviewed");
    expect(ov.roster.find((r) => r.name === "Nancy Muzi Gao")?.status).toBe("missing");
  });

  test("pipeline keeps the latest stage per deal", async () => {
    await ctx.zain.mutation(api.entries.addMany, { entries: [entry("ksa", "Project Falcon", { kind: "deal", dealStage: "lead", date: "2026-10-06" })], source: "typed" });
    await ctx.zain.mutation(api.entries.addMany, { entries: [entry("ksa", "project falcon", { kind: "deal", dealStage: "diligence", dealValue: 120, date: "2026-10-10" })], source: "typed" });
    const ov = await ctx.hela.query(api.dashboard.overview, { cycle: cycleOf("2026-10-10") });
    expect(ov.pipeline.length).toBe(1);
    expect(ov.pipeline[0].stage).toBe("diligence");
  });

  test("team admin is owner-only and the owner can't lock themselves out", async () => {
    const me = await ctx.hela.query(api.members.me, {});
    if (me.state !== "member") throw new Error();
    await expect(ctx.amy.mutation(api.members.save, { name: "X", role: "reporter", geographies: [], extraGeographies: [], active: true })).rejects.toThrow();
    await expect(ctx.hela.mutation(api.members.save, { id: me.member._id, name: "Hela", email: HELA.email, role: "reporter", geographies: [], extraGeographies: [], active: true })).rejects.toThrow(/own owner/);
    await expect(ctx.hela.mutation(api.members.save, { name: "Dup", email: KEN.email, role: "reporter", geographies: [], extraGeographies: [], active: true })).rejects.toThrow(/already uses/);
    // Removing access cuts it immediately.
    const ken = (await ctx.hela.query(api.members.list, {})).find((m) => m.name === "Ken Brenner")!;
    await ctx.hela.mutation(api.members.save, { id: ken._id, name: ken.name, email: KEN.email, role: "reporter", geographies: ken.geographies, extraGeographies: [], active: false });
    expect((await ctx.ken.query(api.members.me, {})).state).toBe("unlinked");
  });
});
