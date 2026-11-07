import { stayDates } from './dates';

function icalDate(value: string): string | null {
  const match = /^(\d{4})(\d{2})(\d{2})(?:T\d{6}Z?)?$/.exec(value.trim());
  if (!match) return null;
  const iso = `${match[1]}-${match[2]}-${match[3]}`;
  const timestamp = Date.parse(`${iso}T00:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === iso ? iso : null;
}

/**
 * iCal DTEND is exclusive. Timed events are intentionally ignored.
 * Throws on structurally incomplete input so a truncated feed cannot release existing blocks.
 */
export function blockedDatesFromIcal(text: string, from: string, to: string): string[] {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
  const dates = new Set<string>();
  const open: string[] = [];
  let calendars = 0;
  let event: Record<string, string> | null = null;
  for (const line of lines) {
    const boundary = /^(BEGIN|END):([A-Z0-9-]+)\s*$/i.exec(line);
    if (boundary) {
      const name = boundary[2].toUpperCase();
      if (boundary[1].toUpperCase() === 'BEGIN') {
        const parent = open[open.length - 1];
        if (parent === undefined ? name !== 'VCALENDAR' : name === 'VCALENDAR' || (name === 'VEVENT' && parent !== 'VCALENDAR')) {
          throw new Error('Malformed calendar: unexpected BEGIN:' + name);
        }
        open.push(name);
        if (name === 'VEVENT') event = {};
        continue;
      }
      if (open.pop() !== name) throw new Error('Malformed calendar: unexpected END:' + name);
      if (name === 'VCALENDAR') calendars++;
      if (name !== 'VEVENT') continue;
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
    // Only the event's own properties count; nested components such as VALARM keep theirs.
    if (event && open[open.length - 1] === 'VEVENT') {
      const colon = line.indexOf(':');
      if (colon >= 0) event[line.slice(0, colon).split(';')[0].toUpperCase()] = line.slice(colon + 1);
    }
  }
  if (open.length > 0 || calendars === 0) throw new Error('Malformed calendar: incomplete VCALENDAR');
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
