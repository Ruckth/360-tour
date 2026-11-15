import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, recordAppointmentChange } from '../private/appointmentChanges';
import { appointmentStatus, loadAppointment, transitions } from '../private/administration';

export const updateAppointmentStatus = adminMutation({
	args: { appointmentId: v.id('appointments'), status: appointmentStatus, expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		if (args.expectedRevision !== undefined) assertFresh(appointment, args.expectedRevision);
		if (!transitions[appointment.status].includes(args.status)) throw new Error('Invalid appointment status transition');
		if (args.status === 'no_show' && appointment.start > Date.now()) throw new Error('No-show can only be marked after the start time');
		await recordAppointmentChange(ctx, appointment, { status: args.status }, { actor: admin.email, kind: 'status' });
	}
});
