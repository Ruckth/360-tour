import { useEffect, useState } from "react";
import type { Doc } from "convex/_generated/dataModel";
import { STATUS_LABELS } from "@/components/admin/labels";
import { CALENDAR_TONE_COLORS, STATUS_TONES, statusMeta } from "@/components/admin/status-tones";

/** Staff schedules run on resort time, whatever the admin's browser zone. */
export const RESORT_ZONE = "Asia/Bangkok";
const RESORT_OFFSET = "+07:00"; // Thailand has no DST
export const DAY_MS = 86_400_000;

const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, weekday: "short", month: "short", day: "numeric" });
const isoFormat = new Intl.DateTimeFormat("en-CA", { timeZone: RESORT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
const time24Format = new Intl.DateTimeFormat("en-GB", { timeZone: RESORT_ZONE, hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

export const formatResortTime = (ms: number) => timeFormat.format(ms);
export const formatResortDate = (ms: number) => dateFormat.format(ms);
/** YYYY-MM-DD in resort time. */
export const resortIsoDate = (ms: number) => isoFormat.format(ms);
export const resortMidnight = (isoDate: string) => Date.parse(`${isoDate}T00:00:00${RESORT_OFFSET}`);
/** "HH:mm" in resort time. */
export const resortTime24 = (ms: number) => time24Format.format(ms);
export const resortDateTime = (isoDate: string, time: string) => Date.parse(`${isoDate}T${time}:00${RESORT_OFFSET}`);

/** Time off as entered: dates plus optional times. Blank times mean whole days. */
export type TimeOffInput = { from: string; to: string; startTime: string; endTime: string };

export function timeOffRange(input: TimeOffInput) {
  const to = input.to || input.from;
  return {
    start: resortDateTime(input.from, input.startTime || "00:00"),
    end: input.endTime ? resortDateTime(to, input.endTime) : resortMidnight(to) + DAY_MS,
  };
}

/** Longest time off the server accepts (`assertTimeOffRange`). */
export const MAX_TIME_OFF_DAYS = 60;

/** Why the server would reject this time off range, or null when it's fine. */
export function timeOffRangeProblem(range: { start: number; end: number }) {
  if (!Number.isSafeInteger(range.start) || !Number.isSafeInteger(range.end)) return "Enter a valid time off date and time.";
  if (range.end <= range.start) return "Time off must end after it starts.";
  if (range.end - range.start > MAX_TIME_OFF_DAYS * DAY_MS) return `Time off can be at most ${MAX_TIME_OFF_DAYS} days.`;
  return null;
}

/** The wanted open time, else the next open time after it, else the first open time of the day. */
export function pickSlot<T extends { start: number }>(slots: readonly T[] | undefined, wanted: number | null): T | undefined {
  if (!slots?.length) return undefined;
  const earliest = (list: readonly T[]) => list.reduce<T | undefined>((best, slot) => (!best || slot.start < best.start ? slot : best), undefined);
  return (wanted === null ? undefined : earliest(slots.filter((slot) => slot.start >= wanted))) ?? earliest(slots);
}

/** The inverse of `timeOffRange`, for editing. */
export function timeOffInput(range: { start: number; end: number }): TimeOffInput {
  const startTime = resortTime24(range.start);
  const endTime = resortTime24(range.end);
  return {
    from: resortIsoDate(range.start),
    // A range ending at midnight ends on the previous day.
    to: resortIsoDate(endTime === "00:00" ? range.end - 1 : range.end),
    startTime: startTime === "00:00" ? "" : startTime,
    endTime: endTime === "00:00" ? "" : endTime,
  };
}

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

export type AppointmentStatus = Doc<"serviceAppointments">["status"];
export type PaymentStatus = Doc<"serviceAppointments">["paymentStatus"];

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
  appointment: Pick<Doc<"serviceAppointments">, "status" | "paymentStatus">,
): AppointmentDisplayStatus {
  return appointment.status === "completed" && appointment.paymentStatus === "unpaid" ? "unpaid" : appointment.status;
}

export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export function initials(name: string) {
  // Only words that start with a letter, so tags like "[AI-EVAL]" or "(VIP)" are skipped.
  return name
    .split(/\s+/)
    .filter((part) => /^\p{L}/u.test(part))
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join("");
}

/** Convex prefixes server errors with request metadata; keep the readable part. */
export function errorText(err: unknown, fallback: string) {
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
