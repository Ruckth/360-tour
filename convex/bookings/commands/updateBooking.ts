import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision } from '../../shared/bookingMoney';
import { assertNotOnOpenOrder } from '../../pos/model';
import { cancelStayRecord } from '../private/stayCorrections';
import { confirmStay, loadBooking, markBookingPaid } from '../private/stays';

export const updateBooking = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		action: v.union(v.literal('confirm'), v.literal('cancel'), v.literal('markPaid')),
		expectedRevision: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision, false);

		if (args.action === 'cancel') {
			await cancelStayRecord(ctx, booking, {
				actor: admin.email, reason: args.reason, notifyGuest: args.notifyGuest
			});
			return;
		}

		if (booking.status === 'cancelled') throw new Error('This booking was cancelled.');

		if (args.action === 'markPaid') {
			// Paying it here while checkout is charging it on an open order would collect it twice.
			await assertNotOnOpenOrder(ctx, { bookingId: booking._id }, 'This stay');
			await markBookingPaid(ctx, booking._id, 'admin', { actor: admin.email, notifyGuest: args.notifyGuest });
			return;
		}

		await confirmStay(ctx, booking, admin.email, args.notifyGuest);
	}
});
