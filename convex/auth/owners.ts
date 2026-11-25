import { ConvexError, v } from 'convex/values';
import { internalMutation, internalQuery } from './model';
import { appendRecordHistory } from '../settings/model';
import { grantCompanyOwner, ownerGrants } from './private/owners';
import { findStaffGrantByEmail, validStaffEmail } from './private/staffAccess';

/** CLI: bun run convex run auth/owners:grantOwner '{"email":"owner@example.com"}' */
export const grantOwner = internalMutation({
  args: { email: v.string() },
  returns: v.id('staffGrants'),
  handler: (ctx, { email }) => grantCompanyOwner(ctx, email),
});

/** CLI: bun run convex run auth/owners:revokeOwner '{"email":"owner@example.com"}' */
export const revokeOwner = internalMutation({
  args: { email: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = validStaffEmail(args.email);
    const grant = await findStaffGrantByEmail(ctx, email);
    if (grant?.role !== 'owner') return null;
    if ((await ownerGrants(ctx).take(2)).length < 2) throw new ConvexError('Cannot revoke the last owner.');
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
  handler: async ctx => (await ownerGrants(ctx).collect()).map(grant => ({ email: grant.email, claimed: Boolean(grant.tokenIdentifier) })),
});
