import type { MutationCtx } from '../_generated/server';

/** Whether `key` has used up its limit, without counting this call. */
export async function rateLimitReached(ctx: MutationCtx, key: string, limit: number) {
  const row = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
  return !!row && row.expiresAt > Date.now() && row.count >= limit;
}

/** Fixed-window limit; all callers sharing a key contend on one atomic document. */
export async function enforceRateLimit(ctx: MutationCtx, key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const row = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
  if (!row) {
    await ctx.db.insert('rateLimits', { key, count: 1, expiresAt: now + windowMs });
  } else if (row.expiresAt <= now) {
    await ctx.db.patch(row._id, { count: 1, expiresAt: now + windowMs });
  } else if (row.count >= limit) {
    throw new Error('Too many requests. Please try again later.');
  } else {
    await ctx.db.patch(row._id, { count: row.count + 1 });
  }
}
