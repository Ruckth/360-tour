import type { Doc, Id } from '../_generated/dataModel';
import type { QueryCtx } from '../_generated/server';

/** WhatsApp, Messenger and Instagram only allow free-text replies within 24 h of the guest's last message. */
export const CHANNEL_REPLY_WINDOW_MS = 24 * 60 * 60 * 1000;

export function channelHasReplyWindow(channel: Doc<'chatSessions'>['channel']) {
	return channel === 'whatsapp' || channel === 'facebook' || channel === 'instagram';
}

async function getLastGuestMessageAt(ctx: QueryCtx, sessionId: Id<'chatSessions'>) {
	const recentMessages = await ctx.db
		.query('chatMessages')
		.withIndex('by_session', (q) => q.eq('sessionId', sessionId))
		.order('desc')
		.take(100);
	return recentMessages.find((message) => message.role === 'user')?.timestamp;
}

/** `closesAt` is undefined when the channel has no window or the guest never wrote. */
export async function getChannelReplyWindow(ctx: QueryCtx, session: Doc<'chatSessions'>) {
	if (!channelHasReplyWindow(session.channel)) return { applies: false as const };
	const lastGuestMessageAt = await getLastGuestMessageAt(ctx, session._id);
	return {
		applies: true as const,
		lastGuestMessageAt,
		closesAt:
			typeof lastGuestMessageAt === 'number'
				? lastGuestMessageAt + CHANNEL_REPLY_WINDOW_MS
				: undefined
	};
}
