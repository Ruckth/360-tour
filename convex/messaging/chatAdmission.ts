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

/** Both admissions and the message commit atomically; duplicate retries consume neither. */
export async function consumeChatAdmission(ctx: MutationCtx, sessionId: Id<'conversations'>) {
  const session = await ctx.db.get(sessionId);
  if (!session) throw new Error('Session not found');
  const row = await getSiteSettingsRow(ctx);
  const limits = resolveChatReplyLimits(row);
  const versions = row?.chatReplyLimitVersions;
  // The component stores remaining tokens, not usage. New namespaces avoid stale balances
  // and shard layouts on edits. Only the changed allowance resets; keys stay channel/session.
  const sessionName = versions?.perChat ? `session:${versions.perChat}` : 'session';
  const channelVersion = versions?.[session.channel];
  const channelName = channelVersion ? `global:${channelVersion}` : 'global';
  await chatLimiter.limit(ctx, sessionName, { key: sessionId, config: { kind: 'fixed window', rate: limits.perChat, period: HOUR }, throws: true });
  await chatLimiter.limit(ctx, channelName, { key: session.channel, config: channelLimitConfig(limits[session.channel]), throws: true });
}
