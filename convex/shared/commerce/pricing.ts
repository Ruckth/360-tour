import { ConvexError } from 'convex/values';
import { assertMoney, assertSatang, roundRatio } from '../money';
import { assertDiscount, assertPrice, lineStaffDiscount, type LineDiscount } from '../orderMath';
import { apportionMoney } from './allocation';
import { assertCommerceCaps, assertCount } from './caps';
import type { CommerceSettings } from './settings';

export type PackageContent =
  | { contentKey: string; kind: 'sessions'; units: number; serviceUnitPrices: readonly number[] }
  | { contentKey: string; kind: 'product'; quantity: number; variantUnitPrice: number; chooseAtSale?: boolean }
  | { contentKey: string; kind: 'voucher'; face: number };

export type PackageContentShare = (
  | { kind: 'sessions'; units: number; normalUnitPrice: number }
  | { kind: 'product'; units: number; normalUnitPrice: number }
  | { kind: 'voucher'; face: number }
) & { contentKey: string; normalValue: number; grossShare: number; staffDiscount: number; paidShare: number };

export function splitPackagePrice(
  input: { price: number; contents: readonly PackageContent[]; staffDiscount?: LineDiscount },
  settings: Pick<CommerceSettings, 'packageSplit'>,
) {
  const { price, contents, staffDiscount } = input;
  assertPrice(price);
  assertCommerceCaps({
    kind: 'package',
    contents: contents.length,
    choosableProducts: contents.filter((content) => content.kind === 'product' && content.chooseAtSale).length,
    servicesPerGrant: contents.flatMap((content) => content.kind === 'sessions' ? [content.serviceUnitPrices.length] : []),
    productQuantities: contents.flatMap((content) => content.kind === 'product' ? [content.quantity] : []),
  });
  if (new Set(contents.map(({ contentKey }) => contentKey)).size !== contents.length) {
    throw new ConvexError('Package content keys must be unique');
  }

  let voucherFace = 0;
  const valuedContents = contents.map((content) => {
    const { contentKey, kind } = content;
    if (kind === 'voucher') {
      assertMoney(content.face, 'Voucher face value');
      voucherFace += content.face;
      return { kind, contentKey, face: content.face, normalValue: content.face };
    }

    const units = kind === 'sessions' ? content.units : content.quantity;
    assertCount('Units', units, 1);
    const prices = kind === 'sessions' ? content.serviceUnitPrices : [content.variantUnitPrice];
    prices.forEach(assertPrice);
    const normalUnitPrice = prices[0];
    return { kind, contentKey, units, normalUnitPrice, normalValue: assertSatang(units * normalUnitPrice) };
  });

  if (price < voucherFace) throw new ConvexError('Package price is below its voucher face value');
  const nonVoucherWeights = valuedContents.map((content) => content.kind === 'voucher' ? 0 : content.normalValue);
  if (price > voucherFace && nonVoucherWeights.every((weight) => weight === 0)) {
    throw new ConvexError('Package price remaining after vouchers needs a positive normal price');
  }

  let voucherShare = voucherFace;
  if (voucherFace > 0 && settings.packageSplit === 'relative_standalone') {
    // Round the relative voucher share once, then distribute the balance. This is
    // the full-TFRS Gold example (44288 satang), when a single pass across all contents would round the voucher down.
    const normalTotal = valuedContents.reduce((sum, { normalValue }) => sum + BigInt(normalValue), 0n);
    voucherShare = roundRatio(BigInt(price) * BigInt(voucherFace), normalTotal);
  }
  const vouchers = apportionMoney(voucherShare, valuedContents.map((content) => content.kind === 'voucher' ? content.face : 0));
  const remainder = apportionMoney(price - voucherShare, nonVoucherWeights);
  const gross = remainder.map((share, index) => share + vouchers[index]);
  const discountableShares = gross.map((share, index) => valuedContents[index].kind === 'voucher' ? 0 : share);
  if (staffDiscount) assertDiscount(staffDiscount);
  const discount = lineStaffDiscount({ unitPrice: discountableShares.reduce((sum, share) => sum + share, 0), qty: 1, discount: staffDiscount });
  const discounts = apportionMoney(discount, discountableShares);
  const shares: PackageContentShare[] = valuedContents.map((content, index) => ({
    ...content,
    grossShare: gross[index],
    staffDiscount: discounts[index],
    paidShare: gross[index] - discounts[index],
  }));
  return { net: price - discount, staffDiscount: discount, shares };
}

/** Standalone vouchers are sold at face value. Package valuation is handled by splitPackagePrice. */
export function assertStandaloneVoucherPrice(face: number, price: number): void {
  assertMoney(face, 'Voucher face value');
  assertMoney(price, 'Voucher sale price');
  if (face !== price) throw new ConvexError('A standalone voucher must sell at face value');
}
