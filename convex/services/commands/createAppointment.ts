import { v } from 'convex/values';
import { adminMutation, canAccessResortDesk } from '../../auth/model';
import { recordRebooked } from '../private/appointmentChanges';
import { canBookAgain } from '../../shared/appointmentWindow';
import { createAppointmentRecord } from '../private/serviceSlots';
import { stayAttachProblem } from '../../bookings/model';
import { resortLocalParts } from '../../shared/time';

export const createAppointment = adminMutation({
	args: {
		serviceId: v.id('services'), durationMin: v.optional(v.number()), start: v.number(), staffId: v.optional(v.id('staff')), guestName: v.string(), guestPhone: v.string(),
		expectedPrice: v.optional(v.number()),
		guestEmail: v.optional(v.string()), bookingId: v.optional(v.id('bookings')), chatSessionId: v.optional(v.id('conversations')),
		rebookedFromId: v.optional(v.id('appointments')), historicalReason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const original = args.rebookedFromId ? await ctx.db.get(args.rebookedFromId) : null;
		if (args.rebookedFromId && (!original || !canBookAgain(original))) throw new Error('Only cancelled or no-show appointments can be booked again');
		// D19: an attached stay is checked in this transaction (exists, not cancelled, covers the appointment date).
		// Stays belong to the resort branch: an actor without resort desk access cannot attach one by ID, and
		// gets the same answer as for a missing stay.
		if (args.bookingId) {
			const booking = (await canAccessResortDesk(ctx, 'bookings')) ? await ctx.db.get(args.bookingId) : null;
			const problem = stayAttachProblem(booking, resortLocalParts(args.start).date);
			if (problem) throw new Error(problem);
		}
		const created = await createAppointmentRecord(ctx, { ...args, source: 'admin', actor: admin.email }, { kind: 'admin_historical', reason: args.historicalReason });
		if (original) await recordRebooked(ctx, original, created.confirmationCode, admin.email);
		return created;
	}
});
