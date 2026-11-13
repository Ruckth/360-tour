import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { recordRebooked } from '../private/appointmentChanges';
import { canBookAgain } from '../../lib/appointmentWindow';
import { createAppointmentRecord } from '../private/serviceSlots';

export const createAppointment = adminMutation({
	args: {
		serviceId: v.id('services'), start: v.number(), staffId: v.optional(v.id('staff')), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), bookingId: v.optional(v.id('bookings')), chatSessionId: v.optional(v.id('conversations')),
		rebookedFromId: v.optional(v.id('appointments')), historicalReason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const original = args.rebookedFromId ? await ctx.db.get(args.rebookedFromId) : null;
		if (args.rebookedFromId && (!original || !canBookAgain(original))) throw new Error('Only cancelled or no-show appointments can be booked again');
		const created = await createAppointmentRecord(ctx, { ...args, source: 'admin', actor: admin.email }, { kind: 'admin_historical', reason: args.historicalReason });
		if (original) await recordRebooked(ctx, original, created.confirmationCode, admin.email);
		return created;
	}
});
