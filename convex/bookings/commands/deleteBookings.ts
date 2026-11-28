import { v } from 'convex/values';
import { bookingRevision } from '../../shared/bookingMoney';
import type { Id } from '../../_generated/dataModel';
import { adminMutation } from '../../auth/model';
import { DAY_MS, deleteBlocker, deleteBookingRecord, MAX_BATCH_DELETE, recordsBlocker } from '../private/stays';

/** Batch delete with the same rules as `deleteBooking`; bookings that can't go are skipped with a reason. */
export const deleteBookings = adminMutation({
	args: {
		bookingIds: v.array(v.id('bookings')),
		review: v.optional(v.object({
			olderThanDays: v.number(),
			revisions: v.array(v.object({ bookingId: v.id('bookings'), revision: v.number() }))
		}))
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		if (args.bookingIds.length > MAX_BATCH_DELETE) {
			throw new Error(`Delete at most ${MAX_BATCH_DELETE} bookings at a time.`);
		}
		const now = Date.now();
		const review = args.review;
		if (review && (!Number.isSafeInteger(review.olderThanDays) || review.olderThanDays < 0 || review.revisions.length > MAX_BATCH_DELETE)) {
			throw new Error('Invalid cleanup review.');
		}
		const revisions = new Map(review?.revisions.map(({ bookingId, revision }) => [bookingId, revision]));
		let deleted = 0;
		const skipped: Array<{ bookingId: Id<'bookings'>; reason: string }> = [];
		for (const bookingId of new Set(args.bookingIds)) {
			const booking = await ctx.db.get(bookingId);
			if (booking && review && (revisions.get(bookingId) !== bookingRevision(booking) ||
				(booking.source !== 'admin' && booking.createdAt > now - review.olderThanDays * DAY_MS))) {
				skipped.push({ bookingId, reason: 'Booking changed since review or is outside the reviewed age filter.' });
				continue;
			}
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
