import { describe, expect, it } from 'vitest';
import { assertSafeIcalUrl, blockedDatesFromIcal } from './ical';

describe('iCal import', () => {
  it('uses exclusive check-out dates and ignores cancelled events', () => {
    const feed = ['BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20300101', 'DTEND;VALUE=DATE:20300104', 'END:VEVENT',
      'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20300105', 'DTEND;VALUE=DATE:20300107', 'STATUS:CANCELLED', 'END:VEVENT',
      'END:VCALENDAR'].join('\r\n');
    expect(blockedDatesFromIcal(feed, '2030-01-02', '2030-01-10')).toEqual(['2030-01-02', '2030-01-03']);
  });

  it('rejects timed events so an unsupported feed cannot clear existing blocks', () => {
    const feed = ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'DTSTART:20300108T090000Z', 'DTEND:20300108T120000Z', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
    expect(() => blockedDatesFromIcal(feed, '2030-01-01', '2030-02-01')).toThrow('Timed or recurring');
  });

  const event = (start: string, end: string, ...extra: string[]) =>
    ['BEGIN:VEVENT', `DTSTART;VALUE=DATE:${start}`, `DTEND;VALUE=DATE:${end}`, ...extra, 'END:VEVENT'];

  it('rejects truncated or malformed calendar structure instead of returning no dates', () => {
    const complete = [...event('20300101', '20300102'), ...event('20300103', '20300104')];
    const malformed = {
      'truncated after several complete events': ['BEGIN:VCALENDAR', ...complete, 'BEGIN:VEVENT', 'DTSTART;VALUE=DATE:20300110'],
      'calendar-only truncation': ['BEGIN:VCALENDAR', ...complete],
      'unexpected end marker': ['BEGIN:VCALENDAR', 'END:VEVENT', 'END:VCALENDAR'],
      'mismatched end marker': ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'END:VALARM', 'END:VCALENDAR'],
      'nested VEVENT': ['BEGIN:VCALENDAR', 'BEGIN:VEVENT', ...event('20300101', '20300102'), 'END:VEVENT', 'END:VCALENDAR'],
      'no calendar envelope': event('20300101', '20300102'),
      'content after the calendar is truncated': ['BEGIN:VCALENDAR', 'END:VCALENDAR', 'BEGIN:VCALENDAR', ...complete],
      empty: [''],
    };
    for (const [name, lines] of Object.entries(malformed)) {
      expect(() => blockedDatesFromIcal(lines.join('\r\n'), '2030-01-01', '2030-02-01'), name).toThrow('Malformed calendar');
    }
  });

  it('accepts a well-formed empty calendar and valid nested components', () => {
    expect(blockedDatesFromIcal('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n', '2030-01-01', '2030-02-01')).toEqual([]);
    const feed = ['\uFEFFBEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE', 'TZID:Asia/Bangkok', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0700', 'END:STANDARD', 'END:VTIMEZONE',
      ...event('20300110', '20300112', 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:-PT15M', 'STATUS:CANCELLED', 'END:VALARM'),
      'END:VCALENDAR', ''].join('\n');
    expect(blockedDatesFromIcal(feed, '2030-01-01', '2030-02-01')).toEqual(['2030-01-10', '2030-01-11']);
  });

  it('rejects private or insecure feed URLs', () => {
    for (const url of ['http://example.com/a.ics', 'https://localhost/a.ics', 'https://127.0.0.1/a.ics', 'https://user:secret@example.com/a.ics']) {
      expect(() => assertSafeIcalUrl(url)).toThrow();
    }
    expect(assertSafeIcalUrl('https://example.com/calendar.ics')).toBe('https://example.com/calendar.ics');
  });
});
