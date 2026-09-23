import { mutation } from './_generated/server';
import { v } from 'convex/values';
import { patchSessionAfterMessages } from './lib/adminChatMetadata';
import { requireAdmin } from './lib/adminAuth';

const MAX_REPLY_LENGTH = 1000;
const CHANNEL_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

function recipientForSession(session: {
  channel: 'web' | 'line' | 'facebook' | 'whatsapp' | 'instagram';
  visitorContactHandle?: string;
  visitorId?: string;
}) {
  if (session.channel === 'web') return undefined;
  const prefix = `${session.channel}:`;
  const fromVisitorId = session.visitorId?.startsWith(prefix)
    ? session.visitorId.slice(prefix.length)
    : undefined;
  return session.visitorContactHandle?.trim() || fromVisitorId?.trim();
}

export const claim = mutation({
  args: {
    sessionId: v.id('chatSessions'),
    requestId: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const { email } = await requireAdmin(ctx);
    const requestId = args.requestId.trim();
    const content = args.content.trim();
    if (!requestId || requestId.length > 100) throw new Error('Invalid reply request');
    if (!content || content.length > MAX_REPLY_LENGTH) {
      throw new Error(`Reply must be between 1 and ${MAX_REPLY_LENGTH} characters`);
    }

    const existing = await ctx.db
      .query('adminReplyAttempts')
      .withIndex('by_requestId', (q) => q.eq('requestId', requestId))
      .unique();
    if (existing) {
      if (existing.sessionId !== args.sessionId || existing.content !== content) {
        throw new Error('Reply request ID was already used');
      }
      return { state: existing.status, channel: null, recipient: null };
    }

    const session = await ctx.db.get(args.sessionId);
    if (!session) throw new Error('Chat session not found');
    const recipient = recipientForSession(session);
    if (session.channel !== 'web' && !recipient) {
      throw new Error('This chat has no channel recipient to reply to');
    }

    if (session.channel !== 'web' && session.channel !== 'line') {
      const recentMessages = await ctx.db
        .query('chatMessages')
        .withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
        .order('desc')
        .take(100);
      const lastVisitorMessage = recentMessages.find((message) => message.role === 'user');
      if (
        !lastVisitorMessage ||
        Date.now() - lastVisitorMessage.timestamp > CHANNEL_REPLY_WINDOW_MS
      ) {
        throw new Error(
          `${session.channel} allows a free-text reply only within 24 hours of the visitor's last message`
        );
      }
    }

    await ctx.db.insert('adminReplyAttempts', {
      requestId,
      sessionId: args.sessionId,
      adminEmail: email,
      content,
      status: 'pending',
      createdAt: Date.now(),
    });
    return { state: 'new' as const, channel: session.channel, recipient: recipient ?? null };
  },
});

export const complete = mutation({
  args: { requestId: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const attempt = await ctx.db
      .query('adminReplyAttempts')
      .withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
      .unique();
    if (!attempt) throw new Error('Reply request not found');
    if (attempt.status === 'sent') return null;
    if (attempt.status !== 'pending') throw new Error('Reply request is not pending');

    const timestamp = Date.now();
    const messageId = await ctx.db.insert('chatMessages', {
      sessionId: attempt.sessionId,
      role: 'assistant',
      source: 'admin',
      content: attempt.content,
      timestamp,
    });
    await patchSessionAfterMessages(ctx, attempt.sessionId, {
      addedMessages: 1,
      latestMessageAt: timestamp,
    });
    await ctx.db.patch(attempt._id, { status: 'sent', completedAt: timestamp });
    return messageId;
  },
});

export const fail = mutation({
  args: { requestId: v.string(), error: v.string() },
  handler: async (ctx, args) => {
    await requireAdmin(ctx);
    const attempt = await ctx.db
      .query('adminReplyAttempts')
      .withIndex('by_requestId', (q) => q.eq('requestId', args.requestId))
      .unique();
    if (!attempt || attempt.status !== 'pending') return null;
    await ctx.db.patch(attempt._id, {
      status: 'failed',
      completedAt: Date.now(),
      error: args.error.slice(0, 300),
    });
    return null;
  },
});
