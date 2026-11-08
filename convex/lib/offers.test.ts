import { describe, expect, it } from 'vitest';
import { evaluateOffer, normalizeCouponCode, type CouponRules, type OfferInput, type QuoteLine } from './offers';

const stay = (amount = 9000, nights = 2, propertySlug = 'mossbell'): QuoteLine => ({
  id: 'stay', kind: 'accommodation', propertySlug, checkIn: '2026-11-10',
  checkOut: `2026-11-${10 + nights}`, nights, amount,
});
const f1: CouponRules = {
  code: 'DCNT-F1-20', version: 1, status: 'active', benefit: { kind: 'percent', percent: 20 },
  scope: 'accommodation', bookFrom: '2026-11-01', bookTo: '2026-11-30',
  stayFrom: '2026-11-01', stayTo: '2026-12-20', minNights: 2, maxSaving: 3000,
  usageLimit: 500, used: 38, discountBudget: 80000, discountGranted: 66450,
};
const input = (coupon: CouponRules = f1, lines = [stay()]): OfferInput => ({
  lines, coupon, directDiscountPercent: 15, today: '2026-11-07',
});

describe('canonical pricing examples', () => {
  it('normalizes a code', () => expect(normalizeCouponCode('dcnt-f1-20 ')).toBe('DCNT-F1-20'));
  it('Mossbell: 2 nights, coupon saves 1800, total 7200', () => {
    expect(evaluateOffer(input())).toMatchObject({ applied: 'coupon', couponStatus: 'applied', couponDiscount: 1800, directDiscount: 1350, total: 7200 });
  });
  it('Canopy: capped coupon loses to the direct offer', () => {
    expect(evaluateOffer(input(f1, [stay(36000, 3, 'canopy')]))).toMatchObject({ applied: 'direct', couponStatus: 'coupon_worse', capped: true, couponDiscount: 3000, discount: 5400, total: 30600 });
  });
  it('Tideglass: one missing night, direct offer still applies', () => {
    expect(evaluateOffer(input(f1, [stay(8500, 1, 'tideglass')]))).toMatchObject({ applied: 'direct', couponStatus: 'invalid', problem: { code: 'min_nights', minNights: 2, missingNights: 1 }, total: 7225 });
  });
  it('a services-only coupon stacks with the direct offer on the stay', () => {
    const lines = [stay(), { id: 'thai', kind: 'service' as const, label: 'Thai massage 60', amount: 1200 }, { id: 'foot', kind: 'service' as const, label: 'Foot spa 45', amount: 600 }];
    const result = evaluateOffer(input({ code: 'DCNT-SPA-500', version: 1, status: 'active', scope: 'services', benefit: { kind: 'fixed', amount: 500 }, minEligibleSubtotal: 1500, used: 0, discountGranted: 0 }, lines));
    expect(result).toMatchObject({ applied: 'coupon', couponStatus: 'applied', directDiscount: 1350, couponDiscount: 500, discount: 1850 });
    expect(result.allocation.reduce((sum, a) => sum + a.discount, 0)).toBe(1850);
    expect(result.allocation.map((a) => a.discount)).toEqual([1350, 333, 167]);
  });
  it('SPA-500: largest-remainder 333/167, breakfast excluded', () => {
    const lines: QuoteLine[] = [
      { id: 'massage', kind: 'service', label: 'Thai massage', amount: 1200 },
      { id: 'spa', kind: 'service', label: 'Foot spa', amount: 600 },
      { id: 'breakfast', kind: 'extra', label: 'Breakfast basket', amount: 450 },
    ];
    const result = evaluateOffer(input({ code: 'DCNT-SPA-500', version: 1, status: 'active', scope: 'services', benefit: { kind: 'fixed', amount: 500 }, minEligibleSubtotal: 1500, bookFrom: '2026-11-01', bookTo: '2026-12-31', used: 14, discountGranted: 0 }, lines));
    expect(result).toMatchObject({ discount: 500, total: 1750, allocation: [
      { lineId: 'massage', discount: 333 }, { lineId: 'spa', discount: 167 }, { lineId: 'breakfast', discount: 0 },
    ] });
  });
  it('L-10: worse than 15% on accommodation', () => {
    expect(evaluateOffer(input({ ...f1, code: 'DCNT-L-10', benefit: { kind: 'percent', percent: 10 }, scope: 'accommodation_and_services' }))).toMatchObject({ couponStatus: 'coupon_worse', couponDiscount: 900, discount: 1350 });
  });
  it('SK-25 is expired', () => {
    expect(evaluateOffer(input({ ...f1, code: 'DCNT-SK-25', bookFrom: undefined, bookTo: '2026-04-20', benefit: { kind: 'percent', percent: 25 } })).problem).toEqual({ code: 'expired', endedOn: '2026-04-20' });
  });
  it('FLASH-30 is sold out within its booking window', () => {
    expect(evaluateOffer({ ...input({ ...f1, code: 'DCNT-FLASH-30', bookFrom: '2026-11-06', bookTo: '2026-11-06', usageLimit: 20, used: 20 }), today: '2026-11-06' }).problem).toEqual({ code: 'sold_out' });
  });
});

describe('offer boundaries and precedence', () => {
  it.each([
    [{ status: 'paused', bookFrom: '2027-01-01' }, 'not_active'],
    [{ bookFrom: '2027-01-01', used: 500 }, 'not_started'],
    [{ bookTo: '2026-11-01', used: 500 }, 'expired'],
    [{ used: 500, discountGranted: 80000 }, 'sold_out'],
    [{ discountGranted: 80000, propertySlugs: ['other'] }, 'budget_used'],
    [{ propertySlugs: ['other'], stayFrom: '2026-12-01' }, 'wrong_property'],
    [{ stayFrom: '2026-12-01', minNights: 3 }, 'stay_outside_dates'],
    [{ minNights: 3, scope: 'services' }, 'min_nights'],
    [{ scope: 'services', minEligibleSubtotal: 99999 }, 'nothing_eligible'],
    [{ minEligibleSubtotal: 9001 }, 'min_subtotal'],
  ] satisfies [Partial<CouponRules>, string][])('validates %j in order', (overrides, problem) => {
    expect(evaluateOffer(input({ ...f1, ...overrides })).problem?.code).toBe(problem);
  });
  it('includes book endpoints and every occupied night but excludes checkout', () => {
    const coupon = { ...f1, bookFrom: '2026-11-07', bookTo: '2026-11-07', stayFrom: '2026-11-10', stayTo: '2026-11-11' };
    expect(evaluateOffer(input(coupon)).couponStatus).toBe('applied');
    expect(evaluateOffer(input({ ...coupon, stayTo: '2026-11-10' })).problem?.code).toBe('stay_outside_dates');
    const later = { ...stay(), id: 'later', checkIn: '2026-11-12', checkOut: '2026-11-14' };
    expect(evaluateOffer(input(coupon, [stay(), later])).problem?.code).toBe('stay_outside_dates');
  });
  it('caps to remaining budget and eligible subtotal', () => {
    expect(evaluateOffer(input({ ...f1, discountGranted: 79500 }))).toMatchObject({ capped: true, couponDiscount: 500, applied: 'direct' });
    expect(evaluateOffer({ ...input({ ...f1, benefit: { kind: 'fixed', amount: 20000 }, maxSaving: undefined }), directDiscountPercent: 0 })).toMatchObject({ discount: 9000, total: 0 });
  });
  it('ties choose direct without consuming the code', () => {
    expect(evaluateOffer(input({ ...f1, benefit: { kind: 'percent', percent: 15 } }))).toMatchObject({ applied: 'direct', couponStatus: 'coupon_worse', couponDiscount: 1350 });
  });
  it('splits direct discounts on accommodation only, deterministically', () => {
    const lines: QuoteLine[] = [stay(10), { ...stay(10), id: 'second' }, { id: 'service', kind: 'service', label: 'Spa', amount: 100 }];
    const result = evaluateOffer({ lines, today: '2026-11-07', directDiscountPercent: 15 });
    expect(result.allocation).toEqual([{ lineId: 'stay', discount: 2 }, { lineId: 'second', discount: 1 }, { lineId: 'service', discount: 0 }]);
    expect(result.allocation.reduce((sum, line) => sum + line.discount, 0)).toBe(result.discount);
  });
  it('zero-value ties still choose direct', () => {
    expect(evaluateOffer({ ...input({ ...f1, minNights: undefined }, [stay(1)]), directDiscountPercent: 0 })).toMatchObject({ applied: 'direct', couponStatus: 'coupon_worse', discount: 0 });
  });
  it('combined scope includes services and excludes extras', () => {
    const result = evaluateOffer(input({ ...f1, scope: 'accommodation_and_services', maxSaving: undefined }, [stay(), { id: 's', kind: 'service', label: 'Spa', amount: 1000 }, { id: 'e', kind: 'extra', label: 'Extra', amount: 1000 }]));
    expect(result).toMatchObject({ discount: 2000, allocation: [{ discount: 1800 }, { discount: 200 }, { discount: 0 }] });
  });
  it('returns none without an offer or eligible value', () => {
    expect(evaluateOffer({ lines: [], directDiscountPercent: 0, today: '2026-11-07' })).toMatchObject({ applied: 'none', couponStatus: 'none', total: 0, allocation: [] });
  });
});


describe('allocation input safety', () => {
  it('rejects fractional lines before rounding can allocate more than a line amount', () => {
    const services: QuoteLine[] = [
      { id: 's1', kind: 'service', label: 'First', amount: 0.6 },
      { id: 's2', kind: 'service', label: 'Second', amount: 0.6 },
    ];
    expect(() => evaluateOffer(input({ ...f1, scope: 'services', benefit: { kind: 'fixed', amount: 1 }, minNights: undefined }, services)))
      .toThrow('non-negative safe integers');
    expect(() => evaluateOffer({ lines: [stay(0.6), stay(0.6)], directDiscountPercent: 100, today: '2026-11-07' }))
      .toThrow('non-negative safe integers');
  });
  it('rejects unsafe totals before allocation', () => {
    expect(() => evaluateOffer(input(f1, [stay(Number.MAX_SAFE_INTEGER), { ...stay(1), id: 'second' }])))
      .toThrow('safe integer');
  });
  it('allocates safe-integer prices exactly without floating-point overspending', () => {
    const lines = [stay(2_763_351_281_106_943), { ...stay(5_552_634_037_994_643), id: 'second' }];
    const result = evaluateOffer({ lines, today: '2026-11-07', directDiscountPercent: 100 });
    expect(result.allocation.map(line => line.discount)).toEqual(lines.map(line => line.amount));
    expect(result.allocation.reduce((sum, line) => sum + line.discount, 0)).toBe(result.discount);
  });
  it('keeps whole-baht allocations within every line and preserves their sum', () => {
    for (const amount of [0, 1, 2, 3, 7, 100, 10_000_000]) {
      const lines: QuoteLine[] = [stay(amount), { id: 's', kind: 'service', label: 'Spa', amount }, { id: 's2', kind: 'service', label: 'Spa 2', amount: 1 }];
      for (const scope of ['accommodation', 'services', 'accommodation_and_services'] as const) {
        const result = evaluateOffer(input({ ...f1, scope, benefit: { kind: 'percent', percent: 100 }, minNights: undefined, maxSaving: undefined }, lines));
        expect(result.allocation.reduce((sum, line) => sum + line.discount, 0)).toBe(result.discount);
        for (const [i, allocation] of result.allocation.entries()) {
          expect(allocation.discount).toBeGreaterThanOrEqual(0);
          expect(allocation.discount).toBeLessThanOrEqual(lines[i].amount);
        }
      }
    }
  });
});
