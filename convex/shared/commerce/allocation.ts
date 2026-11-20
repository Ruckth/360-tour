import { ConvexError } from 'convex/values';
import { assertMoney } from '../money';
import { MAX_TENDERS, TENDER_METHODS, type TenderMethod } from '../orderMath';
import { COMMERCE_LIMITS } from './caps';

/** Largest remainder, with ties following input order. Weights can exceed or fall short of total. */
export function apportionMoney(total: number, weights: readonly number[]): number[] {
  assertMoney(total, 'Allocation', { allowZero: true });
  const exactWeights = weights.map((weight) => {
    if (!Number.isSafeInteger(weight) || weight < 0) throw new ConvexError('Invalid allocation weight');
    return BigInt(weight);
  });
  if (total === 0) return weights.map(() => 0);
  const sum = exactWeights.reduce((amount, weight) => amount + weight, 0n);
  if (sum === 0n) throw new ConvexError('A positive allocation needs positive weight');

  const shares = exactWeights.map((weight, index) => {
    const product = BigInt(total) * weight;
    return { index, value: Number(product / sum), remainder: product % sum };
  });
  let leftover = total - shares.reduce((amount, share) => amount + share.value, 0);
  const byRemainder = [...shares].sort((a, b) => {
    if (a.remainder === b.remainder) return a.index - b.index;
    return a.remainder > b.remainder ? -1 : 1;
  });
  for (const share of byRemainder) {
    if (leftover === 0) break;
    share.value++;
    leftover--;
  }
  return shares.map((share) => share.value);
}

/** For each amount in order, spend down the columns' remaining capacity pro rata. */
function allocateMatrix(amounts: readonly number[], capacities: readonly number[]): number[][] {
  const sumMoney = (values: readonly number[]) => values.reduce((sum, value) => {
    assertMoney(value, 'Allocation cell', { allowZero: true });
    return sum + value;
  }, 0);
  if (sumMoney(amounts) !== sumMoney(capacities)) {
    throw new ConvexError('Allocation amounts must equal available capacity');
  }
  const remaining = [...capacities];
  return amounts.map((amount) => {
    const cells = apportionMoney(amount, remaining);
    cells.forEach((cell, index) => { remaining[index] -= cell; });
    return cells;
  });
}

export type ExternalTender = { method: TenderMethod; amount: number };
export type VoucherTender = { method: 'voucher'; voucherId: string; amount: number };
export type CommerceTender = ExternalTender | VoucherTender;

export type TenderCells = {
  /** One cell per paid voucher, in tender order, including zero cells. */
  vouchers: { voucherId: string; amount: number }[];
  external: number;
};

export type PaymentRow = {
  /** After staff, coupon, and any goodwill discounts, inclusive of any online deposit. */
  net: number;
  deposit?: number;
  /** Amounts collected here for package contents, in frozen content order. */
  contentPaidShares?: readonly number[];
};

export function allocateSalePayments(rows: readonly PaymentRow[], tenders: readonly CommerceTender[]) {
  const vouchers = tenders.filter((tender) => tender.method === 'voucher');
  if (tenders.length > MAX_TENDERS || vouchers.length > COMMERCE_LIMITS.sale.distinctFundingVouchers) {
    throw new ConvexError('Split across at most three payments including at most two vouchers');
  }
  if (new Set(vouchers.map((voucher) => voucher.voucherId)).size !== vouchers.length) {
    throw new ConvexError('Each funding voucher can appear only once');
  }
  let external = 0;
  for (const tender of tenders) {
    assertMoney(tender.amount, 'Payment');
    if (tender.method === 'voucher') continue;
    if (!TENDER_METHODS.includes(tender.method)) throw new ConvexError('Unknown payment method');
    external += tender.amount;
  }
  const asCells = (amounts: readonly number[]): TenderCells => ({
    vouchers: vouchers.map(({ voucherId }, index) => ({ voucherId, amount: amounts[index] })),
    external: amounts[vouchers.length],
  });
  const capacities = rows.map(({ net, deposit = 0 }) => {
    assertMoney(net, 'Row net', { allowZero: true });
    assertMoney(deposit, 'Row deposit', { allowZero: true });
    if (deposit > net) throw new ConvexError('Row deposit exceeds the net amount');
    return net - deposit;
  });
  const receipt = [...vouchers.map(({ amount }) => amount), external];
  assertMoney(receipt.reduce((sum, amount) => sum + amount, 0), 'Collected total', { allowZero: true });
  const matrix = allocateMatrix(capacities, receipt);
  return {
    receipt: asCells(receipt),
    rows: matrix.map((cells, index) => {
      const shares = rows[index].contentPaidShares;
      if (!shares) return { cells: asCells(cells) };
      // Inside the row, visit each tender column and spend down the content capacities.
      const columns = allocateMatrix(cells, shares);
      return { cells: asCells(cells), contents: shares.map((_, content) => asCells(columns.map((column) => column[content]))) };
    }),
  };
}

/** Allocate one frozen goodwill discount across remaining eligible row or content amounts. */
export function allocateGoodwillDiscount(amount: number, capacities: readonly number[]): number[] {
  for (const capacity of capacities) assertMoney(capacity, 'Goodwill capacity', { allowZero: true });
  if (amount > capacities.reduce((sum, capacity) => sum + capacity, 0)) {
    throw new ConvexError('Goodwill exceeds the eligible amount');
  }
  return apportionMoney(amount, capacities);
}
