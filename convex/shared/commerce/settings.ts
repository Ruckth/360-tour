import { ConvexError } from 'convex/values';
import { addDays, isCalendarDate } from '../dates';
import { assertMoney } from '../money';
import type { TenderMethod } from '../orderMath';
import { resortMidnight, resortTodayIso } from '../time';
import { assertCount } from './caps';

export type CommerceSettings = {
  packageSplit: 'voucher_face_value' | 'relative_standalone';
  packageVatTiming: 'at_sale' | 'at_use';
  pointsTreatment: 'discount' | 'payment';
  retainExpiredPackageValue: boolean;
  /** Null turns off the special unused-package refund window. */
  unusedRefundDays: number | null;
  refundDays: { card: number; other: number };
  packageValidityDays: number;
  /** Null makes vouchers non-expiring by default. */
  voucherValidityDays: number | null;
  allowSessionTransfers: boolean;
  pointsExpiryMonths: number;
};

export const DEFAULT_COMMERCE_SETTINGS: Readonly<CommerceSettings> = {
  packageSplit: 'voucher_face_value',
  packageVatTiming: 'at_sale',
  pointsTreatment: 'discount',
  retainExpiredPackageValue: true,
  unusedRefundDays: 7,
  refundDays: { card: 45, other: 15 },
  packageValidityDays: 180,
  voucherValidityDays: 365,
  allowSessionTransfers: true,
  pointsExpiryMonths: 12,
};

/** Monetary classification of a pre-valued loyalty redemption, after the coupon. */
export function splitPointsSpend(
  afterCoupon: number,
  requested: number,
  settings: Pick<CommerceSettings, 'pointsTreatment'>,
) {
  assertMoney(afterCoupon, 'Amount after coupon', { allowZero: true });
  assertMoney(requested, 'Points value', { allowZero: true });
  if (requested > afterCoupon) throw new ConvexError('Points exceed the payable amount');
  return settings.pointsTreatment === 'discount'
    ? { discount: requested, payment: 0 }
    : { discount: 0, payment: requested };
}

/** Frozen validity ends just before midnight Bangkok time on the final day. */
export function benefitExpiresAt(
  soldAt: number,
  kind: 'sessions' | 'voucher',
  settings: Pick<CommerceSettings, 'packageValidityDays' | 'voucherValidityDays'>,
  validityDays?: number | null,
): number | null {
  const fallback = kind === 'sessions' ? settings.packageValidityDays : settings.voucherValidityDays;
  const days = validityDays === undefined ? fallback : validityDays;
  if (days === null) return null;
  assertCount('Validity days', days, 1);
  return resortMidnight(addDays(resortTodayIso(soldAt), days + 1));
}

export type BenefitState = 'active' | 'paused' | 'expired_retained' | 'expired_forfeited';

export function benefitState(
  benefit: { kind: 'sessions' | 'package_voucher' | 'standalone_voucher'; expiresAt: number | null; paused: boolean },
  now: number,
  settings: Pick<CommerceSettings, 'retainExpiredPackageValue'>,
): BenefitState {
  if (benefit.paused) return 'paused';
  if (benefit.expiresAt === null || now < benefit.expiresAt) return 'active';
  const retains = benefit.kind !== 'standalone_voucher' && settings.retainExpiredPackageValue;
  return retains ? 'expired_retained' : 'expired_forfeited';
}

export function canTransferSessions(settings: Pick<CommerceSettings, 'allowSessionTransfers'>): boolean {
  return settings.allowSessionTransfers;
}

/** Business dates in Bangkok; the last calendar day of the window is included. */
export function isProtectedUnusedRefund(
  sale: { soldOn: string; cancelOn: string; unused: boolean },
  settings: Pick<CommerceSettings, 'unusedRefundDays'>,
): boolean {
  const days = settings.unusedRefundDays;
  if (days === null || !sale.unused) return false;
  assertCount('Unused refund days', days, 0);
  if (!isCalendarDate(sale.soldOn) || !isCalendarDate(sale.cancelOn)) throw new ConvexError('Invalid refund date');
  return sale.cancelOn >= sale.soldOn && sale.cancelOn <= addDays(sale.soldOn, days);
}

export function refundDueOn(
  cancelledOn: string,
  method: TenderMethod,
  settings: Pick<CommerceSettings, 'refundDays'>,
): string {
  const days = method === 'card' ? settings.refundDays.card : settings.refundDays.other;
  assertCount('Refund days', days, 0);
  if (!isCalendarDate(cancelledOn)) throw new ConvexError('Invalid cancellation date');
  return addDays(cancelledOn, days);
}

/** Points last through this Bangkok business date, clamped to the target month's last day. */
export function pointsExpireOn(
  lastPurchaseOn: string,
  settings: Pick<CommerceSettings, 'pointsExpiryMonths'>,
): string {
  assertCount('Points expiry months', settings.pointsExpiryMonths, 1);
  if (!isCalendarDate(lastPurchaseOn)) throw new ConvexError('Invalid last purchase date');
  const target = new Date(`${lastPurchaseOn}T00:00:00Z`);
  const day = target.getUTCDate();
  target.setUTCDate(1);
  target.setUTCMonth(target.getUTCMonth() + settings.pointsExpiryMonths + 1, 0);
  target.setUTCDate(Math.min(day, target.getUTCDate()));
  return target.toISOString().slice(0, 10);
}
