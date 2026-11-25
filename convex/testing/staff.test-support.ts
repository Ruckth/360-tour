import type { TestConvex } from 'convex-test';
import type { UserIdentity } from 'convex/server';
import type { MutationCtx } from '../_generated/server';
import type schema from '../schema';
import { insertBranch, PRIMARY_BRANCH, readBranchByKey } from '../branches/model';

export async function asTestOwner(t: TestConvex<typeof schema>, identity: Partial<UserIdentity> & { email: string }) {
  const tokenIdentifier = identity.tokenIdentifier ?? `issuer|${identity.email.toLowerCase()}`;
  const email = identity.email.trim().toLowerCase();
  await t.run(async ctx => {
    const old = await ctx.db.query('staffGrants').withIndex('by_email', q => q.eq('email', email)).unique();
    if (!old) {
      const now = Date.now();
      await ctx.db.insert('staffGrants', { role: 'owner', email, tokenIdentifier, branchIds: [], createdAt: now, updatedAt: now, updatedByEmail: 'system:test' });
    }
  });
  return t.withIdentity({ ...identity, tokenIdentifier });
}

export async function seedTestBranch(ctx: MutationCtx, key: string = PRIMARY_BRANCH.key) {
  const existing = await readBranchByKey(ctx, key);
  return existing?._id ?? await insertBranch(ctx, {
    ...PRIMARY_BRANCH, key, slug: key, name: key === PRIMARY_BRANCH.key ? PRIMARY_BRANCH.name : key,
  }, 'system:test');
}
