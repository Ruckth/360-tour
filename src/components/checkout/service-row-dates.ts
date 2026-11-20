import { resortIsoDate, resortTime24 } from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";
import type { OrderLine } from "./backend";

/** Optional schedule fields remain blank until staff chooses them. */
export function serviceScheduleValue(line: Pick<OrderLine, "schedule">): { date: string; time: string } {
  if (line.schedule) return { date: line.schedule.date ?? "", time: line.schedule.time ?? "" };
  return { date: "", time: "" };
}

/** A legacy row's start: "14:00" today, "Mon 26 Oct, 14:00" on another day this year, with the year otherwise. */
export function serviceStartLabel(startAt: number, now: number) {
  const time = resortTime24(startAt);
  const day = resortIsoDate(startAt);
  const today = resortIsoDate(now);
  if (day === today) return time;
  return `${staffDate(startAt, { weekday: true, now })}, ${time}`;
}
