/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminChat from "../adminChat.js";
import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as chat from "../chat.js";
import type * as chatAi from "../chatAi.js";
import type * as chatSuggestions from "../chatSuggestions.js";
import type * as emails from "../emails.js";
import type * as leads from "../leads.js";
import type * as line from "../line.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_availabilityWrites from "../lib/availabilityWrites.js";
import type * as lib_chatFallback from "../lib/chatFallback.js";
import type * as lib_chatLlm from "../lib/chatLlm.js";
import type * as lib_chatPresence from "../lib/chatPresence.js";
import type * as lib_chatReuse from "../lib/chatReuse.js";
import type * as lib_chatSuggestions from "../lib/chatSuggestions.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_validation from "../lib/validation.js";
import type * as migrations from "../migrations.js";
import type * as properties from "../properties.js";
import type * as seed from "../seed.js";
import type * as seeds_pricing from "../seeds/pricing.js";
import type * as seeds_properties from "../seeds/properties.js";
import type * as seeds_recentBookings from "../seeds/recentBookings.js";
import type * as seeds_reviews from "../seeds/reviews.js";
import type * as seeds_rooms from "../seeds/rooms.js";
import type * as seeds_socialProof from "../seeds/socialProof.js";
import type * as seeds_tourSnippets from "../seeds/tourSnippets.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminChat: typeof adminChat;
  availability: typeof availability;
  bookings: typeof bookings;
  chat: typeof chat;
  chatAi: typeof chatAi;
  chatSuggestions: typeof chatSuggestions;
  emails: typeof emails;
  leads: typeof leads;
  line: typeof line;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/availabilityWrites": typeof lib_availabilityWrites;
  "lib/chatFallback": typeof lib_chatFallback;
  "lib/chatLlm": typeof lib_chatLlm;
  "lib/chatPresence": typeof lib_chatPresence;
  "lib/chatReuse": typeof lib_chatReuse;
  "lib/chatSuggestions": typeof lib_chatSuggestions;
  "lib/chatTools": typeof lib_chatTools;
  "lib/codes": typeof lib_codes;
  "lib/dates": typeof lib_dates;
  "lib/pricing": typeof lib_pricing;
  "lib/validation": typeof lib_validation;
  migrations: typeof migrations;
  properties: typeof properties;
  seed: typeof seed;
  "seeds/pricing": typeof seeds_pricing;
  "seeds/properties": typeof seeds_properties;
  "seeds/recentBookings": typeof seeds_recentBookings;
  "seeds/reviews": typeof seeds_reviews;
  "seeds/rooms": typeof seeds_rooms;
  "seeds/socialProof": typeof seeds_socialProof;
  "seeds/tourSnippets": typeof seeds_tourSnippets;
  users: typeof users;
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

export declare const components: {};
