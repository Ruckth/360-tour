import { tz } from "@date-fns/tz";
import { format } from "date-fns";

/**
 * How the admin shows a moment: "14 Nov, 13:07", "14 Nov" and "13:07", always in resort
 * (Bangkok) time, whatever the device's zone. The year is added only when it isn't the current
 * year in Bangkok: "28 Dec 2025, 09:30". Guest-facing text, the printed receipt and exports keep
 * their own formats; date inputs keep theirs.
 */
export const RESORT_ZONE = "Asia/Bangkok";

const IN_RESORT = { in: tz(RESORT_ZONE) };
const inResort = (ms: number, pattern: string) => format(ms, pattern, IN_RESORT);
const sameYear = (ms: number, now: number) => inResort(ms, "yyyy") === inResort(now, "yyyy");

type DateOptions = {
  /** "Mon 14 Nov": for schedules, where the day of the week matters. */
  weekday?: boolean;
  /** "Now" for the year rule; tests pass it. */
  now?: number;
};

/** "14 Nov", "Mon 14 Nov", or "14 Nov 2025" outside the current year. */
export function staffDate(ms: number, { weekday = false, now = Date.now() }: DateOptions = {}) {
  const day = `${weekday ? "EEE " : ""}d MMM`;
  return inResort(ms, sameYear(ms, now) ? day : `${day} yyyy`);
}

/** "13:07", 24-hour. */
export const staffTime = (ms: number) => inResort(ms, "HH:mm");

/** "14 Nov, 13:07", or "28 Dec 2025, 09:30" outside the current year. */
export function staffDateTime(ms: number, options: DateOptions = {}) {
  return `${staffDate(ms, options)}, ${staffTime(ms)}`;
}

/**
 * The admin calendars' date-fns formats in the same style: a 24-hour clock and day before
 * month ("Saturday 14 November 2026"). Pass as `i18n.formats`.
 */
export const STAFF_CALENDAR_FORMATS = {
  dayTitle: "EEEE d MMMM yyyy",
  agendaDayHeader: "EEEE d MMMM",
  moreDayHeader: "EEEE d MMMM",
  timeGutter: "HH:mm",
  timeGutterMinute: "HH:mm",
  eventTime: "HH:mm",
};
