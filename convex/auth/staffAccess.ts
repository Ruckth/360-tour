import { staffAccessListPeopleResult, staffAccessMyAccessResult } from './validators';
import { ConvexError, v } from 'convex/values';
import { authenticatedMutation, internalQuery, publicQuery, staffMutation, staffQuery } from './model';
import { listAssignedBranches, listBranchesForAccess, readBranch } from '../branches/model';
import { STAFF_INVITATION_TTL_MS, staffRole } from '../shared/staffTypes';
import { isSeparateMarketingAccount, retireOwnerMarketingGrants, marketingAccessForIdentity, marketingInvitationExpiry } from '../marketing/model';
import { appendRecordHistory, cashierRules } from '../settings/model';
import { boundStaffGrant, findStaffGrantByEmail, resolveStaffAccess, staffAccess, staffInvitationExpiry, validStaffEmail } from './private/staffAccess';
import { OWNER_MANAGEMENT_MESSAGE } from './private/owners';

export const currentInternal = internalQuery({ args: {}, handler: staffAccess });

export const myAccess = publicQuery({
  returns: staffAccessMyAccessResult,
  reason: "Sign-in bootstrap returns caller capabilities or anonymous access.", args: {}, handler: async ctx => {
  const identity = await ctx.auth.getUserIdentity();
  const [{ access, branches: assigned }, rules] = await Promise.all([resolveStaffAccess(ctx, identity), cashierRules(ctx)]);
  const { email, role, pendingInvitation, companyScope } = access;
  const [currentBranches, marketing] = await Promise.all([
    companyScope ? listBranchesForAccess(ctx, access) : assigned,
    marketingAccessForIdentity(ctx, identity, companyScope),
  ]);
  const branches = currentBranches.map(({ _id: id, key, name, slug, state }) => ({ id, key, name, slug, state }));
  const publicAccess = { email, role, pendingInvitation, companyScope, branches };
  return { ...publicAccess, capabilities: { ...access.capabilities, marketing: marketing.capabilities.view }, cashierRules: rules, marketingInvitation: marketing.pendingInvitation, marketingRole: marketing.role };
} });

export const claimInvite = authenticatedMutation({ args: {}, handler: async ctx => {
  const identity = ctx.identity;
  const email = identity?.email?.trim().toLowerCase();
  if (!identity || !email) throw new Error('Not authenticated');
  if (identity.emailVerified !== true) throw new ConvexError('Verify your email before claiming a staff invitation');
  const [existing, invite] = await Promise.all([boundStaffGrant(ctx, identity), findStaffGrantByEmail(ctx, email)]);
  if (existing) {
    if (existing.email === email || existing.role === 'owner') return null;
    if (!invite || invite.tokenIdentifier || invite.role !== 'owner') throw new ConvexError('No unclaimed invitation');
  } else if (!invite || invite.tokenIdentifier) {
    throw new ConvexError('No unclaimed invitation');
  }
  const now = Date.now();
  const expiresAt = staffInvitationExpiry(invite);
  if (expiresAt !== null && expiresAt <= now) throw new ConvexError('Invitation expired. Ask an owner to resend it.');
  if (invite.role !== 'owner' && !(await listAssignedBranches(ctx, invite.branchIds)).length) {
    throw new ConvexError('This invitation has no available branches. Ask an owner to update it.');
  }
  if (existing) {
    await ctx.db.delete(existing._id);
    await appendRecordHistory(ctx, {
      entityType: 'staffGrant', entityId: existing._id, actor: email, kind: 'retired',
      reason: 'Superseded by claimed owner grant',
      before: { email: existing.email, role: existing.role, branchIds: existing.branchIds },
      after: { replacedByGrantId: invite._id, replacedByEmail: invite.email, replacedByRole: invite.role },
    });
  }
  if (invite.role === 'owner') await retireOwnerMarketingGrants(ctx, email, identity.tokenIdentifier, email);
  const branchIds = invite.role === 'owner' ? [] : invite.branchIds;
  await ctx.db.patch(invite._id, {
    tokenIdentifier: identity.tokenIdentifier,
    ...(invite.role === 'owner' ? { inviteExpiresAt: undefined, branchIds } : {}),
    revision: (invite.revision ?? 0) + 1, updatedAt: now,
  });
  await appendRecordHistory(ctx, {
    entityType: 'staffGrant', entityId: invite._id, actor: email, kind: 'claimed',
    ...(existing ? { before: { retiredGrantId: existing._id, email: existing.email, role: existing.role, branchIds: existing.branchIds } } : {}),
    after: { email: invite.email, role: invite.role, branchIds },
  });
  return null;
} });

/** Combined by email, with independent staff and marketing grants (never copied/merged). */
export const listPeople = staffQuery({
  capability: 'manageTeam', args: {}, returns: staffAccessListPeopleResult, handler: async ctx => {
  const staff = await ctx.db.query('staffGrants').take(501);
  const marketing = await ctx.db.query('marketingGrants').take(501);
  if (staff.length > 500 || marketing.length > 500) throw new ConvexError('Team is too large for this view. Contact support.');
  const staffByEmail = new Map(staff.map(grant => [grant.email, grant]));
  const marketingByEmail = new Map(marketing.map(grant => [grant.email, grant]));
  const emails = new Set([...staffByEmail.keys(), ...marketingByEmail.keys()]);
  const now = Date.now();
  const status = (row: { tokenIdentifier?: string; updatedAt: number }, expiresAt: number | null) => ({
    claimed: Boolean(row.tokenIdentifier), expiresAt, expired: expiresAt !== null && expiresAt <= now, updatedAt: row.updatedAt,
  });
  return [...emails].sort().map(email => {
    const grant = staffByEmail.get(email);
    const storedMarketing = marketingByEmail.get(email) ?? null;
    const separateMarketingAccount = grant?.role === 'owner' && isSeparateMarketingAccount(grant, storedMarketing);
    const marketingGrant = grant?.role === 'owner' && !separateMarketingAccount ? null : storedMarketing;
    return {
      email, role: grant?.role ?? null, branchIds: grant?.branchIds ?? [], separateMarketingAccount,
      staffGrant: grant ? { id: grant._id, revision: grant.revision ?? 0, role: grant.role, ...status(grant, staffInvitationExpiry(grant)) } : null,
      marketingGrant: marketingGrant ? {
        id: marketingGrant._id, revision: marketingGrant.revision ?? 0, role: marketingGrant.role, ...status(marketingGrant, marketingInvitationExpiry(marketingGrant)),
      } : null,
    };
  });
} });

/** Invite, change a claimed role, or revoke. Updating an unclaimed invite never renews its deadline. */
export const setGrant = staffMutation({
  capability: 'manageTeam', args: {
    email: v.string(), role: v.union(staffRole, v.null()), branchIds: v.array(v.id('branches')),
    expectedGrant: v.union(v.null(), v.object({ id: v.id('staffGrants'), revision: v.number() })),
  },
  returns: v.union(v.id('staffGrants'), v.null()), handler: async (ctx, args) => {
  const actor = ctx.staff;
  const email = validStaffEmail(args.email);
  const old = await findStaffGrantByEmail(ctx, email);
  if (old?.role === 'owner') throw new ConvexError(OWNER_MANAGEMENT_MESSAGE);
  const expected = args.expectedGrant;
  if (expected === null && old) throw new ConvexError('This person already has desk access or an invitation. Review their Team entry.');
  if (expected && (old?._id !== expected.id || (old.revision ?? 0) !== expected.revision)) {
    throw new ConvexError('Desk access changed. Review the current role and branches before trying again.');
  }
  if (args.role === null) {
    if (old) {
      await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: old._id, actor: actor.email, kind: 'revoked', before: { email, role: old.role, branchIds: old.branchIds } });
      await ctx.db.delete(old._id);
    }
    return null;
  }
  const { branchIds } = args;
  if (branchIds.length === 0) throw new ConvexError('Select at least one branch.');
  if (new Set(branchIds).size !== branchIds.length) throw new ConvexError('Select each branch only once.');
  const branches = await Promise.all(branchIds.map(id => readBranch(ctx, id)));
  if (branches.some(branch => !branch || branch.state === 'archived')) throw new ConvexError('Select existing branches that are not archived.');
  const now = Date.now();
  const fields = { email, role: args.role, branchIds, revision: (old?.revision ?? 0) + 1, updatedAt: now, updatedByEmail: actor.email };
  const id = old ? old._id : await ctx.db.insert('staffGrants', { ...fields, inviteExpiresAt: now + STAFF_INVITATION_TTL_MS, createdAt: now });
  if (old) await ctx.db.patch(id, fields);
  await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: id, actor: actor.email, kind: old ? 'updated' : 'invited', ...(old ? { before: { role: old.role, branchIds: old.branchIds } } : {}), after: { email, role: args.role, branchIds } });
  return id;
} });

/** Resending renews the existing invitation; expiring prevents claim. Neither sends an email. */
export const updateInvitation = staffMutation({
  capability: 'manageTeam', args: { grantId: v.id('staffGrants'), expectedRevision: v.number(), action: v.union(v.literal('resend'), v.literal('expire')) }, handler: async (ctx, args) => {
  const actor = ctx.staff;
  const grant = await ctx.db.get(args.grantId);
  if (grant?.role === 'owner') throw new ConvexError(OWNER_MANAGEMENT_MESSAGE);
  if (!grant || grant.tokenIdentifier) throw new ConvexError('No unclaimed invitation');
  if ((grant.revision ?? 0) !== args.expectedRevision) throw new ConvexError('Invitation changed. Review the current invitation before trying again.');
  const expiresAt = Date.now() + (args.action === 'resend' ? STAFF_INVITATION_TTL_MS : 0);
  await ctx.db.patch(grant._id, { inviteExpiresAt: expiresAt, revision: (grant.revision ?? 0) + 1, updatedAt: Date.now(), updatedByEmail: actor.email });
  await appendRecordHistory(ctx, { entityType: 'staffGrant', entityId: grant._id, actor: actor.email, kind: args.action, after: { expiresAt } });
  return { expiresAt };
} });
