import { ConvexError, v, type Infer, type Value } from 'convex/values';
import type { Doc, Id, TableNames } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { canReadCheckoutOrder, type StaffActor } from '../../auth/model';
import { assertAttemptPaymentAdmission, paymentTillLoad, readDefaultBranch, resolveCommerceSettings } from '../../commerce/model';
import { readBudget } from '../../lib/readBudget';
import { canSpendVoucher, COMMERCE_LIMITS } from '../../shared/commerce';
import { assertMoney } from '../../shared/money';
import { assertTenders, MAX_TENDERS } from '../../shared/orderMath';
import { effectiveTime } from '../../shared/bookingMoney';
import { sha256 } from '../../shared/displayTokens';
import { ownsPaymentAttempt, paymentTabArgs, paymentTillLabel, validPaymentDeviceKey } from './tillPayments';
import { tenderMethod } from '../../shared/financeValidators';
import { isCalendarDate } from '../../shared/dates';
import { resortMidnight, resortTodayIso } from '../../shared/time';
import { reviewedVoucher } from '../validators';

export type PaymentCtx = QueryCtx | MutationCtx;
export type Attempt = Doc<'paymentAttempts'>;
export type ExternalLeg = Attempt['legs'][number];
export type FundingVoucher = Infer<typeof reviewedVoucher>;

export const paymentPlanArgs = {
  legs: v.array(v.object({ key: v.string(), method: tenderMethod, amount: v.number() })),
  vouchers: v.array(reviewedVoucher),
};

export { ownsPaymentAttempt, paymentTabArgs };
export const paymentLoadArgs = { load: v.optional(paymentTillLoad) };

export const attemptOwnerArgs = {
  attemptId: v.id('paymentAttempts'),
  tillId: v.string(),
  ownerRevision: v.number(),
  ...paymentTabArgs,
};

export function paymentError(code: string, message: string): never {
  throw new ConvexError({ code, message });
}

export function paymentRefusal(error: ConvexError<Value>) {
  const data = error.data;
  if (data && typeof data === 'object' && 'message' in data && typeof data.message === 'string') {
    return { status: 'refused' as const, code: typeof data.code === 'string' ? data.code : 'review_required', message: data.message };
  }
  return { status: 'refused' as const, code: 'review_required', message: typeof data === 'string' ? data : 'Review the payment again.' };
}

export async function paymentGet<T extends TableNames>(ctx: PaymentCtx, id: Id<T>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const doc = await ctx.db.get(id);
  if (doc) budget.document(doc);
  budget.assert();
  return doc;
}

export async function paymentRange<T>(ctx: PaymentCtx, take: () => Promise<T[]>) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const rows = await take();
  for (const row of rows) {
    budget.document(row);
    budget.assert();
  }
  return rows;
}

export async function checkoutPaymentSettings(ctx: PaymentCtx) {
  const [settings, duplicate] = await paymentRange(ctx, () => ctx.db.query('commerceSettings')
    .withIndex('by_key', q => q.eq('key', 'default')).take(2));
  if (duplicate) throw new Error('Checkout has duplicate commerce settings.');
  return resolveCommerceSettings(settings);
}

export async function readAttemptByKey(ctx: PaymentCtx, key: string) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const row = await ctx.db.query('paymentAttempts').withIndex('by_key', q => q.eq('key', key)).unique();
  if (row) budget.document(row);
  budget.assert();
  return row;
}

export async function paymentOrder(ctx: PaymentCtx, id: Id<'orders'>, actor: StaffActor) {
  const order = await paymentGet(ctx, id);
  if (!order || !canReadCheckoutOrder(actor, order)) paymentError('order_unavailable', 'Order not found');
  return order;
}

export function assertTillId(tillId: string) {
  if (!tillId.trim() || tillId.length > 160) paymentError('invalid_till', 'Choose a till before taking payment.');
}

export function holdsInstruction(attempt: Attempt) {
  return attempt.legs.some(leg => leg.instructedAt !== undefined);
}

export function assertNewPayments(settings: Awaited<ReturnType<typeof checkoutPaymentSettings>>) {
  if (settings.paymentsMode !== 'attempts') paymentError('payments_direct', 'This till uses direct payments.');
  if (settings.cutover && !settings.cutover.activatedAt) paymentError('checkout_paused', 'Checkout is paused for update.');
}

/**
 * `checkPrevious` on a part: no screen may show its instruction again, only Check previous payment.
 * Its outcome is unknown, or it was instructed under an earlier owner revision (before a handover,
 * however many times the payment has since come back). Within the current revision only the call
 * that armed it may show the instruction; every other screen also checks (the panel decides that).
 */
export function legView(attempt: Pick<Attempt, 'ownerRevision'>, leg: ExternalLeg) {
  return { ...leg, checkPrevious: leg.state === 'unknown' || (leg.state === 'instructed' && leg.instructedOwnerRevision !== attempt.ownerRevision) };
}

export function attemptView(attempt: Attempt) {
  return {
    attemptId: attempt._id, orderId: attempt.orderId, status: attempt.status,
    ...attemptOwnerView(attempt), reviewedRequest: attempt.reviewedRequest, legs: attempt.legs.map(leg => legView(attempt, leg)),
    parentAttemptId: attempt.parentAttemptId, refusal: attempt.refusal,
    giveBackLegs: (attempt.resolution?.giveBackLegs ?? []).map(leg => legView(attempt, leg)),
    notifyGuest: attempt.notifyGuest ?? false,
  };
}

export function assertBusinessDate(date: string) {
  const now = Date.now();
  const today = resortTodayIso(now);
  if (!isCalendarDate(date) || date > today) paymentError('invalid_business_date', 'Choose a valid payment date.');
  effectiveTime(date === today ? now : resortMidnight(date), now);
}

export function assertPaymentPlan(legs: Infer<typeof paymentPlanArgs.legs>, vouchers: FundingVoucher[], due: number) {
  if (vouchers.length > COMMERCE_LIMITS.sale.distinctFundingVouchers ||
      new Set(vouchers.map(voucher => voucher.voucherId)).size !== vouchers.length) {
    paymentError('voucher_limit', 'Choose at most two distinct vouchers.');
  }
  if (legs.length + vouchers.filter(voucher => voucher.paid > 0).length > MAX_TENDERS) {
    paymentError('payment_limit', 'Split across at most three payments including vouchers.');
  }
  if (new Set(legs.map(leg => leg.key)).size !== legs.length || legs.some(leg => !leg.key.trim() || leg.key.length > 100)) {
    paymentError('invalid_leg_key', 'Each payment part needs its own key.');
  }
  let voucherTotal = 0;
  for (const voucher of vouchers) {
    assertMoney(voucher.paid, 'Voucher payment', { allowZero: true });
    assertMoney(voucher.goodwill, 'Voucher discount', { allowZero: true });
    assertMoney(voucher.paid + voucher.goodwill, 'Voucher value');
    voucherTotal += voucher.paid + voucher.goodwill;
  }
  assertTenders(legs, due - voucherTotal);
}

export async function checkFundingVouchers(
  ctx: PaymentCtx, order: Doc<'orders'>, lines: Doc<'orderLines'>[], vouchers: FundingVoucher[], issuesVoucher: boolean, now: number, selectedBranch?: Doc<'branches'> | null,
) {
  if (vouchers.length && (issuesVoucher || !canSpendVoucher(lines, order.bookingId))) {
    paymentError('voucher_not_allowed', 'Vouchers cannot pay a stay or a sale that issues voucher value.');
  }
  if (!vouchers.length) return [];
  const branch = selectedBranch ?? await defaultPaymentBranch(ctx);
  return await Promise.all(vouchers.map(async funding => {
    const voucher = await paymentGet(ctx, funding.voucherId);
    if (!voucher || voucher.branchId !== branch._id || voucher.status !== 'active' || voucher.pause ||
        voucher.pendingReturnId || (voucher.effectiveExpiresAt !== null && now >= voucher.effectiveExpiresAt) ||
        funding.paid > voucher.paidBalance || funding.goodwill > voucher.goodwillBalance) {
      paymentError('voucher_changed', 'A funding voucher is no longer available for the reviewed amount.');
    }
    return { funding, voucher };
  }));
}

export function attemptOwnerView(attempt: Attempt) {
  const { tillId, owner, ownerRevision, tillLabel, ownerDisplayName } = attempt;
  return { tillId, owner, ownerRevision, tillLabel, ownerDisplayName };
}

export async function defaultPaymentBranch(ctx: PaymentCtx) {
  const branch = await readDefaultBranch(ctx);
  if (!branch) paymentError('branch_unavailable', 'Checkout is still being set up.');
  return branch;
}

type Tab = { tillId: string; tabKey?: string };
type Load = Tab & { load?: Infer<typeof paymentTillLoad> };

export async function assertOperatorLoad(ctx: PaymentCtx, args: Load, settings?: Awaited<ReturnType<typeof checkoutPaymentSettings>>) {
  if (!validPaymentDeviceKey(args.tabKey) || !args.load || args.load.tillId !== args.tillId) {
    paymentError('TILL_NEEDS_RELOAD', 'Reload this till before taking payment.');
  }
  return { till: await assertAttemptPaymentAdmission(ctx, args.load, settings), tabKey: args.tabKey };
}

export async function paymentOperator(ctx: PaymentCtx, actor: StaffActor, till: Doc<'tills'>, tabKey: string) {
  const identity = await ctx.auth.getUserIdentity();
  return {
    owner: actor.email, ownerToken: actor.tokenIdentifier, ownerTab: await sha256(tabKey),
    ownerDisplayName: identity?.name?.trim().slice(0, 160) || undefined,
    tillId: till._id, tillLabel: paymentTillLabel(till),
  };
}

export async function attemptForOwner(ctx: PaymentCtx, actor: StaffActor, args: Tab & { attemptId: Id<'paymentAttempts'>; ownerRevision: number }) {
  assertTillId(args.tillId);
  const attempt = await paymentGet(ctx, args.attemptId);
  if (!attempt) paymentError('attempt_missing', 'This payment was not found.');
  const order = await paymentOrder(ctx, attempt.orderId, actor);
  if (attempt.ownerRevision !== args.ownerRevision) paymentError('payment_handed_over', 'This payment was handed over.');
  if (!await ownsPaymentAttempt(attempt, actor, args)) {
    paymentError('in_progress_elsewhere', 'This payment is in progress on another till or tab.');
  }
  return { attempt, order };
}

export function instructionOrigin(attempt: Attempt) {
  return { instructedTillId: attempt.tillId, instructedTab: attempt.ownerTab, instructedOwnerRevision: attempt.ownerRevision };
}

/** Lifecycle operations can proceed once cancellation or settlement removes the live attempt. */
export function assertNoActivePayment(order: Doc<'orders'>) {
  if (order.activeAttemptId) paymentError('payment_in_progress', 'Resolve the payment in progress before changing this order.');
}

export function needsPaymentCheck(leg: ExternalLeg) {
  return leg.state === 'instructed' || leg.state === 'unknown';
}

export function assertActiveAttempt(order: Doc<'orders'>, attempt: Attempt) {
  if (order.activeAttemptId !== attempt._id || order.status !== 'draft') {
    paymentError('attempt_closed', 'This payment is no longer active.');
  }
}

export function externalTenders(legs: ExternalLeg[]) {
  return legs.map(({ method, amount, received }) => ({ method, amount, received }));
}
