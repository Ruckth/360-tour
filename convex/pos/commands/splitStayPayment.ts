import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { reserveWrites } from '../../lib/readBudget';
import { attemptKey } from '../../shared/bookingMoney';
import { sha256 } from '../../shared/displayTokens';
import { assertOrderSize, orderTotals } from '../../shared/orderMath';
import { assertNewPayments, checkoutPaymentSettings, paymentError, paymentGet, paymentOrder, paymentRefusal } from '../private/paymentAttempt';
import { readPaymentLines } from '../private/paymentReview';
import { insertOrder } from '../private/orderLinks';
import { refreshOrder } from '../private/orderModel';
import { assertNoPendingApprovals } from '../private/staffApprovalState';
import {
  isRoomPaymentLine, logRoomRoutingRequest, moveRoomHandovers, readRoomHandovers, readRoomRoute, replayRoomRoutingRequest, updateRoomRoute,
} from '../private/stayPaymentRouting';

export const splitStayPayment = staffMutation({
  capability: 'checkout',
  args: {
    orderId: v.id('orders'), expectedRevision: v.number(), clientKey: v.string(),
    join: v.optional(v.object({ shopOrderId: v.id('orders'), expectedRevision: v.number() })),
  },
  handler: async (ctx, args) => {
    let prepared;
    try {
      const order = await paymentOrder(ctx, args.orderId, ctx.staff);
      const join = args.join;
      const key = await sha256(attemptKey(args.clientKey));
      const fingerprint = await sha256(JSON.stringify([order._id, args.expectedRevision, join?.shopOrderId, join?.expectedRevision, ctx.staff.email]));
      const replay = await replayRoomRoutingRequest(ctx, key, fingerprint);
      if (replay) return { status: join ? 'joined' as const : 'split' as const, ...replay, replayed: true };
      assertNewPayments(await checkoutPaymentSettings(ctx));
      if (order.revision !== args.expectedRevision || order.status !== 'draft') paymentError('order_changed', 'Review the current room order.');
      if (order.activeAttemptId) paymentError('payment_in_progress', 'Resolve the payment in progress before splitting the bill.');
      await assertNoPendingApprovals(ctx, order._id);
      const lines = await readPaymentLines(ctx, order);
      const roomLines = lines.filter(isRoomPaymentLine);
      const bookings = new Set([order.bookingId, ...roomLines.map(line => line.bookingId)].filter(id => id !== undefined));
      const [bookingId] = bookings;
      if (!bookingId || bookings.size !== 1 || !roomLines.some(line => line.bookingId === bookingId)) {
        paymentError('split_stays', 'Choose one stay with an accommodation balance.');
      }
      const existing = await readRoomRoute(ctx, bookingId);
      let shop;
      let moved;
      if (join) {
        if (existing?.roomOrderId !== order._id || existing.shopOrderId !== join.shopOrderId) paymentError('split_changed', 'Review the linked Shop & spa order.');
        shop = await paymentGet(ctx, join.shopOrderId);
        if (!shop || shop.revision !== join.expectedRevision || shop.status !== 'draft' || shop.activeAttemptId) {
          paymentError('split_changed', 'Both bills must be unchanged, unpaid and free of active attempts.');
        }
        await assertNoPendingApprovals(ctx, shop._id);
        if (order.promotion || shop.customerId !== order.customerId) paymentError('split_changed', 'Review the customer and coupon on both orders.');
        moved = await readPaymentLines(ctx, shop);
        if (lines.length + moved.length > 100) paymentError('order_limit', 'The joined cart would exceed the row limit.');
        assertOrderSize(orderTotals([...lines, ...moved]));
      } else {
        if (existing) paymentError('split_changed', 'This stay already has a Shop & spa bill.');
        moved = lines.filter(line => !isRoomPaymentLine(line));
        if (!moved.length) paymentError('nothing_to_split', 'This bill only contains accommodation.');
      }
      const handovers = await readRoomHandovers(ctx, shop?._id ?? order._id, new Set(moved.map(line => line._id)));
      prepared = { order, shop, moved, handovers, bookingId, key, fingerprint };
    } catch (error) {
      if (!(error instanceof ConvexError)) throw error;
      return paymentRefusal(error);
    }

    const { order, moved, handovers, bookingId, key, fingerprint } = prepared;
    const joining = !!args.join;
    const shop = prepared.shop ?? await insertOrder(ctx, ctx.staff.email, { parentOrderId: order._id, bookingId, customerId: order.customerId });
    const [from, to] = joining ? [shop, order] : [order, shop];
    await moveRoomHandovers(ctx, handovers, from._id, to._id);
    for (const line of moved) {
      reserveWrites(ctx, 1);
      await ctx.db.patch(line._id, { orderId: to._id });
    }
    reserveWrites(ctx, 2);
    await ctx.db.patch(from._id, { promotion: undefined, ...(joining ? {} : { bookingId, implicitSourceLink: undefined }) });
    await ctx.db.patch(to._id, { promotion: from.promotion, implicitSourceLink: undefined });
    await refreshOrder(ctx, order._id, bookingId);
    await refreshOrder(ctx, shop._id, bookingId);
    if (joining) {
      reserveWrites(ctx, 1);
      await ctx.db.patch(shop._id, { status: 'discarded', updatedAt: Date.now() });
    }
    const route = { roomOrderId: order._id, shopOrderId: shop._id };
    await updateRoomRoute(ctx, bookingId, ctx.staff.email, route, joining);
    await logRoomRoutingRequest(ctx, key, fingerprint, ctx.staff.email, route, joining);
    return { status: joining ? 'joined' as const : 'split' as const, ...route, replayed: false };
  },
});
