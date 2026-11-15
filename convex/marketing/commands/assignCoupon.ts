import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { appendRecordHistory } from '../../settings/model';

export const assignCoupon = marketingMutation({
  permission: "partners",
  args: {
    affiliateId: v.id("marketingAffiliates"),
    couponId: v.union(v.id("coupons"), v.null()),
  },
  handler: async (ctx, args) => {
    const actor = ctx.marketing;
    const partner = await ctx.db.get(args.affiliateId);
    if (!partner || partner.status === "archived")
      throw new ConvexError("Partner unavailable");
    if (args.couponId) {
      const coupon = await ctx.db.get(args.couponId);
      if (!coupon) throw new ConvexError("Coupon not found");
      if (coupon.affiliateId && coupon.affiliateId !== partner._id)
        throw new ConvexError("Coupon already belongs to another partner");
      await ctx.db.patch(coupon._id, {
        affiliateId: partner._id,
        updatedAt: Date.now(),
        updatedByEmail: actor.email,
      });
      await appendRecordHistory(ctx, {
        entityType: "coupon",
        entityId: coupon._id,
        actor: actor.email,
        kind: "affiliate_assigned",
        after: { affiliate: partner.name },
      });
    } else {
      const coupons = await ctx.db
        .query("coupons")
        .withIndex("by_affiliateId", (q) => q.eq("affiliateId", partner._id))
        .take(201);
      if (coupons.length > 200)
        throw new ConvexError("Too many coupons to unassign");
      for (const coupon of coupons) {
        await ctx.db.patch(coupon._id, {
          affiliateId: undefined,
          updatedAt: Date.now(),
          updatedByEmail: actor.email,
        });
        await appendRecordHistory(ctx, {
          entityType: "coupon",
          entityId: coupon._id,
          actor: actor.email,
          kind: "affiliate_unassigned",
          before: { affiliate: partner.name },
          after: { affiliate: null },
        });
      }
    }
    return null;
  },
});
