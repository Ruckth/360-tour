import { ConvexError, v } from 'convex/values';
import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';
import { staffMutation, staffQuery } from '../auth/model';
import { appendRecordHistory } from '../settings/model';
import { assertUniqueBranchSlug, insertBranch, readBranch } from './private/branches';
import { branchState, type BranchState } from '../shared/branchTypes';
import { branchDocument, branchProfileFields } from './validators';

type Profile = Pick<Doc<'branches'>, 'name' | 'slug' | 'issuer'>;
const transitions: Record<BranchState, readonly BranchState[]> = {
  setup: ['active', 'archived'],
  active: ['suspended'],
  suspended: ['active', 'archived'],
  archived: [],
};

function slugValue(raw: string, label: string) {
  const value = raw.trim().toLowerCase();
  if (value.length > 80 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new ConvexError(`Enter a branch ${label} of 1–80 characters using letters, numbers and single hyphens.`);
  }
  return value;
}

function cleanProfile({ name, slug, issuer }: Profile): Profile {
  const clean = { legalName: issuer.legalName.trim(), taxId: issuer.taxId.trim(), branchCode: issuer.branchCode.trim(), address: issuer.address.trim() };
  if (!name.trim()) throw new ConvexError('Enter a branch name.');
  if (!clean.legalName || !clean.taxId || !clean.address) throw new ConvexError('Enter the issuer legal name, tax ID and address.');
  if (!/^[0-9]{5}$/.test(clean.branchCode)) throw new ConvexError('Enter a five-digit issuer branch code.');
  return { name: name.trim(), slug: slugValue(slug, 'slug'), issuer: clean };
}

async function existingBranch(ctx: QueryCtx, branchId: Id<'branches'>) {
  const branch = await readBranch(ctx, branchId);
  if (!branch) throw new ConvexError('Branch not found.');
  return branch;
}

export const list = staffQuery({
  capability: 'manageTeam',
  args: {},
  returns: v.array(branchDocument),
  handler: ctx => ctx.db.query('branches').collect(),
});

export const create = staffMutation({
  capability: 'manageTeam',
  args: { key: v.string(), ...branchProfileFields },
  returns: v.id('branches'),
  handler: async (ctx, { key, ...profile }) => {
    const branch = { ...cleanProfile(profile), key: slugValue(key, 'key'), state: 'setup' as const };
    const id = await insertBranch(ctx, branch, ctx.staff.email);
    await appendRecordHistory(ctx, { entityType: 'branch', entityId: id, actor: ctx.staff.email, kind: 'created', after: branch });
    return id;
  },
});

export const update = staffMutation({
  capability: 'manageTeam',
  args: { branchId: v.id('branches'), revision: v.number(), ...branchProfileFields },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, { branchId, revision, ...profile }) => {
    const branch = await existingBranch(ctx, branchId);
    if (branch.state === 'archived') throw new ConvexError('Archived branches are read-only.');
    if (branch.revision !== revision) throw new ConvexError('This branch changed. Reload it and try again.');
    const next = cleanProfile(profile);
    await assertUniqueBranchSlug(ctx, next.slug, branchId);
    const patch = { ...next, revision: revision + 1, updatedAt: Date.now() };
    await ctx.db.patch(branchId, patch);
    await appendRecordHistory(ctx, {
      entityType: 'branch', entityId: branchId, actor: ctx.staff.email, kind: 'updated',
      before: { name: branch.name, slug: branch.slug, issuer: branch.issuer }, after: next,
    });
    return { revision: patch.revision };
  },
});

export const setState = staffMutation({
  capability: 'manageTeam',
  args: { branchId: v.id('branches'), state: branchState, reason: v.optional(v.string()) },
  returns: v.object({ revision: v.number() }),
  handler: async (ctx, { branchId, state, reason }) => {
    const branch = await existingBranch(ctx, branchId);
    if (branch.state === 'active' && state === 'archived') throw new ConvexError('Suspend the branch before archiving it.');
    if (!transitions[branch.state].includes(state)) throw new ConvexError('This branch state transition is not allowed.');
    const stateReason = reason?.trim() || undefined;
    if (state === 'suspended' && !stateReason) throw new ConvexError('Enter a reason for suspending this branch.');
    const now = Date.now();
    const revision = branch.revision + 1;
    await ctx.db.patch(branchId, { state, stateReason, stateChangedAt: now, stateChangedByEmail: ctx.staff.email, revision, updatedAt: now });
    await appendRecordHistory(ctx, {
      entityType: 'branch', entityId: branchId, actor: ctx.staff.email, kind: 'state_changed', reason: stateReason,
      before: { state: branch.state, ...(branch.stateReason ? { stateReason: branch.stateReason } : {}) },
      after: { state, ...(stateReason ? { stateReason } : {}) },
    });
    return { revision };
  },
});
