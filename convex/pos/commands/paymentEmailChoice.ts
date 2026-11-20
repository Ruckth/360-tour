import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { assertActiveAttempt, attemptForOwner, attemptOwnerArgs, paymentRefusal } from '../private/paymentAttempt';

/**
 * Keeps the cashier's "Send booking payment confirmation email" choice on the active attempt, so a
 * reload or the till it is handed to shows it and settlement sends it. Only the current owner may set it.
 */
export const setPaymentEmailChoice = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, notifyGuest: v.boolean() },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      if ((attempt.notifyGuest ?? false) !== args.notifyGuest) {
        reserveWrites(ctx, 1);
        await ctx.db.patch(attempt._id, { notifyGuest: args.notifyGuest, updatedAt: Date.now() });
      }
      return { status: 'saved' as const, notifyGuest: args.notifyGuest };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
