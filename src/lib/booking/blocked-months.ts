/** `YYYY-MM` month keys for loading a villa's blocked nights one calendar month at a time. */

export function monthOf(iso: string): string {
  return iso.slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(Date.UTC(year, monthIndex - 1 + delta, 1)).toISOString().slice(0, 7);
}

/** First and last date of the month, inclusive (the shape `availability.getBlockedDates` takes). */
export function monthBounds(month: string): { startDate: string; endDate: string } {
  const next = shiftMonth(month, 1);
  const lastDay = new Date(Date.parse(`${next}-01T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  return { startDate: `${month}-01`, endDate: lastDay };
}

/** Months holding the nights of [checkIn, checkOut); empty until both dates are set. */
export function stayMonths(checkIn: string, checkOut: string): string[] {
  if (!checkIn || !checkOut || checkOut <= checkIn) return [];
  const lastNight = new Date(Date.parse(`${checkOut}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const months: string[] = [];
  for (let month = monthOf(checkIn); month <= monthOf(lastNight); month = shiftMonth(month, 1)) {
    months.push(month);
  }
  return months;
}

/**
 * Months the booking calendar needs: the one on screen and the next (prefetch), plus every month of
 * the chosen stay. Months before today's are skipped because those days can't be picked.
 */
export function calendarMonths({
  visibleMonth,
  checkIn,
  checkOut,
  today,
}: {
  visibleMonth: string;
  checkIn: string;
  checkOut: string;
  today: string;
}): string[] {
  const first = monthOf(today);
  const months = new Set([visibleMonth, shiftMonth(visibleMonth, 1), ...stayMonths(checkIn, checkOut)]);
  return [...months].filter((month) => month >= first).sort();
}

/** Most villa-nights one `getBlockedDatesByProperty` call may cover (MAX_PROPERTY_DAYS in convex/availability.ts). */
export const MAX_PROPERTY_DAYS = 3100;

/** Splits villa ids into calls that fit the per-call villa-nights budget for a stay of `nights`. */
export function villaBatches<T>(ids: T[], nights: number): T[][] {
  const size = Math.max(1, Math.min(100, Math.floor(MAX_PROPERTY_DAYS / Math.max(1, nights))));
  const batches: T[][] = [];
  for (let index = 0; index < ids.length; index += size) batches.push(ids.slice(index, index + size));
  return batches;
}
