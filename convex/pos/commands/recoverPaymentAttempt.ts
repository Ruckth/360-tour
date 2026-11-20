import { ConvexError, v, type Infer, type ObjectType } from 'convex/values';
import { staffMutation, type StaffActor } from '../../auth/model';
import type { MutationCtx } from '../../_generated/server';
import type { Doc } from '../../_generated/dataModel';
import { reserveWrites } from '../../lib/readBudget';
import { attemptKey } from '../../shared/bookingMoney';
import { COMMERCE_LIMITS } from '../../shared/commerce';
import { assertMoney } from '../../shared/money';
import { sha256 } from '../../shared/displayTokens';
import { orderTotals } from '../../shared/orderMath';
import {
  assertActiveAttempt, assertNewPayments, assertOperatorLoad, attemptForOwner, attemptOwnerArgs, attemptView,
  checkoutPaymentSettings, defaultPaymentBranch, instructionOrigin, ownsPaymentAttempt, paymentError, paymentLoadArgs, paymentPlanArgs,
  paymentRefusal, readAttemptByKey, type Attempt,
} from '../private/paymentAttempt';
import { prepareCommercePayment } from '../private/paymentCommerce';
import { checkPaymentCart, readPaymentLines } from '../private/paymentReview';
import { assertRecoveryPlan, availableRecoveryVouchers, MAX_PAYMENT_ATTEMPT_DEPTH, paymentEvidence } from '../private/paymentRecovery';

const reviewFields = {
  expectedRevision: v.number(),
  customers: v.array(v.object({ customerId: v.id('customers'), revision: v.number() })),
  vouchers: paymentPlanArgs.vouchers,
};

async function recoveryQuote(
  ctx: MutationCtx, order: Doc<'orders'>, attempt: Attempt, review: ObjectType<typeof reviewFields>, actor: StaffActor,
) {
  if (review.customers.length > 101 || review.vouchers.length > COMMERCE_LIMITS.sale.distinctFundingVouchers ||
      new Set(review.vouchers.map(item => item.voucherId)).size !== review.vouchers.length) {
    paymentError('request_limit', 'Review the payment before continuing.');
  }
  if (order.revision !== review.expectedRevision) paymentError('order_changed', 'Review the order again.');
  for (const voucher of review.vouchers) {
    assertMoney(voucher.paid, 'Voucher payment', { allowZero: true });
    assertMoney(voucher.goodwill, 'Voucher discount', { allowZero: true });
    assertMoney(voucher.paid + voucher.goodwill, 'Voucher value');
  }
  const { kept, check, depth } = await paymentEvidence(ctx, attempt);
  if (check.length) paymentError('check_previous', 'Check the previous payment first.');
  const settings = await checkoutPaymentSettings(ctx);
  const now = Date.now();
  const lines = await readPaymentLines(ctx, order, { allowEmpty: true });
  const branch = review.vouchers.length ? await defaultPaymentBranch(ctx) : undefined;
  const vouchers = await availableRecoveryVouchers(ctx, review.vouchers, branch?._id, now);
  const due = orderTotals(lines).due;
  const keptAmount = kept.reduce((sum, tender) => sum + tender.amount, 0);
  const paidByVoucher = vouchers.reduce((sum, voucher) => sum + voucher.paid + voucher.goodwill, 0);
  if (paidByVoucher > due) paymentError('voucher_amount', 'Voucher value exceeds what the order owes.');
  const reviewedRequest = {
    revision: review.expectedRevision, due, customers: review.customers, vouchers,
    settingsRevision: settings.revision, businessDate: attempt.reviewedRequest.businessDate,
  };
  return { settings, now, lines, kept, keptAmount, reviewedRequest, depth, balance: due - paidByVoucher - keptAmount, actor };
}

async function checkRecoveryCart(
  ctx: MutationCtx, order: Doc<'orders'>, quote: Awaited<ReturnType<typeof recoveryQuote>>, legs: Infer<typeof paymentPlanArgs.legs>,
) {
  const { settings, now, reviewedRequest, actor, kept } = quote;
  assertNewPayments(settings);
  const tenders = assertRecoveryPlan(kept, legs, reviewedRequest.vouchers, reviewedRequest.due);
  const cart = await checkPaymentCart(ctx, order, reviewedRequest, { lines: quote.lines });
  return await prepareCommercePayment(ctx, {
    order, settings, actor, tenders, now, lines: cart.lines, appointment: cart.appointment, vouchers: reviewedRequest.vouchers,
  });
}

/** Shows the durable balance and live reasons for any refusal after reconciling the prior instruction. */
export const previewPaymentRecovery = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, ...reviewFields },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      const quote = await recoveryQuote(ctx, order, attempt, args, ctx.staff);
      const { kept, balance, reviewedRequest } = quote;
      const candidate = balance > 0 ? [{ key: 'preview', method: kept[0]?.method ?? 'cash' as const, amount: balance }] : [];
      let refusal;
      if (balance >= 0) {
        try { await checkRecoveryCart(ctx, order, quote, candidate); }
        catch (error) {
          if (!(error instanceof ConvexError)) throw error;
          const { code, message } = paymentRefusal(error);
          refusal = { code, message };
        }
      }
      return {
        status: 'recovery' as const, kept, balance, vouchers: reviewedRequest.vouchers, refusal,
        next: refusal ? 'swap_or_give_back' as const : balance > 0 ? 'collect' as const : balance < 0 ? 'give_back' as const : 'finish' as const,
      };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});

export const startPaymentRecovery = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, ...reviewFields, clientKey: v.string(), legs: paymentPlanArgs.legs },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      const key = attemptKey(args.clientKey);
      const fingerprint = await sha256(JSON.stringify([
        attempt._id, args.expectedRevision, args.customers, args.legs, args.vouchers,
      ]));
      const replay = await readAttemptByKey(ctx, key);
      if (replay) {
        if (replay.parentAttemptId !== attempt._id || !await ownsPaymentAttempt(replay, ctx.staff, args) ||
            replay.fingerprint.split(':')[0] !== fingerprint) paymentError('payment_key_conflict', 'This payment key was already used.');
        return { status: 'ready' as const, attempt: attemptView(replay), replayed: true };
      }
      assertActiveAttempt(order, attempt);
      const quote = await recoveryQuote(ctx, order, attempt, args, ctx.staff);
      if (quote.depth >= MAX_PAYMENT_ATTEMPT_DEPTH) paymentError('recovery_limit', 'Give back the collected amount and close this payment.');
      if (quote.balance < 0) paymentError('give_back_required', 'Give back only the excess before finishing this sale.');
      const sale = await checkRecoveryCart(ctx, order, quote, args.legs);
      const now = quote.now;
      const fields = {
        orderId: order._id, key, fingerprint: `${fingerprint}:${sale.catalogFingerprint}`, reviewedRequest: quote.reviewedRequest,
        legs: args.legs.map(leg => ({ ...leg, state: 'planned' as const })),
        status: 'recovering' as const, ownerRevision: attempt.ownerRevision,
        tillId: attempt.tillId, tillLabel: attempt.tillLabel, owner: attempt.owner, ownerTab: attempt.ownerTab,
        ownerToken: attempt.ownerToken, ownerDisplayName: attempt.ownerDisplayName, parentAttemptId: attempt._id, createdAt: now, updatedAt: now,
      };
      reserveWrites(ctx, 3);
      const id = await ctx.db.insert('paymentAttempts', fields);
      await ctx.db.patch(attempt._id, {
        status: 'resolved', resolution: { giveBackLegs: attempt.resolution?.giveBackLegs ?? [], settledAttemptId: id, resolvedAt: now },
        updatedAt: now,
      });
      await ctx.db.patch(order._id, { activeAttemptId: id });
      return { status: 'ready' as const, attempt: attemptView({ ...fields, _id: id, _creationTime: now }), replayed: false,
        stockShortages: sale.stockShortages };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});

/** Persist the give-back instruction before asking staff to use the terminal or drawer. */
export const armPaymentGiveBack = staffMutation({
  capability: 'checkout',
  args: {
    ...attemptOwnerArgs, ...paymentLoadArgs, ...reviewFields, leg: paymentPlanArgs.legs.element,
    cancelSale: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      await assertOperatorLoad(ctx, args);
      const previous = attempt.resolution?.giveBackLegs ?? [];
      const existing = previous.find(leg => leg.key === args.leg.key);
      if (existing) {
        if (existing.amount !== args.leg.amount || existing.method !== args.leg.method) paymentError('payment_key_conflict', 'This give-back key was already used.');
        return { status: existing.state === 'unknown' || existing.state === 'instructed' ? 'check_previous' as const : 'already_recorded' as const, leg: existing };
      }
      const now = Date.now();
      let kept;
      let excess;
      if (args.cancelSale) {
        if (order.revision !== args.expectedRevision) paymentError('order_changed', 'Review the order again.');
        const evidence = await paymentEvidence(ctx, attempt);
        if (evidence.check.length) paymentError('check_previous', 'Check the previous payment first.');
        kept = evidence.kept;
        excess = kept.reduce((sum, tender) => sum + tender.amount, 0);
      } else {
        const quote = await recoveryQuote(ctx, order, attempt, args, ctx.staff);
        kept = quote.kept;
        excess = Math.max(0, -quote.balance);
        if (quote.balance >= 0) {
          const proposed = quote.balance ? [{ key: 'preview', method: kept[0]?.method ?? 'cash' as const, amount: quote.balance }] : [];
          try { await checkRecoveryCart(ctx, order, quote, proposed); }
          catch (error) {
            if (!(error instanceof ConvexError)) throw error;
            excess = quote.keptAmount;
          }
        }
      }
      const methodBalance = kept.find(tender => tender.method === args.leg.method)?.amount ?? 0;
      if (args.leg.amount > Math.min(excess, methodBalance)) paymentError('give_back_amount', 'Give back only the verified excess from that method.');
      assertRecoveryPlan([], [args.leg], [], args.leg.amount);
      if (previous.length >= 20) paymentError('give_back_limit', 'This payment has too many give-back parts.');
      const leg = { ...args.leg, state: 'instructed' as const, instructedAt: now, ...instructionOrigin(attempt) };
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { status: 'refused', refusal: { code: 'recovery_required', message: 'Review the remaining balance.' },
        resolution: { giveBackLegs: [...previous, leg], resolvedAt: now }, updatedAt: now });
      return { status: 'instruct' as const, leg };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});

export const beginPaymentSwap = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, expectedRevision: v.number() },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      if (order.revision !== args.expectedRevision) paymentError('order_changed', 'Review the order again.');
      const { check } = await paymentEvidence(ctx, attempt);
      if (check.length) paymentError('check_previous', 'Check the previous payment first.');
      const refusal = { code: 'swap_requested', message: 'Review the cart after the swap.' };
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { status: 'refused', refusal, updatedAt: Date.now() });
      return { status: 'swap' as const, revision: order.revision };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
