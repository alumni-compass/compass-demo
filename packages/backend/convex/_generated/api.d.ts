/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as access from "../access.js";
import type * as adminOps from "../adminOps.js";
import type * as agent from "../agent.js";
import type * as auth from "../auth.js";
import type * as authz from "../authz.js";
import type * as careers from "../careers.js";
import type * as chat from "../chat.js";
import type * as directory from "../directory.js";
import type * as directorySearch from "../directorySearch.js";
import type * as eventAdmin from "../eventAdmin.js";
import type * as events from "../events.js";
import type * as giving from "../giving.js";
import type * as givingReports from "../givingReports.js";
import type * as healthCheck from "../healthCheck.js";
import type * as http from "../http.js";
import type * as mentoring from "../mentoring.js";
import type * as privateData from "../privateData.js";
import type * as profiles from "../profiles.js";
import type * as race from "../race.js";
import type * as raceProfiles from "../raceProfiles.js";
import type * as referrals from "../referrals.js";
import type * as seed from "../seed.js";
import type * as stories from "../stories.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  access: typeof access;
  adminOps: typeof adminOps;
  agent: typeof agent;
  auth: typeof auth;
  authz: typeof authz;
  careers: typeof careers;
  chat: typeof chat;
  directory: typeof directory;
  directorySearch: typeof directorySearch;
  eventAdmin: typeof eventAdmin;
  events: typeof events;
  giving: typeof giving;
  givingReports: typeof givingReports;
  healthCheck: typeof healthCheck;
  http: typeof http;
  mentoring: typeof mentoring;
  privateData: typeof privateData;
  profiles: typeof profiles;
  race: typeof race;
  raceProfiles: typeof raceProfiles;
  referrals: typeof referrals;
  seed: typeof seed;
  stories: typeof stories;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  betterAuth: import("@convex-dev/better-auth/_generated/component.js").ComponentApi<"betterAuth">;
  agent: import("@convex-dev/agent/_generated/component.js").ComponentApi<"agent">;
};
