import { formatMoney } from "../labels";

// Dates are YYYY-MM-DD strings in Asia/Bangkok, money is whole baht, as in the offer engine.

export const thb = (amount: number) => formatMoney(amount, "THB");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parts(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month: MONTHS[(month ?? 1) - 1] ?? "", day };
}

/** "2026-11-01" → "1 Nov 2026" */
export function formatDay(iso: string) {
  const { year, month, day } = parts(iso);
  return `${day} ${month} ${year}`;
}

/**
 * An inclusive date range in the data.md style: "1–30 Nov 2026", "1 Nov–20 Dec 2026",
 * "from 15 Nov 2026", "until 30 Nov 2026", or "Ongoing" without either end.
 */
export function formatRange(from?: string, to?: string) {
  if (from && to) {
    const a = parts(from);
    const b = parts(to);
    if (from === to) return formatDay(from);
    if (a.year === b.year && a.month === b.month) return `${a.day}–${b.day} ${b.month} ${b.year}`;
    if (a.year === b.year) return `${a.day} ${a.month}–${b.day} ${b.month} ${b.year}`;
    return `${formatDay(from)}–${formatDay(to)}`;
  }
  if (from) return `from ${formatDay(from)}`;
  if (to) return `until ${formatDay(to)}`;
  return "Ongoing";
}

const bangkokDay = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Bangkok", year: "numeric", month: "2-digit", day: "2-digit" });

/** Today in Asia/Bangkok as YYYY-MM-DD, the date the offer engine compares against. */
export function bangkokToday(ms: number) {
  return bangkokDay.format(ms);
}

/** Nights between two YYYY-MM-DD dates (0 when the order is wrong or a date is missing). */
export function nightsBetween(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  const days = (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000;
  return Number.isFinite(days) && days > 0 ? Math.round(days) : 0;
}

const stamp = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Bangkok",
  day: "numeric",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/** A saved-at time in Bangkok: "3 Nov 2026, 10:12". */
export function formatStamp(ms: number) {
  return stamp.format(ms).replace(/ at /, ", ");
}
