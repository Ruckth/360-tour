import { isIsoDate } from './dates';


export type ServiceSchedule = { date?: string; time?: string };

export const isScheduleDate = (value: string) => isIsoDate(value);

/** 24-hour "HH:MM". */
export const isScheduleTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);

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
