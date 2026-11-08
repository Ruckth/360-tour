// Release 2 coupon redemption lifecycle. CONTRACT — implementation owned by the backend work package.
// Counters on `coupons`: held/heldDiscount (unpaid bookings) and used/discountGranted (paid).
// A slot is available when used + held < usageLimit and discountGranted + heldDiscount + discount <= discountBudget.
import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';

export type HoldInput = { coupon: Doc<'coupons'>; couponVersion: number; discount: number; bookingId: Id<'bookings'> };

/** Reserves one slot and the discount for a new booking, atomically in the caller's transaction. Throws ConvexError 'coupon_unavailable' when none is left. */
export async function holdCouponRedemption(_ctx: MutationCtx, _input: HoldInput): Promise<Id<'couponRedemptions'>> {
	throw new Error('holdCouponRedemption: not implemented');
}

/**
 * Brings the booking's redemption in line with its current state. Called by writeBooking after every write.
 * held + payment received -> consumed; held + cancelled unpaid -> released; consumed + cancelled -> reversed;
 * released + booking live again (recovered checkout) -> consumed (or held if unpaid), overLimit when the limit is now exceeded.
 */
export async function syncCouponRedemption(_ctx: MutationCtx, _booking: Doc<'bookings'>): Promise<void> {
	throw new Error('syncCouponRedemption: not implemented');
}
