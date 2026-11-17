import { expect, it } from 'vitest';
import { parseMoneyInput } from '@/lib/money-input';
import { parseAmount } from '@/components/admin/admin-bookings-shared';
import { assertMoney, MAX_MONEY } from 'convex/shared/money';
import { assertStayPrice } from 'convex/shared/bookingMoney';
import { assertTenders } from 'convex/shared/orderMath';

it.each([
  ['0', 0], ['1', 100], ['1.23', 123], ['.50', 50], ['1.', 100],
  [' 1,234.50 ', 123450], ['1,234,567.89', 123456789],
])('parses baht %s consistently in money and booking inputs', (text, satang) => {
  expect(parseMoneyInput(text)).toBe(satang);
  expect(parseAmount(text)).toBe(satang);
});

it.each(['1.234', '0.005', '1,234.567', '1,23', ',123', '1,,000', '', ' ', '.', '-1', 'Infinity', '1e3', '9007199254740992'])('rejects invalid money text %j without rounding it', text => {
  expect(parseMoneyInput(text)).toBeNaN();
  expect(parseAmount(text)).toBeNull();
});

it.each([1, 10050, MAX_MONEY])('accepts positive whole satang %s across prices and payments', amount => {
  expect(() => assertMoney(amount)).not.toThrow();
  expect(() => assertStayPrice(amount)).not.toThrow();
  expect(() => assertTenders([{ method: 'cash', amount, received: amount }], amount)).not.toThrow();
});

it.each([
  [NaN, 'more than zero'], [Infinity, 'more than zero'], [-1, 'more than zero'], [0, 'more than zero'],
  [0.5, 'baht amount with at most 2 decimal places'], [MAX_MONEY + 1, 'at most 10,000,000'],
])('rejects invalid positive satang %s through one bounded rule', (amount, message) => {
  expect(() => assertMoney(amount)).toThrow(message);
  expect(() => assertTenders([{ method: 'cash', amount }], amount)).toThrow(message);
  expect(() => assertTenders([{ method: 'cash', amount: 1, received: amount }], 1)).toThrow(message);
});

it('allows a free stay price while still validating precision and the limit', () => {
  expect(() => assertStayPrice(0)).not.toThrow();
  for (const amount of [NaN, Infinity, -1, 0.5, MAX_MONEY + 1]) expect(() => assertStayPrice(amount)).toThrow();
});
