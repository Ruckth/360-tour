import { v } from 'convex/values';
import { adminMutation } from '../../auth/model';
import { assertFresh, recordAppointmentChange } from '../private/appointmentChanges';
import { canEditTurnaround, turnaroundMinutes, turnaroundProblem, withTurnaround } from '../../lib/appointmentWindow';
import { staffBusyRanges } from '../private/serviceSlots';
import { MINUTE, loadAppointment } from '../private/administration';

/** This appointment's turnaround only; the service default is untouched. */
export const updateAppointmentTurnaround = adminMutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), turnaroundMin: v.number() },
	handler: async (ctx, args) => {
		const admin = ctx.admin;
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (!canEditTurnaround(appointment)) throw new Error('Turnaround can only change while the appointment is booked, arrived or in service');
		const problem = turnaroundProblem(args.turnaroundMin, (appointment.end - appointment.start) / MINUTE);
		if (problem) throw new Error(problem);
		if (args.turnaroundMin === turnaroundMinutes(appointment)) throw new Error('Nothing to change: choose another turnaround');
		const window = withTurnaround(appointment, args.turnaroundMin);
		if (window.blockedUntil > appointment.blockedUntil) {
			const staff = await ctx.db.get(appointment.staffId);
			if (!staff || (await staffBusyRanges(ctx, staff, appointment.blockedUntil, window.blockedUntil, appointment._id)).length) {
				throw new Error(`${staff?.name ?? 'The staff member'} isn't free for the longer turnaround: it would overlap another booking, a break, time off or the end of their shift`);
			}
		}
		await recordAppointmentChange(ctx, appointment, { blockedUntil: window.blockedUntil }, { actor: admin.email, kind: 'turnaround' });
	}
});
