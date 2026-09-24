import { stayDates } from './dates';

function icalDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : null;
}

/** iCal DTEND is exclusive. Timed events are intentionally ignored. */
export function blockedDatesFromIcal(text: string, from: string, to: string): string[] {
  const lines = text.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const dates = new Set<string>();
  let event: Record<string, string> | null = null;
  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') { event = {}; continue; }
    if (line === 'END:VEVENT') {
      if (event && event.STATUS !== 'CANCELLED') {
        if (event.RRULE || event.DTSTART?.includes('T') || event.DTEND?.includes('T')) {
          throw new Error('Timed or recurring calendar events require manual review');
        }
        const start = icalDate(event.DTSTART ?? '');
        const end = icalDate(event.DTEND ?? '');
        if (!start || !end || end <= start) throw new Error('Invalid calendar event dates');
        const clippedStart = start > from ? start : from;
        const clippedEnd = end < to ? end : to;
        if (clippedEnd > clippedStart) for (const date of stayDates(clippedStart, clippedEnd)) dates.add(date);
      }
      event = null;
      continue;
    }
    if (event) {
      const colon = line.indexOf(':');
      if (colon >= 0) event[line.slice(0, colon).split(';')[0].toUpperCase()] = line.slice(colon + 1);
    }
  }
  return [...dates].sort();
}

export function assertSafeIcalUrl(value: string): string {
  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  if (url.protocol !== 'https:' || url.username || url.password || !host.includes('.') ||
      host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') ||
      /^\d+\.\d+\.\d+\.\d+$/.test(host) || host.includes(':')) {
    throw new Error('A public HTTPS iCal URL is required');
  }
  return url.toString();
}
