import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision } from '../../lib/bookingMoney';
import { cancelStayRecord, refundReplay } from '../private/stayCorrections';
import { loadBooking, refundInput } from '../private/stays';

/**
 * Cancels a stay. Paid money is kept unless `refund` records a refund of any part of it in the
 * same transaction; cancelling never implies a refund. `notifyGuest` defaults to no for stays that
 * started before today.
 */
export const cancelStay = adminMutation({
	args: {
		bookingId: v.id('bookings'),
		expectedRevision: v.number(),
		reason: v.optional(v.string()),
		effectiveAt: v.optional(v.number()),
		notifyGuest: v.optional(v.boolean()),
		refund: v.optional(v.object(refundInput))
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const refund = args.refund ? { ...args.refund, replayContext: JSON.stringify(['cancel', args.reason?.trim() ?? null, args.effectiveAt ?? null, args.notifyGuest ?? null]) } : undefined;
		if (refund) {
			const replay = await refundReplay(ctx, args.bookingId, refund, admin.email);
			if (replay) return { replayed: true };
		}
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision);
		if (booking.status === 'cancelled') throw new Error('This booking is already cancelled.');
		await cancelStayRecord(ctx, booking, {
			actor: admin.email, reason: args.reason, effectiveAt: args.effectiveAt, notifyGuest: args.notifyGuest, refund
		});
		return { replayed: false };
	}
});
