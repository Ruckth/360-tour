import { HOUR, RateLimiter, type RateLimitConfig } from '@convex-dev/rate-limiter';
import { components } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { getSiteSettingsRow } from '../settings/model';
import { CHAT_REPLY_LIMIT_DEFAULTS, resolveChatReplyLimits } from '../shared/siteSettings';

/** Keep at least 50 replies per shard; small allowances must admit even a single reply. */
export function channelLimitConfig(rate: number): RateLimitConfig {
  return { kind: 'fixed window', rate, period: HOUR, ...(rate >= 500 ? { shards: 10 } : {}) };
}

export const chatLimiter = new RateLimiter(components.rateLimiter, {
  session: { kind: 'fixed window', rate: CHAT_REPLY_LIMIT_DEFAULTS.perChat, period: HOUR },
  global: channelLimitConfig(CHAT_REPLY_LIMIT_DEFAULTS.web),
});

/**
 * The component stores a remaining balance per name, so a non-default allowance gets its own name:
 * a changed limit (or shard layout) never inherits a balance counted under another limit.
 */
function budgetName(base: 'session' | 'global', rate: number, defaultRate: number) {
  return rate === defaultRate ? base : `${base}:${rate}`;
}

/** Both admissions and the message commit atomically; duplicate retries consume neither. */
export async function consumeChatAdmission(ctx: MutationCtx, sessionId: Id<'conversations'>) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error('Session not found');
  const limits = resolveChatReplyLimits(await getSiteSettingsRow(ctx));
  const perChat = limits.perChat, channel = limits[session.channel];
  await chatLimiter.limit(ctx, budgetName('session', perChat, CHAT_REPLY_LIMIT_DEFAULTS.perChat), { key: sessionId, config: { kind: 'fixed window', rate: perChat, period: HOUR }, throws: true });
  await chatLimiter.limit(ctx, budgetName('global', channel, CHAT_REPLY_LIMIT_DEFAULTS[session.channel]), { key: session.channel, config: channelLimitConfig(channel), throws: true });
}
