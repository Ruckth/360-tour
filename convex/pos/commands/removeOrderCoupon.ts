import { v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { orderLines } from '../private/orderLines';
import { editableOrder, logOrder, refreshOrder, writeCouponShares } from '../private/orderModel';

/** Removes the order's coupon and every row's share of it. A no-op when the order has none. */
export const removeOrderCoupon = staffMutation({
  capability: 'checkout',
	args: { orderId: v.id('orders') },
	handler: async (ctx, args): Promise<{ revision: number }> => {
		const admin = ctx.staff;
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.promotion) return { revision: order.revision };
		await ctx.db.patch(order._id, { promotion: undefined });
		await writeCouponShares(ctx, await orderLines(ctx, order._id), null);
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'coupon_removed', { before: { code: order.promotion.code, discount: order.promotion.discount } });
		return { revision: order.revision + 1 };
	}
});
