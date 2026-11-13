/**
 * Asia/Bangkok is UTC+7 with no DST. Use fixed arithmetic: zone-aware helpers returned
 * UTC clock times in the Convex production runtime.
 */
export const RESORT_OFFSET_MS = 7 * 60 * 60_000;

/** The resort's calendar date (Asia/Bangkok), not the UTC date, for "today" rules. */
export function resortTodayIso(now = Date.now()): string {
	return new Date(now + RESORT_OFFSET_MS).toISOString().slice(0, 10);
}

export const DAY_MS = 86_400_000;

export function resortLocalParts(instant: number): { date: string; time: string; weekday: number } {
	const local = new Date(instant + RESORT_OFFSET_MS);
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		date: local.toISOString().slice(0, 10),
		time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
		weekday: local.getUTCDay()
	};
}

/** Date/time input interpreted on the resort clock; never the browser clock. */
export const resortDateTime = (date: string, time: string) => Date.parse(`${date}T${time}:00Z`) - RESORT_OFFSET_MS;
export const resortMidnight = (date: string) => resortDateTime(date, '00:00');
export const resortTime24 = (instant: number) => resortLocalParts(instant).time;
