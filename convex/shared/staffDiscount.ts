import { percentageOf, roundRatio } from './money';
import { lineCouponBase, roundMoney, type PricedLine, type LineDiscount } from './orderMath';
import type { CashierRules } from './staffTypes';
type BaselineLine = PricedLine & { catalogUnitPrice?: number };


/** Baseline (at least the line price) × current quantity; the coupon is deliberately excluded. Whole satang throughout. */
export function manualReduction(line: PricedLine & { catalogUnitPrice?: number }) {
  const subtotalSatang = roundMoney(Math.max(line.catalogUnitPrice ?? line.unitPrice, line.unitPrice) * line.qty);
  const reductionSatang = Math.max(0, subtotalSatang - lineCouponBase(line));
  return { subtotalSatang, reductionSatang, percent: subtotalSatang ? roundRatio(BigInt(reductionSatang) * 10000n, subtotalSatang) : 0 };
}
export function discountOverLimit(line: BaselineLine, discount: LineDiscount, rules: Pick<CashierRules, "discountLimitPercent">) {
  if (!Number.isFinite(discount.value) || discount.value < 0) return null;
  const { subtotalSatang, reductionSatang } = manualReduction({ ...line, discount });
  if (reductionSatang <= percentageOf(subtotalSatang, rules.discountLimitPercent)) return null;
  return { amount: reductionSatang, limitPercent: rules.discountLimitPercent };
}
