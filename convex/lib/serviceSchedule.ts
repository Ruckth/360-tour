import { RESORT_OFFSET_MS, isIsoDate } from './dates';

/**
 * When a service row on an order is planned, in resort (Bangkok) wall-clock terms. Both parts are
 * optional and independent: `{}` is "not scheduled", `{ date }` a known day with the time still to
 * be set, `{ time }` a time without a day. A blank part is unset; it never means "now".
 *
 * Rows saved before this field have no `schedule`; their `startAt` keeps its legacy meaning (an
 * instant, or absent = done now). Rows with a `schedule` never have a `startAt`.
 */
export type ServiceSchedule = { date?: string; time?: string };

export const isScheduleDate = (value: string) => isIsoDate(value);

/** 24-hour "HH:MM". */
export const isScheduleTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

/** A legacy row's instant as resort date and time, so editing one part keeps the other. */
export function scheduleFromStartAt(startAt: number): ServiceSchedule {
	const local = new Date(startAt + RESORT_OFFSET_MS).toISOString();
	return { date: local.slice(0, 10), time: local.slice(11, 16) };
}

/**
 * The row's schedule after a date and/or time change. `undefined` leaves a part as it is; `null`
 * or `''` clears it. Returns the problem for an invalid value instead of guessing.
 */
export function changeSchedule(
	current: ServiceSchedule,
	change: { date?: string | null; time?: string | null }
): { schedule: ServiceSchedule } | { problem: string } {
	const next: ServiceSchedule = { ...current };
	if (change.date !== undefined) {
		const date = change.date?.trim() ?? '';
		if (!date) delete next.date;
		else if (!isScheduleDate(date)) return { problem: 'Enter the service date as YYYY-MM-DD, or leave it blank' };
		else next.date = date;
	}
	if (change.time !== undefined) {
		const time = change.time?.trim() ?? '';
		if (!time) delete next.time;
		else if (!isScheduleTime(time)) return { problem: 'Enter the service time as HH:MM (24-hour), or leave it blank' };
		else next.time = time;
	}
	return { schedule: { ...(next.date ? { date: next.date } : {}), ...(next.time ? { time: next.time } : {}) } };
}
