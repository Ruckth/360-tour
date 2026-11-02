import { isoToDate, isTimeValue } from "@/lib/dates/values";
import {
  resortDateTime,
  resortIsoDate,
  resortTime24,
} from "@/lib/staff-bookings";

export const paymentDateInput = (at: number) =>
  `${resortIsoDate(at)}T${resortTime24(at)}`;
export function paymentDateValue(input: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const [day, time] = input.split("T");
  if (!isoToDate(day) || !isTimeValue(time)) return null;
  const at = resortDateTime(day, time);
  return Number.isFinite(at) ? at : null;
}
