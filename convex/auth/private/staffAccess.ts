import { manualReduction } from '../../shared/staffDiscount';
import type { UserIdentity } from 'convex/server';
import { ConvexError } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { listAssignedBranches, PRIMARY_BRANCH, readBranchByKey } from '../../branches/model';
import { resortTodayIso } from '../../shared/time';
import { isOpenOrder, isSettledOrder } from '../../pos/model';
import { type PricedLine } from '../../shared/orderMath';
import { STAFF_INVITATION_TTL_MS, staffCapabilities, type CashierAction, type StaffRole } from '../../shared/staffTypes';
import { cashierRules } from '../../settings/model';
import { percentageOf } from '../../shared/money';

export { staffCapabilities, type StaffRole } from '../../shared/staffTypes';

export type StaffCapability = keyof ReturnType<typeof staffCapabilities>;

type PendingStaffInvitation = {
  branchIds: Id<'branches'>[];
  branches: { id: Id<'branches'>; name: string }[];
} & ({ role: 'owner'; expiresAt: null } | { role: 'manager' | 'cashier'; expiresAt: number });

export type StaffAccess = {
  email: string | null; tokenIdentifier: string | null; role: StaffRole;
  capabilities: ReturnType<typeof staffCapabilities>;
  branchIds: Id<'branches'>[];
  companyScope: boolean;
  pendingInvitation: PendingStaffInvitation | null;
};

export type StaffActor = StaffAccess & { email: string; tokenIdentifier: string; grantId?: Id<'staffGrants'> };

export function staffInvitationExpiry(grant: Doc<'staffGrants'>) {
  return grant.tokenIdentifier || grant.role === 'owner' ? null : grant.inviteExpiresAt ?? grant.createdAt + STAFF_INVITATION_TTL_MS;
}

export function validStaffEmail(raw: string) {
  const email = raw.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ConvexError('Enter a valid email');
  return email;
}

export function findStaffGrantByEmail(ctx: QueryCtx, email: string) {
  return ctx.db.query('staffGrants').withIndex('by_email', q => q.eq('email', email)).unique();
}

type StaffIdentity = Pick<UserIdentity, 'email' | 'emailVerified' | 'tokenIdentifier'>;

export function boundStaffGrant(ctx: QueryCtx, identity: StaffIdentity | null) {
  if (identity?.emailVerified !== true || !identity.email?.trim()) return null;
  return ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique();
}

export async function pendingStaffInvitation(ctx: QueryCtx, grant: Doc<'staffGrants'>): Promise<StaffAccess['pendingInvitation']> {
  if (grant.tokenIdentifier) return null;
  if (grant.role === 'owner') return { role: 'owner', expiresAt: null, branchIds: [], branches: [] };
  const expiresAt = staffInvitationExpiry(grant);
  if (expiresAt === null || expiresAt <= Date.now()) return null;
  const branches = await listAssignedBranches(ctx, grant.branchIds);
  if (!branches.length) return null;
  return {
    role: grant.role, expiresAt,
    branchIds: branches.map(branch => branch._id),
    branches: branches.map(({ _id: id, name }) => ({ id, name })),
  };
}

async function pendingOwnerInvitationForEmail(ctx: QueryCtx, email: string): Promise<StaffAccess['pendingInvitation']> {
  const invite = await findStaffGrantByEmail(ctx, email);
  return invite?.role === 'owner' ? await pendingStaffInvitation(ctx, invite) : null;
}

type AccessResolution = { access: StaffAccess; branches: Doc<'branches'>[]; accessReads: number; grantId?: Id<'staffGrants'> };

export async function resolveStaffAccess(ctx: QueryCtx, identity: StaffIdentity | null, scope?: 'selectedBranch'): Promise<AccessResolution> {
  const email = identity?.email?.trim().toLowerCase() || null;
  const tokenIdentifier = identity?.tokenIdentifier ?? null;
  const denied: AccessResolution = {
    access: { email, tokenIdentifier, role: null, capabilities: staffCapabilities(null), branchIds: [], companyScope: false, pendingInvitation: null },
    branches: [], accessReads: 0,
  };
  if (identity?.emailVerified !== true || !email) return denied;

  const grant = await boundStaffGrant(ctx, identity);
  if (!grant) {
    const invite = await findStaffGrantByEmail(ctx, email);
    return { ...denied, access: { ...denied.access, pendingInvitation: invite && await pendingStaffInvitation(ctx, invite) }, accessReads: 2 };
  }

  const companyScope = grant.role === 'owner';
  // Selected-branch registrations must authorize the target branch in the handler.
  // Keep the grant's raw membership IDs and let that check validate the single branch.
  if (scope === 'selectedBranch') {
    const role = companyScope || grant.branchIds.length ? grant.role : null;
    return {
      access: { ...denied.access, role, companyScope, branchIds: grant.branchIds, capabilities: staffCapabilities(role) },
      branches: [],
      accessReads: 1,
      grantId: grant._id,
    };
  }
  const checkPendingOwner = !companyScope && grant.email !== email;
  const [branches, pendingInvitation] = await Promise.all([
    companyScope ? Promise.resolve([]) : listAssignedBranches(ctx, grant.branchIds),
    checkPendingOwner ? pendingOwnerInvitationForEmail(ctx, email) : Promise.resolve(null),
  ]);
  const accessReads = 1 + (companyScope ? 0 : grant.branchIds.length) + (checkPendingOwner ? 1 : 0);
  if (!companyScope && !branches.length) {
    return { ...denied, access: { ...denied.access, pendingInvitation }, accessReads };
  }
  return {
    access: {
      ...denied.access, role: grant.role, capabilities: staffCapabilities(grant.role), companyScope,
      branchIds: branches.map(branch => branch._id), pendingInvitation,
    },
    branches,
    accessReads,
    grantId: grant._id,
  };
}

export async function accessForIdentity(ctx: QueryCtx, identity: StaffIdentity | null): Promise<StaffAccess> {
  return (await resolveStaffAccess(ctx, identity)).access;
}

export async function staffAccess(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<StaffAccess> {
  if (!('db' in ctx)) return await ctx.runQuery(internal.auth.staffAccess.currentInternal, {});
  return await accessForIdentity(ctx, await ctx.auth.getUserIdentity());
}

/** Legacy resort records are owned by the primary branch. */
export async function canAccessResortDesk(ctx: QueryCtx & { operationsAccess?: StaffAccess }, capability: 'chats' | 'bookings') {
  const actor = ctx.operationsAccess ?? await staffAccess(ctx);
  if (!actor.capabilities[capability]) return false;
  if (actor.companyScope) return true;
  const branch = await readBranchByKey(ctx, PRIMARY_BRANCH.key);
  return !!branch && branch.state !== 'archived' && actor.branchIds.includes(branch._id);
}

export async function requireStaff(ctx: QueryCtx | MutationCtx | ActionCtx, capability: StaffCapability, scope?: 'selectedBranch'): Promise<StaffActor & { accessReads: number }> {
  const { access, accessReads, grantId } = 'db' in ctx
    ? await resolveStaffAccess(ctx, await ctx.auth.getUserIdentity(), scope)
    : { access: await staffAccess(ctx), accessReads: 0, grantId: undefined };
  if (!access.email || !access.tokenIdentifier) throw new Error('Not authenticated');
  if (!access.capabilities[capability]) throw new Error('Not authorized');
  return { ...access, email: access.email, tokenIdentifier: access.tokenIdentifier, accessReads: 'db' in ctx ? accessReads : 0, ...(grantId ? { grantId } : {}) };
}

export async function requireCashierAction(ctx: QueryCtx | MutationCtx, actor: StaffActor, action: CashierAction) {
  if (actor.role === 'cashier' && (await cashierRules(ctx))[action] !== 'cashier')
    throw new ConvexError({ code: 'NEEDS_APPROVAL', kind: action, message: 'Ask a manager to approve this action.' });
}

export async function assertCashierDiscount(ctx: QueryCtx | MutationCtx, actor: StaffActor, line: PricedLine & { catalogUnitPrice?: number }) {
  if (actor.role !== 'cashier') return;
  const rules = await cashierRules(ctx);
  const reduction = manualReduction(line);
  const limitSatang = percentageOf(reduction.subtotalSatang, rules.discountLimitPercent);
  if (reduction.reductionSatang > limitSatang) throw new ConvexError({
    code: 'NEEDS_APPROVAL', kind: 'discount', message: 'This manual discount needs manager approval.',
    ...reduction, amount: reduction.reductionSatang, limitSatang, discountLimitPercent: rules.discountLimitPercent,
  });
}

export function canAccessCheckoutOrderBranch(actor: StaffActor, order: Pick<Doc<'orders'>, 'stockBranchId'>) {
  return !order.stockBranchId || actor.companyScope || actor.branchIds.includes(order.stockBranchId);
}

/** Cashier recall is limited to active checkout and receipts on today's resort business date. */
export function canReadCheckoutOrder(actor: StaffActor, order: Doc<'orders'> | null) {
  if (!order || !canAccessCheckoutOrderBranch(actor, order)) return false;
  if (actor.role !== 'cashier') return true;
  if (isOpenOrder(order)) return true;
  const settledAt = order.paymentEffectiveAt ?? order.paidAt;
  return isSettledOrder(order) && settledAt !== undefined && resortTodayIso(settledAt) === resortTodayIso();
}
