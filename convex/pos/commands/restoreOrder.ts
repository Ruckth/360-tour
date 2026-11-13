import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { attemptKey } from '../../lib/bookingMoney';
import { orderLines } from '../private/orderLines';
import { isOpenOrder } from '../../shared/orderState';
import { discardedInfo, restoreConflicts } from '../private/lifecycleModel';
import { lifecycleArgs, lineSnapshot, logOrder, refreshOrder } from '../private/orderModel';

/**
 * Makes a discarded order an unpaid order again, with its rows, links and customer as they were.
 * Nothing is re-priced: a row whose stay or appointment changed meanwhile comes back flagged and
 * must be updated before payment (the source's new terms are never overwritten). If a row's stay,
 * appointment or fee is now on another open order, the restore refuses and lists them, unless
 * `removeConflictingRows` is true, which restores without those rows (each removal is logged with
 * the row). It refuses when no row would be left. Returns the rows taken off and the warnings.
 */
export const restoreOrder = staffMutation({
  capability: 'checkout',
	args: { ...lifecycleArgs, removeConflictingRows: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const key = attemptKey(args.idempotencyKey);
		const order = await ctx.db.get(args.orderId);
		if (!order) throw new ConvexError('Order not found');
		if (order.status !== 'discarded') {
			if (isOpenOrder(order) && order.lifecycleKey === key) return { replayed: true, removed: [], warnings: [] };
			throw new ConvexError(isOpenOrder(order) ? 'This order is not discarded.' : order.status === 'paid' ? 'This order is already paid' : 'This order was voided');
		}
		if (order.revision !== args.expectedRevision) throw new ConvexError('The order changed since you opened it. Review it and try again.');
		const lines = await orderLines(ctx, order._id);
		const conflicts = await restoreConflicts(ctx, order, lines);
		const blocking = conflicts.filter((conflict) => conflict.blocking);
		if (blocking.length && !args.removeConflictingRows) {
			throw new ConvexError(`Not restored: ${blocking.map((conflict) => conflict.message).join(' ')} Restore without ${blocking.length === 1 ? 'that row' : 'those rows'}, or leave the order discarded.`);
		}
		if (blocking.length >= lines.length) throw new ConvexError('Not restored: every item on this order is now on another order.');

		const removed = [];
		for (const conflict of blocking) {
			const line = lines.find((row) => row._id === conflict.lineId)!;
			await ctx.db.delete(line._id);
			await logOrder(ctx, order._id, admin.email, 'line_removed', { reason: `Taken off when restoring: ${conflict.message}`, before: lineSnapshot(line) });
			removed.push({ lineId: line._id, name: line.name, reason: conflict.message });
		}
		const before = discardedInfo(order);
		await ctx.db.patch(order._id, { status: 'draft', discardedAt: undefined, discardedBy: undefined, discardReason: undefined, lifecycleKey: key });
		// Totals follow the rows that came back; the revision moves, so a payment reviewed earlier is refused.
		await refreshOrder(ctx, order._id);
		const warnings = conflicts.filter((conflict) => !conflict.blocking);
		await logOrder(ctx, order._id, admin.email, 'restored', {
			before: { status: 'discarded', discardedAt: before.at, discardedBy: before.by, discardReason: before.reason },
			after: { status: 'draft', removed: removed.map(({ lineId, name }) => ({ lineId, name })), warnings: warnings.map(({ kind, name, message }) => ({ kind, name, message })) }
		});
		return { replayed: false, removed, warnings };
	}
});
