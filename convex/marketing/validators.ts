import { v } from 'convex/values';

// Published no-login response contracts. Fields are selected by each owning endpoint.
export const accessCurrentResult = v.union(v.object({
"email": v.string(),
"role": v.literal("admin"),
"capabilities": v.object({
"view": v.boolean(),
"draft": v.boolean(),
"publish": v.boolean(),
"spend": v.boolean(),
"partners": v.boolean(),
"reviewCredits": v.boolean(),
"manageAccess": v.boolean(),
}),
"pendingInvitation": v.null(),
}), v.object({
"email": v.union(v.null(), v.string()),
"role": v.union(v.null(), v.literal("manager"), v.literal("marketer"), v.literal("finance"), v.literal("viewer")),
"capabilities": v.object({
"view": v.boolean(),
"draft": v.boolean(),
"publish": v.boolean(),
"spend": v.boolean(),
"partners": v.boolean(),
"reviewCredits": v.boolean(),
"manageAccess": v.boolean(),
}),
"pendingInvitation": v.union(v.null(), v.object({
"role": v.union(v.literal("manager"), v.literal("marketer"), v.literal("finance"), v.literal("viewer")),
})),
}));

export const publicResolveLinkResult = v.union(v.null(), v.object({
"path": v.string(),
"status": v.union(v.literal("active"), v.literal("archived"), v.literal("paused")),
"offerRemoved": v.boolean(),
"couponCode": v.optional(v.string()),
}));

export const publicRecordOpenResult = v.null();

export const publicStartSessionResult = v.object({
"visitorKey": v.string(),
"sessionId": v.union(v.null(), v.id("marketingSessions")),
});

export const publicPreviewCouponResult = v.object({
"subtotal": v.number(),
"applied": v.union(v.literal("coupon"), v.literal("direct"), v.literal("none")),
"couponStatus": v.union(v.literal("applied"), v.literal("coupon_worse"), v.literal("invalid"), v.literal("none")),
"problem": v.optional(v.union(v.object({
"code": v.literal("not_found"),
}), v.object({
"code": v.literal("not_active"),
}), v.object({
"code": v.literal("not_started"),
"startsOn": v.string(),
}), v.object({
"code": v.literal("expired"),
"endedOn": v.string(),
}), v.object({
"code": v.literal("sold_out"),
}), v.object({
"code": v.literal("budget_used"),
}), v.object({
"code": v.literal("wrong_property"),
}), v.object({
"code": v.literal("stay_outside_dates"),
"stayFrom": v.optional(v.string()),
"stayTo": v.optional(v.string()),
}), v.object({
"code": v.literal("min_nights"),
"minNights": v.number(),
"missingNights": v.number(),
}), v.object({
"code": v.literal("min_subtotal"),
"minEligibleSubtotal": v.number(),
"eligibleSubtotal": v.number(),
}), v.object({
"code": v.literal("nothing_eligible"),
}))),
"directDiscount": v.number(),
"couponDiscount": v.number(),
"capped": v.boolean(),
"discount": v.number(),
"total": v.number(),
"allocation": v.array(v.object({
"lineId": v.string(),
"discount": v.number(),
})),
});

export const reportNoteCouponRefusalResult = v.null();
