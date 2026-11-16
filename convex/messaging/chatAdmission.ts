import { HOUR, RateLimiter } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';

export const chatLimiter = new RateLimiter(components.rateLimiter, {
  session: { kind: 'fixed window', rate: 20, period: HOUR },
  global: { kind: 'fixed window', rate: 500, period: HOUR, shards: 10 },
});

/** Both admissions and the message commit atomically; duplicate retries consume neither. */
export async function consumeChatAdmission(ctx: MutationCtx, sessionId: Id<'conversations'>) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error('Session not found');
  // Public callers can create only web sessions; messaging channels are server-owned.
  const kind = session.channel === 'web' ? 'web' : 'messaging';
  await chatLimiter.limit(ctx, 'session', { key: sessionId, throws: true });
  await chatLimiter.limit(ctx, 'global', { key: kind, throws: true });
}
