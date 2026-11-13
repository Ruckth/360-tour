import { dateToIso } from "@/lib/dates/values";
import { formatPickerDate } from "@/lib/dates/format";
export { dateToIso, isoToDate } from "@/lib/dates/values";

export { nightsBetweenIso, addDaysIso, rangeIntersectsDates } from 'convex/shared/dates';

export function isDateInIsoList(date: Date, dates: Set<string>): boolean {
  return dates.has(dateToIso(date));
}

export function formatDisplayDate(iso: string): string {
  return formatPickerDate(iso);
}
