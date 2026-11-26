import { ConvexError } from 'convex/values';
import type { QueryCtx } from '../_generated/server';
import { readBudget } from '../lib/readBudget';

import { PRIMARY_BRANCH, readBranchByKey } from '../branches/model';

export async function readDefaultBranch(ctx: QueryCtx) {
  const budget = readBudget(ctx);
  budget.range();
  budget.assert();
  const branch = await readBranchByKey(ctx, PRIMARY_BRANCH.key);
  if (branch) budget.document(branch);
  budget.assert();
  return branch;
}

export async function ensureDefaultBranch(ctx: QueryCtx) {
  const branch = await readDefaultBranch(ctx);
  if (!branch) throw new ConvexError('Payment activation requires the seeded Koh Samui branch.');
  return branch._id;
}
