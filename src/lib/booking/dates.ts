import { dateToIso, isoToDate } from "@/lib/dates/values";
import { formatPickerDate } from "@/lib/dates/format";
export { dateToIso, isoToDate, todayIsoLocal } from "@/lib/dates/values";

export function nightsBetweenIso(checkIn: string, checkOut: string): number {
  if (!checkIn || !checkOut) return 0;
  const start = isoToDate(checkIn);
  const end = isoToDate(checkOut);
  if (!start || !end) return 0;
  return Math.max(
    0,
    Math.floor(
      (Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()) -
        Date.UTC(start.getFullYear(), start.getMonth(), start.getDate())) /
        86400000,
    ),
  );
}

export function addDaysIso(value: string, days: number): string {
  const date = isoToDate(value);
  if (!date) return "";
  date.setDate(date.getDate() + days);
  return dateToIso(date);
}

export function rangeIntersectsDates(
  blockedDates: string[],
  checkIn: string,
  checkOut: string,
): boolean {
  if (!checkIn || !checkOut) return false;
  return blockedDates.some((date) => date >= checkIn && date < checkOut);
}

export function isDateInIsoList(date: Date, dates: Set<string>): boolean {
  return dates.has(dateToIso(date));
}

export function formatDisplayDate(iso: string): string {
  return formatPickerDate(iso);
}
