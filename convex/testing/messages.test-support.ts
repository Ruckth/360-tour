import type { TestConvexForDataModel } from 'convex-test';
import type { DataModel, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { recordGuest, LEASE_MS } from '../messaging/pipeline';
import { insertChannelEvent } from '../messaging/inboxProjection';
import type { ReplyOutcome } from '../messaging/inboxState';

/** Fixture guest turns exercise the production message/projection/inbox writer. */
export async function recordTestGuest(t: TestConvexForDataModel<DataModel>, args: { sessionId: Id<'conversations'>; content: string }) {
  return t.run(ctx => recordGuest(ctx, args.sessionId, args.content));
}

/** Prepare a claimed turn fixture, then use the real atomic worker commit. */
export async function commitTestAssistant(t: TestConvexForDataModel<DataModel>, args: {
  sessionId: Id<'conversations'>; content: string; replyToMessageId?: Id<'messages'>;
  action?: 'booking' | 'tour' | 'none'; outcome?: ReplyOutcome;
}) {
  const claimToken = crypto.randomUUID();
  const eventId = await t.run(async ctx => {
    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error('Session not found');
    const now = Date.now();
    return insertChannelEvent(ctx, {
      channel: session.channel, eventKey: crypto.randomUUID(), eventType: 'message', sessionId: args.sessionId,
      userMessageId: args.replyToMessageId, actionHint: args.action, status: 'processing', claimToken,
      processingStartedAt: now, leaseExpiresAt: now + LEASE_MS, attempts: 1, createdAt: now, updatedAt: now,
      responseText: args.content, responseModel: 'test', responseOutcome: args.outcome,
    });
  });
  const stored = await t.mutation(internal.messaging.worker.commitTurn, { eventId, claimToken });
  const event = await t.run(ctx => ctx.db.get(eventId));
  return { stored, messageId: event?.assistantMessageId ?? null };
}
