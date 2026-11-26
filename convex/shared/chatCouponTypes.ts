import { v, type Infer } from 'convex/values';

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

export type ChatCouponSnapshot = Infer<typeof chatCouponValidator>;
