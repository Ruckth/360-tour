import { describe, expect, it } from 'vitest';
import { MAX_QUOTE_SUBTOTAL, evaluateOffer, normalizeCouponCode, type CouponRules, type OfferInput, type QuoteLine } from './offers';

const stay = (amount = 900000, nights = 2, propertySlug = 'mossbell'): QuoteLine => ({
  id: 'stay', kind: 'accommodation', propertySlug, checkIn: '2026-11-10',
  checkOut: `2026-11-${10 + nights}`, nights, amount,
});
const f1: CouponRules = {
  code: 'DCNT-F1-20', version: 1, status: 'active', benefit: { kind: 'percent', percent: 2000 },
  scope: 'accommodation', bookFrom: '2026-11-01', bookTo: '2026-11-30',
  stayFrom: '2026-11-01', stayTo: '2026-12-20', minNights: 2, maxSaving: 300000,
  usageLimit: 500, used: 38, discountBudget: 8000000, discountGranted: 6645000,
};
const input = (coupon: CouponRules = f1, lines = [stay()]): OfferInput => ({
  lines, coupon, directDiscountPercent: 1500, today: '2026-11-07',
});

describe('canonical pricing examples', () => {
  it('normalizes a code', () => expect(normalizeCouponCode('dcnt-f1-20 ')).toBe('DCNT-F1-20'));
  it('Mossbell: 2 nights, coupon saves 1800, total 7200', () => {
    expect(evaluateOffer(input())).toMatchObject({ applied: 'coupon', couponStatus: 'applied', couponDiscount: 180000, directDiscount: 135000, total: 720000 });
  });
  it('Canopy: capped coupon loses to the direct offer', () => {
    expect(evaluateOffer(input(f1, [stay(3600000, 3, 'canopy')]))).toMatchObject({ applied: 'direct', couponStatus: 'coupon_worse', capped: true, couponDiscount: 300000, discount: 540000, total: 3060000 });
  });
  it('Tideglass: one missing night, direct offer still applies', () => {
    expect(evaluateOffer(input(f1, [stay(850000, 1, 'tideglass')]))).toMatchObject({ applied: 'direct', couponStatus: 'invalid', problem: { code: 'min_nights', minNights: 2, missingNights: 1 }, total: 722500 });
  });
  it('a services-only coupon stacks with the direct offer on the stay', () => {
    const lines = [stay(), { id: 'thai', kind: 'service' as const, label: 'Thai massage 60', amount: 120000 }, { id: 'foot', kind: 'service' as const, label: 'Foot spa 45', amount: 60000 }];
    const result = evaluateOffer(input({ code: 'DCNT-SPA-500', version: 1, status: 'active', scope: 'services', benefit: { kind: 'fixed', amount: 50000 }, minEligibleSubtotal: 150000, used: 0, discountGranted: 0 }, lines));
    expect(result).toMatchObject({ applied: 'coupon', couponStatus: 'applied', directDiscount: 135000, couponDiscount: 50000, discount: 185000 });
    expect(result.allocation.reduce((sum, a) => sum + a.discount, 0)).toBe(185000);
    expect(result.allocation.map((a) => a.discount)).toEqual([135000, 33333, 16667]);
  });
  it('SPA-500: largest-remainder 333/167, breakfast excluded', () => {
    const lines: QuoteLine[] = [
      { id: 'massage', kind: 'service', label: 'Thai massage', amount: 120000 },
      { id: 'spa', kind: 'service', label: 'Foot spa', amount: 60000 },
      { id: 'breakfast', kind: 'extra', label: 'Breakfast basket', amount: 45000 },
    ];
    const result = evaluateOffer(input({ code: 'DCNT-SPA-500', version: 1, status: 'active', scope: 'services', benefit: { kind: 'fixed', amount: 50000 }, minEligibleSubtotal: 150000, bookFrom: '2026-11-01', bookTo: '2026-12-31', used: 14, discountGranted: 0 }, lines));
    expect(result).toMatchObject({ discount: 50000, total: 175000, allocation: [
      { lineId: 'massage', discount: 33333 }, { lineId: 'spa', discount: 16667 }, { lineId: 'breakfast', discount: 0 },
    ] });
  });
  it('L-10: worse than 15% on accommodation', () => {
    expect(evaluateOffer(input({ ...f1, code: 'DCNT-L-10', benefit: { kind: 'percent', percent: 1000 }, scope: 'accommodation_and_services' }))).toMatchObject({ couponStatus: 'coupon_worse', couponDiscount: 90000, discount: 135000 });
  });
  it('SK-25 is expired', () => {
    expect(evaluateOffer(input({ ...f1, code: 'DCNT-SK-25', bookFrom: undefined, bookTo: '2026-04-20', benefit: { kind: 'percent', percent: 2500 } })).problem).toEqual({ code: 'expired', endedOn: '2026-04-20' });
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
    [{ used: 500, discountGranted: 8000000 }, 'sold_out'],
    [{ discountGranted: 8000000, propertySlugs: ['other'] }, 'budget_used'],
    [{ propertySlugs: ['other'], stayFrom: '2026-12-01' }, 'wrong_property'],
    [{ stayFrom: '2026-12-01', minNights: 3 }, 'stay_outside_dates'],
    [{ minNights: 3, scope: 'services' }, 'min_nights'],
    [{ scope: 'services', minEligibleSubtotal: 9999900 }, 'nothing_eligible'],
    [{ minEligibleSubtotal: 900100 }, 'min_subtotal'],
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
    expect(evaluateOffer(input({ ...f1, discountGranted: 7950000 }))).toMatchObject({ capped: true, couponDiscount: 50000, applied: 'direct' });
    expect(evaluateOffer({ ...input({ ...f1, benefit: { kind: 'fixed', amount: 2000000 }, maxSaving: undefined }), directDiscountPercent: 0 })).toMatchObject({ discount: 900000, total: 0 });
  });
  it('ties choose direct without consuming the code', () => {
    expect(evaluateOffer(input({ ...f1, benefit: { kind: 'percent', percent: 1500 } }))).toMatchObject({ applied: 'direct', couponStatus: 'coupon_worse', couponDiscount: 135000 });
  });
  it('splits direct discounts on accommodation only, deterministically', () => {
    const lines: QuoteLine[] = [stay(1000), { ...stay(1000), id: 'second' }, { id: 'service', kind: 'service', label: 'Spa', amount: 10000 }];
    const result = evaluateOffer({ lines, today: '2026-11-07', directDiscountPercent: 1500 });
    expect(result.allocation).toEqual([{ lineId: 'stay', discount: 150 }, { lineId: 'second', discount: 150 }, { lineId: 'service', discount: 0 }]);
    expect(result.allocation.reduce((sum, line) => sum + line.discount, 0)).toBe(result.discount);
  });
  it('zero-value ties still choose direct', () => {
    expect(evaluateOffer({ ...input({ ...f1, minNights: undefined }, [stay(1)]), directDiscountPercent: 0 })).toMatchObject({ applied: 'direct', couponStatus: 'coupon_worse', discount: 0 });
  });
  it('combined scope includes services and excludes extras', () => {
    const result = evaluateOffer(input({ ...f1, scope: 'accommodation_and_services', maxSaving: undefined }, [stay(), { id: 's', kind: 'service', label: 'Spa', amount: 100000 }, { id: 'e', kind: 'extra', label: 'Extra', amount: 100000 }]));
    expect(result).toMatchObject({ discount: 200000, allocation: [{ discount: 180000 }, { discount: 20000 }, { discount: 0 }] });
  });
  it('returns none without an offer or eligible value', () => {
    expect(evaluateOffer({ lines: [], directDiscountPercent: 0, today: '2026-11-07' })).toMatchObject({ applied: 'none', couponStatus: 'none', total: 0, allocation: [] });
  });
});


describe('allocation input safety', () => {
  it('rejects fractional lines before rounding can allocate more than a line amount', () => {
    const services: QuoteLine[] = [
      { id: 's1', kind: 'service', label: 'First', amount: 0.6 },
      { id: 's2', kind: 'service', label: 'Second', amount: 60 },
    ];
    expect(() => evaluateOffer(input({ ...f1, scope: 'services', benefit: { kind: 'fixed', amount: 100 }, minNights: undefined }, services)))
      .toThrow('non-negative safe integers');
    expect(() => evaluateOffer({ lines: [stay(0.6), stay(60)], directDiscountPercent: 10000, today: '2026-11-07' }))
      .toThrow('non-negative safe integers');
  });
  it('rejects totals above the quote ceiling before allocation', () => {
    expect(() => evaluateOffer(input(f1, [stay(MAX_QUOTE_SUBTOTAL), { ...stay(100), id: 'second' }])))
      .toThrow('at most');
  });
  it('allocates exactly at the quote ceiling, with stable remainder ties', () => {
    const lines: QuoteLine[] = [stay(MAX_QUOTE_SUBTOTAL - 3), ...[1, 1, 1].map((amount, index) => ({
      id: `s${index}`, kind: 'service' as const, label: 'Service', amount,
    }))];
    for (const discount of [1, 2, MAX_QUOTE_SUBTOTAL / 2, MAX_QUOTE_SUBTOTAL - 1, MAX_QUOTE_SUBTOTAL]) {
      const result = evaluateOffer({ ...input({ ...f1, scope: 'accommodation_and_services',
        benefit: { kind: 'fixed', amount: discount }, maxSaving: undefined, discountBudget: undefined,
      }, lines), directDiscountPercent: 0 });
      // Oracle: exact shares via BigInt, then largest remainder with input-order ties.
      const shares = lines.map((line, index) => {
        const product = BigInt(discount) * BigInt(line.amount);
        return { index, value: Number(product / BigInt(MAX_QUOTE_SUBTOTAL)), remainder: Number(product % BigInt(MAX_QUOTE_SUBTOTAL)) };
      });
      const remaining = discount - shares.reduce((sum, share) => sum + share.value, 0);
      [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index).slice(0, remaining).forEach(share => share.value++);
      expect(result.allocation.map(line => line.discount)).toEqual(shares.map(share => share.value));
    }
  });

  it('keeps whole-baht allocations within every line and preserves their sum', () => {
    for (const amount of [0, 1, 2, 3, 7, 100, 10_000_000]) {
      const lines: QuoteLine[] = [stay(amount), { id: 's', kind: 'service', label: 'Spa', amount }, { id: 's2', kind: 'service', label: 'Spa 2', amount: 100 }];
      for (const scope of ['accommodation', 'services', 'accommodation_and_services'] as const) {
        const result = evaluateOffer(input({ ...f1, scope, benefit: { kind: 'percent', percent: 10000 }, minNights: undefined, maxSaving: undefined }, lines));
        expect(result.allocation.reduce((sum, line) => sum + line.discount, 0)).toBe(result.discount);
        for (const [i, allocation] of result.allocation.entries()) {
          expect(allocation.discount).toBeGreaterThanOrEqual(0);
          expect(allocation.discount).toBeLessThanOrEqual(lines[i].amount);
        }
      }
    }
  });
});

describe('held coupon capacity and budget', () => {
  it('counts held slots, including coupons written before held fields existed', () => {
    expect(evaluateOffer(input({ ...f1, used: 499, held: 1 })).problem).toEqual({ code: 'sold_out' });
    expect(evaluateOffer(input({ ...f1, used: 499 })).couponStatus).toBe('applied');
  });
  it('counts held discounts for exhaustion and the remaining-budget cap', () => {
    expect(evaluateOffer(input({ ...f1, heldDiscount: 1355000 })).problem).toEqual({ code: 'budget_used' });
    expect(evaluateOffer(input({ ...f1, heldDiscount: 1200000 }))).toMatchObject({ couponStatus: 'applied', couponDiscount: 155000, capped: true, total: 745000 });
  });
});
