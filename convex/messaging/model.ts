import type { MutationCtx } from '../_generated/server';
import type { Doc, Id } from '../_generated/dataModel';
import { internal } from '../_generated/api';
import { maintenancePaused } from '../auth/model';
import { patchSessionAfterMessages } from '../lib/adminChatMetadata';
import { guestReceived, sendFailed } from '../lib/inboxLifecycle';
import { asksForStaff, queueStaffAlert } from '../chatKnowledge';

export const LEASE_MS = 60_000;
export const MAX_ATTEMPTS = 4;
export { startDurablePreparation, currentClaim, withDurableTool, durableToolValidator, durableTurnValidator, type DurableTool } from './claims';
export async function recordGuest(ctx: MutationCtx, sessionId: Id<'conversations'>, content: string, timestamp = Date.now()) {
  const messageId = await ctx.db.insert('messages', { sessionId, role: 'user', content, timestamp });
  await patchSessionAfterMessages(ctx, sessionId, { addedMessages: 1, latestMessageAt: timestamp, lastSeenAt: Date.now() });
  await guestReceived(ctx, sessionId, messageId);
  if (asksForStaff(content)) await queueStaffAlert(ctx, sessionId, content, messageId);
  return messageId;
}
export async function nextEvent(ctx: MutationCtx, sessionId: Id<'conversations'>) {
  // Two bounded indexed heads, rather than scanning a growing conversation transcript.
  const [processing, received] = await Promise.all(['processing', 'received'].map(status => ctx.db.query('channelEvents')
    .withIndex('by_sessionId_and_status_and_createdAt', q => q.eq('sessionId', sessionId).eq('status', status as 'processing' | 'received')).first()));
  if (!processing) return received;
  if (!received) return processing;
  return processing._creationTime <= received._creationTime ? processing : received;
}
export async function scheduleNext(ctx: MutationCtx, sessionId?: Id<'conversations'>) {
  if (!sessionId || maintenancePaused()) return;
  const next = await nextEvent(ctx, sessionId);
  if (next) await ctx.scheduler.runAfter(Math.max(0, (next.nextAttemptAt ?? 0) - Date.now()), internal.messaging.worker.run, { eventId: next._id });
}
export async function reconcile(ctx: MutationCtx, event: Doc<'channelEvents'>, reason: string) {
  await ctx.db.patch(event._id, { status: 'reconciliation', dispatchState: event.deliveryStartedAt ? 'uncertain' : event.dispatchState,
    error: reason, processedAt: Date.now(), updatedAt: Date.now(), claimToken: undefined, leaseExpiresAt: undefined });
  if (event.sessionId) {
    await sendFailed(ctx, event.sessionId, event.userMessageId, reason);
    // Surface uncertainty even when a later queued question is the latest guest message.
    await ctx.db.patch(event.sessionId, { aiPaused: true, inboxState: 'needs_staff', inboxReason: 'send_failed', inboxSendError: reason });
  }
  await scheduleNext(ctx, event.sessionId);
}

// Staff alert implementation remains in the mixed messaging module until closure.
export { queueStaffAlert } from '../chatKnowledge';
