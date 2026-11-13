import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, cleanReason, recordAppointmentChange } from '../private/appointmentChanges';
import { canCorrectAppointmentTime, movedWindow } from '../../lib/appointmentWindow';
import { assertAppointmentStart, assertStaffFree, blocksTime, historicalWarnings } from '../private/serviceSlots';
import { loadAppointment } from '../private/administration';

/**
 * Corrects an appointment's time/staff in any status. Financial terms stay as booked.
 * Past roster gaps are logged; historical overlaps need a reason; current/future occupancy is strict.
 */
export const rescheduleAppointment = adminMutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), start: v.number(), staffId: v.id('staff'), historicalReason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (!canCorrectAppointmentTime(appointment, Date.now())) throw new Error('This appointment cannot be rescheduled');
		if (args.start === appointment.start && args.staffId === appointment.staffId) throw new Error('Nothing to change: choose another time or staff member');
		assertAppointmentStart(args.start, { kind: 'admin_historical' });
		const service = await ctx.db.get(appointment.serviceId);
		if (!service) throw new Error('Service unavailable');
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const window = movedWindow(appointment, args.start);
		const historical = window.blockedUntil <= Date.now();
		const reason = cleanReason(args.historicalReason);
		let warnings: string[] = [];
		if (historical) {
			const review = await historicalWarnings(ctx, staff, service, window.start, window.blockedUntil, appointment._id);
			warnings = review.warnings;
			if (review.needsReason && !reason) throw new Error('Explain the historical appointment overlap before saving');
		} else {
			// The existing assignment is booked truth even when the template was later archived/reassigned.
			if (args.staffId !== appointment.staffId && (!service.staffIds.includes(args.staffId) || service.status !== 'active')) throw new Error(`${staff.name} doesn't perform ${service.name}`);
			if (blocksTime(appointment)) await assertStaffFree(ctx, staff, window.start, window.blockedUntil, appointment._id);
		}
		await recordAppointmentChange(ctx, appointment, { staffId: args.staffId, staffNameSnapshot: args.staffId === appointment.staffId ? appointment.staffNameSnapshot ?? staff.name : staff.name, ...window }, { actor: admin.email, kind: 'rescheduled', reason, effectiveAt: window.start, warnings });
	}
});
