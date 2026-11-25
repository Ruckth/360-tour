import { manualReduction } from '../../shared/staffDiscount';
import type { UserIdentity } from 'convex/server';
import { ConvexError } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc, Id } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { listAssignedBranches } from '../../branches/model';
import { resortTodayIso } from '../../shared/time';
import { isOpenOrder, isSettledOrder } from '../../pos/model';
import { type PricedLine } from '../../shared/orderMath';
import { STAFF_INVITATION_TTL_MS, type CashierAction } from '../../shared/staffTypes';
import { cashierRules } from '../../settings/model';
import { percentageOf } from '../../shared/money';

export type StaffRole = 'owner' | 'manager' | 'cashier' | null;

export function staffCapabilities(role: StaffRole) {
  const operations = role === 'owner' || role === 'manager';
  return {
    checkout: role !== null, approve: operations, operations,
    manageTeam: role === 'owner', settings: role === 'owner',
    bookings: operations, services: operations, customers: operations, orders: operations,
    chats: operations, properties: operations, roster: operations, reports: operations,
    // Marketing is resolved separately, through the existing marketing grants.
  };
}

export type StaffCapability = keyof ReturnType<typeof staffCapabilities>;

export type StaffAccess = {
  email: string | null; tokenIdentifier: string | null; role: StaffRole;
  capabilities: ReturnType<typeof staffCapabilities>;
  branchIds: Id<'branches'>[];
  companyScope: boolean;
  pendingInvitation: (
    { role: 'owner'; expiresAt: null; branchIds: Id<'branches'>[] } |
    { role: 'manager' | 'cashier'; expiresAt: number; branchIds: Id<'branches'>[] }
  ) | null;
};

export type StaffActor = StaffAccess & { email: string; tokenIdentifier: string };

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
  if (grant.role === 'owner') return { role: 'owner', expiresAt: null, branchIds: [] };
  const expiresAt = staffInvitationExpiry(grant);
  if (expiresAt === null || expiresAt <= Date.now()) return null;
  const branches = await listAssignedBranches(ctx, grant.branchIds);
  return branches.length ? { role: grant.role, expiresAt, branchIds: branches.map(branch => branch._id) } : null;
}

type AccessResolution = { access: StaffAccess; branches: Doc<'branches'>[]; branchReads: number };

export async function resolveStaffAccess(ctx: QueryCtx, identity: StaffIdentity | null): Promise<AccessResolution> {
  const email = identity?.email?.trim().toLowerCase() || null;
  const tokenIdentifier = identity?.tokenIdentifier ?? null;
  const denied: AccessResolution = {
    access: { email, tokenIdentifier, role: null, capabilities: staffCapabilities(null), branchIds: [], companyScope: false, pendingInvitation: null },
    branches: [], branchReads: 0,
  };
  if (identity?.emailVerified !== true || !email) return denied;

  const grant = await boundStaffGrant(ctx, identity);
  if (!grant) {
    const invite = await findStaffGrantByEmail(ctx, email);
    return { ...denied, access: { ...denied.access, pendingInvitation: invite && await pendingStaffInvitation(ctx, invite) } };
  }

  const companyScope = grant.role === 'owner';
  const branches = companyScope ? [] : await listAssignedBranches(ctx, grant.branchIds);
  if (!companyScope && !branches.length) return denied;
  return {
    access: {
      ...denied.access, role: grant.role, capabilities: staffCapabilities(grant.role), companyScope,
      branchIds: branches.map(branch => branch._id),
    },
    branches,
    branchReads: companyScope ? 0 : grant.branchIds.length,
  };
}

export async function accessForIdentity(ctx: QueryCtx, identity: StaffIdentity | null): Promise<StaffAccess> {
  return (await resolveStaffAccess(ctx, identity)).access;
}

export async function staffAccess(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<StaffAccess> {
  if (!('db' in ctx)) return await ctx.runQuery(internal.auth.staffAccess.currentInternal, {});
  return await accessForIdentity(ctx, await ctx.auth.getUserIdentity());
}

export async function requireStaff(ctx: QueryCtx | MutationCtx | ActionCtx, capability: StaffCapability): Promise<StaffActor & { accessReads: number }> {
  const { access, branchReads } = 'db' in ctx
    ? await resolveStaffAccess(ctx, await ctx.auth.getUserIdentity())
    : { access: await staffAccess(ctx), branchReads: 0 };
  if (!access.email || !access.tokenIdentifier) throw new Error('Not authenticated');
  if (!access.capabilities[capability]) throw new Error('Not authorized');
  return { ...access, email: access.email, tokenIdentifier: access.tokenIdentifier, accessReads: 'db' in ctx ? 1 + branchReads : 0 };
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

/** Cashier recall is limited to active checkout and receipts on today's resort business date. */
export function canReadCheckoutOrder(actor: StaffActor, order: Doc<'orders'> | null) {
  if (!order) return false;
  if (actor.role !== 'cashier') return true;
  if (isOpenOrder(order)) return true;
  const settledAt = order.paymentEffectiveAt ?? order.paidAt;
  return isSettledOrder(order) && settledAt !== undefined && resortTodayIso(settledAt) === resortTodayIso();
}
