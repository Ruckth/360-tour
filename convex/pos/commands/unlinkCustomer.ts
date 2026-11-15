import { v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { editableOrder } from '../private/orderModel';

export const unlinkCustomer = staffMutation({
  capability: 'checkout',
	args: { orderId: v.id('orders') },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.customerId) return { orderId: order._id };
		const now = Date.now();
		await ctx.db.patch(order._id, { customerId: undefined, revision: order.revision + 1, updatedAt: now });
		await ctx.db.insert('orderAudit', { orderId: order._id, at: now, actor: admin.email, kind: 'customer_unlinked', customerId: order.customerId });
		return { orderId: order._id };
	}
});
