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
type AiContext = { name: string; today: string; geographies: { key: string; name: string }[] } | null;

/** Turns a spoken or typed brain-dump into structured updates for review. */
export const structure = action({
  args: { text: v.string(), defaultGeography: v.string() },
  handler: async (ctx, { text, defaultGeography }): Promise<StructuredEntry[]> => {
    const me: AiContext = await ctx.runQuery(internal.aiData.context, {});
    if (!me) throw new ConvexError("You don't have access to this dashboard yet.");
    const input = text.trim().slice(0, 8000);
    if (input.length < 8) throw new ConvexError("Say or type a bit more first.");

    const geoList = me.geographies.map((g) => `${g.key} (${g.name})`).join(", ");
    const system = [
      "You turn a team member's spoken or typed update into structured reporting entries for an investment firm's biweekly geography report.",
      `Today is ${me.today}. The speaker is ${me.name}.`,
      `Allowed geography keys: ${geoList}. If the speaker doesn't name a geography, use "${defaultGeography}".`,
      "Split distinct items into separate entries. Merge repeats. Keep the speaker's facts exactly; drop small talk.",
      "The input may be in English, Arabic or French. Always write the entries in English.",
      STYLE,
    ].join("\n");

    const result = await callClaude({
      max_tokens: 4000,
      system,
      tools: [{ name: "record_entries", description: "Record the structured entries.", input_schema: ENTRY_SCHEMA }],
      tool_choice: { type: "tool", name: "record_entries" },
      messages: [{ role: "user", content: input }],
    });
    const call = result.content.find((c) => c.type === "tool_use");
    const parsed = (call?.input as { entries?: unknown[] } | undefined)?.entries ?? [];
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
      .filter((e) => e.title);
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
