import { addDays as nextLocalDate, weekdayOf } from './dates';
import type { Doc } from '../_generated/dataModel';
import type { DayPlan } from './serviceScheduleTypes';
import { assertValidIsoDate } from './validation';
import { resortDateTime } from './time';


export type Range = [start: number, end: number];

/** Local "HH:mm"; "24:00" is allowed so shifts and breaks can end at midnight. */
export function assertValidTime(time: string): void {
	if (!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(time)) throw new Error('Time must be HH:mm');
}

export function localDateTimeUtc(date: string, time: string): number {
	assertValidIsoDate(date, 'Date');
	assertValidTime(time);
	return resortDateTime(date, time);
}

export function localDayRange(date: string): Range {
	return [localDateTimeUtc(date, '00:00'), localDateTimeUtc(nextLocalDate(date), '00:00')];
}

export function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
	const merged: Range[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
		else merged.push([...range]);
	}
	return merged;
}

type Pattern = Pick<Doc<'staff'>, 'workingHours' | 'breaks'>;

const byStart = (a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start);

/** The weekly pattern's plan for a date. */
export function patternDay(staff: Pattern, date: string): DayPlan {
	const weekday = weekdayOf(date);
	return {
		shifts: staff.workingHours.filter((h) => h.weekday === weekday).map(({ start, end }) => ({ start, end })).sort(byStart),
		breaks: staff.breaks.filter((b) => b.weekday === weekday).map(({ start, end, label }) => ({ start, end, label })).sort(byStart)
	};
}

/** The plan in force on a date: the override row if there is one, otherwise the weekly pattern. */
export function effectivePlan(staff: Pattern, date: string, override: Doc<'staffDays'> | null | undefined): DayPlan {
	if (!override) return patternDay(staff, date);
	return { shifts: override.shifts, breaks: override.breaks, ...(override.note ? { note: override.note } : {}) };
}

/** Working time for a plan on a date, as absolute ranges. */
export function planWorking(date: string, plan: DayPlan): Range[] {
	return mergeRanges(plan.shifts.map((s): Range => [localDateTimeUtc(date, s.start), localDateTimeUtc(date, s.end)]));
}

/** Unavailable time within a date's local day: the gaps around shifts, plus breaks. */
export function planBusy(date: string, plan: DayPlan): Range[] {
	const [dayStart, dayEnd] = localDayRange(date);
	const busy: Range[] = [];
	let cursor = dayStart;
	for (const [start, end] of planWorking(date, plan)) {
		if (start > cursor) busy.push([cursor, start]);
		cursor = Math.max(cursor, end);
	}
	if (cursor < dayEnd) busy.push([cursor, dayEnd]);
	busy.push(...plan.breaks.map((b): Range => [localDateTimeUtc(date, b.start), localDateTimeUtc(date, b.end)]));
	return mergeRanges(busy);
}

/** True when part of [start, end) on this date falls outside the plan's working time. */
export function planUncovers(date: string, plan: DayPlan, start: number, end: number): boolean {
	return planBusy(date, plan).some(([a, b]) => start < b && end > a);
}

export function blocksTime(appointment: Doc<'appointments'>): boolean {
	return appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}
