import { ConvexError, v } from 'convex/values';
import { staffQuery } from '../../auth/model';
import {
  assertTillId, attemptOwnerView, attemptView, needsPaymentCheck, ownsPaymentAttempt, paymentGet, paymentOrder, paymentRefusal, paymentTabArgs,
} from '../private/paymentAttempt';
import { recoveryView } from '../private/paymentRecovery';

export const resumePaymentAttempt = staffQuery({
  capability: 'checkout',
  args: { orderId: v.id('orders'), tillId: v.string(), ...paymentTabArgs },
  handler: async (ctx, args) => {
    try {
      assertTillId(args.tillId);
      const order = await paymentOrder(ctx, args.orderId, ctx.staff);
      if (!order.activeAttemptId) return { status: 'none' as const };
      const attempt = await paymentGet(ctx, order.activeAttemptId);
      if (!attempt) throw new Error('The order has a missing payment attempt.');
      if (!await ownsPaymentAttempt(attempt, ctx.staff, args)) {
        return { status: 'in_progress_elsewhere' as const, ...attemptOwnerView(attempt) };
      }
      const collection = attempt.legs.find(needsPaymentCheck);
      const giveBack = attempt.resolution?.giveBackLegs.find(needsPaymentCheck);
      return {
        status: 'resume' as const, attempt: attemptView(attempt), ...recoveryView(attempt, order),
        checkPrevious: collection ? { kind: 'collection' as const, leg: collection } :
          giveBack ? { kind: 'give_back' as const, leg: giveBack } : null,
      };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
