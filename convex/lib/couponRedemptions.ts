// Counters reserve both slots and budget in the booking transaction. Reversed uses stay counted.
import { ConvexError } from 'convex/values';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { stayMoney, type BookingPatch } from './bookingMoney';
import { evaluateOffer, type CouponProblem, type CouponRules } from './offers';
import { resortTodayIso } from './dates';

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

/** Each transition moves counters once; terminal reversals never restore capacity or budget. */
export async function syncCouponRedemption(ctx: MutationCtx, booking: Doc<'bookings'>): Promise<void> {
	if (!booking.promotion) return;
	const redemption = await ctx.db.get(booking.promotion.redemptionId);
	if (!redemption) throw new Error('Booking redemption not found');
	if (redemption.state === 'reversed') return;
	const coupon = await ctx.db.get(redemption.couponId);
	if (!coupon) throw new Error('Redemption coupon not found');
	const money = stayMoney(booking);
	const paid = money.gross > 0;
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
		// Honour the frozen quote on unpaid reopen too: never silently raise its price.
		// A full coupon/budget is visible to admins as an overLimit held row.
		overLimit = availability(coupon, rules, redemption.discount) ? true : undefined;
		state = 'held';
		held++;
		heldDiscount += redemption.discount;
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
		await ctx.db.patch(coupon._id, { held, heldDiscount, used, discountGranted });
	}
	await ctx.db.patch(redemption._id, { state, overLimit, updatedAt: Date.now() });
}

/** Requote an existing promotion against its immutable rules, excluding its own budget reservation. */
export async function repriceCouponBooking(ctx: MutationCtx, booking: Doc<'bookings'>, property: Doc<'properties'>, stay: { checkIn: string; checkOut: string; nights: number }): Promise<BookingPatch> {
	const promotion = booking.promotion;
	if (!promotion) return {};
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
	if (result.couponStatus !== 'applied') {
		if (redemption.state === 'held') await ctx.db.patch(coupon._id, { held: (coupon.held ?? 0) - 1, heldDiscount: (coupon.heldDiscount ?? 0) - redemption.discount });
		await ctx.db.patch(redemption._id, { state: redemption.state === 'held' || redemption.state === 'released' ? 'released' : 'reversed', updatedAt: Date.now() });
		return { subtotal: result.subtotal, discountAmount: result.discount, total: result.total, currency: property.currency, promotion: undefined };
	}
	const delta = result.discount - redemption.discount;
	if (delta !== 0) {
		if (redemption.state === 'held') await ctx.db.patch(coupon._id, { heldDiscount: (coupon.heldDiscount ?? 0) + delta });
		else if (counted) await ctx.db.patch(coupon._id, { discountGranted: coupon.discountGranted + delta });
		await ctx.db.patch(redemption._id, { discount: result.discount, updatedAt: Date.now() });
	}
	return { subtotal: result.subtotal, discountAmount: result.discount, total: result.total, currency: property.currency, promotion: { ...promotion, discount: result.discount } };
}
