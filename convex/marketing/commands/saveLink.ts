import { ConvexError, v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { marketingMutation } from '../../auth/model';
import { isMarketingLocale } from '../../lib/marketingSlugs';
import { requireEditableDraft, requireMarketingPermission } from '../accessPolicy';
import { auditFields, destination, getOrThrow, recordChanges, slugCheck, validateLinkDestination } from '../catalogModel';

export const saveLink = marketingMutation({
  permission: 'draft',
	args: {
		linkId: v.optional(v.id('marketingLinks')),
		slug: v.string(),
		name: v.string(),
		campaignId: v.id('marketingCampaigns'),
		placement: v.optional(v.string()),
		destination,
		locale: v.optional(v.string()),
		couponId: v.optional(v.id('coupons')),
		affiliateId: v.optional(v.id('marketingAffiliates')),
		entry: v.union(v.literal('link'), v.literal('qr'))
	},
	handler: async (ctx, args): Promise<Id<'marketingLinks'>> => {
		const admin = ctx.marketing;
		const { linkId, ...fields } = args;
		if (fields.affiliateId) { await requireMarketingPermission(ctx, 'partners'); const affiliate = await ctx.db.get(fields.affiliateId); if (!affiliate || affiliate.status === 'archived') throw new Error('Partner unavailable'); }
		const checked = await slugCheck(ctx, args.slug, linkId);
		if (!checked.ok) throw new ConvexError({ code: `slug_${checked.reason}`, message: `Slug ${checked.reason}. Choose a different short URL.` });
		await getOrThrow(ctx, 'marketingCampaigns', fields.campaignId);
		if (fields.couponId) await getOrThrow(ctx, 'coupons', fields.couponId);
		if (fields.locale !== undefined && !isMarketingLocale(fields.locale)) throw new ConvexError({ code: 'invalid_locale', message: 'Invalid locale. Choose a supported language.' });
		const existing = linkId ? await getOrThrow(ctx, 'marketingLinks', linkId) : null;
		requireEditableDraft(admin, existing);
		if (existing?.affiliateId && existing.slug.startsWith('r/')) throw new Error('Edit canonical partner aliases from Partners');
		if (existing?.affiliateId && existing.affiliateId !== fields.affiliateId) await requireMarketingPermission(ctx, 'partners');
		await validateLinkDestination(ctx, fields.destination, existing?.status === 'active');
		const values = { ...fields, placement: fields.placement, locale: fields.locale, couponId: fields.couponId, affiliateId: fields.affiliateId, slug: checked.slug, ...auditFields(admin) };
		if (linkId && existing) {
			// Printed QR codes and shared posts point at the slug, so it is fixed once the link has been live.
			if (existing.status !== 'draft' && existing.slug !== checked.slug) throw new ConvexError({ code: 'slug_locked', message: 'Slug is locked after publishing. Create a new link to use a different slug.' });
			await recordChanges(ctx, 'marketingLink', linkId, admin.email, existing, { ...fields, slug: checked.slug, placement: fields.placement, locale: fields.locale, couponId: fields.couponId });
			await ctx.db.patch(linkId, values);
			return linkId;
		}
		const id = await ctx.db.insert('marketingLinks', { ...values, createdAt: values.updatedAt, opens: 0, status: 'draft' });
		await recordChanges(ctx, 'marketingLink', id, admin.email, null, { ...fields, slug: checked.slug });
		return id;
	}
});
