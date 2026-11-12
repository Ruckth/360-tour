import { ConvexError, v } from 'convex/values';
import { staffMutation } from '../../auth/model';
import { type PosCouponProblem } from '../../lib/posCoupons';
import { editableOrder, refreshOrder } from '../private/orderModel';

/**
 * Checks the order's coupon again with its frozen version: after payment refused it, or once a
 * problem may be gone (a paused coupon resumed, a limit raised). The split and the revision follow,
 * so staff review any new total before paying. Use applyOrderCoupon to adopt the current version.
 */
export const recheckOrderCoupon = staffMutation({
  capability: 'checkout',
	args: { orderId: v.id('orders') },
	handler: async (ctx, args): Promise<{ revision: number; discount: number; problem: PosCouponProblem | null }> => {
		const admin = ctx.staff;
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if (!order.promotion) throw new ConvexError('This order has no coupon');
		await refreshOrder(ctx, order._id);
		const updated = (await ctx.db.get(order._id))!;
		return { revision: updated.revision, discount: updated.promotion?.discount ?? 0, problem: updated.promotion?.problem ?? null };
	}
});
