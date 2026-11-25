import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, recordAppointmentChange } from '../private/appointmentChanges';
import { guestDetails } from '../private/serviceSlots';
import { MINUTE, loadAppointment, serviceChange } from '../private/administration';

/** Guest details, notes and optionally the service, validated together and saved in one write. */
export const updateAppointmentDetails = adminMutation({
	args: {
		appointmentId: v.id('appointments'), expectedRevision: v.number(), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), notes: v.optional(v.string()), serviceId: v.optional(v.id('services')), durationMin: v.optional(v.number()),
		expectedService: v.optional(v.object({ durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string() }))
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		const details = guestDetails(args, { requireContact: appointment.source !== 'admin' || Boolean(appointment.chatSessionId) });
		const serviceId = args.serviceId ?? appointment.serviceId;
		const changingService = serviceId !== appointment.serviceId
			|| (args.durationMin !== undefined && args.durationMin !== (appointment.end - appointment.start) / MINUTE);
		const service = changingService ? await serviceChange(ctx, appointment, serviceId, args.expectedService, args.durationMin) : {};
		await recordAppointmentChange(ctx, appointment, { ...details, ...service }, { actor: admin.email, kind: changingService ? 'service' : 'details' });
	}
});
