import type { Doc, Id } from '../../_generated/dataModel';
import { assertMoney } from '../../shared/money';
import { MAX_TENDERS, type Tender, type TenderMethod } from '../../shared/orderMath';
import {
  assertPaymentPlan, needsPaymentCheck, paymentError, paymentGet,
  type Attempt, type ExternalLeg, type FundingVoucher, type PaymentCtx,
} from './paymentAttempt';

export const MAX_PAYMENT_ATTEMPT_DEPTH = 20;

/** A child can start only once its parent is fully checked. Count immutable evidence across the chain. */
export async function paymentEvidence(ctx: PaymentCtx, attempt: Attempt) {
  const chain = [attempt];
  let parentId = attempt.parentAttemptId;
  while (parentId) {
    if (chain.length >= MAX_PAYMENT_ATTEMPT_DEPTH) throw new Error('Payment recovery exceeds its supported depth.');
    const parent = await paymentGet(ctx, parentId);
    if (!parent || parent.orderId !== attempt.orderId || parent.status !== 'resolved') {
      throw new Error('The payment recovery chain is incomplete.');
    }
    chain.push(parent);
    parentId = parent.parentAttemptId;
  }
  const kept = new Map<TenderMethod, Tender>();
  const check: { kind: 'collection' | 'give_back'; leg: ExternalLeg }[] = [];
  for (const step of [...chain].reverse()) {
    for (const [kind, legs] of [['collection', step.legs], ['give_back', step.resolution?.giveBackLegs ?? []]] as const) {
      for (const leg of legs) {
        if (needsPaymentCheck(leg)) check.push({ kind, leg });
        if (leg.state !== 'taken') continue;
        const existing = kept.get(leg.method);
        const amount = (existing?.amount ?? 0) + (kind === 'collection' ? leg.amount : -leg.amount);
        if (amount < 0) throw new Error('Give-back exceeds verified money taken for this method.');
        if (amount) kept.set(leg.method, { method: leg.method, amount, ...(existing || kind === 'give_back' ? {} : { received: leg.received }) });
        else kept.delete(leg.method);
      }
    }
  }
  return { kept: [...kept.values()], check, depth: chain.length };
}

export function combinePaymentMethods(kept: Tender[], planned: Pick<ExternalLeg, 'method' | 'amount'>[]) {
  const byMethod = new Map(kept.map(tender => [tender.method, tender]));
  for (const { method, amount } of planned) {
    assertMoney(amount, 'Payment');
    const already = byMethod.get(method);
    byMethod.set(method, { method, amount: (already?.amount ?? 0) + amount });
  }
  return [...byMethod.values()];
}

export function assertRecoveryPlan(kept: Tender[], legs: Pick<ExternalLeg, 'method' | 'amount' | 'key'>[], vouchers: FundingVoucher[], due: number) {
  const voucherAmount = vouchers.reduce((sum, item) => sum + item.paid + item.goodwill, 0);
  const remaining = due - voucherAmount - kept.reduce((sum, tender) => sum + tender.amount, 0);
  assertPaymentPlan(legs, [], remaining);
  const combined = combinePaymentMethods(kept, legs);
  if (combined.length + vouchers.filter(voucher => voucher.paid > 0).length > MAX_TENDERS) {
    paymentError('payment_limit', 'Split across at most three payment methods including vouchers.');
  }
  return combined;
}

export function checkedLeg(attempt: Attempt, kind: 'collection' | 'give_back', legKey: string) {
  return (kind === 'collection' ? attempt.legs : attempt.resolution?.giveBackLegs ?? []).find(leg => leg.key === legKey);
}

export async function availableRecoveryVouchers(
  ctx: PaymentCtx, vouchers: FundingVoucher[], branch: Id<'branches'> | undefined, now: number,
) {
  const current = await Promise.all(vouchers.map(async funding => {
    const voucher = await paymentGet(ctx, funding.voucherId);
    return voucher && voucher.branchId === branch && voucher.status === 'active' && !voucher.pendingReturnId &&
      !voucher.pause && (voucher.effectiveExpiresAt === null || voucher.effectiveExpiresAt > now) && voucher.paidBalance >= funding.paid &&
      voucher.goodwillBalance >= funding.goodwill ? funding : null;
  }));
  return current.filter((item): item is FundingVoucher => item !== null);
}

export function recoveryView(attempt: Attempt, order: Doc<'orders'>) {
  return { orderRevision: order.revision, due: order.due, giveBackLegs: attempt.resolution?.giveBackLegs ?? [] };
}
