import { ConvexError, v } from 'convex/values';
import { releaseCheckoutHolds } from '../../commerce/model';
import { staffMutation } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { checkedLeg, paymentEvidence } from '../private/paymentRecovery';
import { assertTenders, changeDue } from '../../shared/orderMath';
import {
  assertActiveAttempt, attemptForOwner, attemptOwnerArgs, attemptView, needsPaymentCheck, paymentError, paymentRefusal,
} from '../private/paymentAttempt';

export const recordPaymentLeg = staffMutation({
  capability: 'checkout',
  args: {
    ...attemptOwnerArgs, kind: v.optional(v.union(v.literal('collection'), v.literal('give_back'))), legKey: v.string(), outcome: v.union(v.literal('taken'), v.literal('declined'), v.literal('unknown')),
    received: v.optional(v.number()), reference: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      const kind = args.kind ?? 'collection';
      const leg = checkedLeg(attempt, kind, args.legKey);
      if (!leg) paymentError('leg_missing', 'Payment part not found.');
      const reference = args.reference?.trim() || undefined;
      if (reference && reference.length > 160) paymentError('invalid_reference', 'Enter a shorter payment reference.');
      if (args.received !== undefined && args.outcome !== 'taken') paymentError('invalid_cash', 'Record cash received only after it was taken.');
      if (kind === 'give_back' && args.received !== undefined) paymentError('invalid_cash', 'Enter cash received for collections only.');
      const received = kind === 'collection' && args.outcome === 'taken' && leg.method === 'cash' ? args.received ?? leg.received ?? leg.tendered : args.received;
      if (kind === 'collection' && args.outcome === 'taken' && leg.method === 'cash' && received === undefined) {
        paymentError('invalid_cash', 'Enter the cash received before recording this payment.');
      }
      const tender = { method: leg.method, amount: leg.amount, received };
      assertTenders([tender], leg.amount);
      const change = received === undefined ? undefined : changeDue([tender]);
      if (leg.state === args.outcome && leg.received === received && leg.reference === reference) {
        return { status: 'recorded' as const, attempt: attemptView(attempt), replayed: true };
      }
      assertActiveAttempt(order, attempt);
      if (!needsPaymentCheck(leg)) paymentError('leg_not_instructed', 'This payment part already has an outcome or has not been instructed.');
      const update = { ...leg, state: args.outcome, received, change, reference };
      const apply = (candidate: typeof leg) => candidate.key === leg.key ? update : candidate;
      const resolution = kind === 'give_back' ? attempt.resolution : undefined;
      const patch = resolution
        ? { resolution: { ...resolution, giveBackLegs: resolution.giveBackLegs.map(apply) } }
        : { legs: attempt.legs.map(apply) };
      const next = { ...attempt, ...patch };
      if ((args.outcome === 'declined' && kind === 'collection' && !next.legs.some(part => part.state === 'planned')) ||
          (args.outcome === 'taken' && kind === 'give_back')) {
        const { kept, check } = await paymentEvidence(ctx, next);
        if (!kept.length && !check.length) await releaseCheckoutHolds(ctx, order._id, ctx.staff.email);
      }
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { ...patch, updatedAt: Date.now() });
      return { status: 'recorded' as const, attempt: attemptView({ ...attempt, ...patch }), replayed: false };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
