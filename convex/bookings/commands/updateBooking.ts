import { resortTodayIso } from '../../shared/time';
import { appendBookingHistory } from '../private/money';
import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision, bookingRevision } from '../../shared/bookingMoney';
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

/** Desk observations are recorded separately from availability, billing and guest access. */
export const recordStayStatus = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		expectedRevision: v.number(),
		status: v.union(v.literal('checked_in'), v.literal('checked_out')),
		reason: v.optional(v.string())
	},
	handler: async (ctx, { bookingId, expectedRevision, status, reason }) => {
		const booking = await loadBooking(ctx, bookingId);
		if (booking.status !== 'confirmed') throw new Error('Only confirmed bookings can record a stay status.');
		const revision = bookingRevision(booking);
		if (booking.stayStatus === status && revision === expectedRevision + 1) return;
		assertBookingRevision(booking, expectedRevision);
		if (booking.stayStatus === status) return;

		const today = resortTodayIso();
		const requiresReason = status === 'checked_in'
			? booking.stayStatus === 'checked_out' || today !== booking.checkIn
			: booking.stayStatus !== 'checked_in' || today !== booking.checkOut;
		const note = reason?.trim();
		if (requiresReason && !note) throw new Error('Enter a reason for an early, late or out-of-order transition.');
		if (note && note.length > 500) throw new Error('Use at most 500 characters for the reason.');
		await ctx.db.patch(bookingId, { stayStatus: status, revision: revision + 1 });
		await appendBookingHistory(ctx, bookingId, {
			kind: 'stay_status_changed', actor: ctx.admin.email, reason: note, effectiveAt: Date.now(),
			before: { stayStatus: booking.stayStatus ?? null }, after: { stayStatus: status }
		});
	}
});
