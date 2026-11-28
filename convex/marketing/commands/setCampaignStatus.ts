import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { auditFields, campaignStatus, campaignTransitions, getOrThrow, recordChanges } from '../catalogModel';

export const setCampaignStatus = marketingMutation({
  permission: 'publish',
	args: { campaignId: v.id('marketingCampaigns'), status: campaignStatus, expectedUpdatedAt: v.optional(v.number()) },
	handler: async (ctx, args): Promise<number | null> => {
		const admin = ctx.marketing;
		const campaign = await getOrThrow(ctx, 'marketingCampaigns', args.campaignId);
		if (args.expectedUpdatedAt !== undefined && campaign.updatedAt !== args.expectedUpdatedAt) {
			throw new ConvexError({ code: 'stale_campaign', message: 'This campaign changed. Review its latest status before trying again.' });
		}
		if (args.status !== campaign.status && !campaignTransitions[campaign.status].includes(args.status)) {
			throw new ConvexError({ code: 'invalid_transition', message: 'This campaign status change is unavailable. Use the next action in the campaign lifecycle.' });
		}
		await recordChanges(ctx, 'marketingCampaign', args.campaignId, admin.email, campaign, { status: args.status }, 'status_changed');
		const audit = auditFields(admin);
		const updatedAt = Math.max(audit.updatedAt, campaign.updatedAt + 1);
		await ctx.db.patch(args.campaignId, { status: args.status, ...audit, updatedAt });
		return args.expectedUpdatedAt === undefined ? null : updatedAt;
	}
});
