import { ConvexError } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';

type Branch = Doc<'branches'>;
type BranchScope = { companyScope: boolean; branchIds: Id<'branches'>[] };

export const PRIMARY_BRANCH = {
  key: 'koh-samui',
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

export async function listBranchesForAccess(ctx: QueryCtx, access: BranchScope): Promise<Branch[]> {
  if (access.companyScope) {
    const [beforeArchived, afterArchived] = await Promise.all([
      ctx.db.query('branches').withIndex('by_state', q => q.lt('state', 'archived')).collect(),
      ctx.db.query('branches').withIndex('by_state', q => q.gt('state', 'archived')).collect(),
    ]);
    return [...beforeArchived, ...afterArchived];
  }
  const assigned = await Promise.all(access.branchIds.map(id => readBranch(ctx, id)));
  return assigned.filter((branch): branch is Branch => branch !== null && branch.state !== 'archived');
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
