export function isIsoDate(s: string): boolean {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
	const [y, m, d] = s.split('-').map((n) => Number(n));
	const date = new Date(Date.UTC(y, m - 1, d));
	return (
		date.getUTCFullYear() === y &&
		date.getUTCMonth() === m - 1 &&
		date.getUTCDate() === d
	);
}

export function utcMidnightMs(s: string): number {
	const [y, m, d] = s.split('-').map((n) => Number(n));
	return Date.UTC(y, m - 1, d);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
	return Math.floor((utcMidnightMs(checkOut) - utcMidnightMs(checkIn)) / 86400000);
}

export function stayDates(checkIn: string, checkOut: string): string[] {
	const dates: string[] = [];
	const cursor = new Date(`${checkIn}T00:00:00.000Z`);
	const end = new Date(`${checkOut}T00:00:00.000Z`);

	while (cursor < end) {
		dates.push(cursor.toISOString().slice(0, 10));
		cursor.setUTCDate(cursor.getUTCDate() + 1);
	}

	return dates;
}


/** Strict calendar input; supports years 0001–0099 that Date.UTC treats as 1900–1999. */
export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10) === value;
}

/** Date-input range: incomplete, invalid and reversed ranges deliberately show zero nights. */
export function nightsBetweenIso(checkIn: string, checkOut: string): number {
  if (!isCalendarDate(checkIn) || !isCalendarDate(checkOut)) return 0;
  return Math.max(0, Math.floor((Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86_400_000));
}

/** Calendar-day addition is independent of browser DST. Invalid date input stays empty. */
export function addDaysIso(value: string, days: number): string {
  if (!isCalendarDate(value)) return '';
  return addDays(value, days);
}

export function rangeIntersectsDates(blockedDates: string[], checkIn: string, checkOut: string): boolean {
  if (!checkIn || !checkOut) return false;
  return blockedDates.some((date) => date >= checkIn && date < checkOut);
}

/** Raw calendar arithmetic for already validated backend dates; defaults to the next day. */
export function addDays(date: string, days = 1): string {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + days);
  return cursor.toISOString().slice(0, 10);
}

/** 0 = Sunday, for a YYYY-MM-DD calendar date. */
export function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00Z`).getUTCDay();
}
