import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const roleValidator = v.union(
  v.literal("owner"),
  v.literal("manager"),
  v.literal("reporter"),
);

export const kindValidator = v.union(
  v.literal("activity"),
  v.literal("meeting"),
  v.literal("deal"),
  v.literal("blocker"),
  v.literal("ask"),
  v.literal("next"),
);

export const stageValidator = v.union(
  v.literal("lead"),
  v.literal("engaged"),
  v.literal("diligence"),
  v.literal("terms"),
  v.literal("closing"),
  v.literal("closed"),
  v.literal("lost"),
);

export const reportStatusValidator = v.union(
  v.literal("draft"),
  v.literal("submitted"),
  v.literal("reviewed"),
  v.literal("needs_info"),
);

export default defineSchema({
  // Who can sign in, and what they can do. Matched to a login by email.
  members: defineTable({
    name: v.string(),
    email: v.optional(v.string()), // lowercase; empty until the owner fills it in
    title: v.optional(v.string()),
    role: roleValidator,
    // Geographies this person is expected to report on every cycle.
    geographies: v.array(v.string()),
    // Geographies they may log against occasionally, without being chased for a report.
    extraGeographies: v.array(v.string()),
    userId: v.optional(v.string()), // login id, set on first sign-in
    active: v.boolean(),
  })
    .index("by_email", ["email"])
    .index("by_userId", ["userId"]),

  geographies: defineTable({
    key: v.string(),
    name: v.string(),
    region: v.string(),
    timezone: v.string(),
    lat: v.optional(v.number()),
    lng: v.optional(v.number()),
    order: v.number(),
    active: v.boolean(),
  }).index("by_key", ["key"]),

  // Individual updates, logged any time.
  entries: defineTable({
    authorId: v.id("members"),
    geography: v.string(),
    kind: kindValidator,
    title: v.string(),
    details: v.optional(v.string()),
    counterparty: v.optional(v.string()),
    dealStage: v.optional(stageValidator),
    dealValue: v.optional(v.number()), // USD millions
    date: v.string(), // YYYY-MM-DD
    cycle: v.number(),
    source: v.union(v.literal("typed"), v.literal("voice")),
    editedBy: v.optional(v.id("members")),
    updatedAt: v.number(),
  })
    .index("by_cycle", ["cycle"])
    .index("by_author_cycle", ["authorId", "cycle"])
    .index("by_geo_cycle", ["geography", "cycle"]),

  // One biweekly report per person, per geography, per cycle.
  reports: defineTable({
    authorId: v.id("members"),
    geography: v.string(),
    cycle: v.number(),
    summary: v.string(),
    status: reportStatusValidator,
    submittedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("members")),
    reviewedAt: v.optional(v.number()),
    updatedAt: v.number(),
  })
    .index("by_cycle", ["cycle"])
    .index("by_author_cycle_geo", ["authorId", "cycle", "geography"])
    .index("by_status", ["status"]),

  comments: defineTable({
    reportId: v.id("reports"),
    authorId: v.id("members"),
    body: v.string(),
    createdAt: v.number(),
  }).index("by_report", ["reportId"]),

  settings: defineTable({
    key: v.string(),
    value: v.string(),
  }).index("by_key", ["key"]),
});
