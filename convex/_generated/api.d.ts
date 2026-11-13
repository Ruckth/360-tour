/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

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
import type * as catalog_adminProperties from "../catalog/adminProperties.js";
import type * as catalog_adminReviews from "../catalog/adminReviews.js";
import type * as catalog_model from "../catalog/model.js";
import type * as catalog_properties from "../catalog/properties.js";
import type * as catalog_publicProperties from "../catalog/publicProperties.js";
import type * as catalog_tables from "../catalog/tables.js";
import type * as chatEval from "../chatEval.js";
import type * as concierge_businessFacts from "../concierge/businessFacts.js";
import type * as concierge_context from "../concierge/context.js";
import type * as concierge_copy from "../concierge/copy.js";
import type * as concierge_generation from "../concierge/generation.js";
import type * as concierge_knowledge from "../concierge/knowledge.js";
import type * as concierge_knowledgeGrouping from "../concierge/knowledgeGrouping.js";
import type * as concierge_llm from "../concierge/llm.js";
import type * as concierge_metrics from "../concierge/metrics.js";
import type * as concierge_model from "../concierge/model.js";
import type * as concierge_outcome from "../concierge/outcome.js";
import type * as concierge_prompt from "../concierge/prompt.js";
import type * as concierge_runTurn from "../concierge/runTurn.js";
import type * as concierge_tables from "../concierge/tables.js";
import type * as concierge_tools_booking from "../concierge/tools/booking.js";
import type * as concierge_tools_dispatcher from "../concierge/tools/dispatcher.js";
import type * as concierge_tools_facts from "../concierge/tools/facts.js";
import type * as concierge_tools_metadata from "../concierge/tools/metadata.js";
import type * as concierge_tools_presentation from "../concierge/tools/presentation.js";
import type * as concierge_tools_property from "../concierge/tools/property.js";
import type * as concierge_tools_service from "../concierge/tools/service.js";
import type * as concierge_tools_types from "../concierge/tools/types.js";
import type * as concierge_tools_validation from "../concierge/tools/validation.js";
import type * as concierge_turn from "../concierge/turn.js";
import type * as crons from "../crons.js";
import type * as emails from "../emails.js";
import type * as http from "../http.js";
import type * as lib_adminAuth from "../lib/adminAuth.js";
import type * as lib_adminEmails from "../lib/adminEmails.js";
import type * as lib_adminPhotos from "../lib/adminPhotos.js";
import type * as lib_affiliateTypes from "../lib/affiliateTypes.js";
import type * as lib_appointmentChanges from "../lib/appointmentChanges.js";
import type * as lib_appointmentFinance from "../lib/appointmentFinance.js";
import type * as lib_appointmentWindow from "../lib/appointmentWindow.js";
import type * as lib_availabilityWrites from "../lib/availabilityWrites.js";
import type * as lib_bookingMoney from "../lib/bookingMoney.js";
import type * as lib_bookingPhone from "../lib/bookingPhone.js";
import type * as lib_bookingWrites from "../lib/bookingWrites.js";
import type * as lib_chatCoupon from "../lib/chatCoupon.js";
import type * as lib_chatCouponCopy from "../lib/chatCouponCopy.js";
import type * as lib_chatPresence from "../lib/chatPresence.js";
import type * as lib_chatReuse from "../lib/chatReuse.js";
import type * as lib_chatSuggestions from "../lib/chatSuggestions.js";
import type * as lib_chatWriteGuard from "../lib/chatWriteGuard.js";
import type * as lib_codes from "../lib/codes.js";
import type * as lib_dates from "../lib/dates.js";
import type * as lib_displayLease from "../lib/displayLease.js";
import type * as lib_displayTokens from "../lib/displayTokens.js";
import type * as lib_displayView from "../lib/displayView.js";
import type * as lib_financeValidators from "../lib/financeValidators.js";
import type * as lib_guestCouponCode from "../lib/guestCouponCode.js";
import type * as lib_ical from "../lib/ical.js";
import type * as lib_imageUploads from "../lib/imageUploads.js";
import type * as lib_inboxTypes from "../lib/inboxTypes.js";
import type * as lib_lineLinks from "../lib/lineLinks.js";
import type * as lib_maintenance from "../lib/maintenance.js";
import type * as lib_marketingPolicy from "../lib/marketingPolicy.js";
import type * as lib_marketingPrivacy from "../lib/marketingPrivacy.js";
import type * as lib_marketingReport from "../lib/marketingReport.js";
import type * as lib_marketingSlugs from "../lib/marketingSlugs.js";
import type * as lib_offers from "../lib/offers.js";
import type * as lib_orderLifecycle from "../lib/orderLifecycle.js";
import type * as lib_orderLines from "../lib/orderLines.js";
import type * as lib_orderLinks from "../lib/orderLinks.js";
import type * as lib_orderMath from "../lib/orderMath.js";
import type * as lib_orderRefunds from "../lib/orderRefunds.js";
import type * as lib_posCoupons from "../lib/posCoupons.js";
import type * as lib_pricing from "../lib/pricing.js";
import type * as lib_readBudget from "../lib/readBudget.js";
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
import type * as lib_stayMoney from "../lib/stayMoney.js";
import type * as lib_stayOverlap from "../lib/stayOverlap.js";
import type * as lib_unknownReply from "../lib/unknownReply.js";
import type * as lib_validation from "../lib/validation.js";
import type * as maintenance_scenarios from "../maintenance/scenarios.js";
import type * as marketing_access from "../marketing/access.js";
import type * as marketing_accessPolicy from "../marketing/accessPolicy.js";
import type * as marketing_affiliateCredits from "../marketing/affiliateCredits.js";
import type * as marketing_affiliateRead from "../marketing/affiliateRead.js";
import type * as marketing_affiliates from "../marketing/affiliates.js";
import type * as marketing_attribution from "../marketing/attribution.js";
import type * as marketing_catalogModel from "../marketing/catalogModel.js";
import type * as marketing_commands_assignCoupon from "../marketing/commands/assignCoupon.js";
import type * as marketing_commands_refreshCredit from "../marketing/commands/refreshCredit.js";
import type * as marketing_commands_reviewCredit from "../marketing/commands/reviewCredit.js";
import type * as marketing_commands_saveAffiliate from "../marketing/commands/saveAffiliate.js";
import type * as marketing_commands_saveCampaign from "../marketing/commands/saveCampaign.js";
import type * as marketing_commands_saveCoupon from "../marketing/commands/saveCoupon.js";
import type * as marketing_commands_saveLink from "../marketing/commands/saveLink.js";
import type * as marketing_commands_setAffiliateStatus from "../marketing/commands/setAffiliateStatus.js";
import type * as marketing_commands_setCampaignStatus from "../marketing/commands/setCampaignStatus.js";
import type * as marketing_commands_setCouponStatus from "../marketing/commands/setCouponStatus.js";
import type * as marketing_commands_setLinkStatus from "../marketing/commands/setLinkStatus.js";
import type * as marketing_couponRedemptions from "../marketing/couponRedemptions.js";
import type * as marketing_maintenance from "../marketing/maintenance.js";
import type * as marketing_model from "../marketing/model.js";
import type * as marketing_public from "../marketing/public.js";
import type * as marketing_queries from "../marketing/queries.js";
import type * as marketing_report from "../marketing/report.js";
import type * as marketing_reportRead from "../marketing/reportRead.js";
import type * as marketing_tables from "../marketing/tables.js";
import type * as messaging_adminChat from "../messaging/adminChat.js";
import type * as messaging_adminChatMetadata from "../messaging/adminChatMetadata.js";
import type * as messaging_adminReply from "../messaging/adminReply.js";
import type * as messaging_admission from "../messaging/admission.js";
import type * as messaging_alerts from "../messaging/alerts.js";
import type * as messaging_channelReplyWindow from "../messaging/channelReplyWindow.js";
import type * as messaging_channels_adapter from "../messaging/channels/adapter.js";
import type * as messaging_channels_images from "../messaging/channels/images.js";
import type * as messaging_channels_index from "../messaging/channels/index.js";
import type * as messaging_channels_line from "../messaging/channels/line.js";
import type * as messaging_channels_meta from "../messaging/channels/meta.js";
import type * as messaging_channels_profile from "../messaging/channels/profile.js";
import type * as messaging_channels_richMessages from "../messaging/channels/richMessages.js";
import type * as messaging_channels_whatsapp from "../messaging/channels/whatsapp.js";
import type * as messaging_chat from "../messaging/chat.js";
import type * as messaging_chatAdmission from "../messaging/chatAdmission.js";
import type * as messaging_chatSuggestions from "../messaging/chatSuggestions.js";
import type * as messaging_claims from "../messaging/claims.js";
import type * as messaging_guestToken from "../messaging/guestToken.js";
import type * as messaging_inboxLifecycle from "../messaging/inboxLifecycle.js";
import type * as messaging_inboxState from "../messaging/inboxState.js";
import type * as messaging_ingress from "../messaging/ingress.js";
import type * as messaging_leadWriter from "../messaging/leadWriter.js";
import type * as messaging_leads from "../messaging/leads.js";
import type * as messaging_maintenance from "../messaging/maintenance.js";
import type * as messaging_model from "../messaging/model.js";
import type * as messaging_pipeline from "../messaging/pipeline.js";
import type * as messaging_rateLimit from "../messaging/rateLimit.js";
import type * as messaging_staffHandoff from "../messaging/staffHandoff.js";
import type * as messaging_staffRequests from "../messaging/staffRequests.js";
import type * as messaging_tables from "../messaging/tables.js";
import type * as messaging_worker from "../messaging/worker.js";
import type * as messaging_writeGuard from "../messaging/writeGuard.js";
import type * as pos_catalog from "../pos/catalog.js";
import type * as pos_commands_addAppointmentFee from "../pos/commands/addAppointmentFee.js";
import type * as pos_commands_addItem from "../pos/commands/addItem.js";
import type * as pos_commands_amendOrderPayment from "../pos/commands/amendOrderPayment.js";
import type * as pos_commands_applyOrderCoupon from "../pos/commands/applyOrderCoupon.js";
import type * as pos_commands_attach from "../pos/commands/attach.js";
import type * as pos_commands_clearOrder from "../pos/commands/clearOrder.js";
import type * as pos_commands_createOrder from "../pos/commands/createOrder.js";
import type * as pos_commands_discardOrder from "../pos/commands/discardOrder.js";
import type * as pos_commands_linkCustomer from "../pos/commands/linkCustomer.js";
import type * as pos_commands_linkPaidLine from "../pos/commands/linkPaidLine.js";
import type * as pos_commands_openOrderFor from "../pos/commands/openOrderFor.js";
import type * as pos_commands_openOrderForLink from "../pos/commands/openOrderForLink.js";
import type * as pos_commands_overrideLinePrice from "../pos/commands/overrideLinePrice.js";
import type * as pos_commands_recheckOrderCoupon from "../pos/commands/recheckOrderCoupon.js";
import type * as pos_commands_refundLine from "../pos/commands/refundLine.js";
import type * as pos_commands_removeLine from "../pos/commands/removeLine.js";
import type * as pos_commands_removeOrderCoupon from "../pos/commands/removeOrderCoupon.js";
import type * as pos_commands_restoreOrder from "../pos/commands/restoreOrder.js";
import type * as pos_commands_saveOrder from "../pos/commands/saveOrder.js";
import type * as pos_commands_settleOrder from "../pos/commands/settleOrder.js";
import type * as pos_commands_unlinkCustomer from "../pos/commands/unlinkCustomer.js";
import type * as pos_commands_unlinkPaidLine from "../pos/commands/unlinkPaidLine.js";
import type * as pos_commands_updateLine from "../pos/commands/updateLine.js";
import type * as pos_commands_updateSourceLine from "../pos/commands/updateSourceLine.js";
import type * as pos_commands_voidOrder from "../pos/commands/voidOrder.js";
import type * as pos_commands_voidUnreceivedOrder from "../pos/commands/voidUnreceivedOrder.js";
import type * as pos_customers from "../pos/customers.js";
import type * as pos_displays from "../pos/displays.js";
import type * as pos_model from "../pos/model.js";
import type * as pos_orderHistoryPages from "../pos/orderHistoryPages.js";
import type * as pos_orders from "../pos/orders.js";
import type * as pos_private_approvalModel from "../pos/private/approvalModel.js";
import type * as pos_private_customerModel from "../pos/private/customerModel.js";
import type * as pos_private_displayModel from "../pos/private/displayModel.js";
import type * as pos_private_lifecycleModel from "../pos/private/lifecycleModel.js";
import type * as pos_private_lineCommands from "../pos/private/lineCommands.js";
import type * as pos_private_orderModel from "../pos/private/orderModel.js";
import type * as pos_private_paidLinkModel from "../pos/private/paidLinkModel.js";
import type * as pos_private_paidLinks from "../pos/private/paidLinks.js";
import type * as pos_private_paymentCorrections from "../pos/private/paymentCorrections.js";
import type * as pos_private_sourceModel from "../pos/private/sourceModel.js";
import type * as pos_sourceReads from "../pos/sourceReads.js";
import type * as pos_staffApprovals from "../pos/staffApprovals.js";
import type * as pos_tables from "../pos/tables.js";
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
import type * as settings_cashierPolicy from "../settings/cashierPolicy.js";
import type * as settings_cashierRules from "../settings/cashierRules.js";
import type * as settings_configurationHistory from "../settings/configurationHistory.js";
import type * as settings_configurationWriter from "../settings/configurationWriter.js";
import type * as settings_emailTransport from "../settings/emailTransport.js";
import type * as settings_emails from "../settings/emails.js";
import type * as settings_model from "../settings/model.js";
import type * as settings_recordHistory from "../settings/recordHistory.js";
import type * as settings_recordWriter from "../settings/recordWriter.js";
import type * as settings_settings from "../settings/settings.js";
import type * as settings_tables from "../settings/tables.js";
import type * as shared_imageUrls from "../shared/imageUrls.js";
import type * as shared_marketingAccess from "../shared/marketingAccess.js";
import type * as shared_marketingAffiliateTypes from "../shared/marketingAffiliateTypes.js";
import type * as shared_marketingAttribution from "../shared/marketingAttribution.js";
import type * as shared_marketingTypes from "../shared/marketingTypes.js";
import type * as shared_messagingImages from "../shared/messagingImages.js";
import type * as shared_money from "../shared/money.js";
import type * as shared_validation from "../shared/validation.js";
import type * as staffAccess from "../staffAccess.js";
import type * as testing_harness from "../testing/harness.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
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
  "catalog/adminProperties": typeof catalog_adminProperties;
  "catalog/adminReviews": typeof catalog_adminReviews;
  "catalog/model": typeof catalog_model;
  "catalog/properties": typeof catalog_properties;
  "catalog/publicProperties": typeof catalog_publicProperties;
  "catalog/tables": typeof catalog_tables;
  chatEval: typeof chatEval;
  "concierge/businessFacts": typeof concierge_businessFacts;
  "concierge/context": typeof concierge_context;
  "concierge/copy": typeof concierge_copy;
  "concierge/generation": typeof concierge_generation;
  "concierge/knowledge": typeof concierge_knowledge;
  "concierge/knowledgeGrouping": typeof concierge_knowledgeGrouping;
  "concierge/llm": typeof concierge_llm;
  "concierge/metrics": typeof concierge_metrics;
  "concierge/model": typeof concierge_model;
  "concierge/outcome": typeof concierge_outcome;
  "concierge/prompt": typeof concierge_prompt;
  "concierge/runTurn": typeof concierge_runTurn;
  "concierge/tables": typeof concierge_tables;
  "concierge/tools/booking": typeof concierge_tools_booking;
  "concierge/tools/dispatcher": typeof concierge_tools_dispatcher;
  "concierge/tools/facts": typeof concierge_tools_facts;
  "concierge/tools/metadata": typeof concierge_tools_metadata;
  "concierge/tools/presentation": typeof concierge_tools_presentation;
  "concierge/tools/property": typeof concierge_tools_property;
  "concierge/tools/service": typeof concierge_tools_service;
  "concierge/tools/types": typeof concierge_tools_types;
  "concierge/tools/validation": typeof concierge_tools_validation;
  "concierge/turn": typeof concierge_turn;
  crons: typeof crons;
  emails: typeof emails;
  http: typeof http;
  "lib/adminAuth": typeof lib_adminAuth;
  "lib/adminEmails": typeof lib_adminEmails;
  "lib/adminPhotos": typeof lib_adminPhotos;
  "lib/affiliateTypes": typeof lib_affiliateTypes;
  "lib/appointmentChanges": typeof lib_appointmentChanges;
  "lib/appointmentFinance": typeof lib_appointmentFinance;
  "lib/appointmentWindow": typeof lib_appointmentWindow;
  "lib/availabilityWrites": typeof lib_availabilityWrites;
  "lib/bookingMoney": typeof lib_bookingMoney;
  "lib/bookingPhone": typeof lib_bookingPhone;
  "lib/bookingWrites": typeof lib_bookingWrites;
  "lib/chatCoupon": typeof lib_chatCoupon;
  "lib/chatCouponCopy": typeof lib_chatCouponCopy;
  "lib/chatPresence": typeof lib_chatPresence;
  "lib/chatReuse": typeof lib_chatReuse;
  "lib/chatSuggestions": typeof lib_chatSuggestions;
  "lib/chatWriteGuard": typeof lib_chatWriteGuard;
  "lib/codes": typeof lib_codes;
  "lib/dates": typeof lib_dates;
  "lib/displayLease": typeof lib_displayLease;
  "lib/displayTokens": typeof lib_displayTokens;
  "lib/displayView": typeof lib_displayView;
  "lib/financeValidators": typeof lib_financeValidators;
  "lib/guestCouponCode": typeof lib_guestCouponCode;
  "lib/ical": typeof lib_ical;
  "lib/imageUploads": typeof lib_imageUploads;
  "lib/inboxTypes": typeof lib_inboxTypes;
  "lib/lineLinks": typeof lib_lineLinks;
  "lib/maintenance": typeof lib_maintenance;
  "lib/marketingPolicy": typeof lib_marketingPolicy;
  "lib/marketingPrivacy": typeof lib_marketingPrivacy;
  "lib/marketingReport": typeof lib_marketingReport;
  "lib/marketingSlugs": typeof lib_marketingSlugs;
  "lib/offers": typeof lib_offers;
  "lib/orderLifecycle": typeof lib_orderLifecycle;
  "lib/orderLines": typeof lib_orderLines;
  "lib/orderLinks": typeof lib_orderLinks;
  "lib/orderMath": typeof lib_orderMath;
  "lib/orderRefunds": typeof lib_orderRefunds;
  "lib/posCoupons": typeof lib_posCoupons;
  "lib/pricing": typeof lib_pricing;
  "lib/readBudget": typeof lib_readBudget;
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
  "lib/stayMoney": typeof lib_stayMoney;
  "lib/stayOverlap": typeof lib_stayOverlap;
  "lib/unknownReply": typeof lib_unknownReply;
  "lib/validation": typeof lib_validation;
  "maintenance/scenarios": typeof maintenance_scenarios;
  "marketing/access": typeof marketing_access;
  "marketing/accessPolicy": typeof marketing_accessPolicy;
  "marketing/affiliateCredits": typeof marketing_affiliateCredits;
  "marketing/affiliateRead": typeof marketing_affiliateRead;
  "marketing/affiliates": typeof marketing_affiliates;
  "marketing/attribution": typeof marketing_attribution;
  "marketing/catalogModel": typeof marketing_catalogModel;
  "marketing/commands/assignCoupon": typeof marketing_commands_assignCoupon;
  "marketing/commands/refreshCredit": typeof marketing_commands_refreshCredit;
  "marketing/commands/reviewCredit": typeof marketing_commands_reviewCredit;
  "marketing/commands/saveAffiliate": typeof marketing_commands_saveAffiliate;
  "marketing/commands/saveCampaign": typeof marketing_commands_saveCampaign;
  "marketing/commands/saveCoupon": typeof marketing_commands_saveCoupon;
  "marketing/commands/saveLink": typeof marketing_commands_saveLink;
  "marketing/commands/setAffiliateStatus": typeof marketing_commands_setAffiliateStatus;
  "marketing/commands/setCampaignStatus": typeof marketing_commands_setCampaignStatus;
  "marketing/commands/setCouponStatus": typeof marketing_commands_setCouponStatus;
  "marketing/commands/setLinkStatus": typeof marketing_commands_setLinkStatus;
  "marketing/couponRedemptions": typeof marketing_couponRedemptions;
  "marketing/maintenance": typeof marketing_maintenance;
  "marketing/model": typeof marketing_model;
  "marketing/public": typeof marketing_public;
  "marketing/queries": typeof marketing_queries;
  "marketing/report": typeof marketing_report;
  "marketing/reportRead": typeof marketing_reportRead;
  "marketing/tables": typeof marketing_tables;
  "messaging/adminChat": typeof messaging_adminChat;
  "messaging/adminChatMetadata": typeof messaging_adminChatMetadata;
  "messaging/adminReply": typeof messaging_adminReply;
  "messaging/admission": typeof messaging_admission;
  "messaging/alerts": typeof messaging_alerts;
  "messaging/channelReplyWindow": typeof messaging_channelReplyWindow;
  "messaging/channels/adapter": typeof messaging_channels_adapter;
  "messaging/channels/images": typeof messaging_channels_images;
  "messaging/channels/index": typeof messaging_channels_index;
  "messaging/channels/line": typeof messaging_channels_line;
  "messaging/channels/meta": typeof messaging_channels_meta;
  "messaging/channels/profile": typeof messaging_channels_profile;
  "messaging/channels/richMessages": typeof messaging_channels_richMessages;
  "messaging/channels/whatsapp": typeof messaging_channels_whatsapp;
  "messaging/chat": typeof messaging_chat;
  "messaging/chatAdmission": typeof messaging_chatAdmission;
  "messaging/chatSuggestions": typeof messaging_chatSuggestions;
  "messaging/claims": typeof messaging_claims;
  "messaging/guestToken": typeof messaging_guestToken;
  "messaging/inboxLifecycle": typeof messaging_inboxLifecycle;
  "messaging/inboxState": typeof messaging_inboxState;
  "messaging/ingress": typeof messaging_ingress;
  "messaging/leadWriter": typeof messaging_leadWriter;
  "messaging/leads": typeof messaging_leads;
  "messaging/maintenance": typeof messaging_maintenance;
  "messaging/model": typeof messaging_model;
  "messaging/pipeline": typeof messaging_pipeline;
  "messaging/rateLimit": typeof messaging_rateLimit;
  "messaging/staffHandoff": typeof messaging_staffHandoff;
  "messaging/staffRequests": typeof messaging_staffRequests;
  "messaging/tables": typeof messaging_tables;
  "messaging/worker": typeof messaging_worker;
  "messaging/writeGuard": typeof messaging_writeGuard;
  "pos/catalog": typeof pos_catalog;
  "pos/commands/addAppointmentFee": typeof pos_commands_addAppointmentFee;
  "pos/commands/addItem": typeof pos_commands_addItem;
  "pos/commands/amendOrderPayment": typeof pos_commands_amendOrderPayment;
  "pos/commands/applyOrderCoupon": typeof pos_commands_applyOrderCoupon;
  "pos/commands/attach": typeof pos_commands_attach;
  "pos/commands/clearOrder": typeof pos_commands_clearOrder;
  "pos/commands/createOrder": typeof pos_commands_createOrder;
  "pos/commands/discardOrder": typeof pos_commands_discardOrder;
  "pos/commands/linkCustomer": typeof pos_commands_linkCustomer;
  "pos/commands/linkPaidLine": typeof pos_commands_linkPaidLine;
  "pos/commands/openOrderFor": typeof pos_commands_openOrderFor;
  "pos/commands/openOrderForLink": typeof pos_commands_openOrderForLink;
  "pos/commands/overrideLinePrice": typeof pos_commands_overrideLinePrice;
  "pos/commands/recheckOrderCoupon": typeof pos_commands_recheckOrderCoupon;
  "pos/commands/refundLine": typeof pos_commands_refundLine;
  "pos/commands/removeLine": typeof pos_commands_removeLine;
  "pos/commands/removeOrderCoupon": typeof pos_commands_removeOrderCoupon;
  "pos/commands/restoreOrder": typeof pos_commands_restoreOrder;
  "pos/commands/saveOrder": typeof pos_commands_saveOrder;
  "pos/commands/settleOrder": typeof pos_commands_settleOrder;
  "pos/commands/unlinkCustomer": typeof pos_commands_unlinkCustomer;
  "pos/commands/unlinkPaidLine": typeof pos_commands_unlinkPaidLine;
  "pos/commands/updateLine": typeof pos_commands_updateLine;
  "pos/commands/updateSourceLine": typeof pos_commands_updateSourceLine;
  "pos/commands/voidOrder": typeof pos_commands_voidOrder;
  "pos/commands/voidUnreceivedOrder": typeof pos_commands_voidUnreceivedOrder;
  "pos/customers": typeof pos_customers;
  "pos/displays": typeof pos_displays;
  "pos/model": typeof pos_model;
  "pos/orderHistoryPages": typeof pos_orderHistoryPages;
  "pos/orders": typeof pos_orders;
  "pos/private/approvalModel": typeof pos_private_approvalModel;
  "pos/private/customerModel": typeof pos_private_customerModel;
  "pos/private/displayModel": typeof pos_private_displayModel;
  "pos/private/lifecycleModel": typeof pos_private_lifecycleModel;
  "pos/private/lineCommands": typeof pos_private_lineCommands;
  "pos/private/orderModel": typeof pos_private_orderModel;
  "pos/private/paidLinkModel": typeof pos_private_paidLinkModel;
  "pos/private/paidLinks": typeof pos_private_paidLinks;
  "pos/private/paymentCorrections": typeof pos_private_paymentCorrections;
  "pos/private/sourceModel": typeof pos_private_sourceModel;
  "pos/sourceReads": typeof pos_sourceReads;
  "pos/staffApprovals": typeof pos_staffApprovals;
  "pos/tables": typeof pos_tables;
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
  "settings/cashierPolicy": typeof settings_cashierPolicy;
  "settings/cashierRules": typeof settings_cashierRules;
  "settings/configurationHistory": typeof settings_configurationHistory;
  "settings/configurationWriter": typeof settings_configurationWriter;
  "settings/emailTransport": typeof settings_emailTransport;
  "settings/emails": typeof settings_emails;
  "settings/model": typeof settings_model;
  "settings/recordHistory": typeof settings_recordHistory;
  "settings/recordWriter": typeof settings_recordWriter;
  "settings/settings": typeof settings_settings;
  "settings/tables": typeof settings_tables;
  "shared/imageUrls": typeof shared_imageUrls;
  "shared/marketingAccess": typeof shared_marketingAccess;
  "shared/marketingAffiliateTypes": typeof shared_marketingAffiliateTypes;
  "shared/marketingAttribution": typeof shared_marketingAttribution;
  "shared/marketingTypes": typeof shared_marketingTypes;
  "shared/messagingImages": typeof shared_messagingImages;
  "shared/money": typeof shared_money;
  "shared/validation": typeof shared_validation;
  staffAccess: typeof staffAccess;
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
