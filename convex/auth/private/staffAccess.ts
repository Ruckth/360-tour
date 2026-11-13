import type { UserIdentity } from 'convex/server';
import { ConvexError } from 'convex/values';
import { internal } from '../../_generated/api';
import type { Doc } from '../../_generated/dataModel';
import type { ActionCtx, MutationCtx, QueryCtx } from '../../_generated/server';
import { adminEmails } from '../../lib/adminEmails';
import { resortTodayIso } from '../../lib/dates';
import { isOpenOrder, isSettledOrder } from '../../pos/model';
import { lineCouponBase, roundMoney, type PricedLine } from '../../lib/orderMath';
import { STAFF_INVITATION_TTL_MS, type CashierAction } from '../../lib/staffTypes';
import { cashierRules } from '../../settings/model';
import { percentageOf, roundRatio } from '../../shared/money';

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
  pendingInvitation: { role: 'manager' | 'cashier'; expiresAt: number } | null;
};

export type StaffActor = StaffAccess & { email: string; tokenIdentifier: string };

export function staffInvitationExpiry(grant: Doc<'staffGrants'>) {
  return grant.tokenIdentifier ? null : grant.inviteExpiresAt ?? grant.createdAt + STAFF_INVITATION_TTL_MS;
}

export async function accessForIdentity(ctx: QueryCtx | MutationCtx, identity: Pick<UserIdentity, 'email' | 'tokenIdentifier'> | null): Promise<StaffAccess> {
  const email = identity?.email?.trim().toLowerCase() ?? null;
  let role: StaffRole = null;
  let pendingInvitation: StaffAccess['pendingInvitation'] = null;
  if (email && adminEmails().has(email)) role = 'owner';
  else if (identity && email) {
    const grant = await ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique();
    role = grant?.role ?? null;
    if (!grant) {
      const invite = await ctx.db.query('staffGrants').withIndex('by_email', q => q.eq('email', email)).unique();
      const expiresAt = invite && staffInvitationExpiry(invite);
      if (invite && expiresAt && expiresAt > Date.now()) pendingInvitation = { role: invite.role, expiresAt };
    }
  }
  return { email, tokenIdentifier: identity?.tokenIdentifier ?? null, role, capabilities: staffCapabilities(role), pendingInvitation };
}

export async function staffAccess(ctx: QueryCtx | MutationCtx | ActionCtx): Promise<StaffAccess> {
  if (!('db' in ctx)) return await ctx.runQuery(internal.auth.staffAccess.currentInternal, {});
  return await accessForIdentity(ctx, await ctx.auth.getUserIdentity());
}

export async function requireStaff(ctx: QueryCtx | MutationCtx | ActionCtx, capability: StaffCapability): Promise<StaffActor> {
  const access = await staffAccess(ctx);
  if (!access.email || !access.tokenIdentifier) throw new Error('Not authenticated');
  if (!access.capabilities[capability]) throw new Error('Not authorized');
  return { ...access, email: access.email, tokenIdentifier: access.tokenIdentifier };
}

export async function requireCashierAction(ctx: QueryCtx | MutationCtx, actor: StaffActor, action: CashierAction) {
  if (actor.role === 'cashier' && (await cashierRules(ctx))[action] !== 'cashier')
    throw new ConvexError({ code: 'NEEDS_APPROVAL', kind: action, message: 'Ask a manager to approve this action.' });
}

/** Baseline (at least the line price) × current quantity; the coupon is deliberately excluded. Whole satang throughout. */
export function manualReduction(line: PricedLine & { catalogUnitPrice?: number }) {
  const subtotalSatang = roundMoney(Math.max(line.catalogUnitPrice ?? line.unitPrice, line.unitPrice) * line.qty);
  const reductionSatang = Math.max(0, subtotalSatang - lineCouponBase(line));
  return { subtotalSatang, reductionSatang, percent: subtotalSatang ? roundRatio(BigInt(reductionSatang) * 10000n, subtotalSatang) : 0 };
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
