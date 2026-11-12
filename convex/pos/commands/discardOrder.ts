import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { attemptKey, cleanReason } from '../../lib/bookingMoney';
import { orderLines } from '../../lib/orderLines';
import { lifecycleArgs, lineSnapshot, logOrder } from '../private/orderModel';

/**
 * Discards an unpaid order staff no longer want: it leaves Unpaid orders and appears under
 * Discarded. Everything is kept: its number, rows, booking links, customer and history. While
 * discarded it can't be changed or paid, and it no longer holds its stays, appointments or fees,
 * so they can be charged on another order or recorded as paid elsewhere. The bookings and
 * appointments themselves are not touched (nothing is cancelled).
 *
 * `expectedRevision` is the order revision staff saw; `idempotencyKey` makes a retry after a lost
 * response return `replayed: true`. Paid and void orders refuse (void a paid order instead). An
 * empty order refuses: it is not listed, so there is nothing to discard.
 */
export const discardOrder = staffMutation({
  capability: 'checkout',
	args: { ...lifecycleArgs, reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const key = attemptKey(args.idempotencyKey);
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status === 'discarded') {
			if (order.lifecycleKey === key) return { replayed: true };
			throw new ConvexError('This order is already discarded.');
		}
		if (order.status === 'paid') throw new ConvexError('A paid order can’t be discarded. Void it instead.');
		if (order.status === 'void') throw new ConvexError('This order was voided');
		if (order.revision !== args.expectedRevision) throw new ConvexError('The order changed since you opened it. Review it and try again.');
		const reason = cleanReason(args.reason, 'Reason', false);
		const lines = await orderLines(ctx, order._id);
		if (!lines.length) throw new ConvexError('This order has no items, so it isn’t listed and there is nothing to discard.');
		if (await ctx.db.query('orderPayments').withIndex('by_orderId', (q) => q.eq('orderId', order._id)).first()) {
			throw new ConvexError('This order has payments recorded, so it can’t be discarded.');
		}
		const now = Date.now();
		await ctx.db.patch(order._id, {
			status: 'discarded', discardedAt: now, discardedBy: admin.email, discardReason: reason, lifecycleKey: key,
			revision: order.revision + 1, updatedAt: now
		});
		await logOrder(ctx, order._id, admin.email, 'discarded', {
			reason,
			before: {
				status: order.status, revision: order.revision, bookingId: order.bookingId, appointmentId: order.appointmentId, customerId: order.customerId,
				itemCount: order.itemCount, total: order.total, due: order.due, lines: lines.map(lineSnapshot)
			},
			after: { status: 'discarded' }
		});
		return { replayed: false };
	}
});
