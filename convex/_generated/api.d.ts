/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as adminBookings from "../adminBookings.js";
import type * as adminChat from "../adminChat.js";
import type * as adminProperties from "../adminProperties.js";
import type * as adminReply from "../adminReply.js";
import type * as adminReviews from "../adminReviews.js";
import type * as adminServices from "../adminServices.js";
import type * as aiEval from "../aiEval.js";
import type * as availability from "../availability.js";
import type * as bookings from "../bookings.js";
import type * as businessFacts from "../businessFacts.js";
import type * as chat from "../chat.js";
import type * as chatAi from "../chatAi.js";
import type * as chatEval from "../chatEval.js";
import type * as chatKnowledge from "../chatKnowledge.js";
import type * as chatSuggestions from "../chatSuggestions.js";
import type * as configurationHistory from "../configurationHistory.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as displays from "../displays.js";
import type * as emails from "../emails.js";
import type * as facebook from "../facebook.js";
import type * as http from "../http.js";
import type * as ical from "../ical.js";
import type * as inboxLifecycle from "../inboxLifecycle.js";
import type * as instagram from "../instagram.js";
import type * as leads from "../leads.js";
import type * as marketing from "../marketing.js";
import type * as marketingReport from "../marketingReport.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_adminChatMetadata from "../lib/adminChatMetadata.js";
import type * as lib_adminPhotos from "../lib/adminPhotos.js";
import type * as lib_appointmentChanges from "../lib/appointmentChanges.js";
import type * as lib_appointmentFinance from "../lib/appointmentFinance.js";
import type * as lib_appointmentWindow from "../lib/appointmentWindow.js";
import type * as lib_availabilityWrites from "../lib/availabilityWrites.js";
import type * as lib_billMath from "../lib/billMath.js";
import type * as lib_bookingMoney from "../lib/bookingMoney.js";
import type * as lib_bookingPhone from "../lib/bookingPhone.js";
import type * as lib_bookingWrites from "../lib/bookingWrites.js";
import type * as lib_channelReplyWindow from "../lib/channelReplyWindow.js";
import type * as lib_chatFallback from "../lib/chatFallback.js";
import type * as lib_chatLlm from "../lib/chatLlm.js";
import type * as lib_chatPresence from "../lib/chatPresence.js";
import type * as lib_chatReuse from "../lib/chatReuse.js";
import type * as lib_chatSuggestions from "../lib/chatSuggestions.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_chatWriteGuard from "../lib/chatWriteGuard.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_conciergePolicy from "../lib/conciergePolicy.js";
import type * as lib_conciergeReplyOutcome from "../lib/conciergeReplyOutcome.js";
import type * as lib_conciergeTurn from "../lib/conciergeTurn.js";
import type * as lib_configurationHistory from "../lib/configurationHistory.js";
import type * as lib_couponRedemptions from "../lib/couponRedemptions.js";
import type * as lib_curatedVariants from "../lib/curatedVariants.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_displayTokens from "../lib/displayTokens.js";
import type * as lib_displayView from "../lib/displayView.js";
import type * as lib_factRetrieval from "../lib/factRetrieval.js";
import type * as lib_financeValidators from "../lib/financeValidators.js";
import type * as lib_ical from "../lib/ical.js";
import type * as lib_imageUploads from "../lib/imageUploads.js";
import type * as lib_imageUrls from "../lib/imageUrls.js";
import type * as lib_inboxBackfill from "../lib/inboxBackfill.js";
import type * as lib_inboxLifecycle from "../lib/inboxLifecycle.js";
import type * as lib_inboxTypes from "../lib/inboxTypes.js";
import type * as lib_knowledgeGrouping from "../lib/knowledgeGrouping.js";
import type * as lib_legacyQa from "../lib/legacyQa.js";
import type * as lib_lineLinks from "../lib/lineLinks.js";
import type * as lib_marketingSlugs from "../lib/marketingSlugs.js";
import type * as lib_marketingReport from "../lib/marketingReport.js";
import type * as lib_offers from "../lib/offers.js";
import type * as lib_orderBackfill from "../lib/orderBackfill.js";
import type * as lib_orderLifecycle from "../lib/orderLifecycle.js";
import type * as lib_orderLines from "../lib/orderLines.js";
import type * as lib_orderLinks from "../lib/orderLinks.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_readBudget from "../lib/readBudget.js";
import type * as lib_recordHistory from "../lib/recordHistory.js";
import type * as lib_replyCards from "../lib/replyCards.js";
import type * as lib_rosterHistory from "../lib/rosterHistory.js";
import type * as lib_serverSecret from "../lib/serverSecret.js";
import type * as lib_serviceCatalog from "../lib/serviceCatalog.js";
import type * as lib_serviceSchedule from "../lib/serviceSchedule.js";
import type * as lib_serviceSlots from "../lib/serviceSlots.js";
import type * as lib_siteSettings from "../lib/siteSettings.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_socialProof from "../lib/socialProof.js";
import type * as lib_stayCorrections from "../lib/stayCorrections.js";
import type * as lib_stayOverlap from "../lib/stayOverlap.js";
import type * as lib_turnMetrics from "../lib/turnMetrics.js";
import type * as lib_unknownReply from "../lib/unknownReply.js";
import type * as lib_validation from "../lib/validation.js";
import type * as line from "../line.js";
import type * as migrations from "../migrations.js";
import type * as orderHistoryPages from "../orderHistoryPages.js";
import type * as payments from "../payments.js";
import type * as pos from "../pos.js";
import type * as properties from "../properties.js";
import type * as publicProperties from "../publicProperties.js";
import type * as publicServices from "../publicServices.js";
import type * as recordHistory from "../recordHistory.js";
import type * as roster from "../roster.js";
import type * as seed from "../seed.js";
import type * as seeds_aiEvalData from "../seeds/aiEvalData.js";
import type * as seeds_curatedQuestions from "../seeds/curatedQuestions.js";
import type * as seeds_properties from "../seeds/properties.js";
import type * as seeds_recentBookings from "../seeds/recentBookings.js";
import type * as seeds_reviews from "../seeds/reviews.js";
import type * as seeds_rooms from "../seeds/rooms.js";
import type * as seeds_socialProof from "../seeds/socialProof.js";
import type * as seeds_staffServices from "../seeds/staffServices.js";
import type * as seeds_tourSnippets from "../seeds/tourSnippets.js";
import type * as serviceBookings from "../serviceBookings.js";
import type * as settings from "../settings.js";
import type * as users from "../users.js";
import type * as whatsapp from "../whatsapp.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminBookings: typeof adminBookings;
  adminChat: typeof adminChat;
  adminProperties: typeof adminProperties;
  adminReply: typeof adminReply;
  adminReviews: typeof adminReviews;
  adminServices: typeof adminServices;
  aiEval: typeof aiEval;
  availability: typeof availability;
  bookings: typeof bookings;
  businessFacts: typeof businessFacts;
  chat: typeof chat;
  chatAi: typeof chatAi;
  chatEval: typeof chatEval;
  chatKnowledge: typeof chatKnowledge;
  chatSuggestions: typeof chatSuggestions;
  configurationHistory: typeof configurationHistory;
  crons: typeof crons;
  customers: typeof customers;
  displays: typeof displays;
  emails: typeof emails;
  facebook: typeof facebook;
  http: typeof http;
  ical: typeof ical;
  inboxLifecycle: typeof inboxLifecycle;
  instagram: typeof instagram;
  leads: typeof leads;
  marketing: typeof marketing;
  marketingReport: typeof marketingReport;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/adminChatMetadata": typeof lib_adminChatMetadata;
  "lib/adminPhotos": typeof lib_adminPhotos;
  "lib/appointmentChanges": typeof lib_appointmentChanges;
  "lib/appointmentFinance": typeof lib_appointmentFinance;
  "lib/appointmentWindow": typeof lib_appointmentWindow;
  "lib/availabilityWrites": typeof lib_availabilityWrites;
  "lib/billMath": typeof lib_billMath;
  "lib/bookingMoney": typeof lib_bookingMoney;
  "lib/bookingPhone": typeof lib_bookingPhone;
  "lib/bookingWrites": typeof lib_bookingWrites;
  "lib/channelReplyWindow": typeof lib_channelReplyWindow;
  "lib/chatFallback": typeof lib_chatFallback;
  "lib/chatLlm": typeof lib_chatLlm;
  "lib/chatPresence": typeof lib_chatPresence;
  "lib/chatReuse": typeof lib_chatReuse;
  "lib/chatSuggestions": typeof lib_chatSuggestions;
  "lib/chatTools": typeof lib_chatTools;
  "lib/chatWriteGuard": typeof lib_chatWriteGuard;
  "lib/codes": typeof lib_codes;
  "lib/conciergePolicy": typeof lib_conciergePolicy;
  "lib/conciergeReplyOutcome": typeof lib_conciergeReplyOutcome;
  "lib/conciergeTurn": typeof lib_conciergeTurn;
  "lib/configurationHistory": typeof lib_configurationHistory;
  "lib/couponRedemptions": typeof lib_couponRedemptions;
  "lib/curatedVariants": typeof lib_curatedVariants;
  "lib/dates": typeof lib_dates;
  "lib/displayTokens": typeof lib_displayTokens;
  "lib/displayView": typeof lib_displayView;
  "lib/factRetrieval": typeof lib_factRetrieval;
  "lib/financeValidators": typeof lib_financeValidators;
  "lib/ical": typeof lib_ical;
  "lib/imageUploads": typeof lib_imageUploads;
  "lib/imageUrls": typeof lib_imageUrls;
  "lib/inboxBackfill": typeof lib_inboxBackfill;
  "lib/inboxLifecycle": typeof lib_inboxLifecycle;
  "lib/inboxTypes": typeof lib_inboxTypes;
  "lib/knowledgeGrouping": typeof lib_knowledgeGrouping;
  "lib/legacyQa": typeof lib_legacyQa;
  "lib/lineLinks": typeof lib_lineLinks;
  "lib/marketingSlugs": typeof lib_marketingSlugs;
  "lib/marketingReport": typeof lib_marketingReport;
  "lib/offers": typeof lib_offers;
  "lib/orderBackfill": typeof lib_orderBackfill;
  "lib/orderLifecycle": typeof lib_orderLifecycle;
  "lib/orderLines": typeof lib_orderLines;
  "lib/orderLinks": typeof lib_orderLinks;
  "lib/pricing": typeof lib_pricing;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/readBudget": typeof lib_readBudget;
  "lib/recordHistory": typeof lib_recordHistory;
  "lib/replyCards": typeof lib_replyCards;
  "lib/rosterHistory": typeof lib_rosterHistory;
  "lib/serverSecret": typeof lib_serverSecret;
  "lib/serviceCatalog": typeof lib_serviceCatalog;
  "lib/serviceSchedule": typeof lib_serviceSchedule;
  "lib/serviceSlots": typeof lib_serviceSlots;
  "lib/siteSettings": typeof lib_siteSettings;
  "lib/slug": typeof lib_slug;
  "lib/socialProof": typeof lib_socialProof;
  "lib/stayCorrections": typeof lib_stayCorrections;
  "lib/stayOverlap": typeof lib_stayOverlap;
  "lib/turnMetrics": typeof lib_turnMetrics;
  "lib/unknownReply": typeof lib_unknownReply;
  "lib/validation": typeof lib_validation;
  line: typeof line;
  migrations: typeof migrations;
  orderHistoryPages: typeof orderHistoryPages;
  payments: typeof payments;
  pos: typeof pos;
  properties: typeof properties;
  publicProperties: typeof publicProperties;
  publicServices: typeof publicServices;
  recordHistory: typeof recordHistory;
  roster: typeof roster;
  seed: typeof seed;
  "seeds/aiEvalData": typeof seeds_aiEvalData;
  "seeds/curatedQuestions": typeof seeds_curatedQuestions;
  "seeds/properties": typeof seeds_properties;
  "seeds/recentBookings": typeof seeds_recentBookings;
  "seeds/reviews": typeof seeds_reviews;
  "seeds/rooms": typeof seeds_rooms;
  "seeds/socialProof": typeof seeds_socialProof;
  "seeds/staffServices": typeof seeds_staffServices;
  "seeds/tourSnippets": typeof seeds_tourSnippets;
  serviceBookings: typeof serviceBookings;
  settings: typeof settings;
  users: typeof users;
  whatsapp: typeof whatsapp;
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
  migrations: {
    lib: {
      cancel: FunctionReference<
        "mutation",
        "internal",
        { name: string },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
      cancelAll: FunctionReference<
        "mutation",
        "internal",
        { sinceTs?: number },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getStatus: FunctionReference<
        "query",
        "internal",
        { limit?: number; names?: Array<string> },
        Array<{
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }>
      >;
      migrate: FunctionReference<
        "mutation",
        "internal",
        {
          batchSize?: number;
          cursor?: string | null;
          dryRun: boolean;
          fnHandle: string;
          name: string;
          next?: Array<{ fnHandle: string; name: string }>;
          oneBatchOnly?: boolean;
          reset?: boolean;
        },
        {
          batchSize?: number;
          cursor?: string | null;
          error?: string;
          isDone: boolean;
          latestEnd?: number;
          latestStart: number;
          name: string;
          next?: Array<string>;
          processed: number;
          state: "inProgress" | "success" | "failed" | "canceled" | "unknown";
        }
      >;
    };
  };
};
