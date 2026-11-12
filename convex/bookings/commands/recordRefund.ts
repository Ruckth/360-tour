import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision, assertNoLiveCheckout } from '../../lib/bookingMoney';
import { recordStayRefund, refundReplay } from '../../lib/stayCorrections';
import { loadBooking, refundInput } from '../model';

/**
 * Records a refund given back to the guest. Recording moves no money. A live stay refunds only
 * what exceeds its price (a credit, e.g. after it was shortened), so it can't be charged again;
 * a cancelled stay can refund any part of what it kept. Duplicates (same key), overrefunds, other
 * currencies and payments of other bookings are refused.
 */
export const recordRefund = adminMutation({
	args: { bookingId: v.id('bookings'), expectedRevision: v.number(), ...refundInput },
	handler: async (ctx, { bookingId, expectedRevision, ...input }) => {
		const admin = ctx.admin;
		const replay = await refundReplay(ctx, bookingId, input, admin.email);
		if (replay) return { refundId: replay._id, replayed: true };
		const booking = await loadBooking(ctx, bookingId);
		assertBookingRevision(booking, expectedRevision);
		assertNoLiveCheckout(booking);
		const { refundId } = await recordStayRefund(ctx, booking, input, admin.email);
		return { refundId, replayed: false };
	}
});
