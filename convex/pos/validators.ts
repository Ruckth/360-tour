import { v } from 'convex/values';

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const displaysClaimLinkResult = v.union(v.object({
"ok": v.literal(true),
"token": v.string(),
}), v.object({
"ok": v.literal(false),
"code": v.literal("LINK_INVALID"),
}));

export const displaysStartPairingResult = v.union(v.object({
"status": v.literal("active"),
}), v.object({
"status": v.literal("pending"),
"token": v.string(),
"code": v.string(),
"expiresAt": v.number(),
}));

export const displaysReleaseDisplayResult = v.null();

export const displaysCurrentResult = v.union(v.object({
"state": v.literal("unpaired"),
}), v.object({
"state": v.literal("pending"),
"code": v.string(),
}), v.object({
"state": v.literal("idle"),
"businessName": v.string(),
}), v.object({
"businessName": v.string(),
"customerFirstName": v.union(v.null(), v.string()),
"orderNumber": v.union(v.null(), v.number()),
"currency": v.string(),
"state": v.literal("order"),
"lines": v.array(v.object({
"name": v.string(),
"detail": v.union(v.null(), v.string()),
"qty": v.number(),
"unitPrice": v.number(),
"price": v.number(),
"discount": v.number(),
"couponDiscount": v.number(),
"total": v.number(),
"deposit": v.number(),
})),
"subtotal": v.number(),
"discount": v.number(),
"coupon": v.union(v.null(), v.object({
"code": v.string(),
"saving": v.number(),
})),
"deposit": v.number(),
"total": v.number(),
"vat": v.number(),
"due": v.number(),
"activeAt": v.number(),
}), v.object({
"businessName": v.string(),
"customerFirstName": v.union(v.null(), v.string()),
"orderNumber": v.union(v.null(), v.number()),
"currency": v.string(),
"state": v.literal("paid"),
"total": v.number(),
"vat": v.number(),
"amountPaid": v.number(),
"receiptNumber": v.union(v.null(), v.number()),
"paidAt": v.number(),
"coupon": v.union(v.null(), v.object({
"code": v.string(),
"saving": v.number(),
})),
}));

export const displaysHeartbeatResult = v.null();
