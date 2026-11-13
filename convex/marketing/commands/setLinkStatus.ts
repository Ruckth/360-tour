import { ConvexError, v } from 'convex/values';
import { marketingMutation } from '../../auth/model';
import { auditFields, getOrThrow, publishStatus, recordChanges, validateLinkDestination } from '../catalogModel';

export const setLinkStatus = marketingMutation({
  permission: 'publish',
	args: { linkId: v.id('marketingLinks'), status: publishStatus },
	handler: async (ctx, args): Promise<null> => {
		const admin = ctx.marketing;
		const link = await getOrThrow(ctx, 'marketingLinks', args.linkId);
		if (link.affiliateId) { const partner = await ctx.db.get(link.affiliateId); if (link.slug.startsWith('r/')) throw new Error('Change canonical link status from Partners'); if (args.status === 'active' && partner?.status !== 'active') throw new Error('Activate the partner first'); }
		if (args.status === 'draft' && link.status !== 'draft') {
			throw new ConvexError({ code: 'invalid_transition', message: 'A link cannot return to draft. Pause or archive it to remove its offer.' });
		}
		if (args.status === 'active') await validateLinkDestination(ctx, link.destination, true);
		await recordChanges(ctx, 'marketingLink', args.linkId, admin.email, link, { status: args.status }, 'status_changed');
		await ctx.db.patch(args.linkId, { status: args.status, ...auditFields(admin) });
		return null;
	}
});
