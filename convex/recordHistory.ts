import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { query } from './_generated/server';
import { requireAdmin } from './lib/adminAuth';

export const list = query({
 args: { entityType: v.string(), entityId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
 handler: async (ctx, args) => {
  await requireAdmin(ctx);
  if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error('Page size must be 1–100');
  if (args.entityId === undefined) return await ctx.db.query('recordChanges')
   .withIndex('by_entityType_and_recordedAt', q => q.eq('entityType', args.entityType))
   .order('desc').paginate(args.paginationOpts);
  const entityId = args.entityId;
  return await ctx.db.query('recordChanges')
   .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', args.entityType).eq('entityId', entityId))
   .order('desc').paginate(args.paginationOpts);
 }
});
