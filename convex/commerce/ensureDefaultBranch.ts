import type { MutationCtx, QueryCtx } from '../_generated/server';
import { readBudget, reserveWrites } from '../lib/readBudget';

import { insertBranch, PRIMARY_BRANCH, readBranchByKey } from '../branches/model';

export async function readDefaultBranch(ctx: QueryCtx) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const branch = await readBranchByKey(ctx, PRIMARY_BRANCH.key);
  if (branch) budget.document(branch);
  budget.assert();
  return branch;
}

/** The indexed read and insert share the caller's transaction, including on concurrent setup. */
export async function ensureDefaultBranch(ctx: MutationCtx) {
  const branch = await readDefaultBranch(ctx);
  if (branch) return branch._id;
  reserveWrites(ctx, 1);
  return await insertBranch(ctx, PRIMARY_BRANCH, 'system:commerce');
}
