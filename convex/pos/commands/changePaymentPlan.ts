import { ConvexError } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import {
  assertActiveAttempt, assertNewPayments, assertPaymentPlan, attemptForOwner, attemptOwnerArgs, attemptView,
  checkoutPaymentSettings, needsPaymentCheck, paymentError, paymentPlanArgs, paymentRefusal,
} from '../private/paymentAttempt';
import { assertRecoveryPlan, paymentEvidence } from '../private/paymentRecovery';
import { preflightAttempt } from '../private/attemptPreflight';

export const changePaymentPlan = staffMutation({
  capability: 'checkout',
  args: { ...attemptOwnerArgs, legs: paymentPlanArgs.legs },
  handler: async (ctx, args) => {
    try {
      const { attempt, order } = await attemptForOwner(ctx, ctx.staff, args);
      assertActiveAttempt(order, attempt);
      if (attempt.status !== 'collecting' && attempt.status !== 'recovering') {
        paymentError('recovery_required', 'Review the recovery balance first.');
      }
      if (attempt.legs.some(needsPaymentCheck) || attempt.resolution?.giveBackLegs.some(needsPaymentCheck)) {
        paymentError('check_previous', 'Check the previous payment first.');
      }
      const protectedLegs = attempt.legs.filter(leg => leg.state !== 'planned');
      if (protectedLegs.length + args.legs.length > 20 ||
          args.legs.some(leg => protectedLegs.some(previous => previous.key === leg.key))) {
        paymentError('invalid_leg_key', 'Use a new key for each new payment part.');
      }
      const { kept } = await paymentEvidence(ctx, attempt);
      const { vouchers, due } = attempt.reviewedRequest;
      const live = [...protectedLegs.filter(leg => leg.state === 'taken'), ...args.legs];
      if (!attempt.parentAttemptId) assertPaymentPlan(live, vouchers, due);
      const combined = assertRecoveryPlan(kept, args.legs, vouchers, due);
      const settings = await checkoutPaymentSettings(ctx);
      assertNewPayments(settings);
      await preflightAttempt(ctx, order, attempt, settings, ctx.staff, attempt.parentAttemptId ? combined : live, Date.now(), kept.length > 0);
      const legs = [...protectedLegs, ...args.legs.map(leg => ({ ...leg, state: 'planned' as const }))];
      reserveWrites(ctx, 1);
      await ctx.db.patch(attempt._id, { legs, updatedAt: Date.now() });
      return { status: 'updated' as const, attempt: attemptView({ ...attempt, legs }) };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
