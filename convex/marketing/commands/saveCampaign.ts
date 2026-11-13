import { ConvexError, v } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import { marketingMutation } from '../../auth/model';
import { requireEditableDraft } from '../accessPolicy';
import { auditFields, getOrThrow, recordChanges, validateRange } from '../catalogModel';

// ---------- Admin mutations ----------

export const saveCampaign = marketingMutation({
  permission: 'draft',
	args: {
		campaignId: v.optional(v.id('marketingCampaigns')),
		name: v.string(),
		source: v.string(),
		medium: v.string(),
		startsOn: v.optional(v.string()),
		endsOn: v.optional(v.string()),
		budget: v.optional(v.number()),
		notes: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<Id<'marketingCampaigns'>> => {
		const admin = ctx.marketing;
		const { campaignId, ...fields } = args;
		if (admin.role === 'marketer' && fields.budget !== undefined) throw new Error('Marketers cannot set budgets');
		if (!fields.name.trim() || !fields.source.trim() || !fields.medium.trim()) throw new ConvexError({ code: 'missing_campaign_fields', message: 'Name, source and medium are required. Fill in all three fields.' });
		validateRange(fields.startsOn, fields.endsOn);
		if (fields.budget !== undefined && (!Number.isSafeInteger(fields.budget) || fields.budget < 0)) throw new ConvexError({ code: 'invalid_budget', message: 'Invalid budget. Enter a finite, non-negative amount.' });
		const audit = auditFields(admin);
		if (campaignId) {
			const existing = await getOrThrow(ctx, 'marketingCampaigns', campaignId);
			requireEditableDraft(admin, existing);
			if (admin.role === 'marketer') fields.budget = existing.budget;
			await recordChanges(ctx, 'marketingCampaign', campaignId, admin.email, existing, { ...fields, startsOn: fields.startsOn, endsOn: fields.endsOn, budget: fields.budget, notes: fields.notes });
			await ctx.db.patch(campaignId, { ...fields, startsOn: fields.startsOn, endsOn: fields.endsOn, budget: fields.budget, notes: fields.notes, ...audit });
			return campaignId;
		}
		const id = await ctx.db.insert('marketingCampaigns', { ...fields, ...audit, createdAt: audit.updatedAt, status: 'draft' });
		await recordChanges(ctx, 'marketingCampaign', id, admin.email, null, fields);
		return id;
	}
});
