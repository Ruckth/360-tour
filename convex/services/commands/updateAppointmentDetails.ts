import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, recordAppointmentChange } from '../private/appointmentChanges';
import { guestDetails } from '../private/serviceSlots';
import { loadAppointment, serviceChange } from '../private/administration';

/** Guest details, notes and optionally the service, validated together and saved in one write. */
export const updateAppointmentDetails = adminMutation({
	args: {
		appointmentId: v.id('appointments'), expectedRevision: v.number(), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), notes: v.optional(v.string()), serviceId: v.optional(v.id('services')),
		expectedService: v.optional(v.object({ durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string() }))
	},
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		const details = guestDetails(args, { requireContact: appointment.source !== 'admin' || Boolean(appointment.chatSessionId) });
		const newServiceId = args.serviceId !== undefined && args.serviceId !== appointment.serviceId ? args.serviceId : null;
		const service = newServiceId ? await serviceChange(ctx, appointment, newServiceId, args.expectedService) : {};
		await recordAppointmentChange(ctx, appointment, { ...details, ...service }, { actor: admin.email, kind: newServiceId ? 'service' : 'details' });
	}
});
