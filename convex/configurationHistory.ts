import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireAdmin } from './lib/adminAuth';

/** Discover deleted villas, or rooms (including removed ones) from their retained villa id. */
export const records = query({
	args: { propertyId: v.optional(v.id('properties')), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (
			!Number.isInteger(args.paginationOpts.numItems) ||
			args.paginationOpts.numItems < 1 ||
			args.paginationOpts.numItems > 50
		)
			throw new Error('Page size must be 1–50');
		if (args.propertyId)
			return await ctx.db
				.query('configurationHistoryIndex')
				.withIndex('by_propertyId_and_entityType', (q) => q.eq('propertyId', args.propertyId!).eq('entityType', 'room'))
				.order('desc')
				.paginate(args.paginationOpts);
		return await ctx.db
			.query('configurationHistoryIndex')
			.withIndex('by_entityType_and_deleted', (q) => q.eq('entityType', 'property').eq('deleted', true))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});
