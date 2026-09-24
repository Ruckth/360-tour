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

  it('rejects private or insecure feed URLs', () => {
    for (const url of ['http://example.com/a.ics', 'https://localhost/a.ics', 'https://127.0.0.1/a.ics', 'https://user:secret@example.com/a.ics']) {
      expect(() => assertSafeIcalUrl(url)).toThrow();
    }
    expect(assertSafeIcalUrl('https://example.com/calendar.ics')).toBe('https://example.com/calendar.ics');
  });
});
