import { requireMarketingPermission } from './lib/marketingAccess';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { authenticatedQuery } from './auth/model';
import { requireOwner, requireAdmin } from './lib/adminAuth';
import { canReadMarketingPersonalData, redactMarketingHistoryValue } from './lib/marketingPrivacy';

export const list = authenticatedQuery({
 args: { entityType: v.string(), entityId: v.optional(v.string()), paginationOpts: paginationOptsValidator },
 handler: async (ctx, args) => {
  const marketing = ['marketingCampaign','marketingLink','coupon','marketingSpend','marketingAffiliate'].includes(args.entityType);
  let fullDetail = true;
  if (marketing) fullDetail = canReadMarketingPersonalData(await requireMarketingPermission(ctx, 'view'));
  else if (['staffGrant', 'cashierRules', 'marketingGrant'].includes(args.entityType)) await requireOwner(ctx);
  else await requireAdmin(ctx);
  if (!Number.isInteger(args.paginationOpts.numItems) || args.paginationOpts.numItems < 1 || args.paginationOpts.numItems > 100) throw new Error('Page size must be 1–100');
  const entityId = args.entityId;
  const page = entityId === undefined
   ? await ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_recordedAt', q => q.eq('entityType', args.entityType))
    .order('desc').paginate(args.paginationOpts)
   : await ctx.db.query('recordChanges')
    .withIndex('by_entityType_and_entityId_and_recordedAt', q => q.eq('entityType', args.entityType).eq('entityId', entityId))
    .order('desc').paginate(args.paginationOpts);
  if (fullDetail) return page;
  return { ...page, page: page.page.map(row => ({
   ...row, actor: 'Staff', reason: undefined,
   ...(row.before !== undefined ? { before: redactMarketingHistoryValue(row.before) } : {}),
   ...(row.after !== undefined ? { after: redactMarketingHistoryValue(row.after) } : {})
  })) };
 }
});
