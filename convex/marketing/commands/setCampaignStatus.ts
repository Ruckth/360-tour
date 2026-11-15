import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { auditFields, campaignStatus, campaignTransitions, getOrThrow, recordChanges } from '../catalogModel';

export const setCampaignStatus = marketingMutation({
  permission: 'publish',
	args: { campaignId: v.id('marketingCampaigns'), status: campaignStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = ctx.marketing;
		const campaign = await getOrThrow(ctx, 'marketingCampaigns', args.campaignId);
		if (args.status !== campaign.status && !campaignTransitions[campaign.status].includes(args.status)) {
			throw new ConvexError({ code: 'invalid_transition', message: 'This campaign status change is unavailable. Use the next action in the campaign lifecycle.' });
		}
		await recordChanges(ctx, 'marketingCampaign', args.campaignId, admin.email, campaign, { status: args.status }, 'status_changed');
		await ctx.db.patch(args.campaignId, { status: args.status, ...auditFields(admin) });
		return null;
	}
});
