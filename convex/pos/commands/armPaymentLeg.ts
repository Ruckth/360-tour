import { ConvexError, v } from 'convex/values';
import { placeCheckoutHolds } from '../../commerce/model';
import { staffMutation } from '../../auth/model';
import { CHECKOUT_STOCK_HOLD_MS } from '../../shared/commerce/caps';
import { assertTenders } from '../../shared/orderMath';
import { reserveWrites } from '../../lib/readBudget';
import {
  assertActiveAttempt, assertNewPayments, assertOperatorLoad, attemptForOwner, attemptOwnerArgs, attemptView, checkoutPaymentSettings,
  externalTenders, instructionOrigin, needsPaymentCheck, paymentError, paymentLoadArgs, paymentRefusal,
} from '../private/paymentAttempt';
import { combinePaymentMethods, paymentEvidence } from '../private/paymentRecovery';
import { freezeAttemptCatalogue, preflightAttempt } from '../private/attemptPreflight';
import { reviewedStock, stockReviewMatches } from '../private/paymentCommerce';

export const armPaymentLeg = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, ...paymentLoadArgs, legKey: v.string(), tendered: v.optional(v.union(v.number(), v.null())),
    updateTendered: v.optional(v.literal(true)), stockInHand: v.optional(v.boolean()), stockReview: v.optional(reviewedStock) },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      const settings = await checkoutPaymentSettings(ctx);
      assertNewPayments(settings);
      await assertOperatorLoad(ctx, args, settings);
      const pending = attempt.legs.find(needsPaymentCheck);
      if (args.updateTendered) {
        if (!pending || pending.key !== args.legKey || pending.state !== 'instructed' || pending.method !== 'cash') {
          paymentError('leg_not_instructed', 'This cash payment is no longer open for entry.');
        }
        const tendered = args.tendered ?? undefined;
        assertTenders([{ ...pending, received: tendered }], pending.amount);
        if (pending.tendered !== tendered) {
          reserveWrites(ctx, 1);
          await ctx.db.patch(attempt._id, { legs: attempt.legs.map(leg => leg.key === pending.key ? { ...leg, tendered } : leg) });
        }
        return { status: 'tendered' as const };
      }
      if (pending) return { status: 'check_previous' as const, leg: pending, attempt: attemptView(attempt) };
      const giveBack = attempt.resolution?.giveBackLegs.find(needsPaymentCheck);
      if (giveBack) return { status: 'check_previous' as const, kind: 'give_back' as const, leg: giveBack, attempt: attemptView(attempt) };
      if (attempt.status === 'refused' && attempt.refusal) return { status: 'refused' as const, ...attempt.refusal };
      if (attempt.status !== 'collecting' && attempt.status !== 'recovering') paymentError('attempt_not_collecting', 'Review this payment before taking money.');
      const leg = attempt.legs.find(candidate => candidate.key === args.legKey);
      if (!leg || leg.state !== 'planned') paymentError('leg_not_planned', 'Choose an unpaid payment part.');
      const now = Date.now();
      const { kept } = await paymentEvidence(ctx, attempt);
      const tenders = attempt.parentAttemptId
        ? combinePaymentMethods(kept, attempt.legs.filter(part => part.state === 'planned'))
        : externalTenders(attempt.legs.filter(part => part.state !== 'declined'));
      const tendered = args.tendered ?? undefined;
      assertTenders([{ ...leg, received: tendered }], leg.amount);
      const stockHoldUntil = now + CHECKOUT_STOCK_HOLD_MS;
      const { sale, frozen } = await preflightAttempt(ctx, order, attempt, settings, ctx.staff, tenders, now, kept.length > 0, stockHoldUntil);
      const confirmed = args.stockInHand && !order.stockBranchId || stockReviewMatches(sale.stockShortages, args.stockReview);
      if (!confirmed && !kept.length) {
        return { status: 'confirm_stock' as const, shortages: sale.stockShortages };
      }
      const currentHoldTimes = sale.restock.flatMap(row => row.reservationExpiresAt === undefined ? [] : [row.reservationExpiresAt]);
      if (sale.branch) {
        const lines = sale.restock
          .filter(row => row.holdAtArm)
          .map(row => ({ variantId: row.variant.id, quantity: row.quantity, lotAllocations: row.lotAllocations }));
        if (lines.length) {
          await placeCheckoutHolds(ctx, {
            orderId: order._id, branchId: sale.branch._id, attemptId: attempt._id, legKey: leg.key, lines, actor: ctx.staff.email,
            expiresAt: stockHoldUntil,
          });
          currentHoldTimes.push(stockHoldUntil);
        }
      }
      const instructed = {
        ...leg, tendered, state: 'instructed' as const, instructedAt: now, ...instructionOrigin(attempt),
        stockHoldUntil: currentHoldTimes.length ? Math.min(...currentHoldTimes) : undefined,
      };
      const legs = attempt.legs.map(candidate => candidate.key === leg.key ? instructed : candidate);
      if (!frozen) await freezeAttemptCatalogue(ctx, attempt, sale.frozenCatalogue);
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { legs, updatedAt: now });
      return { status: 'instruct' as const, leg: instructed, attempt: attemptView({ ...attempt, legs }) };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
