import type { ActionCtx } from '../_generated/server';
import type { Id } from '../_generated/dataModel';
import { api, internal } from '../_generated/api';
/** All reads precede generation; history ends at this event, excluding later queued guests. */
export async function loadTurnContext(ctx: Pick<ActionCtx, 'runQuery'>, args: { sessionId: Id<'conversations'>; replyToMessageId?: Id<'messages'> }) {
  const [properties, settings, recentHistory] = await Promise.all([
    ctx.runQuery(api.catalog.properties.list, {}), ctx.runQuery(internal.settings.settings.effective, {}),
    ctx.runQuery(internal.messaging.chat.getRecentMessages, { sessionId: args.sessionId, limit: 10, throughMessageId: args.replyToMessageId }),
  ]);
  return { properties, settings, recentHistory };
}
