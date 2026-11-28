import { ConvexError, type Infer } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
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
    policy: purchasingPolicy(policy),
  };
}

export type PurchasingPolicy = ReturnType<typeof purchasingPolicy>;
/** Over-delivery tolerance ceiling; larger overships always go to held goods. */
export const OVER_RECEIPT_TOLERANCE_MAX_PCT = 25;

/** Purchasing business policies with their off defaults. */
export function purchasingPolicy(policy: Doc<'stockBranchPolicies'> | null) {
  return {
    separateReceiving: policy?.separateReceiving ?? false,
    directOrderLimit: policy?.directOrderLimit ?? null,
    overReceiptTolerancePct: policy?.overReceiptTolerancePct ?? 0,
    receivingContact: policy?.receivingContact, receivingPhone: policy?.receivingPhone,
  };
}

type PolicyInput = {
  separateReceiving?: boolean; directOrderLimit?: number | null; overReceiptTolerancePct?: number;
  receivingContact?: string; receivingPhone?: string;
};

/** Validate the optional purchasing policy fields of a policy write. Omitted keys are left out (keep their value). */
export function purchasingPolicyPatch(input: PolicyInput): Partial<Doc<'stockBranchPolicies'>> {
  const patch: Partial<Doc<'stockBranchPolicies'>> = {};
  if (input.separateReceiving !== undefined) patch.separateReceiving = input.separateReceiving;
  if (input.directOrderLimit !== undefined) {
    const limit = input.directOrderLimit;
    if (limit !== null && (!Number.isSafeInteger(limit) || limit <= 0)) {
      throw new ConvexError({ code: 'INVALID_POLICY', message: 'The direct order limit must be a positive amount, or empty for no limit.' });
    }
    patch.directOrderLimit = limit ?? undefined;
  }
  if (input.overReceiptTolerancePct !== undefined) {
    const pct = input.overReceiptTolerancePct;
    if (!Number.isSafeInteger(pct) || pct < 0 || pct > OVER_RECEIPT_TOLERANCE_MAX_PCT) {
      throw new ConvexError({ code: 'INVALID_POLICY', message: `The over-delivery tolerance must be a whole percent from 0 to ${OVER_RECEIPT_TOLERANCE_MAX_PCT}.` });
    }
    patch.overReceiptTolerancePct = pct || undefined;
  }
  for (const field of ['receivingContact', 'receivingPhone'] as const) {
    const value = input[field];
    if (value === undefined) continue;
    const trimmed = value.trim();
    if (trimmed.length > 200) throw new ConvexError({ code: 'INVALID_POLICY', message: 'Receiving contact details are limited to 200 characters.' });
    patch[field] = trimmed || undefined;
  }
  return patch;
}

/** Other active approvers at the branch (bounded), for the single-approver warning. */
export async function otherApproverCount(ctx: QueryCtx, branchId: Id<'branches'>, exceptGrantId: Id<'staffGrants'> | undefined) {
  const grants = await ctx.db.query('stockGrants').withIndex('by_branch_staff', q => q.eq('branchId', branchId)).take(200);
  const candidates = grants.filter(grant => grant.roles.approver && grant.staffGrantId !== exceptGrantId);
  const staff = await Promise.all(candidates.map(grant => ctx.db.get(grant.staffGrantId)));
  // Only bound, assigned staff count; invitations and removed staff cannot approve.
  return staff.filter(row => row?.tokenIdentifier && (row.role === 'owner' || row.branchIds.includes(branchId))).length;
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
