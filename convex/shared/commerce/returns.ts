import { ConvexError } from 'convex/values';
import { assertMoney, roundRatio } from '../money';
import { MAX_TENDERS, TENDER_METHODS, type TenderMethod } from '../orderMath';
import type { ExternalTender, TenderCells } from './allocation';
import { assertCount, COMMERCE_LIMITS } from './caps';

export type UnitProgress = {
  unitsSold: number;
  /** Cumulative units before this action and at its requested target. */
  unitsBefore: number;
  unitsThrough: number;
};

/** Difference between two rounded cumulative amounts. Also works for paid VAT uses and voucher face satang. */
export function incrementalShare(paidShare: number, { unitsSold, unitsBefore, unitsThrough }: UnitProgress) {
  assertMoney(paidShare, 'Frozen share', { allowZero: true });
  assertCount('Original units', unitsSold, 1);
  assertCount('Previous units', unitsBefore, 0, unitsSold);
  assertCount('Target units', unitsThrough, unitsBefore, unitsSold);
  const cumulative = (units: number) => roundRatio(BigInt(paidShare) * BigInt(units), unitsSold);
  const total = cumulative(unitsThrough);
  return { amount: total - cumulative(unitsBefore), total };
}

export type SessionRefundMode = 'paid_share' | 'normal_price';

export type SessionReturn = UnitProgress & {
  paidShare: number;
  normalUnitPrice: number;
  /** Paid uses at the time of the return quote. Goodwill uses never enter this count. */
  paidUnitsUsed: number;
};

/**
 * The normal-price option leaves each retained unit at list price, whether used yet
 * or still available. This makes the cumulative refund monotone across intervening uses.
 */
export function quoteSessionReturn(input: SessionReturn, settings: { sessionRefundMode: SessionRefundMode }) {
  const { unitsSold, unitsThrough, unitsBefore, paidShare, normalUnitPrice, paidUnitsUsed } = input;
  assertCount('Original units', unitsSold, 1);
  assertCount('Used paid units', paidUnitsUsed, 0, unitsSold);
  const unused = unitsSold - paidUnitsUsed;
  assertCount('Previous units', unitsBefore, 0, unused);
  assertCount('Target units', unitsThrough, unitsBefore, unused);
  if (settings.sessionRefundMode === 'paid_share') return incrementalShare(paidShare, input);

  assertMoney(normalUnitPrice, 'Normal unit price', { allowZero: true });
  assertMoney(paidShare, 'Frozen share', { allowZero: true });
  const cumulative = (returned: number) => {
    if (returned === 0) return 0;
    const remaining = BigInt(paidShare) - BigInt(normalUnitPrice) * BigInt(unitsSold - returned);
    return remaining > 0n ? Number(remaining) : 0;
  };
  const total = cumulative(unitsThrough);
  return { amount: total - cumulative(unitsBefore), total };
}

/** A package voucher spends at face; revoking unused face returns its frozen paid value. */
export function quotePackageVoucherReturn(input: {
  paidShare: number;
  face: number;
  faceSpent: number;
  faceReturned: number;
  faceThrough: number;
}) {
  const { paidShare, face, faceSpent, faceReturned, faceThrough } = input;
  assertMoney(face, 'Voucher face value');
  assertCount('Voucher face spent', faceSpent, 0, face);
  assertCount('Voucher face to revoke', faceThrough, 0, face - faceSpent);
  return incrementalShare(paidShare, { unitsSold: face, unitsBefore: faceReturned, unitsThrough: faceThrough });
}

/** D8's exception for a mistaken standalone sale on the issuing receipt. */
export function quoteStandaloneVoucherReturn(input: {
  face: number;
  paidBalance: number;
  everSpent: boolean;
  onIssuingReceipt: boolean;
  mistakenSale: boolean;
}): number {
  assertMoney(input.face, 'Voucher face value');
  assertMoney(input.paidBalance, 'Voucher paid balance', { allowZero: true });
  return input.onIssuingReceipt && input.mistakenSale && !input.everSpent && input.paidBalance === input.face
    ? input.face
    : 0;
}

export type BenefitBuckets = { paid: number; goodwill: number };

/** Spend goodwill first. Store both amounts so undo can restore the original buckets. */
export function splitBenefitUse(balances: BenefitBuckets, requested: number): BenefitBuckets {
  assertCount('Paid balance', balances.paid, 0);
  assertCount('Goodwill balance', balances.goodwill, 0);
  assertCount('Benefit use', requested, 0);
  const goodwill = Math.min(requested, balances.goodwill);
  const paid = requested - goodwill;
  if (paid > balances.paid) throw new ConvexError('Benefit use exceeds the available balance');
  return { paid, goodwill };
}

export type VoucherRefundStatus = 'active' | 'paused' | 'expired' | 'disabled';
export type VoucherRefundBalance = {
  voucherId: string;
  /** Frozen paid contribution on the receipt. */
  paid: number;
  /** Includes earlier credits issued as replacement codes. */
  credited: number;
  status: VoucherRefundStatus;
};
type GoodwillRefund = { voucherId: string; amount: number; status: VoucherRefundStatus };

/** A correction can replace external methods on the receipt while keeping its frozen collection cells. */
export function assertExternalCorrection(
  frozenExternal: TenderCells['external'],
  effective: readonly ExternalTender[],
  paidVoucherCount: number,
): void {
  assertMoney(frozenExternal, 'Frozen external amount', { allowZero: true });
  assertCount('Paid voucher count', paidVoucherCount, 0, COMMERCE_LIMITS.sale.distinctFundingVouchers);
  if (effective.length + paidVoucherCount > MAX_TENDERS) throw new ConvexError('Split across at most three payments');
  let external = 0;
  for (const tender of effective) {
    if (!TENDER_METHODS.includes(tender.method)) throw new ConvexError('Unknown external payment method');
    assertMoney(tender.amount, 'External payment');
    external += tender.amount;
  }
  if (external !== frozenExternal) throw new ConvexError('Corrected external payments must match the frozen external amount');
}

/** Apply the refund increment across receipt-level balances. Keep the frozen sale cells for reporting. */
export function routeReceiptRefund(input: {
  amount: number;
  vouchers: readonly VoucherRefundBalance[];
  /** Current effective methods, after any correction. */
  externalTenders: readonly ExternalTender[];
  externalRefunded: number;
  /** Returnable goodwill discount by voucher, computed separately from paid value. */
  goodwill?: readonly GoodwillRefund[];
}) {
  const { amount, vouchers, externalTenders, externalRefunded, goodwill = [] } = input;
  assertMoney(amount, 'Paid refund', { allowZero: true });
  assertMoney(externalRefunded, 'Prior external refunds', { allowZero: true });
  const externalPaid = externalTenders.reduce((sum, tender) => sum + tender.amount, 0);
  assertExternalCorrection(externalPaid, externalTenders, vouchers.length);
  if (externalRefunded > externalPaid) throw new ConvexError('Prior external refunds exceed collection');
  if (new Set(vouchers.map(({ voucherId }) => voucherId)).size !== vouchers.length) {
    throw new ConvexError('Each funding voucher can appear only once');
  }

  let remaining = amount;
  const credits = [];
  for (const { voucherId, paid, credited, status } of vouchers) {
    assertMoney(paid, 'Voucher contribution');
    assertMoney(credited, 'Prior voucher credit', { allowZero: true });
    if (credited > paid) throw new ConvexError('Prior voucher credits exceed its contribution');
    const credit = Math.min(remaining, paid - credited);
    if (credit === 0) continue;
    remaining -= credit;
    credits.push({
      voucherId,
      amount: credit,
      replacementValidityDays: status === 'expired' || status === 'disabled' ? 90 : null,
    });
  }
  if (remaining > externalPaid - externalRefunded) throw new ConvexError('Refund exceeds remaining receipt payments');

  const byMethod = new Map<TenderMethod, number>();
  for (const { method, amount } of externalTenders) {
    byMethod.set(method, (byMethod.get(method) ?? 0) + amount);
  }
  const primary = [...byMethod].reduce<[TenderMethod, number] | null>((best, tender) => {
    return !best || tender[1] > best[1] ? tender : best;
  }, null);

  const goodwillCredits = goodwill.flatMap(({ voucherId, amount, status }) => {
    assertMoney(amount, 'Goodwill restoration', { allowZero: true });
    return amount > 0 && (status === 'active' || status === 'paused') ? [{ voucherId, amount }] : [];
  });
  return {
    voucherCredits: credits,
    external: remaining > 0 && primary ? { method: primary[0], amount: remaining } : null,
    goodwillCredits,
  };
}
