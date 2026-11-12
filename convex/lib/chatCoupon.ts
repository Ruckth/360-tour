import { guestCouponFromHistory } from './guestCouponCode';
import { v, type Infer } from 'convex/values';
import type { QueryCtx, MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { evaluateOffer, normalizeCouponCode, type OfferResult } from './offers';
import { couponVersion } from './couponRedemptions';
import { resortTodayIso } from './dates';
import { quoteBookableStay, type StayInput } from './bookingWrites';

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

/** Latest explicit guest choice, with withdrawals and replacements applied in transcript order. */
export async function activeGuestCoupon(ctx: QueryCtx | MutationCtx, sessionId: Id<'conversations'>) {
  const messages = await ctx.db.query('messages').withIndex('by_session', q => q.eq('sessionId', sessionId)).order('desc').take(100);
  return guestCouponFromHistory(messages.reverse().filter(message => message.role === 'user').map(message => message.content));
}

/** A model may repeat the guest's current code, never choose one from the catalog or stale history. */
export async function assertGuestSuppliedCoupon(ctx: QueryCtx | MutationCtx, sessionId: Id<'conversations'>, code: string) {
  if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new Error('Ask the guest for a valid coupon code.');
  if (await activeGuestCoupon(ctx, sessionId) !== code) {
    throw new Error('Only a coupon code supplied by this guest can be quoted. Ask the guest for their code.');
  }
}

/** Uses the same offer engine, live rules, counters and accommodation basis as checkout. */
export async function quoteChatStay(ctx: QueryCtx | MutationCtx, input: StayInput & { couponCode?: string }) {
  const stay = await quoteBookableStay(ctx, input);
  const code = normalizeCouponCode(input.couponCode ?? '');
  const coupon = code ? await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique() : null;
  const rules = coupon ? await couponVersion(ctx, coupon._id, coupon.currentVersion) : null;
  let offer: OfferResult = evaluateOffer({
    lines: [{ id: 'accommodation', kind: 'accommodation', propertySlug: stay.property.slug,
      checkIn: input.checkIn, checkOut: input.checkOut, nights: stay.nights, amount: stay.quote.subtotal }],
    directDiscountPercent: stay.property.directDiscountPercent, today: resortTodayIso(),
    ...(coupon && rules ? { coupon: { ...rules, code: coupon.code, version: coupon.currentVersion,
      status: coupon.status, used: coupon.used, held: coupon.held, discountGranted: coupon.discountGranted, heldDiscount: coupon.heldDiscount } } : {})
  });
  if (code && !coupon) offer = { ...offer, couponStatus: 'invalid', problem: { code: 'not_found' } };
  return { ...stay, offer, coupon: code ? {
    code, ...(coupon ? { couponId: coupon._id, version: coupon.currentVersion } : {}),
    status: offer.couponStatus === 'none' ? 'invalid' as const : offer.couponStatus,
    discount: offer.couponDiscount, capped: offer.capped, ...(offer.problem ? { problem: offer.problem } : {})
  } : undefined };
}

export function couponSnapshotIdentity(coupon: ChatCouponSnapshot | undefined) {
  if (!coupon) return '';
  return JSON.stringify([coupon.code, coupon.couponId, coupon.version, coupon.status, coupon.discount, coupon.capped,
    coupon.problem ? Object.entries(coupon.problem).sort(([a], [b]) => a.localeCompare(b)) : null]);
}
