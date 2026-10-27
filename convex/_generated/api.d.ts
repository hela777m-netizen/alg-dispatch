/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as ai from "../ai.js";
import type * as aiData from "../aiData.js";
import type * as availability from "../availability.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as entries from "../entries.js";
import type * as files from "../files.js";
import type * as lib_access from "../lib/access.js";
import type * as lib_audit from "../lib/audit.js";
import type * as lib_countries from "../lib/countries.js";
import type * as lib_cycles from "../lib/cycles.js";
import type * as lib_notify from "../lib/notify.js";
import type * as lib_presence from "../lib/presence.js";
import type * as members from "../members.js";
import type * as notifications from "../notifications.js";
import type * as reports from "../reports.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  ai: typeof ai;
  aiData: typeof aiData;
  availability: typeof availability;
  crons: typeof crons;
  dashboard: typeof dashboard;
  entries: typeof entries;
  files: typeof files;
  "lib/access": typeof lib_access;
  "lib/audit": typeof lib_audit;
  "lib/countries": typeof lib_countries;
  "lib/cycles": typeof lib_cycles;
  "lib/notify": typeof lib_notify;
  "lib/presence": typeof lib_presence;
  members: typeof members;
  notifications: typeof notifications;
  reports: typeof reports;
}>;
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
