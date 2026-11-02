import { v, ConvexError } from "convex/values";
import { action, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const STYLE = [
  "Write in plain, direct business English.",
  "No em dashes or en dashes. Use commas, colons or full stops instead.",
  "No filler, no hype, no phrases like 'leverage', 'robust', 'delve', 'exciting'.",
  "Never invent facts, names, figures or dates that the speaker did not give.",
].join(" ");

/** Short reference code for an error, shown to the user and written to the server log. */
function ref() {
  return `AI-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

/**
 * Calls the Claude API. Users get a plain message with a reference code; the owner also
 * gets the setting-level reason. The log gets the status and reference, never the prompt.
 */
async function callClaude(body: Record<string, unknown>, isOwner: boolean) {
  const code = ref();
  const fail = (forOwner: string): never => {
    throw new ConvexError(
      isOwner
        ? `${forOwner} (ref ${code})`
        : `AI is unavailable right now (ref ${code}). You can carry on by typing your update.`,
    );
  };
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.error(`[${code}] AI not configured: ANTHROPIC_API_KEY missing`);
    fail("AI isn't set up: ANTHROPIC_API_KEY is missing in Convex.");
  }
  let res: Response;
  try {
    res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": key!,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({ model: MODEL(), ...body }),
    });
  } catch {
    console.error(`[${code}] Claude API unreachable`);
    return fail("Couldn't reach the Claude API.");
  }
  if (!res.ok) {
    let reason = "";
    try {
      reason = ((await res.json()) as { error?: { message?: string } }).error?.message ?? "";
    } catch { /* not JSON */ }
    console.error(`[${code}] Claude API error ${res.status}`);
    if (res.status === 429) {
      throw new ConvexError(`Too many AI requests right now (ref ${code}). Try again in a minute, or carry on by typing.`);
    }
    if (res.status === 401) fail("The Claude API key was rejected. Check ANTHROPIC_API_KEY in Convex.");
    if (/credit balance/i.test(reason)) fail("The Claude account has no credit. Add credit in the Anthropic console.");
    if (res.status === 404) fail(`Claude model not found (${MODEL()}). Set ANTHROPIC_MODEL in Convex to a current model.`);
    fail(`Claude returned ${res.status}${reason ? `: ${reason.slice(0, 160)}` : ""}.`);
  }
  return (await res.json()) as { content: { type: string; text?: string; input?: unknown }[] };
}

/** Runs an AI call and writes one audit row with its size and outcome. */
async function logged<T>(ctx: ActionCtx, action: string, size: number, run: () => Promise<T>): Promise<T> {
  try {
    const out = await run();
    await ctx.runMutation(internal.aiData.logCall, { action, size, ok: true });
    return out;
  } catch (e) {
    const m = e instanceof ConvexError && typeof e.data === "string" ? e.data.match(/ref (AI-[A-Z0-9]+)/) : null;
    await ctx.runMutation(internal.aiData.logCall, { action, size, ok: false, ref: m?.[1] });
    throw e;
  }
}

const ENTRY_SCHEMA = {
  type: "object",
  properties: {
    entries: {
      type: "array",
      items: {
        type: "object",
        properties: {
          geography: { type: "string", description: "One of the allowed geography keys." },
          kind: {
            type: "string",
            enum: ["activity", "meeting", "deal", "event", "blocker", "ask", "next"],
            description:
              "activity: work done. meeting: a meeting or call with a counterparty. deal: a transaction or mandate and its stage. event: a conference, forum or business event attended or coming up. blocker: something stuck. ask: something needed from HQ or a colleague. next: planned for the coming two weeks.",
          },
          title: { type: "string", description: "Short headline, under 12 words. For deals, the deal or company name only." },
          details: { type: "string", description: "One to three sentences with the specifics the speaker gave." },
          counterparty: { type: "string", description: "Company or person met or dealt with, if named." },
          dealStage: { type: "string", enum: ["lead", "engaged", "diligence", "terms", "closing", "closed", "lost"] },
          dealValue: { type: "number", description: "Deal size in USD millions, only if stated. Convert other currencies only if the rate is obvious; otherwise omit." },
          date: { type: "string", description: "YYYY-MM-DD. Resolve 'yesterday', 'Tuesday' etc. against today's date. Default to today." },
          startTime: { type: "string", description: "HH:MM, 24-hour, only if a start time is stated." },
          endTime: { type: "string", description: "HH:MM, 24-hour, only if an end time is stated." },
        },
        required: ["geography", "kind", "title", "date"],
      },
    },
  },
  required: ["entries"],
};

type Kind = "activity" | "meeting" | "deal" | "event" | "blocker" | "ask" | "next";
type Stage = "lead" | "engaged" | "diligence" | "terms" | "closing" | "closed" | "lost";
export type StructuredEntry = {
  geography: string;
  kind: Kind;
  title: string;
  details?: string;
  counterparty?: string;
  dealStage?: Stage;
  dealValue?: number;
  date: string;
  startTime?: string;
  endTime?: string;
};
type AiContext = {
  name: string;
  isOwner: boolean;
  today: string;
  location?: string;
  geographies: { key: string; name: string; region: string }[];
} | null;

type ContentBlock = Record<string, unknown>;

/** Shared by voice, typing and document upload: asks Claude for structured entries. */
async function extractEntries(
  me: NonNullable<AiContext>,
  content: string | ContentBlock[],
  defaultGeography: string,
  sourceNote: string,
): Promise<StructuredEntry[]> {
  const geoList = me.geographies.map((g) => `${g.key} = ${g.name} (${g.region})`).join("; ");
  const system = [
    "You turn a team member's update into structured reporting entries for an investment firm's biweekly geography report.",
    `Today is ${me.today}. The author is ${me.name}.${me.location ? ` They are currently in ${me.location}.` : ""}`,
    `Geographies (key = name (main city)): ${geoList}.`,
    "Assign each entry to the geography it is ABOUT, using the countries, cities, companies, regulators and people mentioned. " +
      "Where the author happens to be is not the geography: someone in Abu Dhabi talking about a Lagos deal files it under Nigeria. " +
      `Only if nothing in an item points to a geography, use "${defaultGeography}".`,
    "Split distinct items into separate entries. Merge repeats. Keep the facts exactly; drop small talk and boilerplate.",
    sourceNote,
    "Always answer by calling the record_entries tool exactly once. Do not reply with plain text.",
    "The input may be in English, Arabic or French. Always write the entries in English.",
    STYLE,
  ].join("\n");

  const result = await callClaude({
    max_tokens: 6000,
    system,
    tools: [{ name: "record_entries", description: "Record the structured entries.", input_schema: ENTRY_SCHEMA }],
    tool_choice: { type: "auto" },
    messages: [{ role: "user", content }],
  }, me.isOwner);
  const call = result.content.find((c) => c.type === "tool_use");
  let parsed = (call?.input as { entries?: unknown[] } | undefined)?.entries ?? [];
  if (!call) {
    // Fallback: the model answered in text; pull out a JSON object if there is one.
    const text = result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = (JSON.parse(match[0]) as { entries?: unknown[] }).entries ?? [];
      } catch { /* leave empty */ }
    }
  }
  const allowed = new Set(me.geographies.map((g) => g.key));
  const kinds = new Set(["activity", "meeting", "deal", "event", "blocker", "ask", "next"]);
  const hhmm = (t: unknown) => (typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t) ? t : undefined);
  const stages = new Set(["lead", "engaged", "diligence", "terms", "closing", "closed", "lost"]);

  return parsed
    .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
    .map((e): StructuredEntry => ({
      geography: allowed.has(String(e.geography)) ? String(e.geography) : defaultGeography,
      kind: (kinds.has(String(e.kind)) ? e.kind : "activity") as Kind,
      title: String(e.title ?? "").slice(0, 200),
      details: e.details ? String(e.details) : undefined,
      counterparty: e.counterparty ? String(e.counterparty) : undefined,
      dealStage: (stages.has(String(e.dealStage)) ? e.dealStage : undefined) as Stage | undefined,
      dealValue: typeof e.dealValue === "number" ? e.dealValue : undefined,
      date: /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) ? String(e.date) : me.today,
      startTime: hhmm(e.startTime),
      endTime: hhmm(e.startTime) ? hhmm(e.endTime) : undefined,
    }))
    .filter((e) => e.title)
    .slice(0, 30);
}

/** Turns a spoken or typed brain-dump into structured updates for review. */
export const structure = action({
  args: { text: v.string(), defaultGeography: v.string() },
  handler: async (ctx, { text, defaultGeography }): Promise<StructuredEntry[]> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const input = text.trim().slice(0, 40000);
    if (input.length < 8) throw new ConvexError("Say or type a bit more first.");
    return await logged(ctx, "structure", input.length, () =>
      extractEntries(me, input, defaultGeography, "The input is spoken or typed notes."),
    );
  },
});

/** Reads an uploaded report (PDF) and returns structured updates for review. Only the uploader can have it read. */
export const fromDocument = action({
  args: { storageId: v.id("_storage"), defaultGeography: v.string() },
  handler: async (ctx, { storageId, defaultGeography }): Promise<StructuredEntry[]> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const upload: { size: number; contentType?: string } | null = await ctx.runQuery(internal.aiData.ownUpload, { storageId });
    if (!upload) throw new ConvexError("That upload isn't available. Upload the file again.");
    try {
      if (upload.size > 8 * 1024 * 1024) throw new ConvexError("That file is over 8 MB. Export a smaller PDF or split it.");
      if (upload.contentType && upload.contentType !== "application/pdf") throw new ConvexError("Upload a PDF, or a Word file.");
      const blob = await ctx.storage.get(storageId);
      if (!blob) throw new ConvexError("The upload didn't arrive. Try again.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new ConvexError("That file isn't a readable PDF.");
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = btoa(binary);
      return await logged(ctx, "fromDocument", bytes.length, () =>
        extractEntries(
          me,
          [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
            { type: "text", text: "Extract the reporting entries from this report." },
          ],
          defaultGeography,
          "The input is an existing written report, possibly with fixed sections and headings. Map its sections to entry types. Use dates written in the report where given; otherwise use today.",
        ),
      );
    } finally {
      await ctx.storage.delete(storageId);
      await ctx.runMutation(internal.aiData.forgetUpload, { storageId });
    }
  },
});

/** Tidies a spoken or rough reply into a short, clear message, for a manager's feedback on an update. */
export const polish = action({
  args: { text: v.string(), about: v.string() },
  handler: async (ctx, { text, about }): Promise<string> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const input = text.trim().slice(0, 6000);
    if (input.length < 4) throw new ConvexError("Say or type a bit more first.");
    const result = await logged(ctx, "polish", input.length, () => callClaude({
      max_tokens: 800,
      system: [
        `You tidy a spoken reply from ${me.name} into a short written message to a colleague.`,
        `The reply is about this update: "${about.slice(0, 400)}".`,
        "Keep the speaker's meaning, decisions, names and next steps exactly. Remove filler and repetition.",
        "Write it in the first person as the speaker, warm but brief: 1 to 5 sentences, or a few bullets if there are several actions.",
        "The input may be in English, Arabic or French. Reply in English unless the speaker clearly wrote in another language for the colleague.",
        "Return only the message text.",
        STYLE,
      ].join("\n"),
      messages: [{ role: "user", content: input }],
    }, me.isOwner));
    return result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  },
});

type CycleData = {
  name: string;
  geographyName: string;
  range: { start: string; end: string };
  entries: { kind: string; date: string; startTime?: string; endTime?: string; title: string; counterparty?: string; dealStage?: string; dealValue?: number; details?: string }[];
} | null;

/** Drafts the biweekly report text from the person's logged updates. */
export const draftSummary = action({
  args: { geography: v.string(), cycle: v.number() },
  handler: async (ctx, { geography, cycle }): Promise<string> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const data: CycleData = await ctx.runQuery(internal.aiData.cycleEntries, { geography, cycle });
    if (!data) throw new ConvexError("Pick a geography from the list.");
    if (data.entries.length === 0) throw new ConvexError("Log a few updates first, then draft the report.");

    const lines = data.entries
      .map((e) =>
        [
          `- [${e.kind}] ${e.date}${e.startTime ? ` ${e.startTime}${e.endTime ? `-${e.endTime}` : ""}` : ""}: ${e.title}`,
          e.counterparty ? ` (with ${e.counterparty})` : "",
          e.dealStage ? ` stage: ${e.dealStage}` : "",
          e.dealValue !== undefined ? ` value: USD ${e.dealValue}m` : "",
          e.details ? `\n  ${e.details}` : "",
        ].join(""),
      )
      .join("\n");

    const result = await logged(ctx, "draftSummary", lines.length, () => callClaude({
      max_tokens: 1500,
      system: [
        `You write the biweekly report for ${data.geographyName}, covering ${data.range.start} to ${data.range.end}, on behalf of ${data.name}.`,
        "Use these short sections with plain headings, each 1 to 4 bullet points: Highlights, Pipeline, Blockers and asks, Next two weeks.",
        "Skip a section if there is nothing for it. Under 220 words. Only use facts from the entries.",
        STYLE,
      ].join("\n"),
      messages: [{ role: "user", content: `Entries:\n${lines}` }],
    }, me.isOwner));
    return result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  },
});

const LEAD_ITEM = {
  type: "object",
  properties: {
    lead: { type: "string", description: "Bold opening, ending with a full stop." },
    text: { type: "string", description: "One to three sentences." },
  },
  required: ["lead", "text"],
};

const UPDATE_SCHEMA = {
  type: "object",
  properties: {
    keyWins: { type: "array", items: LEAD_ITEM, description: "One to four wins. Lead is the topic, e.g. 'Kazakhstan.'" },
    issues: { type: "array", items: LEAD_ITEM, description: "Blockers and decisions needed. Lead is the topic. Text says what is needed, from whom, and why." },
    workstreams: {
      type: "array",
      items: {
        type: "object",
        properties: {
          heading: { type: "string", description: "Workstream heading, e.g. 'Saudi Arabia: ALG Middle East', 'Advisory: Detalytics', 'MIG partnership', 'Internal'." },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                lead: { type: "string", description: "'<Headline> (<when>).' with <when> copied exactly from the entry." },
                text: { type: "string", description: "One to three sentences, past tense." },
                subpoints: { type: "array", items: { type: "string" }, description: "Optional further facts, one sentence each." },
              },
              required: ["lead", "text"],
            },
          },
        },
        required: ["heading", "items"],
      },
    },
    priorities: { type: "array", items: { type: "string" }, description: "Business priorities for the next two weeks, one sentence each, main focus first." },
    events: { type: "array", items: LEAD_ITEM, description: "Upcoming business events. Lead: '<Event>, <organiser> (<when>, <venue>).'" },
  },
  required: ["keyWins", "issues", "workstreams", "priorities", "events"],
};

type LeadItem = { lead: string; text: string };
export type BusinessUpdate = {
  name: string;
  title: string;
  ending: string;
  quarter: string;
  keyWins: LeadItem[];
  issues: LeadItem[];
  workstreams: { heading: string; items: (LeadItem & { subpoints: string[] })[] }[];
  priorities: string[];
  events: LeadItem[];
  travel: LeadItem[];
  leave: string[];
};

type UpdateData = {
  requesterIsOwner: boolean;
  name: string;
  title: string;
  range: { start: string; end: string };
  ending: string;
  quarter: string;
  entries: { kind: string; upcoming: boolean; geography: string; when: string; title: string; details?: string; counterparty?: string; dealStage?: string; dealValue?: number }[];
  reports: { geography: string; status: string; text: string }[];
  travel: LeadItem[];
  leave: string[];
} | null;

const str = (x: unknown, max = 1200) => (typeof x === "string" ? x.trim().slice(0, max) : "");
const leadItems = (x: unknown, max = 12): LeadItem[] =>
  (Array.isArray(x) ? x : [])
    .map((i) => ({ lead: str((i as LeadItem)?.lead, 300), text: str((i as LeadItem)?.text) }))
    .filter((i) => i.lead || i.text)
    .slice(0, max);

/**
 * Writes the Bi-Weekly Business Update for one person and cycle, in the structure of ALG's Word report.
 * Claude groups the updates into workstreams. Travel and leave come straight from availability plans.
 */
export const businessUpdate = action({
  args: { memberId: v.optional(v.id("members")), cycle: v.number() },
  handler: async (ctx, { memberId, cycle }): Promise<BusinessUpdate> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const data: UpdateData = await ctx.runQuery(internal.aiData.businessUpdateData, { memberId, cycle });
    if (!data) throw new ConvexError("You can only download your own business update.");
    if (data.entries.length === 0 && data.reports.length === 0) {
      throw new ConvexError("Nothing is logged for this period yet. Log a few updates first.");
    }

    const lines = data.entries
      .map((e) =>
        [
          `- [${e.kind}${e.upcoming ? ", upcoming" : ""}] ${e.when} | ${e.geography} | ${e.title}`,
          e.counterparty ? ` | with ${e.counterparty}` : "",
          e.dealStage ? ` | stage: ${e.dealStage}` : "",
          e.dealValue !== undefined ? ` | USD ${e.dealValue}m` : "",
          e.details ? `\n  ${e.details}` : "",
        ].join(""),
      )
      .join("\n");
    const written = data.reports.map((r) => `### ${r.geography} (${r.status})\n${r.text}`).join("\n\n");
    const input = `Logged updates:\n${lines || "(none)"}${written ? `\n\nReport text the author wrote this cycle:\n${written}` : ""}`.slice(0, 60000);

    const system = [
      `You write the Bi-Weekly Business Update of ${data.name}${data.title ? `, ${data.title}` : ""}, at Al Liwan Group, for their manager.`,
      `It covers ${data.range.start} to ${data.ending}. Entries marked upcoming are dated after that.`,
      "Write in the first person singular as the author, and address the manager as 'you'. Past tense for what happened.",
      "Key wins: the most significant progress, one to four items. Issues and blockers: what is stuck or needs a decision, from whom.",
      "Business updates: group every non-upcoming entry under a workstream heading. A heading names the country or relationship and, where useful, the project after a colon, " +
        "for example 'Saudi Arabia: ALG Middle East', 'Advisory: Detalytics', 'Brazil to UAE corridor', 'MIG partnership', 'Internal'. " +
        "Related entries filed under different geographies belong under one heading. Order workstreams by importance, items by date.",
      "Each item lead is '<short headline> (<when>).' with <when> copied exactly as given in the entry. Then one to three sentences of substance. " +
        "Put secondary facts in subpoints. Name people and organisations exactly as given.",
      "Business priorities: what the author will do in the next two weeks, drawn from 'next' entries, open blockers, asks and live deals. Main focus first.",
      "Business events: only 'event' entries. Lead '<event name>, <organiser> (<when>, <venue>).' omitting parts not given; then what the author will do about it.",
      "Do not write about travel or leave; they are added separately. Leave a list empty if nothing fits.",
      "Where the author wrote report text, keep its facts and wording where it is clear.",
      "Always answer by calling the write_update tool exactly once.",
      STYLE,
    ].join("\n");

    const result = await logged(ctx, "businessUpdate", input.length, () => callClaude({
      max_tokens: 8000,
      system,
      tools: [{ name: "write_update", description: "Record the business update.", input_schema: UPDATE_SCHEMA }],
      // This model accepts only "auto"; the system prompt asks for the tool, and a JSON reply is accepted as a fallback.
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: input }],
    }, me.isOwner));
    let out = (result.content.find((c) => c.type === "tool_use")?.input ?? null) as Record<string, unknown> | null;
    if (!out) {
      const text = result.content.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n");
      const match = text.match(/\{[\s\S]*\}/);
      try {
        out = match ? (JSON.parse(match[0]) as Record<string, unknown>) : null;
      } catch {
        out = null;
      }
    }
    if (!out) throw new ConvexError("Claude didn't return the report. Try again.");

    return {
      name: data.name,
      title: data.title,
      ending: data.ending,
      quarter: data.quarter,
      keyWins: leadItems(out.keyWins, 6),
      issues: leadItems(out.issues, 8),
      workstreams: (Array.isArray(out.workstreams) ? out.workstreams : [])
        .map((w) => ({
          heading: str((w as { heading?: unknown })?.heading, 120),
          items: (Array.isArray((w as { items?: unknown })?.items) ? (w as { items: unknown[] }).items : [])
            .map((i) => ({
              ...leadItems([i], 1)[0],
              subpoints: (Array.isArray((i as { subpoints?: unknown })?.subpoints) ? (i as { subpoints: unknown[] }).subpoints : [])
                .map((s) => str(s, 600))
                .filter(Boolean)
                .slice(0, 6),
            }))
            .filter((i) => i.lead !== undefined)
            .slice(0, 30),
        }))
        .filter((w) => w.heading && w.items.length)
        .slice(0, 20),
      priorities: (Array.isArray(out.priorities) ? out.priorities : []).map((p) => str(p, 600)).filter(Boolean).slice(0, 15),
      events: leadItems(out.events, 10),
      travel: data.travel,
      leave: data.leave,
    };
  },
});
