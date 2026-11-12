import { v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { deleteBlocker, deleteBookingRecord, MAX_BATCH_DELETE, recordsBlocker } from '../model';

/** Batch delete with the same rules as `deleteBooking`; bookings that can't go are skipped with a reason. */
export const deleteBookings = adminMutation({
	args: { bookingIds: v.array(v.id('bookings')) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		if (args.bookingIds.length > MAX_BATCH_DELETE) {
			throw new Error(`Delete at most ${MAX_BATCH_DELETE} bookings at a time.`);
		}
		const now = Date.now();
		let deleted = 0;
		const skipped: Array<{ bookingId: Id<'bookings'>; reason: string }> = [];
		for (const bookingId of new Set(args.bookingIds)) {
			const booking = await ctx.db.get(bookingId);
			const blocker = booking ? deleteBlocker(booking, now) ?? (await recordsBlocker(ctx, booking)) : 'Booking not found';
			if (!booking || blocker) {
				skipped.push({ bookingId, reason: blocker ?? 'Booking not found' });
				continue;
			}
			await deleteBookingRecord(ctx, booking, admin.email);
			deleted++;
		}
		return { deleted, skipped };
	}
});
