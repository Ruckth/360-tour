import { v } from 'convex/values';
import { chatCouponValidator } from '../shared/chatCouponTypes';

export const bookingsCreateResult = v.object({
"bookingId": v.id("bookings"),
"accessToken": v.string(),
});

export const bookingsGetByIdResult = v.union(v.null(), v.object({
"_id": v.id("bookings"),
"checkIn": v.string(),
"checkOut": v.string(),
"guests": v.number(),
"nights": v.number(),
"subtotal": v.number(),
"discountAmount": v.number(),
"customPrice": v.boolean(),
"promotion": v.optional(v.object({
"code": v.string(),
"couponVersion": v.number(),
"discount": v.number(),
})),
"total": v.number(),
"currency": v.string(),
"paymentStatus": v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded")),
"status": v.union(v.literal("pending"), v.literal("confirmed"), v.literal("cancelled"), v.literal("completed")),
"confirmationCode": v.optional(v.string()),
"invoiceNumber": v.optional(v.string()),
"receiptNumber": v.optional(v.string()),
}));

export const bookingsGetConfirmProposalResult = v.union(v.null(), v.object({
"subtotal": v.optional(v.number()),
"discountAmount": v.optional(v.number()),
"total": v.number(),
"currency": v.string(),
"cancellationPolicy": v.string(),
"unpaidHoldMinutes": v.number(),
"holdExpiresAt": v.union(v.null(), v.number()),
"coupon": v.optional(chatCouponValidator),
"property": v.string(),
"checkIn": v.string(),
"checkOut": v.string(),
"guests": v.number(),
"nights": v.number(),
}));

export const bookingsConfirmProposalResult = v.union(v.object({
"needsReview": v.literal(false),
"alreadyConfirmed": v.boolean(),
"coupon": v.optional(chatCouponValidator),
"bookingId": v.id("bookings"),
"accessToken": v.string(),
"confirmationCode": v.string(),
"property": v.string(),
"checkIn": v.string(),
"checkOut": v.string(),
"guests": v.number(),
"nights": v.number(),
"total": v.number(),
"currency": v.string(),
"paymentStatus": v.union(v.literal("pending"), v.literal("paid"), v.literal("failed"), v.literal("refunded")),
"quote": v.optional(v.null()),
}), v.object({
"needsReview": v.literal(true),
"quote": v.object({
"currency": v.string(),
"coupon": v.optional(chatCouponValidator),
"confirmToken": v.string(),
"expiresAt": v.number(),
"property": v.string(),
"checkIn": v.string(),
"checkOut": v.string(),
"nights": v.number(),
"guests": v.number(),
"guestName": v.string(),
"guestPhone": v.string(),
"total": v.number(),
"subtotal": v.number(),
"discountAmount": v.number(),
}),
}));

export const availabilityStatus = v.union(v.literal('available'), v.literal('booked'), v.literal('blocked'));

export const availabilityGetBlockedDatesResult = v.array(v.string());

export const availabilityGetBlockedDatesByPropertyResult = v.record(v.string(), v.array(v.string()));

export const availabilityIsAvailableResult = v.boolean();

export const stripeCreateCheckoutResult = v.object({
"url": v.string(),
});
