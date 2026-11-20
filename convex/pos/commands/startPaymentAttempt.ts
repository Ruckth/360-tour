import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { attemptKey } from '../../shared/bookingMoney';
import { COMMERCE_LIMITS } from '../../shared/commerce';
import { sha256 } from '../../shared/displayTokens';
import {
  assertBusinessDate, assertNewPayments, assertOperatorLoad, assertPaymentPlan, assertTillId, attemptOwnerView, attemptView,
  checkoutPaymentSettings, ownsPaymentAttempt, paymentError, paymentGet, paymentLoadArgs, paymentOperator, paymentOrder,
  paymentPlanArgs, paymentRefusal, paymentTabArgs, readAttemptByKey,
} from '../private/paymentAttempt';
import { prepareCommercePayment } from '../private/paymentCommerce';
import { checkPaymentCart } from '../private/paymentReview';
import { isOpenOrder } from '../private/orderLinks';

export const startPaymentAttempt = staffMutation({
  capability: 'checkout',
  args: {
    orderId: v.id('orders'), tillId: v.string(), clientKey: v.string(),
    expectedRevision: v.number(), expectedDue: v.number(), businessDate: v.string(),
    customers: v.array(v.object({ customerId: v.id('customers'), revision: v.number() })),
    // The till's acknowledged load (commerce/paymentCutover acknowledge); a stale page must reload.
    ...paymentLoadArgs, ...paymentTabArgs,
    ...paymentPlanArgs,
  },
  handler: async (ctx, args) => {
    try {
      assertTillId(args.tillId);
      const key = attemptKey(args.clientKey);
      const order = await paymentOrder(ctx, args.orderId, ctx.staff);
      const serialized = JSON.stringify([
        args.orderId, args.expectedRevision, args.expectedDue, args.businessDate,
        args.customers.map(({ customerId, revision }) => [customerId, revision]).sort(),
        args.vouchers.map(({ voucherId, paid, goodwill }) => [voucherId, paid, goodwill]),
        args.legs.map(({ key, method, amount }) => [key, method, amount]),
      ]);
      if (new TextEncoder().encode(serialized).length > COMMERCE_LIMITS.sale.requestBytes) {
        paymentError('request_limit', 'The payment request is too large.');
      }
      const fingerprint = await sha256(serialized);
      // Admission before replay: a panel loaded before the cutover (or on an unacknowledged till) never resumes.
      const settings = await checkoutPaymentSettings(ctx);
      assertNewPayments(settings);
      const { till, tabKey } = await assertOperatorLoad(ctx, args, settings);
      const replay = await readAttemptByKey(ctx, key);
      if (replay) {
        if (replay.orderId !== order._id) paymentError('payment_key_conflict', 'This payment key was already used.');
        const owned = await ownsPaymentAttempt(replay, ctx.staff, args);
        if (!owned && order.activeAttemptId === replay._id) {
          return { status: 'in_progress_elsewhere' as const, ...attemptOwnerView(replay) };
        }
        if (!owned || replay.fingerprint.split(':')[0] !== fingerprint) {
          paymentError('payment_key_conflict', 'This payment key was already used.');
        }
        return { status: 'ready' as const, attempt: attemptView(replay), replayed: true };
      }
      if (order.activeAttemptId) {
        const active = await paymentGet(ctx, order.activeAttemptId);
        if (!active) throw new Error('The order has a missing payment attempt.');
        if (!await ownsPaymentAttempt(active, ctx.staff, args)) {
          return { status: 'in_progress_elsewhere' as const, ...attemptOwnerView(active) };
        }
        return { status: 'resume_required' as const, attempt: attemptView(active) };
      }
      if (!isOpenOrder(order)) paymentError('order_closed', 'This order is already closed.');
      assertBusinessDate(args.businessDate);
      assertPaymentPlan(args.legs, args.vouchers, args.expectedDue);
      const reviewedRequest = {
        revision: args.expectedRevision, due: args.expectedDue, businessDate: args.businessDate,
        customers: args.customers, vouchers: args.vouchers, settingsRevision: settings.revision,
      };
      const now = Date.now();
      const { lines, appointment } = await checkPaymentCart(ctx, order, reviewedRequest);
      const sale = await prepareCommercePayment(ctx, {
        order, lines, appointment, settings, planning: true, actor: ctx.staff, vouchers: args.vouchers, tenders: args.legs, now,
      });
      const fields = {
        orderId: order._id, key, fingerprint: `${fingerprint}:${sale.catalogFingerprint}`, reviewedRequest,
        legs: args.legs.map(leg => ({ ...leg, state: 'planned' as const })),
        status: 'collecting' as const, ...await paymentOperator(ctx, ctx.staff, till, tabKey), ownerRevision: 0,
        createdAt: now, updatedAt: now,
      };
      reserveWrites(ctx, 2);
      const id = await ctx.db.insert('paymentAttempts', fields);
      await ctx.db.patch(order._id, { activeAttemptId: id });
      return { status: 'ready' as const, attempt: attemptView({ ...fields, _id: id, _creationTime: now }), replayed: false };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }
  },
});
