import { describe, expect, it } from 'vitest';
import { COUPON_REFUSAL_PROBLEMS, reportDayCount, reportRangeBounds, spendInRange, validateSpend } from './marketingReport';

describe('report days', () => {
	it('counts inclusive Bangkok days and rejects bad ranges', () => {
		expect(reportDayCount('2026-11-01', '2026-11-30')).toBe(30);
		expect(reportDayCount('2026-11-08', '2026-11-08')).toBe(1);
		expect(reportDayCount('2026-11-09', '2026-11-08')).toBeNull();
		expect(reportDayCount('2026-11-31', '2026-12-01')).toBeNull();
	});

	it('puts 16:59:59Z and 17:00Z on different Bangkok days', () => {
		const { start, end } = reportRangeBounds('2026-11-08', '2026-11-08');
		expect(start).toBe(Date.UTC(2026, 10, 7, 17));
		expect(end).toBe(Date.UTC(2026, 10, 8, 17));
		expect(Date.UTC(2026, 10, 8, 16, 59, 59) < end).toBe(true);
	});
});

describe('spend', () => {
	it('validates integer satang, order of dates, length and note', () => {
		expect(validateSpend({ amount: 1200000, from: '2026-11-01', to: '2026-11-30' })).toBeNull();
		expect(validateSpend({ amount: 120.5, from: '2026-11-01', to: '2026-11-30' })).toMatch(/positive amount/);
		expect(validateSpend({ amount: 0, from: '2026-11-01', to: '2026-11-30' })).toMatch(/positive amount/);
		expect(validateSpend({ amount: 10000, from: '2026-11-30', to: '2026-11-01' })).toMatch(/start date/);
		expect(validateSpend({ amount: 10000, from: '2025-01-01', to: '2026-11-01' })).toMatch(/a year/);
		expect(validateSpend({ amount: 10000, from: '2026-11-01', to: '2026-11-01', note: 'x'.repeat(501) })).toMatch(/note/);
	});

	it('prorates an entry by the days that fall in the range', () => {
		const entry = { amount: 3000000, from: '2026-11-01', to: '2026-11-30' };
		expect(spendInRange(entry, '2026-11-01', '2026-11-30')).toBe(3000000);
		expect(spendInRange(entry, '2026-11-21', '2026-12-20')).toBe(1000000);
		expect(spendInRange(entry, '2026-12-01', '2026-12-31')).toBe(0);
	});
});

it('lists every refusal code once', () => {
	expect(new Set(COUPON_REFUSAL_PROBLEMS).size).toBe(COUPON_REFUSAL_PROBLEMS.length);
	expect(COUPON_REFUSAL_PROBLEMS).toContain('coupon_worse');
});

 it('allocates fractional spend ranges as integer satang without losing the entry total', () => {
  const entry = { amount: 100, from: '2026-11-01', to: '2026-11-03' };
  const daily = ['2026-11-01', '2026-11-02', '2026-11-03'].map(day => spendInRange(entry, day, day));
  expect(daily).toEqual([33, 34, 33]);
  expect(daily.reduce((sum, amount) => sum + amount, 0)).toBe(spendInRange(entry, entry.from, entry.to));
 });
