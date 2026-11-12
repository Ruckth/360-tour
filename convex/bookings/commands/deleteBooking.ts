import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision } from '../../lib/bookingMoney';
import { deleteBlocker, deleteBookingRecord, loadBooking, recordsBlocker } from '../model';

/** Removes a test or mistaken booking. Anything that involved money must be cancelled instead. */
export const deleteBooking = adminMutation({
	args: { bookingId: v.id('bookings'), expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision, false);
		const blocker = deleteBlocker(booking, Date.now());
		if (blocker) throw new Error(blocker);
		const recordsBlock = await recordsBlocker(ctx, booking);
		if (recordsBlock) throw new Error(recordsBlock);
		await deleteBookingRecord(ctx, booking, admin.email);
	}
});
