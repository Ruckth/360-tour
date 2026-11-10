import type { MutationCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { enforceRateLimit } from './rateLimit';

/** Charge both admission budgets within the caller's transaction. */
export async function consumeChatAdmission(ctx: MutationCtx, sessionId: Id<'chatSessions'>) {
  await enforceRateLimit(ctx, `chat:${sessionId}`, 20, 60 * 60 * 1000);
  await enforceRateLimit(ctx, 'chat:global', 500, 60 * 60 * 1000);
}
