import { describe, expect, it } from 'vitest';
import { billTotals, lineCouponDiscount, lineNet } from './billMath';
import type { CouponRules } from './offers';
import { evaluateOrderCoupon, isCouponEligibleLine, parseCouponInput, posCouponMessage, type PosCouponLine } from './posCoupons';

const spa500: CouponRules = {
  code: 'DCNT-SPA-500', version: 1, status: 'active', benefit: { kind: 'fixed', amount: 500 }, scope: 'services',
  bookFrom: '2026-11-01', bookTo: '2026-12-31', minEligibleSubtotal: 1500, used: 14, discountGranted: 7000,
};
const l10: CouponRules = {
  code: 'DCNT-L-10', version: 1, status: 'active', benefit: { kind: 'percent', percent: 10 },
  scope: 'accommodation_and_services', used: 22, discountGranted: 9000,
};
const massage: PosCouponLine = { id: 'massage', kind: 'service', unitPrice: 1200, qty: 1 };
const footSpa: PosCouponLine = { id: 'foot', kind: 'appointment', unitPrice: 600, qty: 1 };
const stay: PosCouponLine = { id: 'stay', kind: 'booking', unitPrice: 30000, qty: 1, deposit: 10000 };
const basket: PosCouponLine = { id: 'basket', kind: 'extra', unitPrice: 450, qty: 2 };
const today = '2026-11-07';

describe('evaluateOrderCoupon', () => {
  it('splits SPA-500 across spa rows in whole baht, ฿333 + ฿167', () => {
    expect(evaluateOrderCoupon({ lines: [massage, footSpa], coupon: spa500, today })).toEqual({
      ok: true, discount: 500, capped: false, eligibleSubtotal: 1800,
      allocation: [{ lineId: 'massage', discount: 333 }, { lineId: 'foot', discount: 167 }],
    });
  });

  it('never discounts stays, extras, rooms or fee rows', () => {
    const fee: PosCouponLine = { id: 'fee', kind: 'extra', unitPrice: 600, qty: 1, fee: { kind: 'no_show' } };
    const room: PosCouponLine = { id: 'room', kind: 'room', unitPrice: 4500, qty: 2 };
    expect([stay, basket, fee, room].some(isCouponEligibleLine)).toBe(false);
    const result = evaluateOrderCoupon({ lines: [stay, massage, basket, fee, room, footSpa], coupon: l10, today });
    expect(result).toMatchObject({ ok: true, discount: 180, eligibleSubtotal: 1800 });
    expect(result.ok && result.allocation.map((share) => share.lineId)).toEqual(['massage', 'foot']);
  });

  it('explains a minimum in baht', () => {
    expect(evaluateOrderCoupon({ lines: [footSpa, basket], coupon: spa500, today })).toEqual({
      ok: false, problem: { code: 'min_subtotal', minEligibleSubtotal: 1500, eligibleSubtotal: 600 },
    });
  });

  it('applies after the staff discount', () => {
    const discounted: PosCouponLine = { ...massage, discount: { type: 'amount', value: 200 } };
    expect(evaluateOrderCoupon({ lines: [discounted], coupon: l10, today })).toMatchObject({ ok: true, discount: 100 });
  });

  it('runs in satang when a row has satang', () => {
    const odd: PosCouponLine = { id: 'odd', kind: 'service', unitPrice: 1234.5, qty: 1 };
    expect(evaluateOrderCoupon({ lines: [odd, massage], coupon: l10, today })).toEqual({
      ok: true, discount: 243.45, capped: false, eligibleSubtotal: 2434.5,
      allocation: [{ lineId: 'odd', discount: 123.45 }, { lineId: 'massage', discount: 120 }],
    });
  });

  it('caps at the remaining budget, satang counters included', () => {
    const budget = { ...spa500, discountBudget: 7300, discountGranted: 7000.5 };
    expect(evaluateOrderCoupon({ lines: [massage, footSpa], coupon: budget, today })).toMatchObject({ ok: true, discount: 299, capped: true });
  });

  it('refuses stays-only, villa-limited and already-used coupons', () => {
    expect(evaluateOrderCoupon({ lines: [massage], coupon: { ...l10, scope: 'accommodation' }, today })).toEqual({ ok: false, problem: { code: 'nothing_eligible' } });
    expect(evaluateOrderCoupon({ lines: [massage], coupon: { ...l10, propertySlugs: ['mossbell'] }, today })).toEqual({ ok: false, problem: { code: 'villa_only' } });
    expect(evaluateOrderCoupon({ lines: [massage], coupon: l10, today, usedOnAttachedStay: true })).toEqual({ ok: false, problem: { code: 'already_on_stay' } });
  });

  it('reports engine problems first', () => {
    expect(evaluateOrderCoupon({ lines: [massage], coupon: { ...l10, status: 'paused' }, today })).toEqual({ ok: false, problem: { code: 'not_active' } });
    expect(evaluateOrderCoupon({ lines: [massage], coupon: { ...l10, usageLimit: 22 }, today })).toEqual({ ok: false, problem: { code: 'sold_out' } });
    expect(evaluateOrderCoupon({ lines: [massage], coupon: spa500, today: '2027-01-01' })).toEqual({ ok: false, problem: { code: 'expired', endedOn: '2026-12-31' } });
    expect(evaluateOrderCoupon({ lines: [stay, basket], coupon: l10, today })).toEqual({ ok: false, problem: { code: 'nothing_eligible' } });
  });

  it('a stored share reconciles with billMath', () => {
    const lines = [{ ...massage, couponDiscount: 333 }, { ...footSpa, couponDiscount: 167 }, stay];
    expect(billTotals(lines)).toMatchObject({ subtotal: 31800, discount: 500, coupon: 500, total: 31300, deposit: 10000, due: 21300 });
    expect(lineNet(lines[0])).toBe(867);
    // A share never exceeds what the staff discount leaves.
    expect(lineCouponDiscount({ unitPrice: 300, qty: 1, discount: { type: 'amount', value: 250 }, couponDiscount: 100 })).toBe(50);
  });
});

describe('parseCouponInput', () => {
  const site = 'https://book.auralis.example';
  it.each([
    ['dcnt-spa-500 ', { kind: 'code', code: 'DCNT-SPA-500' }],
    ['https://book.auralis.example/en/booking?coupon=dcnt-f1-20', { kind: 'code', code: 'DCNT-F1-20' }],
    ['https://book.auralis.example/q1', { kind: 'slug', slug: 'q1' }],
    ['book.auralis.example/q1', { kind: 'slug', slug: 'q1' }],
    ['/r/anna', { kind: 'slug', slug: 'r/anna' }],
    ['https://book.auralis.example/en/booking?mk=f1', { kind: 'slug', slug: 'f1' }],
    ['https://evil.example/q1?coupon=DCNT-SPA-500', { kind: 'invalid', reason: 'outside_link' }],
    ['https://book.auralis.example/rooms/mossbell', { kind: 'invalid', reason: 'no_offer' }],
    ['   ', { kind: 'invalid', reason: 'empty' }],
  ])('%s', (raw, expected) => expect(parseCouponInput(raw, site)).toEqual(expected));
});

it('has a staff message for every problem', () => {
  expect(posCouponMessage({ code: 'min_subtotal', minEligibleSubtotal: 1500, eligibleSubtotal: 600 })).toBe('Eligible items come to ฿600. This coupon needs at least ฿1,500.');
  expect(posCouponMessage({ code: 'expired', endedOn: '2026-12-31' })).toBe('This coupon ended on 31 Dec 2026.');
});
