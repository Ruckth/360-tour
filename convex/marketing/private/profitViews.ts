import { ConvexError } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../auth/model';
import type { ReportFacts } from './serviceFinanceFacts';

export async function viewOwner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError('Sign in to open this report.');
  return identity.tokenIdentifier;
}

export async function readView(
  ctx: QueryCtx,
  id: Id<'serviceProfitViews'>,
  from: string,
  to: string,
  named: boolean,
): Promise<ReportFacts> {
  const view = await ctx.db.get(id);
  if (
    !view ||
    view.expiresAt <= Date.now() ||
    view.from !== from ||
    view.to !== to ||
    view.named !== named ||
    view.owner !== (await viewOwner(ctx))
  ) {
    throw new ConvexError('This report view expired or access changed. Refresh the report.');
  }
  // Only openView writes this typed payload. A view and all of its chunks commit atomically.
  const chunks = await ctx.db
    .query('serviceProfitViewChunks')
    .withIndex('by_view', (q) => q.eq('viewId', id))
    .take(65);
  if (!chunks.length || chunks.length > 64) throw new ConvexError('Refresh the report to reopen this view.');
  return JSON.parse(chunks.map((c) => c.payload).join('')) as ReportFacts;
}
