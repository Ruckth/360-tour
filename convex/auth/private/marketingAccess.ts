import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { marketingAccessForIdentity } from '../../marketing/model';
import type { MarketingPermission } from '../../shared/marketingAccess';
import { boundStaffGrant } from './staffAccess';

export async function marketingAccess(ctx: QueryCtx | MutationCtx) {
  const identity = await ctx.auth.getUserIdentity();
  const isOwner = (await boundStaffGrant(ctx, identity))?.role === 'owner';
  return marketingAccessForIdentity(ctx, identity, isOwner);
}

export async function requireMarketingPermission(ctx: QueryCtx | MutationCtx, permission: MarketingPermission) {
  const access = await marketingAccess(ctx);
  if (!access.email) throw new Error('Not authenticated');
  if (!access.capabilities[permission]) throw new Error('Not authorized');
  return { ...access, email: access.email };
}
