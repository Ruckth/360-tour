import type { MutationCtx, QueryCtx } from '../_generated/server';
import { readBudget, reserveWrites } from '../lib/readBudget';

const DEFAULT_BRANCH_KEY = 'default';

export async function readDefaultBranch(ctx: QueryCtx) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const branch = await ctx.db.query('branches').withIndex('by_key', q => q.eq('key', DEFAULT_BRANCH_KEY)).unique();
  if (branch) budget.document(branch);
  budget.assert();
  return branch;
}

/** The indexed read and insert share the caller's transaction, including on concurrent setup. */
export async function ensureDefaultBranch(ctx: MutationCtx) {
  const branch = await readDefaultBranch(ctx);
  if (branch) return branch._id;
  reserveWrites(ctx, 1);
  return await ctx.db.insert('branches', { key: DEFAULT_BRANCH_KEY });
}
