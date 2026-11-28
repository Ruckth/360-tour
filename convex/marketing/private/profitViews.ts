import { ConvexError } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../auth/model';
import type { ReportFacts } from './serviceFinanceFacts';

export async function viewOwner(ctx: QueryCtx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new ConvexError('Sign in to open this report.');
  return identity.tokenIdentifier;
}

export async function requireView(
  ctx: QueryCtx,
  id: Id<'serviceProfitViews'>,
  from: string,
  to: string,
  named: boolean,
) {
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
  return view;
}

export async function readView(
  ctx: QueryCtx,
  id: Id<'serviceProfitViews'>,
  from: string,
  to: string,
  named: boolean,
): Promise<ReportFacts> {
  const view = await requireView(ctx, id, from, to, named);
  if (view.parentViewId) throw new ConvexError('This report view expired. Refresh the report.');
  if (view.assemblyState) throw new ConvexError('This report snapshot is still being prepared or could not be opened.');
  // Only openView writes this typed payload. A view and all of its chunks commit atomically.
  const chunks = await ctx.db
    .query('serviceProfitViewChunks')
    .withIndex('by_view', (q) => q.eq('viewId', id))
    .take(65);
  if (!chunks.length || chunks.length > 64) throw new ConvexError('Refresh the report to reopen this view.');
  return JSON.parse(chunks.map((c) => c.payload).join('')) as ReportFacts;
}


export async function retireView(ctx: MutationCtx, view: Doc<'serviceProfitViews'>) {
  if (!view.parentViewId) {
    const activeChildren = await ctx.db.query('serviceProfitViews')
      .withIndex('by_parent_expiry', (q) => q.eq('parentViewId', view._id).gt('expiresAt', Date.now())).take(3);
    for (const child of activeChildren) {
      await ctx.db.patch(child._id, { expiresAt: Date.now() });
      await ctx.scheduler.runAfter(0, internal.marketing.profitViews.expireView, { id: child._id });
    }
  }
  await ctx.db.patch(view._id, { expiresAt: Date.now() });
  await ctx.scheduler.runAfter(0, internal.marketing.profitViews.expireView, { id: view._id });
}


export async function storeSourceView(ctx: MutationCtx, id: Id<'serviceProfitViews'>, payload: string) {
  // Limit UTF-16 chunk size so even multi-byte service names fit below the document limit.
  for (let at = 0, sequence = 0; at < payload.length; sequence++) {
    let next = Math.min(at + 100_000, payload.length);
    if (next < payload.length && payload.charCodeAt(next - 1) >= 0xd800 && payload.charCodeAt(next - 1) <= 0xdbff)
      next--;
    await ctx.db.insert('serviceProfitViewChunks', { viewId: id, sequence, payload: payload.slice(at, next) });
    at = next;
  }
}
