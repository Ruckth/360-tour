import { v } from 'convex/values';

export const chatCouponValidator = v.object({
  code: v.string(), couponId: v.optional(v.id('coupons')), version: v.optional(v.number()),
  status: v.union(v.literal('applied'), v.literal('coupon_worse'), v.literal('invalid')),
  discount: v.number(), capped: v.boolean(),
  problem: v.optional(v.union(
    v.object({ code: v.literal('not_found') }), v.object({ code: v.literal('not_active') }),
    v.object({ code: v.literal('not_started'), startsOn: v.string() }),
    v.object({ code: v.literal('expired'), endedOn: v.string() }),
    v.object({ code: v.literal('sold_out') }), v.object({ code: v.literal('budget_used') }),
    v.object({ code: v.literal('wrong_property') }),
    v.object({ code: v.literal('stay_outside_dates'), stayFrom: v.optional(v.string()), stayTo: v.optional(v.string()) }),
    v.object({ code: v.literal('min_nights'), minNights: v.number(), missingNights: v.number() }),
    v.object({ code: v.literal('min_subtotal'), minEligibleSubtotal: v.number(), eligibleSubtotal: v.number() }),
    v.object({ code: v.literal('nothing_eligible') })
  ))
});

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const bookingsQuoteStayResult = v.object({
"pricePerNight": v.number(),
"nights": v.number(),
"subtotal": v.number(),
"discountPercent": v.number(),
"discountAmount": v.number(),
"directTotal": v.number(),
"currency": v.string(),
});

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

export const availabilityGetForPropertyResult = v.array(v.object({
"date": v.string(),
"status": availabilityStatus,
"source": v.string(),
}));

export const availabilityGetBlockedDatesResult = v.array(v.string());

export const availabilityGetBlockedDatesByPropertyResult = v.record(v.string(), v.array(v.string()));

export const availabilityIsAvailableResult = v.boolean();

export const stripeCreateCheckoutResult = v.object({
"url": v.string(),
});
