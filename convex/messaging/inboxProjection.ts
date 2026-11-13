import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { inboxNeedsStaff } from './inboxState';
import { getAdminChatSortAt } from './adminChatMetadata';

/** Preserve the administrative response shape; one latest message/event, never a transcript. */
export async function inboxProjection(ctx: QueryCtx, session: Doc<'conversations'>) {
  const [lastMessagePreview, lastDeliveryStatus] = await Promise.all([
    ctx.db.query('messages').withIndex('by_session', q => q.eq('sessionId', session._id)).order('desc').first(),
    ctx.db.query('channelEvents').withIndex('by_channel_and_sessionId', q => q.eq('channel', session.channel).eq('sessionId', session._id)).order('desc').first(),
  ]);
  return {
    inboxProjectionVersion: 1 as const,
    lastMessagePreview, lastDeliveryStatus,
    lastActivityAt: getAdminChatSortAt(session),
    inboxState: session.inboxState ?? (inboxNeedsStaff(session, lastMessagePreview) ? 'needs_staff' as const : 'processing' as const),
  };
}

/** The indexed head is authoritative even if an older turn completes after a newer ingress. */
export async function refreshDeliveryProjection(ctx: MutationCtx, sessionId?: Id<'conversations'>) {
  if (!sessionId) return;
  const session = await ctx.db.get(sessionId);
  if (!session) return;
  const lastDeliveryStatus = await ctx.db.query('channelEvents').withIndex('by_channel_and_sessionId', q => q.eq('channel', session.channel).eq('sessionId', sessionId)).order('desc').first();
  if (JSON.stringify(session.lastDeliveryStatus) !== JSON.stringify(lastDeliveryStatus)) await ctx.db.patch(sessionId, { lastDeliveryStatus });
}

export async function insertChannelEvent(ctx: MutationCtx, fields: Omit<Doc<'channelEvents'>, '_id' | '_creationTime'>) {
  const id = await ctx.db.insert('channelEvents', fields);
  await refreshDeliveryProjection(ctx, fields.sessionId);
  return id;
}

export async function patchChannelEvent(ctx: MutationCtx, id: Id<'channelEvents'>, patch: Partial<Omit<Doc<'channelEvents'>, '_id' | '_creationTime'>>) {
  await ctx.db.patch(id, patch);
  const event = await ctx.db.get(id);
  await refreshDeliveryProjection(ctx, event?.sessionId);
}

/** Missing version is a separate index bucket, so optional undefined never disappears silently. */
export async function inboxProjectionReady(ctx: QueryCtx) {
  return !(await ctx.db.query('conversations').withIndex('by_inboxProjectionVersion', q => q.eq('inboxProjectionVersion', undefined)).first());
}
