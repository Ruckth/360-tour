import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { queueBookingEmails } from '../model';

export const resendBookingEmails = adminMutation({
	args: { bookingId: v.id('bookings') },
	handler: async (ctx, args) => {
		const booking = await ctx.db.get(args.bookingId);
		if (!booking || booking.status !== 'confirmed') throw new Error('Only confirmed bookings can be emailed');
		await queueBookingEmails(ctx, booking, true);
	}
});
