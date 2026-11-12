// @vitest-environment edge-runtime
import { expect, it } from 'vitest';
import { calculateDirectQuote } from './lib/pricing';
import { orderTotals, lineStaffDiscount } from './lib/orderMath';

it('rounds a percentage discount identically for stays and orders', () => {
  const stay = calculateDirectQuote({ pricePerNight: 10050, directDiscountPercent: 1000, currency: 'THB' }, 1);
  expect(stay.discountAmount).toBe(1005);
  expect(lineStaffDiscount({ unitPrice: 10050, qty: 1, discount: { type: 'percent', value: 1000 } })).toBe(stay.discountAmount);
  expect(lineStaffDiscount({ unitPrice: 1005, qty: 1, discount: { type: 'percent', value: 1000 } })).toBe(101);
});

it('pins deposit settlement without collecting the linked payment twice', () => {
  expect(orderTotals([{ unitPrice: 10050, qty: 1, deposit: 2025 }])).toMatchObject({ total: 10050, deposit: 2025, due: 8025, vat: 657 });
});
