import { ConvexError } from 'convex/values';
import type { Doc } from '../_generated/dataModel';
import { MAX_ORDER, bookingBalance, roundMoney } from './orderMath';

export type Booking = Doc<'bookings'>;

/** A money amount: finite, more than zero, whole satang and within the till limit. */
export function assertMoney(amount: number, label = 'Amount') {
	if (!Number.isFinite(amount) || amount <= 0) throw new ConvexError(`${label} must be more than zero`);
	if (roundMoney(amount) !== amount) throw new ConvexError(`${label} is in whole satang (at most 2 decimals)`);
	if (amount > MAX_ORDER) throw new ConvexError(`${label} is at most ${(MAX_ORDER / 100).toLocaleString('en-US')}`);
}

/** Money on the stay, net of refunds (see orderMath.bookingBalance). */
export function stayMoney(booking: Booking) {
	const { paid, owed, gross, refunded } = bookingBalance(booking);
	const cancelled = booking.status === 'cancelled';
	// A live stay only refunds what exceeds its price, so a refund never reopens a balance; to give
	// back more, correct the price or cancel first. A cancelled stay can refund everything kept.
	const refundable = booking.paymentStatus === 'refunded' ? 0 : cancelled ? paid : Math.max(0, roundMoney(-owed));
	return {
		total: booking.total,
		currency: booking.currency,
		gross,
		refunded,
		net: paid,
		owed: Math.max(0, owed),
		credit: Math.max(0, roundMoney(-owed)),
		refundable,
		refundContext: cancelled ? ('cancellation' as const) : ('credit' as const)
	};
}
