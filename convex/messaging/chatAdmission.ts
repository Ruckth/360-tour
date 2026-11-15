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
  await chatLimiter.limit(ctx, 'session', { key: sessionId, throws: true });
  await chatLimiter.limit(ctx, 'global', { throws: true });
}
