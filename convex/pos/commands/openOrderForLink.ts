import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { oneSource } from '../private/orderModel';
import { openSourceOrder } from '../private/sourceModel';

/** URL source IDs are untrusted; preserve the typed action above for internal UI callers. */
export const openOrderForLink = staffMutation({
  capability: 'checkout',
	args: { bookingId: v.optional(v.string()), appointmentId: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		if (Boolean(args.bookingId) === Boolean(args.appointmentId)) throw new ConvexError('Choose one booking or appointment');
		const bookingId = args.bookingId ? ctx.db.normalizeId('bookings', args.bookingId) : null;
		const appointmentId = args.appointmentId ? ctx.db.normalizeId('appointments', args.appointmentId) : null;
		if (args.bookingId && !bookingId) throw new ConvexError('Booking not found. Start a new order or choose one from Orders.');
		if (args.appointmentId && !appointmentId) throw new ConvexError('Appointment not found. Start a new order or choose one from Orders.');
		const source = oneSource({ bookingId: bookingId ?? undefined, appointmentId: appointmentId ?? undefined });
		return await openSourceOrder(ctx, source, admin);
	}
});
