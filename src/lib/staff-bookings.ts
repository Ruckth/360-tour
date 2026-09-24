import { useEffect, useState } from "react";
import type { Doc } from "convex/_generated/dataModel";

/** Staff schedules run on resort time, whatever the admin's browser zone. */
export const RESORT_ZONE = "Asia/Bangkok";
const RESORT_OFFSET = "+07:00"; // Thailand has no DST
export const DAY_MS = 86_400_000;

const timeFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, hour: "numeric", minute: "2-digit" });
const dateFormat = new Intl.DateTimeFormat("en-US", { timeZone: RESORT_ZONE, weekday: "short", month: "short", day: "numeric" });
const isoFormat = new Intl.DateTimeFormat("en-CA", { timeZone: RESORT_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export const formatResortTime = (ms: number) => timeFormat.format(ms);
export const formatResortDate = (ms: number) => dateFormat.format(ms);
/** YYYY-MM-DD in resort time. */
export const resortIsoDate = (ms: number) => isoFormat.format(ms);
export const resortMidnight = (isoDate: string) => Date.parse(`${isoDate}T00:00:00${RESORT_OFFSET}`);

export type AppointmentStatus = Doc<"serviceAppointments">["status"];

/** One source of truth for appointment state: chip colours, labels and the legend. */
export const APPOINTMENT_STATUS: Record<AppointmentStatus | "unpaid", { label: string; color: string }> = {
  booked: { label: "Booked", color: "var(--color-zinc-400)" },
  arrived: { label: "Arrived", color: "var(--color-violet-500)" },
  in_service: { label: "In service", color: "var(--color-blue-500)" },
  completed: { label: "Completed", color: "var(--color-emerald-500)" },
  unpaid: { label: "Unpaid", color: "var(--color-amber-500)" },
  no_show: { label: "No-show", color: "var(--color-orange-500)" },
  cancelled: { label: "Cancelled", color: "var(--color-rose-500)" },
};

/** Completed but unpaid needs the desk's attention, so it gets its own chip. */
export function displayStatus(appointment: Pick<Doc<"serviceAppointments">, "status" | "paymentStatus">) {
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

export function money(amount: number, currency: string) {
  return currency === "THB" ? `฿${amount.toLocaleString("en-US")}` : `${currency} ${amount.toLocaleString("en-US")}`;
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
