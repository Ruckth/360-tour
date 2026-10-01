import type { Doc } from '../_generated/dataModel';

/**
 * Pure appointment timing rules shared by the Convex mutations and the admin calendar.
 * An appointment occupies its staff member from `start` to `blockedUntil`: the service
 * (`start`–`end`) and then its own turnaround (`end`–`blockedUntil`).
 */

const MINUTE = 60_000;
export const TURNAROUND_STEP_MIN = 5;

type Window = Pick<Doc<'serviceAppointments'>, 'start' | 'end' | 'blockedUntil'>;
type Lifecycle = Pick<Doc<'serviceAppointments'>, 'status' | 'start'>;

export const appointmentRevision = (appointment: Pick<Doc<'serviceAppointments'>, 'revision'>) => appointment.revision ?? 0;

export const turnaroundMinutes = (appointment: Window) => Math.round((appointment.blockedUntil - appointment.end) / MINUTE);

/** The same service length and turnaround, starting at `start`. */
export function movedWindow(appointment: Window, start: number): Window {
	const end = start + (appointment.end - appointment.start);
	return { start, end, blockedUntil: end + (appointment.blockedUntil - appointment.end) };
}

/** The same service, with a different turnaround after it. */
export function withTurnaround(appointment: Window, turnaroundMin: number): Window {
	return { start: appointment.start, end: appointment.end, blockedUntil: appointment.end + turnaroundMin * MINUTE };
}

/** Why a turnaround can't be used with a service of this length, or null. */
export function turnaroundProblem(turnaroundMin: number, durationMin: number): string | null {
	if (!Number.isInteger(turnaroundMin) || turnaroundMin < 0 || turnaroundMin % TURNAROUND_STEP_MIN !== 0) {
		return `Turnaround must be a nonnegative multiple of ${TURNAROUND_STEP_MIN} minutes`;
	}
	if (durationMin + turnaroundMin > 1440) return 'Duration and turnaround cannot exceed 24 hours';
	return null;
}

/** Only upcoming booked appointments move; arrived or running ones need a separate operational flow. */
export const canReschedule = (appointment: Lifecycle, now: number) => appointment.status === 'booked' && appointment.start > now;

/** Turnaround still matters while the appointment holds the staff member's time. */
export const canEditTurnaround = (appointment: Lifecycle) =>
	appointment.status === 'booked' || appointment.status === 'arrived' || appointment.status === 'in_service';

export const canBookAgain = (appointment: Lifecycle) => appointment.status === 'cancelled' || appointment.status === 'no_show';
