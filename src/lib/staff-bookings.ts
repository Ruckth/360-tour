import { resortMidnight } from 'convex/shared/time';
import { timeOffInput } from 'convex/shared/timeOff';
export { DAY_MS, resortTodayIso as resortIsoDate, resortMidnight, resortTime24, resortDateTime } from 'convex/shared/time';
export { timeOffRange, timeOffRangeProblem, pickSlot, timeOffInput, type TimeOffInput } from 'convex/shared/timeOff';
/** Presentation zone; business arithmetic lives in shared/time. */
export const RESORT_ZONE = 'Asia/Bangkok';
import { ConvexError } from "convex/values";
import { useEffect, useState } from "react";
import type { Doc } from "convex/_generated/dataModel";
import { STATUS_LABELS } from "@/components/admin/labels";
import { CALENDAR_TONE_COLORS, STATUS_TONES, statusMeta } from "@/components/admin/status-tones";

const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, weekday: "short", month: "short", day: "numeric" });
const fullDateFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, weekday: "short", month: "short", day: "numeric", year: "numeric" });
const dateTimeFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export const formatResortTime = (ms: number) => timeFormat.format(ms);
export const formatResortDate = (ms: number) => dateFormat.format(ms);
/** "Fri, Sep 25, 2026", for confirmations where the year matters. */
export const formatResortFullDate = (ms: number) => fullDateFormat.format(ms);
/** "Sep 25, 2:30 PM", for history entries. */
export const formatResortDateTime = (ms: number) => dateTimeFormat.format(ms);
/** Shown under every schedule confirmation. */
export const RESORT_ZONE_LABEL = "All times: Bangkok";

/** "Mon, Sep 28 (all day)", "Mon, Sep 28 – Wed, Sep 30" or "Mon, Sep 28, 9:00 AM – 12:00 PM". */
export function formatTimeOff(range: { start: number; end: number }) {
  const input = timeOffInput(range);
  const day = (iso: string) => formatResortDate(resortMidnight(iso));
  if (!input.startTime && !input.endTime) {
    return input.from === input.to ? `${day(input.from)} (all day)` : `${day(input.from)} – ${day(input.to)}`;
  }
  const start = `${day(input.from)}, ${formatResortTime(range.start)}`;
  const end = input.to === input.from ? formatResortTime(range.end) : `${day(input.to)}, ${formatResortTime(range.end)}`;
  return `${start} – ${end}`;
}

export type AppointmentStatus = Doc<"appointments">["status"];
export type PaymentStatus = Doc<"appointments">["paymentStatus"];

/** Keep anonymous appointments distinct without storing a placeholder as the guest's name. */
export function appointmentGuestLabel(appointment: Pick<Doc<"appointments">, "guestName" | "confirmationCode">) {
  return appointment.guestName.trim() || `Unnamed guest · ${appointment.confirmationCode}`;
}

const { unpaid, paid, refunded } = STATUS_LABELS.payment;
export const PAYMENT_LABELS: Record<PaymentStatus, string> = { unpaid, paid, refunded };

/** What the staff calendar shows for an appointment; labels and tones come from `labels.ts` / `status-tones.ts`. */
export type AppointmentDisplayStatus = AppointmentStatus | "unpaid";

/** Legend order. */
export const APPOINTMENT_STATUSES: AppointmentDisplayStatus[] = [
  "booked",
  "arrived",
  "in_service",
  "completed",
  "unpaid",
  "no_show",
  "cancelled",
];

/** Label and tone, for `<StatusBadge {...appointmentStatus(key)} />`. */
export const appointmentStatus = (key: AppointmentDisplayStatus) => statusMeta("appointment", key);

/** Calendar chip colour, the same hue as the badge. */
export const appointmentStatusColor = (key: AppointmentDisplayStatus) => CALENDAR_TONE_COLORS[STATUS_TONES.appointment[key]];

/** Completed but unpaid needs the desk's attention, so it gets its own chip. */
export function displayStatus(
  appointment: Pick<Doc<"appointments">, "status" | "paymentStatus">,
): AppointmentDisplayStatus {
  return appointment.status === "completed" && appointment.paymentStatus === "unpaid" ? "unpaid" : appointment.status;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
export const WEEKDAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

export function initials(name: string) {
  // Only words that start with a letter, so tags like "[AI-EVAL]" or "(VIP)" are skipped.
  return name
    .split(/\s+/)
    .filter((part) => /^\p{L}/u.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/** Application refusals carry public data; legacy development errors include request metadata. */
export function errorText(err: unknown, fallback: string) {
  // A ConvexError (e.g. `coupon_unavailable` from reopenBooking) carries its sentence in `data`.
  if (err && typeof err === "object" && "data" in err) {
    const data: unknown = err.data;
    if (typeof data === "string" && data) return data;
    if (data && typeof data === "object" && "message" in data && typeof data.message === "string" && data.message) return data.message;
    if (err instanceof ConvexError) return fallback;
  }
  if (!(err instanceof Error)) return fallback;
  return err.message.match(/Uncaught Error: (.+?)(?:\n|$)/)?.[1] ?? (err.message || fallback);
}

/** Current time for render logic, refreshed every minute (Date.now() in render is impure). */
export function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
