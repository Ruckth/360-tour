import { ConvexError, v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { marketingMutation } from '../../auth/model';
import { normalizeCouponCode } from '../../shared/offers';
import { appendRecordHistory } from '../../settings/model';
import { requireEditableDraft } from '../accessPolicy';
import type { RuleFields } from '../catalogModel';
import { auditFields, canonical, couponRules, currentRules, getOrThrow, recordChanges, validateRules } from '../catalogModel';

/** Creates the coupon, or writes a new immutable version when any rule changes. Code is fixed after the first redemption. */
export const saveCoupon = marketingMutation({
  permission: 'draft',
	args: { couponId: v.optional(v.id('coupons')), code: v.string(), campaignId: v.optional(v.id('marketingCampaigns')), ...couponRules },
	handler: async (ctx, args): Promise<{ couponId: Id<'coupons'>; version: number }> => {
		const admin = ctx.marketing;
		const { couponId, code: rawCode, campaignId, ...rules } = args;
		const code = normalizeCouponCode(rawCode);
		if (!/^[A-Z0-9-]{3,32}$/.test(code)) throw new ConvexError({ code: 'invalid_coupon_code', message: 'Invalid coupon code. Use 3 to 32 letters, numbers or hyphens.' });
		validateRules(rules);
		if (campaignId) await getOrThrow(ctx, 'marketingCampaigns', campaignId);
		for (const slug of rules.propertySlugs ?? []) {
			if (!await ctx.db.query('properties').withIndex('by_slug', q => q.eq('slug', slug)).unique()) throw new ConvexError({ code: 'property_not_found', message: 'Property not found. Choose an available villa.' });
		}
		const existing = await ctx.db.query('coupons').withIndex('by_code', q => q.eq('code', code)).unique();
		if (existing && existing._id !== couponId) throw new ConvexError({ code: 'coupon_code_taken', message: 'Coupon code taken. Choose a different code.' });
		const audit = auditFields(admin);
		const now = audit.updatedAt;
		if (couponId) {
			const coupon = await getOrThrow(ctx, 'coupons', couponId);
			requireEditableDraft(admin, coupon);
			if (coupon.used > 0 && code !== coupon.code) throw new ConvexError({ code: 'coupon_code_locked', message: 'Cannot change a used coupon code. Create a new coupon to use a different code.' });
			const current = await currentRules(ctx, coupon);
			// Compare the known rule fields individually, independent of object key ordering.
			const changed = (Object.keys(couponRules) as (keyof RuleFields)[]).some(key => canonical(current[key]) !== canonical(rules[key]));
			const version = coupon.currentVersion + (changed ? 1 : 0);
			if (changed) {
				await ctx.db.insert('couponVersions', { ...rules, couponId, version, createdAt: now, createdByEmail: admin.email });
				await appendRecordHistory(ctx, { entityType: 'coupon', entityId: couponId, actor: admin.email, kind: 'version_added', after: { ...rules, version } });
			}
			await recordChanges(ctx, 'coupon', couponId, admin.email, coupon, { code, campaignId });
			await ctx.db.patch(couponId, { code, campaignId, currentVersion: version, ...audit });
			return { couponId, version };
		}
		const id = await ctx.db.insert('coupons', { code, campaignId, status: 'draft', currentVersion: 1, used: 0, discountGranted: 0, createdAt: now, ...audit });
		await ctx.db.insert('couponVersions', { ...rules, couponId: id, version: 1, createdAt: now, createdByEmail: admin.email });
		await recordChanges(ctx, 'coupon', id, admin.email, null, { code, campaignId });
		await appendRecordHistory(ctx, { entityType: 'coupon', entityId: id, actor: admin.email, kind: 'version_added', after: { ...rules, version: 1 } });
		return { couponId: id, version: 1 };
	}
});
