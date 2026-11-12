import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertBookingRevision, writeBooking } from '../../lib/bookingMoney';
import { loadBooking } from '../model';

export const updateNotes = adminMutation({
	args: { bookingId: v.id('bookings'), notes: v.string(), expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const booking = await loadBooking(ctx, args.bookingId);
		assertBookingRevision(booking, args.expectedRevision, false);
		const notes = args.notes.trim();
		if (notes.length > 2000) throw new Error('Notes are limited to 2,000 characters.');
		if ((notes || undefined) === booking.adminNotes) return;
		await writeBooking(ctx, booking, { adminNotes: notes || undefined }, { actor: admin.email, kind: 'notes' });
	}
});
