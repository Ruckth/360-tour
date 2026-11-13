import { v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { orderLines } from '../private/orderLines';
import { editableOrder, lineSnapshot, logOrder, refreshOrder } from '../private/orderModel';

/** Removes every row. The number, explicit source ownership, customer and audit trail stay. */
export const clearOrder = staffMutation({
  capability: 'checkout',
	args: { orderId: v.id('orders') },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const order = await editableOrder(ctx, args.orderId, admin.email);
		const lines = await orderLines(ctx, order._id);
		for (const line of lines) await ctx.db.delete(line._id);
		await ctx.db.patch(order._id, { promotion: undefined });
		await ctx.db.insert('orderAudit', { orderId: order._id, at: Date.now(), actor: admin.email, kind: 'cleared' });
		await refreshOrder(ctx, order._id);
		// The removed rows, so the history shows what was cleared (restoring them is the discard/restore task).
		if (lines.length) await logOrder(ctx, order._id, admin.email, 'cleared', { before: { lines: lines.map(lineSnapshot) } });
	}
});
