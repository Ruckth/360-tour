import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { expect, it } from 'vitest';
import { addDaysIso, isCalendarDate, isIsoDate, nightsBetween, nightsBetweenIso } from 'convex/shared/dates';
import { calculateDirectQuote } from 'convex/shared/pricing';
import { evaluateOffer } from 'convex/shared/offers';
import { orderTotals } from 'convex/shared/orderMath';
import { assertTimeOffRange, timeOffInput, timeOffRange, timeOffRangeProblem } from 'convex/shared/timeOff';
import { DAY_MS, resortMidnight, resortLocalParts, resortTodayIso } from 'convex/shared/time';
import { reportRangeBounds } from 'convex/shared/marketingReport';
import { localDateTimeUtc, planUncovers } from 'convex/shared/schedule';
import { stayConflicts } from 'convex/shared/overlap';

it('rolls resort today at UTC 17:00, including time, weekday, report bounds and midnight shifts', () => {
  const before = Date.parse('2026-11-13T16:59:59.999Z');
  const after = before + 1;
  expect(resortTodayIso(before)).toBe('2026-11-13');
  expect(resortTodayIso(after)).toBe('2026-11-14');
  expect(resortLocalParts(after)).toEqual({ date: '2026-11-14', time: '00:00', weekday: 6 });
  expect(reportRangeBounds('2026-11-14', '2026-11-14')).toEqual({ start: after, end: after + DAY_MS });
  expect(localDateTimeUtc('2026-11-13', '24:00')).toBe(after);
  for (const date of ['2024-02-29', '2026-11-13', '2030-01-01']) expect(resortMidnight(date)).toBe(Date.parse(`${date}T00:00:00+07:00`));
  expect(() => localDateTimeUtc('2026-02-30', '09:00')).toThrow('Date must be');
  expect(planUncovers('2026-11-14', { shifts: [{ start: '00:00', end: '01:00' }], breaks: [] }, after, after + 60 * 60_000)).toBe(false);
});

it.each([
  ['America/Los_Angeles', '2026-11-13'],
  ['America/New_York', '2026-11-13'],
  ['Pacific/Auckland', '2026-11-14'],
  ['Asia/Tokyo', '2026-11-14'],
])('keeps business dates and local Date picker semantics distinct in %s', (zone, localToday) => {
  // Run actual modules in a fresh process so the native browser-like local Date zone really changes.
  const source = ['convex/shared/dates.ts', 'convex/shared/time.ts', 'src/lib/dates/values.ts']
    .map(file => ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ESNext } }).outputText.replace(/^import .*;\n/gm, '')).join('\n');
  const checks = `
    import assert from 'node:assert/strict';
    const at = Date.parse('2026-11-13T17:00:00Z');
    assert.equal(resortTodayIso(at), '2026-11-14');
    assert.equal(todayIsoLocal(new Date(at)), '${localToday}');
    const picker = isoToDate('2026-03-08');
    assert.equal(picker.getDate(), 8);
    assert.equal(picker.getMonth(), 2);
    assert.equal(picker.getHours(), 0);
    assert.equal(dateToIso(picker), '2026-03-08');
    assert.equal(addDaysIso('2026-03-08', 1), '2026-03-09');
    assert.equal(nightsBetweenIso('2026-03-07', '2026-03-09'), 2);
    assert.equal(resortDateTime('2026-11-14', '00:00'), at);
  `;
  expect(execFileSync(process.execPath, ['--input-type=module', '-e', source + checks], { env: { ...process.env, TZ: zone }, encoding: 'utf8' })).toBe('');
});

it('preserves strict date inputs, empty/reversed ranges, signed backend nights and early picker years', () => {
  for (const value of ['', '2026-2-01', '2026-02-29', '2026-02-30', 'bad']) {
    expect(isCalendarDate(value)).toBe(false);
    expect(addDaysIso(value, 1)).toBe('');
    expect(nightsBetweenIso(value, '2026-03-10')).toBe(0);
  }
  expect(nightsBetweenIso('2026-03-10', '2026-03-08')).toBe(0);
  expect(nightsBetween('2026-03-10', '2026-03-08')).toBe(-2);
  expect(addDaysIso('2024-02-28', 2)).toBe('2024-03-01');
  expect(isCalendarDate('0099-12-31')).toBe(true);
  expect(isIsoDate('0099-12-31')).toBe(false); // Existing backend admission policy stays stricter.
  expect(addDaysIso('0099-12-31', 1)).toBe('0100-01-01');
  expect(nightsBetweenIso('0099-12-31', '0100-01-01')).toBe(1);
});

it('uses one integer-satang quote for browser, offer and receipt calculations', () => {
  for (const [price, nights, bps] of [[10050, 1, 1000], [333300, 3, 1250], [1, 1, 5000], [100_000_000, 9, 9999]]) {
    const quote = calculateDirectQuote({ pricePerNight: price, directDiscountPercent: bps, currency: 'THB' }, nights);
    const offer = evaluateOffer({ lines: [{ id: 'stay', kind: 'accommodation', propertySlug: 'villa', checkIn: '2026-11-14', checkOut: '2026-11-15', nights, amount: price * nights }], directDiscountPercent: bps, today: '2026-11-13' });
    const receipt = orderTotals([{ unitPrice: price * nights, qty: 1, discount: { type: 'percent', value: bps } }]);
    expect(quote.discountAmount).toBe(offer.discount);
    expect(quote.directTotal).toBe(offer.total);
    expect(receipt.total).toBe(quote.directTotal);
    expect(Number.isSafeInteger(quote.directTotal)).toBe(true);
  }
  expect(calculateDirectQuote({ pricePerNight: 10050, directDiscountPercent: 1000, currency: 'THB' }, -1)).toMatchObject({ nights: 0, directTotal: 0 });
});

it('shares time-off acceptance, preserving whole days, exact limits and both error presentations', () => {
  const input = { from: '2026-03-07', to: '2026-03-09', startTime: '', endTime: '' };
  const range = timeOffRange(input);
  expect(range.end - range.start).toBe(3 * DAY_MS);
  expect(timeOffInput(range)).toEqual(input);
  expect(timeOffRangeProblem(range)).toBeNull();
  expect(() => assertTimeOffRange(range.start, range.end)).not.toThrow();
  for (const range of [{ start: NaN, end: 1 }, { start: 1, end: 1 }, { start: 0, end: 60 * DAY_MS + 1 }]) {
    expect(timeOffRangeProblem(range)).not.toBeNull();
    expect(() => assertTimeOffRange(range.start, range.end)).toThrow('Time off must be positive and at most 60 days');
  }
  expect(() => assertTimeOffRange(0, 60 * DAY_MS)).not.toThrow();
});

it('shares half-open stay conflicts while keeping pending/cancelled rows and exclusions free', () => {
  const stay = { _id: 'stay', propertyId: 'villa', status: 'confirmed', checkIn: '2026-11-14', checkOut: '2026-11-16' };
  const data = { bookings: [stay], dateBlocks: [], blocks: [] };
  expect(stayConflicts(data, 'villa', '2026-11-16', '2026-11-17')).toBe(false);
  expect(stayConflicts(data, 'villa', '2026-11-15', '2026-11-17')).toBe(true);
  expect(stayConflicts(data, 'villa', '2026-11-15', '2026-11-17', 'stay')).toBe(false);
  for (const status of ['pending', 'cancelled']) expect(stayConflicts({ ...data, bookings: [{ ...stay, status }] }, 'villa', '2026-11-15', '2026-11-17')).toBe(false);
  expect(stayConflicts({ bookings: [], dateBlocks: [{ propertyId: 'villa', start: '2026-11-14', end: '2026-11-16' }], blocks: [] }, 'villa', '2026-11-15', '2026-11-17')).toBe(true);
  expect(stayConflicts({ bookings: [], dateBlocks: [], blocks: [{ propertyId: 'villa', date: '2026-11-15' }] }, 'villa', '2026-11-14', '2026-11-15')).toBe(false);
});
