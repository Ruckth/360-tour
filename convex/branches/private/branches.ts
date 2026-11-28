import { RESORT_BRANCH_KEY } from '../../shared/resortBranch';
import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import type { ReadBudget } from '../../lib/readBudget';

type Branch = Doc<'branches'>;
type BranchScope = { companyScope: boolean; branchIds: Id<'branches'>[] };
export const BRANCH_LIST_LIMIT = 500;
const BRANCH_LIST_LIMIT_MESSAGE = 'There are more than 500 branches to list. Contact support.';

export const PRIMARY_BRANCH = {
  key: RESORT_BRANCH_KEY,
  slug: 'koh-samui',
  name: 'Koh Samui',
  state: 'active',
  issuer: {
    legalName: '360 Tour Co., Ltd.',
    taxId: '0000000000000',
    branchCode: '00000',
    address: '88/8 Moo 3, Bophut, Koh Samui, Surat Thani 84320',
  },
} as const;

export function readBranch(ctx: QueryCtx, branchId: Id<'branches'>) {
  return ctx.db.get('branches', branchId);
}

export function readBranchByKey(ctx: QueryCtx, key: string) {
  return ctx.db.query('branches').withIndex('by_key', q => q.eq('key', key)).unique();
}

export async function listBranches(ctx: QueryCtx): Promise<Branch[]> {
  const branches = await ctx.db.query('branches').take(BRANCH_LIST_LIMIT + 1);
  if (branches.length > BRANCH_LIST_LIMIT) throw new ConvexError(BRANCH_LIST_LIMIT_MESSAGE);
  return branches;
}

export async function listAssignedBranches(ctx: QueryCtx, branchIds: Id<'branches'>[], budget?: ReadBudget): Promise<Branch[]> {
  const assigned = await Promise.all(branchIds.map(async id => {
    budget?.range();
    budget?.assert();
    const branch = await readBranch(ctx, id);
    if (branch) budget?.document(branch);
    budget?.assert();
    return branch;
  }));
  return assigned.filter((branch): branch is Branch => branch !== null && branch.state !== 'archived');
}

/**
 * Branches the actor may use: assigned ones, or for company scope every branch that is not archived.
 * `by_state` orders states as strings (active < archived < setup < suspended), so archived rows form one
 * contiguous range. Reading the ranges below and above it skips archived rows without reading them, and the
 * two reads together take at most BRANCH_LIST_LIMIT + 1 rows, enough to detect a list over the limit.
 */
export async function listBranchesForAccess(ctx: QueryCtx, access: BranchScope): Promise<Branch[]> {
  if (!access.companyScope) return listAssignedBranches(ctx, access.branchIds);
  const below = await ctx.db.query('branches').withIndex('by_state', q => q.lt('state', 'archived')).take(BRANCH_LIST_LIMIT + 1);
  const above = below.length > BRANCH_LIST_LIMIT ? [] : await ctx.db.query('branches')
    .withIndex('by_state', q => q.gt('state', 'archived')).take(BRANCH_LIST_LIMIT + 1 - below.length);
  const branches = [...below, ...above];
  if (branches.length > BRANCH_LIST_LIMIT) throw new ConvexError(BRANCH_LIST_LIMIT_MESSAGE);
  return branches;
}

export async function requireBranchAccess(ctx: QueryCtx, actor: BranchScope, branchId: Id<'branches'>): Promise<Branch> {
  if (actor.companyScope || actor.branchIds.includes(branchId)) {
    const branch = await readBranch(ctx, branchId);
    if (branch && branch.state !== 'archived') return branch;
  }
  throw new ConvexError({ code: 'BRANCH_FORBIDDEN', message: "You don't have access to this branch." });
}

export async function assertUniqueBranchSlug(ctx: QueryCtx, slug: string, branchId?: Id<'branches'>) {
  const existing = await ctx.db.query('branches').withIndex('by_slug', q => q.eq('slug', slug)).unique();
  if (existing && existing._id !== branchId) throw new ConvexError('This branch slug is already in use.');
}

export async function insertBranch(ctx: MutationCtx, branch: Pick<Branch, 'key' | 'name' | 'slug' | 'issuer' | 'state'>, actorEmail: string) {
  if (await readBranchByKey(ctx, branch.key)) throw new ConvexError('This branch key is already in use.');
  await assertUniqueBranchSlug(ctx, branch.slug);
  const now = Date.now();
  return ctx.db.insert('branches', {
    ...branch, stateChangedAt: now, stateChangedByEmail: actorEmail, revision: 1, createdAt: now, updatedAt: now,
  });
}
