import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, cancelAppointmentRecord } from '../private/appointmentChanges';
import { loadAppointment } from '../private/administration';

/** Keeps the record and its payment state; frees the staff member's time. */
export const cancelAppointment = adminMutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (appointment.status !== 'booked' && appointment.status !== 'arrived') throw new Error('Appointment cannot be cancelled');
		await cancelAppointmentRecord(ctx, appointment, { actor: admin.email, reason: args.reason });
	}
});
