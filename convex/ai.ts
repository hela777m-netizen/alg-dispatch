import { v, ConvexError } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";

const MODEL = () => process.env.ANTHROPIC_MODEL || "claude-sonnet-5-5";

const STYLE = [
  "Write in plain, direct business English.",
  "No em dashes or en dashes. Use commas, colons or full stops instead.",
  "No filler, no hype, no phrases like 'leverage', 'robust', 'delve', 'exciting'.",
  "Never invent facts, names, figures or dates that the speaker did not give.",
].join(" ");

async function callClaude(body: Record<string, unknown>) {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) throw new ConvexError("Voice structuring isn't set up yet. Add ANTHROPIC_API_KEY in Convex.");
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": key,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({ model: MODEL(), ...body }),
  });
  if (!res.ok) {
    const detail = await res.text();
    console.error("Claude API error", res.status, detail.slice(0, 500));
    if (res.status === 401) throw new ConvexError("The Claude API key was rejected. Check ANTHROPIC_API_KEY in Convex.");
    if (res.status === 429) throw new ConvexError("Too many requests right now. Try again in a minute.");
    let reason = "";
    try {
      reason = (JSON.parse(detail) as { error?: { message?: string } }).error?.message ?? "";
    } catch { /* not JSON */ }
    if (/credit balance/i.test(reason)) throw new ConvexError("The Claude account has no credit. Add credit at console.anthropic.com > Billing.");
    if (res.status === 404) throw new ConvexError(`Claude model not found (${MODEL()}). Set ANTHROPIC_MODEL in Convex to a current model.`);
    throw new ConvexError(`Couldn't reach Claude (${res.status}${reason ? `: ${reason.slice(0, 160)}` : ""}).`);
  }
  return (await res.json()) as { content: { type: string; text?: string; input?: unknown }[] };
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
            enum: ["activity", "meeting", "deal", "blocker", "ask", "next"],
            description:
              "activity: work done. meeting: a meeting or call with a counterparty. deal: a transaction or mandate and its stage. blocker: something stuck. ask: something needed from HQ or a colleague. next: planned for the coming two weeks.",
          },
          title: { type: "string", description: "Short headline, under 12 words. For deals, the deal or company name only." },
          details: { type: "string", description: "One to three sentences with the specifics the speaker gave." },
          counterparty: { type: "string", description: "Company or person met or dealt with, if named." },
          dealStage: { type: "string", enum: ["lead", "engaged", "diligence", "terms", "closing", "closed", "lost"] },
          dealValue: { type: "number", description: "Deal size in USD millions, only if stated. Convert other currencies only if the rate is obvious; otherwise omit." },
          date: { type: "string", description: "YYYY-MM-DD. Resolve 'yesterday', 'Tuesday' etc. against today's date. Default to today." },
        },
        required: ["geography", "kind", "title", "date"],
      },
    },
  },
  required: ["entries"],
};

type Kind = "activity" | "meeting" | "deal" | "blocker" | "ask" | "next";
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
};
type AiContext = {
  name: string;
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
  });
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
  const kinds = new Set(["activity", "meeting", "deal", "blocker", "ask", "next"]);
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
    return await extractEntries(me, input, defaultGeography, "The input is spoken or typed notes.");
  },
});

/** Reads an uploaded report (PDF) and returns structured updates for review. */
export const fromDocument = action({
  args: { storageId: v.id("_storage"), defaultGeography: v.string() },
  handler: async (ctx, { storageId, defaultGeography }): Promise<StructuredEntry[]> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const blob = await ctx.storage.get(storageId);
    if (!blob) throw new ConvexError("The upload didn't arrive. Try again.");
    try {
      if (blob.size > 8 * 1024 * 1024) throw new ConvexError("That file is over 8 MB. Export a smaller PDF or split it.");
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      const data = btoa(binary);
      return await extractEntries(
        me,
        [
          { type: "document", source: { type: "base64", media_type: "application/pdf", data } },
          { type: "text", text: "Extract the reporting entries from this report." },
        ],
        defaultGeography,
        "The input is an existing written report, possibly with fixed sections and headings. Map its sections to entry types. Use dates written in the report where given; otherwise use today.",
      );
    } finally {
      await ctx.storage.delete(storageId);
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
    const result = await callClaude({
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
    });
    return result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  },
});

type CycleData = {
  name: string;
  geographyName: string;
  range: { start: string; end: string };
  entries: { kind: string; date: string; title: string; counterparty?: string; dealStage?: string; dealValue?: number; details?: string }[];
} | null;

/** Drafts the biweekly report text from the person's logged updates. */
export const draftSummary = action({
  args: { geography: v.string(), cycle: v.number() },
  handler: async (ctx, { geography, cycle }): Promise<string> => {
    const data: CycleData = await ctx.runQuery(internal.aiData.cycleEntries, { geography, cycle });
    if (!data) throw new ConvexError("You don't report on that geography.");
    if (data.entries.length === 0) throw new ConvexError("Log a few updates first, then draft the report.");

    const lines = data.entries
      .map((e) =>
        [
          `- [${e.kind}] ${e.date}: ${e.title}`,
          e.counterparty ? ` (with ${e.counterparty})` : "",
          e.dealStage ? ` stage: ${e.dealStage}` : "",
          e.dealValue !== undefined ? ` value: USD ${e.dealValue}m` : "",
          e.details ? `\n  ${e.details}` : "",
        ].join(""),
      )
      .join("\n");

    const result = await callClaude({
      max_tokens: 1500,
      system: [
        `You write the biweekly report for ${data.geographyName}, covering ${data.range.start} to ${data.range.end}, on behalf of ${data.name}.`,
        "Use these short sections with plain headings, each 1 to 4 bullet points: Highlights, Pipeline, Blockers and asks, Next two weeks.",
        "Skip a section if there is nothing for it. Under 220 words. Only use facts from the entries.",
        STYLE,
      ].join("\n"),
      messages: [{ role: "user", content: `Entries:\n${lines}` }],
    });
    return result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n").trim();
  },
});
