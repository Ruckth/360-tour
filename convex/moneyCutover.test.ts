// @vitest-environment edge-runtime
import { expect, it } from 'vitest';
import { calculateDirectQuote } from './lib/pricing';
import { billTotals, lineStaffDiscount } from './lib/billMath';

it('pins the pre-cutover stay rounding discrepancy and the order satang rule', () => {
  const stay = calculateDirectQuote({ pricePerNight: 100.50, directDiscountPercent: 10, currency: 'THB' }, 1);
  expect(stay.discountAmount).toBe(10);
  expect(lineStaffDiscount({ unitPrice: 100.50, qty: 1, discount: { type: 'percent', value: 10 } })).toBe(10.05);
  expect(lineStaffDiscount({ unitPrice: 10.05, qty: 1, discount: { type: 'percent', value: 10 } })).toBe(1.01);
});

it('pins deposit settlement without collecting the linked payment twice', () => {
  expect(billTotals([{ unitPrice: 100.50, qty: 1, deposit: 20.25 }])).toMatchObject({ total: 100.50, deposit: 20.25, due: 80.25, vat: 6.57 });
});
