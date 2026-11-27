import { ConvexError, type Infer } from 'convex/values';
import type { Id } from '../../_generated/dataModel';
import type { QueryCtx } from '../../_generated/server';
import type { StaffActor } from '../../auth/model';
import { requireBranchAccess } from '../../branches/model';
import { stockGrantRoles } from '../stockValidators';

export type StockRoles = Infer<typeof stockGrantRoles>;
export type StockPermission = keyof StockRoles | 'read';
export const emptyStockRoles: StockRoles = {
  requester: false, approver: false, buyer: false, receiver: false, lead: false,
};

export async function readStockAccess(ctx: QueryCtx, actor: StaffActor, branchId: Id<'branches'>) {
  const branch = await requireBranchAccess(ctx, actor, branchId);
  const staffGrantId = actor.grantId ?? (await ctx.db.query('staffGrants')
    .withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', actor.tokenIdentifier)).unique())?._id;
  const [grant, policy] = await Promise.all([
    staffGrantId ? readStockGrant(ctx, branchId, staffGrantId) : null,
    readStockPolicy(ctx, branchId),
  ]);
  const roles = grant?.roles ?? emptyStockRoles;
  return {
    branch, ...roles, read: Object.values(roles).some(Boolean),
    directOrder: roles.buyer && (policy?.directOrder ?? false),
    directReceipt: roles.receiver && (policy?.directReceipt ?? false),
  };
}

export async function requireStockAccess(ctx: QueryCtx, actor: StaffActor, branchId: Id<'branches'>, permission: StockPermission) {
  const access = await readStockAccess(ctx, actor, branchId);
  if (!access[permission]) {
    throw new ConvexError({ code: 'STOCK_FORBIDDEN', message: 'You do not have the required stock permission for this branch.' });
  }
  return access;
}

export function readStockGrant(ctx: QueryCtx, branchId: Id<'branches'>, staffGrantId: Id<'staffGrants'>) {
  return ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId).eq('staffGrantId', staffGrantId)).unique();
}

export async function hasBranchStockRole(ctx: QueryCtx, staffGrantId: Id<'staffGrants'>, branchIds: Id<'branches'>[]) {
  const grants = await Promise.all(branchIds.map(branchId => readStockGrant(ctx, branchId, staffGrantId)));
  return grants.some(grant => grant && Object.values(grant.roles).some(Boolean));
}

export function readStockPolicy(ctx: QueryCtx, branchId: Id<'branches'>) {
  return ctx.db.query('stockBranchPolicies').withIndex('by_branch', q => q.eq('branchId', branchId)).unique();
}
