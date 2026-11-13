import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { auditFields, getOrThrow, publishStatus, recordChanges } from '../catalogModel';

export const setCouponStatus = marketingMutation({
  permission: 'publish',
	args: { couponId: v.id('coupons'), status: publishStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = ctx.marketing;
		const coupon = await getOrThrow(ctx, 'coupons', args.couponId);
		if (coupon.status === 'archived' && args.status !== 'archived') {
			throw new ConvexError({ code: 'invalid_transition', message: 'Archived coupons cannot change status. Create a new coupon instead.' });
		}
		await recordChanges(ctx, 'coupon', args.couponId, admin.email, coupon, { status: args.status }, 'status_changed');
		await ctx.db.patch(args.couponId, { status: args.status, ...auditFields(admin) });
		return null;
	}
});
