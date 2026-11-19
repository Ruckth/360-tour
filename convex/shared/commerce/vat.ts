import { ConvexError } from 'convex/values';
import { assertMoney } from '../money';
import { orderTotals, type PricedLine } from '../orderMath';
import type { PackageContentShare } from './pricing';
import type { CommerceSettings } from './settings';

export type FrozenVatBase = {
  /** VAT-inclusive amount taxed at this sale or use. */
  vatBase: number;
  /** Prepaid package session amount to recognize over its paid uses. */
  deferredVatBase: number;
};

export function freezeRowVatBase(input: {
  kind: 'voucher' | 'taxable' | 'exempt';
  net: number;
  goodwillDiscount?: number;
  pointsDiscount?: number;
}): FrozenVatBase {
  const { kind, net, goodwillDiscount = 0, pointsDiscount = 0 } = input;
  assertMoney(net, 'VAT row net', { allowZero: true });
  assertMoney(goodwillDiscount, 'Goodwill discount', { allowZero: true });
  assertMoney(pointsDiscount, 'Points discount', { allowZero: true });
  const netOfDiscounts = net - goodwillDiscount - pointsDiscount;
  if (netOfDiscounts < 0) throw new ConvexError('VAT discounts exceed the net row price');
  return { vatBase: kind === 'taxable' ? netOfDiscounts : 0, deferredVatBase: 0 };
}

/** Shares must already reflect the tax-invoice discounts. Goods are used when handed over at sale. */
export function freezePackageVatBases(
  shares: readonly (Pick<PackageContentShare, 'kind' | 'paidShare'> & { vatExempt?: boolean })[],
  settings: Pick<CommerceSettings, 'packageVatTiming'>,
): FrozenVatBase & { contents: FrozenVatBase[] } {
  const contents = shares.map(({ kind, paidShare, vatExempt }) => {
    assertMoney(paidShare, 'Content paid share', { allowZero: true });
    const taxable = kind !== 'voucher' && !vatExempt;
    const deferred = taxable && kind === 'sessions' && settings.packageVatTiming === 'at_use';
    return {
      vatBase: taxable && !deferred ? paidShare : 0,
      deferredVatBase: deferred ? paidShare : 0,
    };
  });
  return {
    vatBase: contents.reduce((sum, part) => sum + part.vatBase, 0),
    deferredVatBase: contents.reduce((sum, part) => sum + part.deferredVatBase, 0),
    contents,
  };
}

export type ReceiptVatInput =
  | { vatVersion?: 1; lines: readonly PricedLine[] }
  | { vatVersion: 2; lines: readonly { vatBase: number }[] };

/** Compute included VAT once on the receipt's total base. Historical lines still use today's formula. */
export function receiptVat(input: ReceiptVatInput): { vatBase: number; vat: number } {
  if (input.vatVersion !== 2) {
    const { total, vat } = orderTotals(input.lines);
    return { vatBase: total, vat };
  }
  const vatBase = input.lines.reduce((sum, line) => {
    assertMoney(line.vatBase, 'Frozen VAT base', { allowZero: true });
    return sum + line.vatBase;
  }, 0);
  assertMoney(vatBase, 'Receipt VAT base', { allowZero: true });
  const { vat } = orderTotals([{ unitPrice: vatBase, qty: 1 }]);
  return { vatBase, vat };
}
