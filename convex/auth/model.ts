/** Public registration seam: maintenance first, then trust, then per-record handler policy. */
import { customAction, customCtx, customMutation, customQuery } from 'convex-helpers/server/customFunctions';
import type { HttpActionBuilder } from 'convex/server';
import { ConvexError, v } from 'convex/values';
import type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
import { action as rawAction, httpAction as rawHttpAction, mutation as rawMutation, query as rawQuery } from '../_generated/server';
import { sha256 } from '../lib/displayTokens';
import { maintenancePaused } from '../lib/maintenance';
import { requireMarketingPermission } from '../marketing/model';
import { requireGuestToken } from '../messaging/model';
import { type MarketingPermission } from '../shared/marketingAccess';
import { requireAdmin } from './private/adminAuth';
import { requireStaff, type StaffCapability } from './private/staffAccess';


// Never re-export raw public builders through this seam.
export { internalAction, internalMutation, internalQuery } from '../_generated/server';
export type { ActionCtx, MutationCtx, QueryCtx } from '../_generated/server';
export { maintenancePaused } from '../lib/maintenance';
function operational() {
  if (maintenancePaused()) {
    throw new ConvexError({ code: 'MAINTENANCE', message: 'The resort is temporarily unavailable for maintenance. Please try again shortly.' });
  }
}

type IdentityCtx = QueryCtx | MutationCtx | ActionCtx;
const publicAccess = customCtx((_ctx: IdentityCtx, { reason }: { reason: string }) => {
  operational();
  if (!reason.trim()) throw new Error('Public access requires a reason');
  return {};
});
/** Anonymous and capability-link endpoints must explain their public contract at registration. */
export const publicQuery = customQuery(rawQuery, publicAccess);
export const publicMutation = customMutation(rawMutation, publicAccess);
export const publicAction = customAction(rawAction, publicAccess);

const authenticatedAccess = customCtx(async (ctx: IdentityCtx) => {
  operational();
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error('Not authenticated');
  return { identity };
});
/** Clerk identity alone: invitation claims and self-owned records do not require a staff grant. */
export const authenticatedQuery = customQuery(rawQuery, authenticatedAccess);
export const authenticatedMutation = customMutation(rawMutation, authenticatedAccess);
export const authenticatedAction = customAction(rawAction, authenticatedAccess);

const adminAccess = customCtx(async (ctx: IdentityCtx) => {
  operational();
  // Authoritative operations policy, including managers. Actions use its internal access query.
  return { admin: await requireAdmin(ctx) };
});
export const adminQuery = customQuery(rawQuery, adminAccess);
export const adminMutation = customMutation(rawMutation, adminAccess);
export const adminAction = customAction(rawAction, adminAccess);

const staffAccess = customCtx(async (ctx: IdentityCtx, { capability }: { capability: StaffCapability }) => {
  operational();
  return { staff: await requireStaff(ctx, capability) };
});
export const staffQuery = customQuery(rawQuery, staffAccess);
export const staffMutation = customMutation(rawMutation, staffAccess);
export const staffAction = customAction(rawAction, staffAccess);

// Marketing grants are independent of desk roles. Never require a staff grant here.
const marketingAccess = customCtx(async (ctx: QueryCtx | MutationCtx, { permission }: { permission: MarketingPermission }) => {
  operational();
  return { marketing: await requireMarketingPermission(ctx, permission) };
});
export const marketingQuery = customQuery(rawQuery, marketingAccess);
export const marketingMutation = customMutation(rawMutation, marketingAccess);

const guestAccess = {
  // Missing optional credentials still fail with INVALID_GUEST_TOKEN, in the transaction.
  args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()) },
  input: async (ctx: QueryCtx | MutationCtx, args: { sessionId: import('../_generated/dataModel').Id<'conversations'>; guestToken?: string }) => {
    operational();
    const guestSession = await requireGuestToken(await ctx.db.get(args.sessionId), args.guestToken);
    return { ctx: { guestSession }, args: { ...args, guestToken: args.guestToken! } };
  },
};
export const guestQuery = customQuery(rawQuery, guestAccess);
export const guestMutation = customMutation(rawMutation, guestAccess);

const deviceAccess = {
  args: { token: v.string() },
  input: async (ctx: QueryCtx | MutationCtx, args: { token: string }) => {
    operational();
    const tokenHash = args.token && args.token.length <= 128 ? await sha256(args.token) : null;
    const device = tokenHash ? await ctx.db.query('displays').withIndex('by_tokenHash', q => q.eq('tokenHash', tokenHash)).unique() : null;
    // Preserve display polling's unpaired/no-op contract; a revoked token has no authority.
    return { ctx: { device: device?.status === 'revoked' ? null : device }, args };
  },
};
export const deviceQuery = customQuery(rawQuery, deviceAccess);
export const deviceMutation = customMutation(rawMutation, deviceAccess);

export const httpAction: HttpActionBuilder = handler => rawHttpAction((ctx, request) =>
  maintenancePaused()
    ? Promise.resolve(new Response('Temporarily unavailable for maintenance', { status: 503, headers: { 'Retry-After': '60' } }))
    : handler(ctx, request),
);
// Auth-owned plain ctx implementations. Registrations stay in users.ts/staffAccess.ts.
export { requireAdmin, requireOwner } from './private/adminAuth';
export { accessForIdentity, assertCashierDiscount, canReadCheckoutOrder, manualReduction, requireCashierAction, requireStaff, staffAccess, staffCapabilities, staffInvitationExpiry, type StaffAccess, type StaffActor, type StaffCapability, type StaffRole } from './private/staffAccess';
