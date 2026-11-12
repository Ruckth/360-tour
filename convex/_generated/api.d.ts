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
import type * as adminReply from "../adminReply.js";
import type * as aiEval from "../aiEval.js";
import type * as auth_model from "../auth/model.js";
import type * as auth_tables from "../auth/tables.js";
import type * as bookings_admin from "../bookings/admin.js";
import type * as bookings_bookings from "../bookings/bookings.js";
import type * as bookings_calendar_addDateBlock from "../bookings/calendar/addDateBlock.js";
import type * as bookings_calendar_addDateBlocks from "../bookings/calendar/addDateBlocks.js";
import type * as bookings_calendar_availability from "../bookings/calendar/availability.js";
import type * as bookings_calendar_ical from "../bookings/calendar/ical.js";
import type * as bookings_calendar_removeDateBlock from "../bookings/calendar/removeDateBlock.js";
import type * as bookings_calendar_updateDateBlock from "../bookings/calendar/updateDateBlock.js";
import type * as bookings_commands_amendPayment from "../bookings/commands/amendPayment.js";
import type * as bookings_commands_cancelPayment from "../bookings/commands/cancelPayment.js";
import type * as bookings_commands_cancelStay from "../bookings/commands/cancelStay.js";
import type * as bookings_commands_createBooking from "../bookings/commands/createBooking.js";
import type * as bookings_commands_deleteBooking from "../bookings/commands/deleteBooking.js";
import type * as bookings_commands_deleteBookings from "../bookings/commands/deleteBookings.js";
import type * as bookings_commands_editBooking from "../bookings/commands/editBooking.js";
import type * as bookings_commands_recordPayment from "../bookings/commands/recordPayment.js";
import type * as bookings_commands_recordRefund from "../bookings/commands/recordRefund.js";
import type * as bookings_commands_reopenBooking from "../bookings/commands/reopenBooking.js";
import type * as bookings_commands_resendBookingEmails from "../bookings/commands/resendBookingEmails.js";
import type * as bookings_commands_updateBooking from "../bookings/commands/updateBooking.js";
import type * as bookings_commands_updateNotes from "../bookings/commands/updateNotes.js";
import type * as bookings_model from "../bookings/model.js";
import type * as bookings_payments_stripe from "../bookings/payments/stripe.js";
import type * as bookings_tables from "../bookings/tables.js";
import type * as businessFacts from "../businessFacts.js";
import type * as catalog_adminProperties from "../catalog/adminProperties.js";
import type * as catalog_adminReviews from "../catalog/adminReviews.js";
import type * as catalog_model from "../catalog/model.js";
import type * as catalog_properties from "../catalog/properties.js";
import type * as catalog_publicProperties from "../catalog/publicProperties.js";
import type * as catalog_tables from "../catalog/tables.js";
import type * as chat from "../chat.js";
import type * as chatAi from "../chatAi.js";
import type * as chatEval from "../chatEval.js";
import type * as chatKnowledge from "../chatKnowledge.js";
import type * as chatSuggestions from "../chatSuggestions.js";
import type * as concierge_context from "../concierge/context.js";
import type * as concierge_copy from "../concierge/copy.js";
import type * as concierge_model from "../concierge/model.js";
import type * as concierge_prompt from "../concierge/prompt.js";
import type * as concierge_runTurn from "../concierge/runTurn.js";
import type * as concierge_tables from "../concierge/tables.js";
import type * as configurationHistory from "../configurationHistory.js";
import type * as crons from "../crons.js";
import type * as customers from "../customers.js";
import type * as displays from "../displays.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as inboxLifecycle from "../inboxLifecycle.js";
import type * as leads from "../leads.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_adminChatMetadata from "../lib/adminChatMetadata.js";
import type * as lib_adminPhotos from "../lib/adminPhotos.js";
import type * as lib_affiliateCredits from "../lib/affiliateCredits.js";
import type * as lib_affiliateTypes from "../lib/affiliateTypes.js";
import type * as lib_appointmentChanges from "../lib/appointmentChanges.js";
import type * as lib_appointmentFinance from "../lib/appointmentFinance.js";
import type * as lib_appointmentWindow from "../lib/appointmentWindow.js";
import type * as lib_availabilityWrites from "../lib/availabilityWrites.js";
import type * as lib_bookingMoney from "../lib/bookingMoney.js";
import type * as lib_bookingPhone from "../lib/bookingPhone.js";
import type * as lib_bookingWrites from "../lib/bookingWrites.js";
import type * as lib_channelReplyWindow from "../lib/channelReplyWindow.js";
import type * as lib_chatAdmission from "../lib/chatAdmission.js";
import type * as lib_chatCoupon from "../lib/chatCoupon.js";
import type * as lib_chatCouponCopy from "../lib/chatCouponCopy.js";
import type * as lib_chatLlm from "../lib/chatLlm.js";
import type * as lib_chatPresence from "../lib/chatPresence.js";
import type * as lib_chatReuse from "../lib/chatReuse.js";
import type * as lib_chatSuggestions from "../lib/chatSuggestions.js";
import type * as lib_chatToolPresentation from "../lib/chatToolPresentation.js";
import type * as lib_chatTools from "../lib/chatTools.js";
import type * as lib_chatWriteGuard from "../lib/chatWriteGuard.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_conciergePolicy from "../lib/conciergePolicy.js";
import type * as lib_conciergeReplyOutcome from "../lib/conciergeReplyOutcome.js";
import type * as lib_conciergeTurn from "../lib/conciergeTurn.js";
import type * as lib_configurationHistory from "../lib/configurationHistory.js";
import type * as lib_couponRedemptions from "../lib/couponRedemptions.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_displayLease from "../lib/displayLease.js";
import type * as lib_displayTokens from "../lib/displayTokens.js";
import type * as lib_displayView from "../lib/displayView.js";
import type * as lib_financeValidators from "../lib/financeValidators.js";
import type * as lib_guestCouponCode from "../lib/guestCouponCode.js";
import type * as lib_guestToken from "../lib/guestToken.js";
import type * as lib_ical from "../lib/ical.js";
import type * as lib_imageUploads from "../lib/imageUploads.js";
import type * as lib_inboxLifecycle from "../lib/inboxLifecycle.js";
import type * as lib_inboxTypes from "../lib/inboxTypes.js";
import type * as lib_knowledgeGrouping from "../lib/knowledgeGrouping.js";
import type * as lib_lineLinks from "../lib/lineLinks.js";
import type * as lib_marketingAccess from "../lib/marketingAccess.js";
import type * as lib_marketingAttribution from "../lib/marketingAttribution.js";
import type * as lib_marketingPolicy from "../lib/marketingPolicy.js";
import type * as lib_marketingPrivacy from "../lib/marketingPrivacy.js";
import type * as lib_marketingReport from "../lib/marketingReport.js";
import type * as lib_marketingReportRead from "../lib/marketingReportRead.js";
import type * as lib_marketingSlugs from "../lib/marketingSlugs.js";
import type * as lib_offers from "../lib/offers.js";
import type * as lib_orderLifecycle from "../lib/orderLifecycle.js";
import type * as lib_orderLines from "../lib/orderLines.js";
import type * as lib_orderLinks from "../lib/orderLinks.js";
import type * as lib_orderMath from "../lib/orderMath.js";
import type * as lib_orderRefunds from "../lib/orderRefunds.js";
import type * as lib_posCoupons from "../lib/posCoupons.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_rateLimit from "../lib/rateLimit.js";
import type * as lib_readBudget from "../lib/readBudget.js";
import type * as lib_recordHistory from "../lib/recordHistory.js";
import type * as lib_replyCards from "../lib/replyCards.js";
import type * as lib_rosterHistory from "../lib/rosterHistory.js";
import type * as lib_serviceCatalog from "../lib/serviceCatalog.js";
import type * as lib_serviceSchedule from "../lib/serviceSchedule.js";
import type * as lib_serviceSlots from "../lib/serviceSlots.js";
import type * as lib_siteSettings from "../lib/siteSettings.js";
import type * as lib_slug from "../lib/slug.js";
import type * as lib_staffAccess from "../lib/staffAccess.js";
import type * as lib_staffApprovalState from "../lib/staffApprovalState.js";
import type * as lib_staffTypes from "../lib/staffTypes.js";
import type * as lib_stayCorrections from "../lib/stayCorrections.js";
import type * as lib_stayOverlap from "../lib/stayOverlap.js";
import type * as lib_turnMetrics from "../lib/turnMetrics.js";
import type * as lib_unknownReply from "../lib/unknownReply.js";
import type * as lib_validation from "../lib/validation.js";
import type * as maintenance_scenarios from "../maintenance/scenarios.js";
import type * as marketing from "../marketing.js";
import type * as marketing_tables from "../marketing/tables.js";
import type * as marketingAccess from "../marketingAccess.js";
import type * as marketingAffiliates from "../marketingAffiliates.js";
import type * as marketingReport from "../marketingReport.js";
import type * as messaging_channels_adapter from "../messaging/channels/adapter.js";
import type * as messaging_channels_images from "../messaging/channels/images.js";
import type * as messaging_channels_index from "../messaging/channels/index.js";
import type * as messaging_channels_line from "../messaging/channels/line.js";
import type * as messaging_channels_meta from "../messaging/channels/meta.js";
import type * as messaging_channels_profile from "../messaging/channels/profile.js";
import type * as messaging_channels_richMessages from "../messaging/channels/richMessages.js";
import type * as messaging_channels_whatsapp from "../messaging/channels/whatsapp.js";
import type * as messaging_claims from "../messaging/claims.js";
import type * as messaging_ingress from "../messaging/ingress.js";
import type * as messaging_model from "../messaging/model.js";
import type * as messaging_tables from "../messaging/tables.js";
import type * as messaging_worker from "../messaging/worker.js";
import type * as orderHistoryPages from "../orderHistoryPages.js";
import type * as pos from "../pos.js";
import type * as pos_tables from "../pos/tables.js";
import type * as recordHistory from "../recordHistory.js";
import type * as seed from "../seed.js";
import type * as seeds_aiEvalData from "../seeds/aiEvalData.js";
import type * as seeds_properties from "../seeds/properties.js";
import type * as seeds_reviews from "../seeds/reviews.js";
import type * as seeds_rooms from "../seeds/rooms.js";
import type * as seeds_staffServices from "../seeds/staffServices.js";
import type * as seeds_tourSnippets from "../seeds/tourSnippets.js";
import type * as services_admin from "../services/admin.js";
import type * as services_commands_addTimeOff from "../services/commands/addTimeOff.js";
import type * as services_commands_archiveService from "../services/commands/archiveService.js";
import type * as services_commands_archiveStaff from "../services/commands/archiveStaff.js";
import type * as services_commands_cancelAppointment from "../services/commands/cancelAppointment.js";
import type * as services_commands_correctAppointmentPaymentEntry from "../services/commands/correctAppointmentPaymentEntry.js";
import type * as services_commands_correctAppointmentStatus from "../services/commands/correctAppointmentStatus.js";
import type * as services_commands_createAppointment from "../services/commands/createAppointment.js";
import type * as services_commands_createService from "../services/commands/createService.js";
import type * as services_commands_createStaff from "../services/commands/createStaff.js";
import type * as services_commands_discardStaffAvatarUpload from "../services/commands/discardStaffAvatarUpload.js";
import type * as services_commands_markAppointmentPaid from "../services/commands/markAppointmentPaid.js";
import type * as services_commands_refundAppointment from "../services/commands/refundAppointment.js";
import type * as services_commands_registerStaffAvatarUpload from "../services/commands/registerStaffAvatarUpload.js";
import type * as services_commands_removeTimeOff from "../services/commands/removeTimeOff.js";
import type * as services_commands_rescheduleAppointment from "../services/commands/rescheduleAppointment.js";
import type * as services_commands_setServiceStaffMatrix from "../services/commands/setServiceStaffMatrix.js";
import type * as services_commands_updateAppointmentDetails from "../services/commands/updateAppointmentDetails.js";
import type * as services_commands_updateAppointmentStatus from "../services/commands/updateAppointmentStatus.js";
import type * as services_commands_updateAppointmentTurnaround from "../services/commands/updateAppointmentTurnaround.js";
import type * as services_commands_updateService from "../services/commands/updateService.js";
import type * as services_commands_updateStaff from "../services/commands/updateStaff.js";
import type * as services_commands_updateTimeOff from "../services/commands/updateTimeOff.js";
import type * as services_commands_uploadStaffAvatar from "../services/commands/uploadStaffAvatar.js";
import type * as services_maintenance from "../services/maintenance.js";
import type * as services_model from "../services/model.js";
import type * as services_publicServices from "../services/publicServices.js";
import type * as services_roster from "../services/roster.js";
import type * as services_serviceBookings from "../services/serviceBookings.js";
import type * as services_tables from "../services/tables.js";
import type * as settings from "../settings.js";
import type * as settings_tables from "../settings/tables.js";
import type * as shared_imageUrls from "../shared/imageUrls.js";
import type * as shared_messagingImages from "../shared/messagingImages.js";
import type * as shared_money from "../shared/money.js";
import type * as shared_validation from "../shared/validation.js";
import type * as staffAccess from "../staffAccess.js";
import type * as staffApprovals from "../staffApprovals.js";
import type * as testing_harness from "../testing/harness.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  adminChat: typeof adminChat;
  adminReply: typeof adminReply;
  aiEval: typeof aiEval;
  "auth/model": typeof auth_model;
  "auth/tables": typeof auth_tables;
  "bookings/admin": typeof bookings_admin;
  "bookings/bookings": typeof bookings_bookings;
  "bookings/calendar/addDateBlock": typeof bookings_calendar_addDateBlock;
  "bookings/calendar/addDateBlocks": typeof bookings_calendar_addDateBlocks;
  "bookings/calendar/availability": typeof bookings_calendar_availability;
  "bookings/calendar/ical": typeof bookings_calendar_ical;
  "bookings/calendar/removeDateBlock": typeof bookings_calendar_removeDateBlock;
  "bookings/calendar/updateDateBlock": typeof bookings_calendar_updateDateBlock;
  "bookings/commands/amendPayment": typeof bookings_commands_amendPayment;
  "bookings/commands/cancelPayment": typeof bookings_commands_cancelPayment;
  "bookings/commands/cancelStay": typeof bookings_commands_cancelStay;
  "bookings/commands/createBooking": typeof bookings_commands_createBooking;
  "bookings/commands/deleteBooking": typeof bookings_commands_deleteBooking;
  "bookings/commands/deleteBookings": typeof bookings_commands_deleteBookings;
  "bookings/commands/editBooking": typeof bookings_commands_editBooking;
  "bookings/commands/recordPayment": typeof bookings_commands_recordPayment;
  "bookings/commands/recordRefund": typeof bookings_commands_recordRefund;
  "bookings/commands/reopenBooking": typeof bookings_commands_reopenBooking;
  "bookings/commands/resendBookingEmails": typeof bookings_commands_resendBookingEmails;
  "bookings/commands/updateBooking": typeof bookings_commands_updateBooking;
  "bookings/commands/updateNotes": typeof bookings_commands_updateNotes;
  "bookings/model": typeof bookings_model;
  "bookings/payments/stripe": typeof bookings_payments_stripe;
  "bookings/tables": typeof bookings_tables;
  businessFacts: typeof businessFacts;
  "catalog/adminProperties": typeof catalog_adminProperties;
  "catalog/adminReviews": typeof catalog_adminReviews;
  "catalog/model": typeof catalog_model;
  "catalog/properties": typeof catalog_properties;
  "catalog/publicProperties": typeof catalog_publicProperties;
  "catalog/tables": typeof catalog_tables;
  chat: typeof chat;
  chatAi: typeof chatAi;
  chatEval: typeof chatEval;
  chatKnowledge: typeof chatKnowledge;
  chatSuggestions: typeof chatSuggestions;
  "concierge/context": typeof concierge_context;
  "concierge/copy": typeof concierge_copy;
  "concierge/model": typeof concierge_model;
  "concierge/prompt": typeof concierge_prompt;
  "concierge/runTurn": typeof concierge_runTurn;
  "concierge/tables": typeof concierge_tables;
  configurationHistory: typeof configurationHistory;
  crons: typeof crons;
  customers: typeof customers;
  displays: typeof displays;
  emails: typeof emails;
  http: typeof http;
  inboxLifecycle: typeof inboxLifecycle;
  leads: typeof leads;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/adminChatMetadata": typeof lib_adminChatMetadata;
  "lib/adminPhotos": typeof lib_adminPhotos;
  "lib/affiliateCredits": typeof lib_affiliateCredits;
  "lib/affiliateTypes": typeof lib_affiliateTypes;
  "lib/appointmentChanges": typeof lib_appointmentChanges;
  "lib/appointmentFinance": typeof lib_appointmentFinance;
  "lib/appointmentWindow": typeof lib_appointmentWindow;
  "lib/availabilityWrites": typeof lib_availabilityWrites;
  "lib/bookingMoney": typeof lib_bookingMoney;
  "lib/bookingPhone": typeof lib_bookingPhone;
  "lib/bookingWrites": typeof lib_bookingWrites;
  "lib/channelReplyWindow": typeof lib_channelReplyWindow;
  "lib/chatAdmission": typeof lib_chatAdmission;
  "lib/chatCoupon": typeof lib_chatCoupon;
  "lib/chatCouponCopy": typeof lib_chatCouponCopy;
  "lib/chatLlm": typeof lib_chatLlm;
  "lib/chatPresence": typeof lib_chatPresence;
  "lib/chatReuse": typeof lib_chatReuse;
  "lib/chatSuggestions": typeof lib_chatSuggestions;
  "lib/chatToolPresentation": typeof lib_chatToolPresentation;
  "lib/chatTools": typeof lib_chatTools;
  "lib/chatWriteGuard": typeof lib_chatWriteGuard;
  "lib/codes": typeof lib_codes;
  "lib/conciergePolicy": typeof lib_conciergePolicy;
  "lib/conciergeReplyOutcome": typeof lib_conciergeReplyOutcome;
  "lib/conciergeTurn": typeof lib_conciergeTurn;
  "lib/configurationHistory": typeof lib_configurationHistory;
  "lib/couponRedemptions": typeof lib_couponRedemptions;
  "lib/dates": typeof lib_dates;
  "lib/displayLease": typeof lib_displayLease;
  "lib/displayTokens": typeof lib_displayTokens;
  "lib/displayView": typeof lib_displayView;
  "lib/financeValidators": typeof lib_financeValidators;
  "lib/guestCouponCode": typeof lib_guestCouponCode;
  "lib/guestToken": typeof lib_guestToken;
  "lib/ical": typeof lib_ical;
  "lib/imageUploads": typeof lib_imageUploads;
  "lib/inboxLifecycle": typeof lib_inboxLifecycle;
  "lib/inboxTypes": typeof lib_inboxTypes;
  "lib/knowledgeGrouping": typeof lib_knowledgeGrouping;
  "lib/lineLinks": typeof lib_lineLinks;
  "lib/marketingAccess": typeof lib_marketingAccess;
  "lib/marketingAttribution": typeof lib_marketingAttribution;
  "lib/marketingPolicy": typeof lib_marketingPolicy;
  "lib/marketingPrivacy": typeof lib_marketingPrivacy;
  "lib/marketingReport": typeof lib_marketingReport;
  "lib/marketingReportRead": typeof lib_marketingReportRead;
  "lib/marketingSlugs": typeof lib_marketingSlugs;
  "lib/offers": typeof lib_offers;
  "lib/orderLifecycle": typeof lib_orderLifecycle;
  "lib/orderLines": typeof lib_orderLines;
  "lib/orderLinks": typeof lib_orderLinks;
  "lib/orderMath": typeof lib_orderMath;
  "lib/orderRefunds": typeof lib_orderRefunds;
  "lib/posCoupons": typeof lib_posCoupons;
  "lib/pricing": typeof lib_pricing;
  "lib/rateLimit": typeof lib_rateLimit;
  "lib/readBudget": typeof lib_readBudget;
  "lib/recordHistory": typeof lib_recordHistory;
  "lib/replyCards": typeof lib_replyCards;
  "lib/rosterHistory": typeof lib_rosterHistory;
  "lib/serviceCatalog": typeof lib_serviceCatalog;
  "lib/serviceSchedule": typeof lib_serviceSchedule;
  "lib/serviceSlots": typeof lib_serviceSlots;
  "lib/siteSettings": typeof lib_siteSettings;
  "lib/slug": typeof lib_slug;
  "lib/staffAccess": typeof lib_staffAccess;
  "lib/staffApprovalState": typeof lib_staffApprovalState;
  "lib/staffTypes": typeof lib_staffTypes;
  "lib/stayCorrections": typeof lib_stayCorrections;
  "lib/stayOverlap": typeof lib_stayOverlap;
  "lib/turnMetrics": typeof lib_turnMetrics;
  "lib/unknownReply": typeof lib_unknownReply;
  "lib/validation": typeof lib_validation;
  "maintenance/scenarios": typeof maintenance_scenarios;
  marketing: typeof marketing;
  "marketing/tables": typeof marketing_tables;
  marketingAccess: typeof marketingAccess;
  marketingAffiliates: typeof marketingAffiliates;
  marketingReport: typeof marketingReport;
  "messaging/channels/adapter": typeof messaging_channels_adapter;
  "messaging/channels/images": typeof messaging_channels_images;
  "messaging/channels/index": typeof messaging_channels_index;
  "messaging/channels/line": typeof messaging_channels_line;
  "messaging/channels/meta": typeof messaging_channels_meta;
  "messaging/channels/profile": typeof messaging_channels_profile;
  "messaging/channels/richMessages": typeof messaging_channels_richMessages;
  "messaging/channels/whatsapp": typeof messaging_channels_whatsapp;
  "messaging/claims": typeof messaging_claims;
  "messaging/ingress": typeof messaging_ingress;
  "messaging/model": typeof messaging_model;
  "messaging/tables": typeof messaging_tables;
  "messaging/worker": typeof messaging_worker;
  orderHistoryPages: typeof orderHistoryPages;
  pos: typeof pos;
  "pos/tables": typeof pos_tables;
  recordHistory: typeof recordHistory;
  seed: typeof seed;
  "seeds/aiEvalData": typeof seeds_aiEvalData;
  "seeds/properties": typeof seeds_properties;
  "seeds/reviews": typeof seeds_reviews;
  "seeds/rooms": typeof seeds_rooms;
  "seeds/staffServices": typeof seeds_staffServices;
  "seeds/tourSnippets": typeof seeds_tourSnippets;
  "services/admin": typeof services_admin;
  "services/commands/addTimeOff": typeof services_commands_addTimeOff;
  "services/commands/archiveService": typeof services_commands_archiveService;
  "services/commands/archiveStaff": typeof services_commands_archiveStaff;
  "services/commands/cancelAppointment": typeof services_commands_cancelAppointment;
  "services/commands/correctAppointmentPaymentEntry": typeof services_commands_correctAppointmentPaymentEntry;
  "services/commands/correctAppointmentStatus": typeof services_commands_correctAppointmentStatus;
  "services/commands/createAppointment": typeof services_commands_createAppointment;
  "services/commands/createService": typeof services_commands_createService;
  "services/commands/createStaff": typeof services_commands_createStaff;
  "services/commands/discardStaffAvatarUpload": typeof services_commands_discardStaffAvatarUpload;
  "services/commands/markAppointmentPaid": typeof services_commands_markAppointmentPaid;
  "services/commands/refundAppointment": typeof services_commands_refundAppointment;
  "services/commands/registerStaffAvatarUpload": typeof services_commands_registerStaffAvatarUpload;
  "services/commands/removeTimeOff": typeof services_commands_removeTimeOff;
  "services/commands/rescheduleAppointment": typeof services_commands_rescheduleAppointment;
  "services/commands/setServiceStaffMatrix": typeof services_commands_setServiceStaffMatrix;
  "services/commands/updateAppointmentDetails": typeof services_commands_updateAppointmentDetails;
  "services/commands/updateAppointmentStatus": typeof services_commands_updateAppointmentStatus;
  "services/commands/updateAppointmentTurnaround": typeof services_commands_updateAppointmentTurnaround;
  "services/commands/updateService": typeof services_commands_updateService;
  "services/commands/updateStaff": typeof services_commands_updateStaff;
  "services/commands/updateTimeOff": typeof services_commands_updateTimeOff;
  "services/commands/uploadStaffAvatar": typeof services_commands_uploadStaffAvatar;
  "services/maintenance": typeof services_maintenance;
  "services/model": typeof services_model;
  "services/publicServices": typeof services_publicServices;
  "services/roster": typeof services_roster;
  "services/serviceBookings": typeof services_serviceBookings;
  "services/tables": typeof services_tables;
  settings: typeof settings;
  "settings/tables": typeof settings_tables;
  "shared/imageUrls": typeof shared_imageUrls;
  "shared/messagingImages": typeof shared_messagingImages;
  "shared/money": typeof shared_money;
  "shared/validation": typeof shared_validation;
  staffAccess: typeof staffAccess;
  staffApprovals: typeof staffApprovals;
  "testing/harness": typeof testing_harness;
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

export declare const components: {
  rateLimiter: {
    lib: {
      checkRateLimit: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      clearAll: FunctionReference<
        "mutation",
        "internal",
        { before?: number },
        null
      >;
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
      getValue: FunctionReference<
        "query",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          key?: string;
          name: string;
          sampleShards?: number;
        },
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          shard: number;
          ts: number;
          value: number;
        }
      >;
      rateLimit: FunctionReference<
        "mutation",
        "internal",
        {
          config:
            | {
                capacity?: number;
                kind: "token bucket";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: null;
              }
            | {
                capacity?: number;
                kind: "fixed window";
                maxReserved?: number;
                period: number;
                rate: number;
                shards?: number;
                start?: number;
              };
          count?: number;
          key?: string;
          name: string;
          reserve?: boolean;
          throws?: boolean;
        },
        { ok: true; retryAfter?: number } | { ok: false; retryAfter: number }
      >;
      resetRateLimit: FunctionReference<
        "mutation",
        "internal",
        { key?: string; name: string },
        null
      >;
    };
    time: {
      getServerTime: FunctionReference<"mutation", "internal", {}, number>;
    };
  };
};
