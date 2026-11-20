import { ConvexError } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { assertActiveAttempt, attemptForOwner, attemptOwnerArgs, paymentError, paymentRefusal } from '../private/paymentAttempt';
import { paymentEvidence } from '../private/paymentRecovery';

export const cancelPaymentAttempt = staffMutation({
  capability: 'checkout',
  args: attemptOwnerArgs,
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      if (attempt.status === 'cancelled') return { status: 'cancelled' as const, replayed: true };
      assertActiveAttempt(order, attempt);
      const { kept, check } = await paymentEvidence(ctx, attempt);
      if (check.length) paymentError('check_previous', 'Check the previous payment first.');
      if (kept.length) paymentError('payment_kept', 'Finish the sale or give back the money already taken.');
      reserveWrites(ctx, 2);
      await ctx.db.patch(attempt._id, { status: 'cancelled', updatedAt: Date.now() });
      await ctx.db.patch(order._id, { activeAttemptId: undefined, hasItems: order.itemCount > 0 });
      return { status: 'cancelled' as const, replayed: false };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
