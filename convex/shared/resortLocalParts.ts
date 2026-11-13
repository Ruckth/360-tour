import { RESORT_OFFSET_MS } from '../lib/dates';

export const RESORT_OFFSET = RESORT_OFFSET_MS;

export function resortLocalParts(instant: number): { date: string; time: string; weekday: number } {
	const local = new Date(instant + RESORT_OFFSET);
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		date: local.toISOString().slice(0, 10),
		time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
		weekday: local.getUTCDay()
	};
}
