import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, cleanReason, recordAppointmentChange } from '../private/appointmentChanges';
import { assertStaffFree, historicalWarnings } from '../private/serviceSlots';
import { loadAppointment } from '../private/administration';

/** Deliberate correction, separate from the frictionless forward operational buttons. */
export const correctAppointmentStatus = adminMutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), status: v.union(v.literal('booked'), v.literal('arrived'), v.literal('in_service'), v.literal('completed'), v.literal('cancelled'), v.literal('no_show')), reason: v.optional(v.string()), effectiveAt: v.number() },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (appointment.status === args.status) throw new Error('Choose a different status');
		const reason = cleanReason(args.reason);
		if (['completed', 'cancelled', 'no_show', 'in_service'].includes(appointment.status) && !reason) throw new Error('Explain why the recorded status was mistaken');
		if (!Number.isSafeInteger(args.effectiveAt) || args.effectiveAt > Date.now()) throw new Error('Effective time must be an actual past or current time');
		if (args.status === 'no_show' && appointment.start > args.effectiveAt) throw new Error('No-show can only be marked after the start time');
		const nextBlocks = args.status !== 'cancelled' && args.status !== 'no_show';
		let warnings: string[] = [];
		if (nextBlocks) {
			const person = await ctx.db.get(appointment.staffId);
			if (!person) throw new Error('Staff member not found');
			if (appointment.blockedUntil > Date.now()) {
				// Real current/future occupancy is never overridable.
				await assertStaffFree(ctx, person, appointment.start, appointment.blockedUntil, appointment._id);
			} else {
				const service = await ctx.db.get(appointment.serviceId);
				if (!service) throw new Error('Service not found');
				const review = await historicalWarnings(ctx, person, service, appointment.start, appointment.blockedUntil, appointment._id);
				warnings = review.warnings;
				if (review.needsReason && !reason) throw new Error('Explain the historical appointment overlap before saving');
			}
		}
		await recordAppointmentChange(ctx, appointment, { status: args.status,
			cancelledAt: args.status === 'cancelled' ? args.effectiveAt : undefined,
			cancelledBy: args.status === 'cancelled' ? admin.email : undefined,
			cancellationReason: args.status === 'cancelled' ? reason : undefined
		}, { actor: admin.email, kind: 'status', reason, effectiveAt: args.effectiveAt, warnings });
	}
});
