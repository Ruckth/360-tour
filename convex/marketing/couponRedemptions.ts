import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { type BookingPatch } from '../lib/bookingMoney';
import { resortTodayIso } from '../lib/dates';
import { evaluateOffer, type CouponProblem, type CouponRules } from '../lib/offers';
import { roundMoney } from '../lib/orderMath';
import { stayMoney } from '../lib/stayMoney';

export type HoldInput = { coupon: Doc<'coupons'>; couponVersion: number; discount: number; bookingId: Id<'bookings'> };

export function couponUnavailable(problem: CouponProblem): never {
	const messages: Record<CouponProblem['code'], string> = {
		not_found: 'This coupon code was not found. Please check the code.',
		not_active: 'This coupon is not currently available.',
		not_started: 'This coupon is not available yet.', expired: 'This coupon has expired.',
		sold_out: 'This coupon has no uses left.', budget_used: 'This coupon has reached its discount budget.',
		wrong_property: 'This coupon does not apply to this villa.', stay_outside_dates: 'This coupon does not cover your stay dates.',
		min_nights: problem.code === 'min_nights' ? `Add ${problem.missingNights} more night${problem.missingNights === 1 ? '' : 's'} to use this offer.` : '',
		min_subtotal: 'Your stay does not meet the minimum spend for this coupon.', nothing_eligible: 'This coupon does not apply to accommodation.'
	};
	throw new ConvexError({ code: 'coupon_unavailable', message: messages[problem.code], problem });
}

export async function couponVersion(ctx: QueryCtx | MutationCtx, couponId: Id<'coupons'>, version: number) {
	const rules = await ctx.db.query('couponVersions').withIndex('by_coupon_and_version', q => q.eq('couponId', couponId).eq('version', version)).unique();
	if (!rules) throw new Error('Coupon version not found');
	return rules;
}

function availability(coupon: Doc<'coupons'>, rules: Pick<CouponRules, 'usageLimit' | 'discountBudget'>, discount: number): CouponProblem | undefined {
	if (rules.usageLimit !== undefined && coupon.used + (coupon.held ?? 0) >= rules.usageLimit) return { code: 'sold_out' };
	if (rules.discountBudget !== undefined && coupon.discountGranted + (coupon.heldDiscount ?? 0) + discount > rules.discountBudget) return { code: 'budget_used' };
}

/** Re-read inside the transaction: racing last-slot mutations conflict on the same coupon row. */
export async function holdCouponRedemption(ctx: MutationCtx, input: HoldInput): Promise<Id<'couponRedemptions'>> {
	const coupon = await ctx.db.get(input.coupon._id);
	if (!coupon) couponUnavailable({ code: 'not_found' });
	if (coupon.status !== 'active') couponUnavailable({ code: 'not_active' });
	const rules = await couponVersion(ctx, coupon._id, input.couponVersion);
	const problem = availability(coupon, rules, input.discount);
	if (problem) couponUnavailable(problem);
	const now = Date.now();
	const id = await ctx.db.insert('couponRedemptions', {
		couponId: coupon._id, couponVersion: input.couponVersion, code: coupon.code, bookingId: input.bookingId,
		state: 'held', discount: input.discount, createdAt: now, updatedAt: now
	});
	await ctx.db.patch(coupon._id, { held: (coupon.held ?? 0) + 1, heldDiscount: (coupon.heldDiscount ?? 0) + input.discount });
	return id;
}

/** Each transition moves counters once; real refunds never restore capacity or budget. */
export async function syncCouponRedemption(ctx: MutationCtx, booking: Doc<'bookings'>): Promise<void> {
	if (!booking.promotion) return;
	const redemption = await ctx.db.get(booking.promotion.redemptionId);
	if (!redemption) throw new Error('Booking redemption not found');
	const coupon = await ctx.db.get(redemption.couponId);
	if (!coupon) throw new Error('Redemption coupon not found');
	const money = stayMoney(booking);
	const paid = money.gross > 0;
	// Real refunds retain gross money and never restore capacity. A void of money never
	// received can also follow cancellation, when the ledger is already reversed.
	if (redemption.state === 'reversed' && (paid || money.refunded > 0)) return;
	// A partial refund on a live stay (goodwill, a shortened stay) keeps the use; only a cancelled or fully refunded stay reverses it.
	const reversed = booking.status === 'cancelled' || booking.paymentStatus === 'refunded' || (paid && money.net <= 0);
	let state: Doc<'couponRedemptions'>['state'] = redemption.state;
	let overLimit = redemption.overLimit;
	let held = coupon.held ?? 0;
	let heldDiscount = coupon.heldDiscount ?? 0;
	let used = coupon.used;
	let discountGranted = coupon.discountGranted;
	if (state === 'released' && (paid || booking.status !== 'cancelled')) {
		const rules = await couponVersion(ctx, coupon._id, coupon.currentVersion);
		const problem = availability(coupon, rules, redemption.discount);
		if (problem && !paid) {
			throw new ConvexError({ code: 'coupon_unavailable', message: `${redemption.code} has no uses left, so this booking can't reopen at its coupon price. Raise the coupon's limit, or create a new booking.` });
		}
		// Only actual captured money may recover an exhausted reservation.
		overLimit = problem ? true : undefined;
		state = 'held';
		held++;
		heldDiscount += redemption.discount;
	}
	if ((state === 'consumed' || state === 'reversed') && !paid && money.refunded === 0) {
		used--; discountGranted -= redemption.discount;
		held++; heldDiscount += redemption.discount;
		state = 'held';
	}
	if (state === 'held') {
		if (paid) {
			held--; heldDiscount -= redemption.discount;
			used++; discountGranted += redemption.discount;
			state = 'consumed';
		} else if (booking.status === 'cancelled') {
			held--; heldDiscount -= redemption.discount;
			state = 'released';
		}
	}
	if (state === 'consumed' && reversed) state = 'reversed';
	if (state === redemption.state) return;
	if (held !== (coupon.held ?? 0) || heldDiscount !== (coupon.heldDiscount ?? 0) || used !== coupon.used || discountGranted !== coupon.discountGranted) {
		// Checkout uses can carry satang; round so the budget check never sees binary noise.
		await ctx.db.patch(coupon._id, { held, heldDiscount, used, discountGranted: roundMoney(discountGranted) });
	}
	await ctx.db.patch(redemption._id, { state, overLimit, updatedAt: Date.now() });
}

/** Read-only pricing plan shared by edit previews and writes; excludes its own reservation. */
export async function quoteCouponBooking(ctx: QueryCtx | MutationCtx, booking: Doc<'bookings'>, property: Doc<'properties'>, stay: { checkIn: string; checkOut: string; nights: number }) {
	const promotion = booking.promotion;
	if (!promotion) return null;
	const coupon = await ctx.db.get(promotion.couponId);
	const redemption = await ctx.db.get(promotion.redemptionId);
	if (!coupon || !redemption) throw new Error('Booking redemption not found');
	const rules = await couponVersion(ctx, coupon._id, promotion.couponVersion);
	const counted = redemption.state !== 'released';
	const result = evaluateOffer({
		lines: [{ id: 'accommodation', kind: 'accommodation', propertySlug: property.slug, ...stay, amount: property.pricePerNight * stay.nights }],
		directDiscountPercent: property.directDiscountPercent,
		// Booking-window rules apply to the original booking date, not the date staff correct it.
		today: resortTodayIso(booking.createdAt),
		coupon: { ...rules, code: promotion.code, version: promotion.couponVersion, status: 'active', usageLimit: undefined,
			used: coupon.used, held: coupon.held, discountGranted: coupon.discountGranted - (counted && redemption.state !== 'held' ? redemption.discount : 0),
			heldDiscount: (coupon.heldDiscount ?? 0) - (redemption.state === 'held' ? redemption.discount : 0) }
	});
	const pricing: BookingPatch = {
		subtotal: result.subtotal, discountAmount: result.discount, total: result.total, currency: property.currency,
		promotion: result.couponStatus === 'applied' ? { ...promotion, discount: result.discount } : undefined
	};
	return { coupon, redemption, pricing };
}

type CouponBookingQuote = NonNullable<Awaited<ReturnType<typeof quoteCouponBooking>>>;

/** Apply the already evaluated plan in the edit transaction; previews never call this. */
export async function repriceCouponBooking(ctx: MutationCtx, { coupon, redemption, pricing }: CouponBookingQuote): Promise<void> {
	if (!pricing.promotion) {
		if (redemption.state === 'held') await ctx.db.patch(coupon._id, { held: (coupon.held ?? 0) - 1, heldDiscount: (coupon.heldDiscount ?? 0) - redemption.discount });
		await ctx.db.patch(redemption._id, { state: redemption.state === 'held' || redemption.state === 'released' ? 'released' : 'reversed', updatedAt: Date.now() });
		return;
	}
	const delta = pricing.promotion.discount - redemption.discount;
	if (delta !== 0) {
		if (redemption.state === 'held') await ctx.db.patch(coupon._id, { heldDiscount: (coupon.heldDiscount ?? 0) + delta });
		else if (redemption.state !== 'released') await ctx.db.patch(coupon._id, { discountGranted: roundMoney(coupon.discountGranted + delta) });
		await ctx.db.patch(redemption._id, { discount: pricing.promotion.discount, updatedAt: Date.now() });
	}
}

/** POS has no holds. The caller validates the frozen quote before any money writes. */
export async function consumeOrderCoupon(ctx: MutationCtx, orderId: Id<'orders'>, promotion: NonNullable<Doc<'orders'>['promotion']>) {
	const existing = await ctx.db.query('couponRedemptions').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique();
	let redemptionId = existing?._id;
	if (!existing) {
		const coupon = await ctx.db.get(promotion.couponId);
		if (!coupon) throw new Error('Redemption coupon not found');
		const now = Date.now();
		redemptionId = await ctx.db.insert('couponRedemptions', {
			couponId: coupon._id, couponVersion: promotion.couponVersion, code: coupon.code, orderId,
			state: 'consumed', discount: promotion.discount, createdAt: now, updatedAt: now
		});
		await ctx.db.patch(coupon._id, { used: coupon.used + 1, discountGranted: roundMoney(coupon.discountGranted + promotion.discount) });
		// The receipt names the code the coupon has when it is used (it may be renamed before its first use).
		promotion = { ...promotion, code: coupon.code };
	}
	await ctx.db.patch(orderId, { promotion: { ...promotion, redemptionId } });
}

/** Real voids retain capacity; correcting money never received releases it exactly once. */
export async function syncOrderCouponRedemption(ctx: MutationCtx, orderId: Id<'orders'>, state: 'reversed' | 'released') {
	const redemption = await ctx.db.query('couponRedemptions').withIndex('by_orderId', q => q.eq('orderId', orderId)).unique();
	if (!redemption || (redemption.state !== 'consumed' && redemption.state !== 'reversed') || redemption.state === state) return;
	if (state === 'released') {
		const coupon = await ctx.db.get(redemption.couponId);
		if (!coupon) throw new Error('Redemption coupon not found');
		await ctx.db.patch(coupon._id, { used: Math.max(0, coupon.used - 1), discountGranted: Math.max(0, roundMoney(coupon.discountGranted - redemption.discount)) });
	}
	await ctx.db.patch(redemption._id, { state, updatedAt: Date.now() });
}
