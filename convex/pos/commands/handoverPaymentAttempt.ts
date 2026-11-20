import { ConvexError, v } from 'convex/values';
import { staffMutation, staffQuery } from '../../auth/model';
import { cutoverRevision, readCommerceSettings } from '../../commerce/model';
import { reserveWrites } from '../../lib/readBudget';
import {
  assertActiveAttempt, assertOperatorLoad, assertTillId, attemptForOwner, attemptOwnerArgs, attemptView,
  ownsPaymentAttempt, paymentError, paymentGet, paymentLoadArgs, paymentOperator, paymentOrder, paymentRefusal, paymentTabArgs,
} from '../private/paymentAttempt';
import { findPaymentTill, paymentTillLabel, paymentTillsAtRevision } from '../private/tillPayments';

/**
 * Where the owner can hand a payment over (v27 Handover): every other till admitted at the current
 * cutover, by its label, and this till's own label so staff can tell them apart. The till that
 * receives it accepts it there (takeOverPaymentAttempt).
 */
export const handoverTills = staffQuery({
  capability: 'checkout',
  args: { tillId: v.string() },
  returns: v.object({ thisTill: v.union(v.string(), v.null()), tills: v.array(v.object({ tillId: v.id('tills'), label: v.string() })) }),
  handler: async (ctx, args) => {
    const own = ctx.db.normalizeId('tills', args.tillId);
    const thisTill = own ? paymentTillLabel({ _id: own, key: 'payment' }) : null;
    const revision = cutoverRevision(await readCommerceSettings(ctx));
    if (revision === null) return { thisTill, tills: [] };
    const { acknowledged } = await paymentTillsAtRevision(ctx, revision);
    return { thisTill, tills: acknowledged.filter(till => till._id !== own).map(till => ({ tillId: till._id, label: paymentTillLabel(till) })) };
  },
});

export const releasePaymentAttempt = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, nextTillId: v.string() },
  handler: async (ctx, args) => {
    try {
      assertTillId(args.nextTillId);
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      const nextTillId = ctx.db.normalizeId('tills', args.nextTillId);
      const nextTill = nextTillId ? await findPaymentTill(ctx, nextTillId) : undefined;
      if (nextTill?.key !== 'payment') paymentError('invalid_till', 'Choose a till before handing over.');
      if (nextTill._id === attempt.tillId) paymentError('invalid_till', 'Choose another till to hand over to.');
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { owner: '', ownerToken: undefined, ownerTab: undefined, ownerDisplayName: undefined,
        tillId: nextTill._id, tillLabel: paymentTillLabel(nextTill), ownerRevision: attempt.ownerRevision + 1, updatedAt: Date.now() });
      return { status: 'released' as const, ownerRevision: attempt.ownerRevision + 1, tillId: args.nextTillId };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});

export const takeOverPaymentAttempt = staffMutation({
  capability: 'checkout',
  args: { ...paymentLoadArgs, ...paymentTabArgs, orderId: v.id('orders'), tillId: v.string(), expectedOwnerRevision: v.number(), stoppedPreviousOperator: v.optional(v.boolean()) },
  handler: async (ctx, args) => {
    try {
      assertTillId(args.tillId);
      const order = await paymentOrder(ctx, args.orderId, ctx.staff);
      const attempt = order?.activeAttemptId ? await paymentGet(ctx, order.activeAttemptId) : null;
      if (!attempt || order?.status !== 'draft') paymentError('attempt_missing', 'This payment was not found.');
      const { till, tabKey } = await assertOperatorLoad(ctx, args);
      if (attempt.ownerRevision === args.expectedOwnerRevision + 1 && await ownsPaymentAttempt(attempt, ctx.staff, args)) {
        return { status: 'taken_over' as const, attempt: attemptView(attempt), replayed: true };
      }
      if (attempt.ownerRevision !== args.expectedOwnerRevision) paymentError('payment_handed_over', 'This payment was handed over.');
      const releasedHere = !attempt.owner && attempt.tillId === args.tillId;
      if (!releasedHere && (ctx.staff.role === 'cashier' || !args.stoppedPreviousOperator)) {
        paymentError('takeover_refused', 'The current till must hand over or a manager must confirm the operator has stopped.');
      }
      // Existing instructed legs stay locked. The new operator can record their verified outcomes.
      const takeover = { ...await paymentOperator(ctx, ctx.staff, till, tabKey), ownerRevision: attempt.ownerRevision + 1, updatedAt: Date.now() };
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, takeover);
      return { status: 'taken_over' as const, attempt: attemptView({ ...attempt, ...takeover }), replayed: false };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
