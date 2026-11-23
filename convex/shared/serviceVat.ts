import { apportionMoney } from './commerce/allocation';
import { receiptVat } from './commerce/vat';
import { roundRatio } from './money';

export const includedServiceVat = (base: number) => receiptVat({ vatVersion: 2, lines: [{ vatBase: base }] }).vat;

/** Allocate the VAT printed once on a receipt to its frozen taxable bases, in receipt line order. */
export function serviceReceiptShares(bases: readonly number[]) {
  return apportionMoney(includedServiceVat(bases.reduce((total, base) => total + base, 0)), bases);
}
/** Closing the final satang of a sale also reverses the final satang of its allocated tax. */
export function revenueRemaining(balance: number, gross: number, vat: number) {
  return gross ? balance - roundRatio(BigInt(balance) * BigInt(vat), gross) : 0;
}
