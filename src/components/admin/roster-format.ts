import { resortMidnight } from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";

/** "Mon 14 Nov" for a resort date. */
export const fullDay = { format: (iso: string) => staffDate(resortMidnight(iso), { weekday: true }) };

export function weekRange(start: string, end: string) {
  return `${staffDate(resortMidnight(start))} – ${staffDate(resortMidnight(end))}`;
}

export const cellKey = (staffId: string, date: string) => `${staffId}|${date}`;
export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
