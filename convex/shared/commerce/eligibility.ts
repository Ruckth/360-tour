import type { LineKind } from '../orderMath';
import { isCouponEligibleLine } from '../posCoupons';

export type CommerceLine = {
  kind: LineKind | 'product' | 'package' | 'voucher';
  fee?: unknown;
  covered?: boolean;
  issuesVoucher?: boolean;
  roomCharge?: boolean;
};

export function commerceLineEligibility(line: CommerceLine) {
  const { kind } = line;
  return {
    coupon: !line.covered && (kind === 'service' || kind === 'appointment') && isCouponEligibleLine({ kind, fee: line.fee }),
    staffDiscount: !line.covered && kind !== 'booking' && kind !== 'voucher',
    voucherSpend: !line.covered && !blocksVoucherSpend(line),
  };
}

function blocksVoucherSpend(line: CommerceLine) {
  return line.kind === 'booking' || line.kind === 'room' || line.kind === 'voucher'
    || !!line.roomCharge || !!line.issuesVoucher;
}

/** Applies to either voucher bucket, even if the forbidden row itself has nothing due. */
export function canSpendVoucher(lines: readonly CommerceLine[], bookingId?: string | null): boolean {
  return !bookingId && !lines.some(blocksVoucherSpend) && lines.some((line) => !line.covered);
}
