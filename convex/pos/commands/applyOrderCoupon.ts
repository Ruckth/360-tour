import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import { staffMutation } from '../../auth/model';
import { normalizeCouponCode } from '../../shared/offers';
import { orderLines } from '../private/orderLines';
import { editableOrder, logOrder, orderCouponUnavailable, quoteOrderCoupon, refreshOrder, writeCouponShares } from '../private/orderModel';

/**
 * Marketing release 2b. Applies one coupon to an unpaid order, replacing any coupon already on it.
 * `code` is typed or read from a pasted link (lib/posCoupons parseCouponInput); `slug` is a scanned
 * short link, resolved here to its active coupon. The order's current coupon version is frozen on
 * `orders.promotion`; the split lands on orderLines.couponDiscount and the revision changes, so any
 * payment reviewed before has to be reviewed again. Nothing is held: settleOrder consumes the use.
 * When it can't apply, throws ConvexError { code: 'coupon_unavailable', message, problem:
 * PosCouponProblem } and writes nothing. Applying the code already on the order re-checks it.
 */
export const applyOrderCoupon = staffMutation({
  capability: 'checkout',
	args: { orderId: v.id('orders'), code: v.optional(v.string()), slug: v.optional(v.string()) },
	handler: async (ctx, args): Promise<{ code: string; discount: number; revision: number }> => {
		const admin = ctx.staff;
		const order = await editableOrder(ctx, args.orderId, admin.email);
		if ((args.code !== undefined) === (args.slug !== undefined)) throw new ConvexError('Choose one coupon code or link');
		let coupon: Doc<'coupons'> | null;
		let viaLinkId: Id<'marketingLinks'> | undefined;
		if (args.slug !== undefined) {
			const link = await ctx.db.query('marketingLinks').withIndex('by_slug', q => q.eq('slug', args.slug!)).unique();
			viaLinkId = link?._id;
			coupon = link?.couponId ? await ctx.db.get(link.couponId) : null;
			if (link?.status !== 'active' || coupon?.status !== 'active') orderCouponUnavailable({ code: 'link_without_offer' }, coupon?.code);
		} else {
			coupon = await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', normalizeCouponCode(args.code!))).unique();
		}
		if (!coupon) orderCouponUnavailable({ code: 'not_found' });
		const lines = await orderLines(ctx, order._id);
		const result = await quoteOrderCoupon(ctx, lines, coupon._id, coupon.currentVersion);
		if (!result.ok) orderCouponUnavailable(result.problem, coupon.code);
		await ctx.db.patch(order._id, { promotion: { couponId: coupon._id, couponVersion: coupon.currentVersion, code: coupon.code, discount: result.discount, appliedAt: Date.now(), appliedBy: admin.email, ...(viaLinkId ? { viaLinkId } : {}) } });
		await writeCouponShares(ctx, lines, result);
		await refreshOrder(ctx, order._id);
		await logOrder(ctx, order._id, admin.email, 'coupon_applied', {
			...(order.promotion ? { before: { code: order.promotion.code } } : {}),
			after: { code: coupon.code, couponVersion: coupon.currentVersion, discount: result.discount }
		});
		return { code: coupon.code, discount: result.discount, revision: order.revision + 1 };
	}
});
