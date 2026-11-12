import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { editableOrder } from '../private/orderModel';

/**
 * Save & close: every edit is already on the server, so this only moves the order to the top of
 * Unpaid orders. Nothing about the order changes (not its revision), so a payment open on
 * another device is not disturbed.
 */
export const saveOrder = staffMutation({
  capability: 'checkout',
	args: { orderId: v.id('orders') },
	handler: async (ctx, args) => {
		const admin = ctx.staff;
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.hasItems) throw new ConvexError('Add an item before saving the order');
		await ctx.db.patch(order._id, { updatedAt: Date.now() });
	}
});
