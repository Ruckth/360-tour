import { ConvexError, v } from 'convex/values';
import { internalQuery, mutation, query } from './_generated/server';
import { adminEmails, requireOwner } from './lib/adminAuth';
import { cashierRules, staffAccess, staffInvitationExpiry } from './lib/staffAccess';
import { cashierRulesFields, STAFF_INVITATION_TTL_MS, staffRole } from './lib/staffTypes';
import { appendRecordHistory } from './lib/recordHistory';
import { marketingAccess, marketingInvitationExpiry } from './lib/marketingAccess';

export const currentInternal = internalQuery({ args: {}, handler: staffAccess });
export const myAccess = query({ args: {}, handler: async ctx => {
  const [access, rules, marketing] = await Promise.all([staffAccess(ctx), cashierRules(ctx), marketingAccess(ctx)]);
  const { email, role, pendingInvitation } = access;
  const publicAccess = { email, role, pendingInvitation };
  return { ...publicAccess, capabilities: { ...access.capabilities, marketing: marketing.capabilities.view }, cashierRules: rules, marketingRole: marketing.role };
} });

export const claimInvite = mutation({ args: {}, handler: async ctx => {
  const identity = await ctx.auth.getUserIdentity();
  const email = identity?.email?.trim().toLowerCase();
  if (!identity || !email) throw new Error('Not authenticated');
  if (adminEmails().has(email)) return null;
  const bound = await ctx.db.query('staffGrants').withIndex('by_tokenIdentifier', q => q.eq('tokenIdentifier', identity.tokenIdentifier)).unique();
  if (bound) return null;
  const invite = await ctx.db.query('staffGrants').withIndex('by_email', q => q.eq('email', email)).unique();
  if (!invite || invite.tokenIdentifier) throw new ConvexError('No unclaimed invitation');
  if ((staffInvitationExpiry(invite) ?? 0) <= Date.now()) throw new ConvexError('Invitation expired. Ask an owner to resend it.');
  await ctx.db.patch(invite._id, { tokenIdentifier: identity.tokenIdentifier, revision: (invite.revision ?? 0) + 1, updatedAt: Date.now() });
  await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: invite._id, actor: email, kind: 'claimed', after: { role: invite.role } });
  return null;
} });

/** Combined by email, with independent staff and marketing grants (never copied/merged). */
export const listPeople = query({ args: {}, handler: async ctx => {
  await requireOwner(ctx);
  const staff = await ctx.db.query('staffGrants').take(501);
  const marketing = await ctx.db.query('marketingGrants').take(501);
  if (staff.length > 500 || marketing.length > 500) throw new ConvexError('Team is too large for this view. Contact support.');
  const owners = adminEmails();
  const emails = new Set([...owners, ...staff.map(g => g.email), ...marketing.map(g => g.email)]);
  return [...emails].sort().map(email => {
    const grant = staff.find(g => g.email === email);
    const marketingGrant = marketing.find(g => g.email === email);
    const describe = (row: typeof grant | typeof marketingGrant, expiresAt: number | null) => row ? {
      id: row._id, role: row.role, claimed: Boolean(row.tokenIdentifier), expiresAt,
      expired: expiresAt !== null && expiresAt <= Date.now(), updatedAt: row.updatedAt,
    } : null;
    return {
      email, role: owners.has(email) ? 'owner' as const : grant?.role ?? null,
      staffGrant: describe(grant, grant ? staffInvitationExpiry(grant) : null),
      marketingGrant: describe(marketingGrant, marketingGrant ? marketingInvitationExpiry(marketingGrant) : null),
    };
  });
} });

/** Invite, change a claimed role, or revoke. Updating an unclaimed invite never renews its deadline. */
export const setGrant = mutation({ args: { email: v.string(), role: v.union(staffRole, v.null()) }, handler: async (ctx, args) => {
  const actor = await requireOwner(ctx);
  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw new ConvexError('Enter a valid email');
  if (adminEmails().has(email)) throw new ConvexError('Owners are managed through ADMIN_EMAILS and cannot be downgraded.');
  const old = await ctx.db.query('staffGrants').withIndex('by_email', q => q.eq('email', email)).unique();
  if (args.role === null) {
    if (old) {
      await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: old._id, actor: actor.email, kind: 'revoked', before: { email, role: old.role } });
      await ctx.db.delete(old._id);
    }
    return null;
  }
  const now = Date.now();
  const fields = { email, role: args.role, revision: (old?.revision ?? 0) + 1, updatedAt: now, updatedByEmail: actor.email };
  const id = old ? old._id : await ctx.db.insert('staffGrants', { ...fields, inviteExpiresAt: now + STAFF_INVITATION_TTL_MS, createdAt: now });
  if (old) await ctx.db.patch(id, fields);
  await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: id, actor: actor.email, kind: old ? 'updated' : 'invited', ...(old ? { before: { role: old.role } } : {}), after: { email, role: args.role } });
  return id;
} });

/** Resending renews the existing invitation; expiring prevents claim. Neither sends an email. */
export const updateInvitation = mutation({ args: { grantId: v.id('staffGrants'), action: v.union(v.literal('resend'), v.literal('expire')) }, handler: async (ctx, args) => {
  const actor = await requireOwner(ctx);
  const grant = await ctx.db.get(args.grantId);
  if (!grant || grant.tokenIdentifier) throw new ConvexError('No unclaimed invitation');
  const expiresAt = Date.now() + (args.action === 'resend' ? STAFF_INVITATION_TTL_MS : 0);
  await ctx.db.patch(grant._id, { inviteExpiresAt: expiresAt, revision: (grant.revision ?? 0) + 1, updatedAt: Date.now(), updatedByEmail: actor.email });
  await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: grant._id, actor: actor.email, kind: args.action, after: { expiresAt } });
  return { expiresAt };
} });

export const getCashierRules = query({ args: {}, handler: async ctx => { await requireOwner(ctx); return await cashierRules(ctx); } });
export const updateCashierRules = mutation({ args: { expectedRevision: v.number(), ...cashierRulesFields }, handler: async (ctx, args) => {
  const actor = await requireOwner(ctx);
  const before = await cashierRules(ctx);
  if (args.expectedRevision !== before.revision) throw new ConvexError({ code: 'STALE_RULES', message: 'Cashier rules changed. Reload and try again.' });
  const limit = args.discountLimitPercent;
  if (!Number.isFinite(limit) || limit < 0 || limit > 100 || Math.abs(Math.round(limit * 100) - limit * 100) > 1e-8) throw new ConvexError('Use 0–100%, up to two decimals.');
  const { discountLimitPercent, voidPaidSale, customPrice, paymentFix } = args;
  const rules = { discountLimitPercent, voidPaidSale, customPrice, paymentFix };
  const fields = { ...rules, revision: before.revision + 1, updatedAt: Date.now(), updatedByEmail: actor.email };
  const row = await ctx.db.query('cashierRules').withIndex('by_key', q => q.eq('key', 'default')).unique();
  const id = row ? row._id : await ctx.db.insert('cashierRules', { key: 'default', ...fields });
  if (row) await ctx.db.patch(id, fields);
  await appendRecordHistory(ctx, { entityType: 'cashierRules', entityId: id, actor: actor.email, kind: 'updated', before, after: fields });
  return { ...rules, revision: fields.revision };
} });
