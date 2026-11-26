import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './model';
import { appendRecordHistory } from '../settings/model';
import { grantCompanyOwner, ownerGrants } from './private/owners';
import { findStaffGrantByEmail, validStaffEmail } from './private/staffAccess';

/** CLI: bun run convex run auth/owners:grantOwner '{"email":"owner@example.com"}' (pass "rebind":true to unbind a claimed owner for recovery) */
export const grantOwner = internalMutation({
  args: { email: v.string(), rebind: v.optional(v.boolean()) },
  returns: v.id('staffGrants'),
  handler: (ctx, { email, rebind }) => grantCompanyOwner(ctx, email, { rebind }),
});

/** CLI: bun run convex run auth/owners:revokeOwner '{"email":"owner@example.com"}' */
export const revokeOwner = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = validStaffEmail(args.email);
    const grant = await findStaffGrantByEmail(ctx, email);
    if (grant?.role !== 'owner') return null;
    if (grant.tokenIdentifier) {
      const claimed = await ctx.db.query('staffGrants')
        .withIndex('by_role_and_tokenIdentifier', q => q.eq('role', 'owner').gt('tokenIdentifier', '')).take(2);
      if (claimed.length < 2) throw new ConvexError('Cannot revoke the last owner.');
    }
    await appendRecordHistory(ctx, {
      entityType: 'staffGrant', entityId: grant._id, actor: 'system:deployment-admin', kind: 'revoked', before: { email, role: grant.role },
    });
    await ctx.db.delete(grant._id);
    return null;
  },
});

/** CLI: bun run convex run auth/owners:listOwners '{}' */
export const listOwners = internalQuery({
  args: {},
  returns: v.array(v.object({ email: v.string(), claimed: v.boolean() })),
  handler: async ctx => {
    const grants = await ownerGrants(ctx).take(501);
    if (grants.length > 500) throw new ConvexError('There are more than 500 owner grants. Contact support.');
    return grants.map(grant => ({ email: grant.email, claimed: Boolean(grant.tokenIdentifier) }));
  },
});
