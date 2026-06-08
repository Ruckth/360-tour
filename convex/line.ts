import { mutation, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';

const eventTypeValidator = v.union(
	v.literal('message'),
	v.literal('follow'),
	v.literal('postback'),
	v.literal('unsupported')
);

const replyModeValidator = v.union(
	v.literal('exact'),
	v.literal('ai'),
	v.literal('postback'),
	v.literal('follow'),
	v.literal('ignored'),
	v.literal('failed')
);

function lineVisitorId(lineUserId: string) {
	return `line:${lineUserId}`;
}

async function getOrCreateLineSession(ctx: MutationCtx, lineUserId?: string) {
	const trimmedLineUserId = lineUserId?.trim();
	if (!trimmedLineUserId) return undefined;

	const visitorId = lineVisitorId(trimmedLineUserId);
	const existingSessions = await ctx.db
		.query('chatSessions')
		.withIndex('by_visitor', (q) => q.eq('visitorId', visitorId))
		.order('desc')
		.take(10);
	const existingSession = existingSessions.find((session) => session.channel === 'line');
	const now = Date.now();

	if (existingSession) {
		await ctx.db.patch(existingSession._id, {
			visitorContactApp: 'line',
			visitorContactHandle: trimmedLineUserId,
			lastSeenAt: now
		});
		return existingSession._id;
	}

	return await ctx.db.insert('chatSessions', {
		channel: 'line',
		visitorId,
		visitorContactApp: 'line',
		visitorContactHandle: trimmedLineUserId,
		lastSeenAt: now,
		lastOpenedAt: now,
		createdAt: now
	});
}

export const claimEvent = mutation({
	args: {
		eventKey: v.string(),
		lineUserId: v.optional(v.string()),
		sourceType: v.optional(v.string()),
		eventType: eventTypeValidator,
		messageText: v.optional(v.string()),
		postbackData: v.optional(v.string()),
		eventTimestamp: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const eventKey = args.eventKey.trim();
		if (!eventKey) throw new Error('LINE event key is required');

		const existing = await ctx.db
			.query('lineWebhookEvents')
			.withIndex('by_event_key', (q) => q.eq('eventKey', eventKey))
			.unique();
		const now = Date.now();

		if (existing && existing.status !== 'failed') {
			return {
				eventId: existing._id,
				sessionId: existing.sessionId,
				duplicate: true,
				status: existing.status
			};
		}

		const sessionId = existing?.sessionId ?? (await getOrCreateLineSession(ctx, args.lineUserId));
		const lineUserId = args.lineUserId?.trim() || undefined;
		const eventPatch = {
			...(sessionId ? { sessionId } : {}),
			...(lineUserId ? { lineUserId } : {}),
			...(args.sourceType ? { sourceType: args.sourceType } : {}),
			eventType: args.eventType,
			...(args.messageText ? { messageText: args.messageText } : {}),
			...(args.postbackData ? { postbackData: args.postbackData } : {}),
			status: 'processing' as const,
			...(typeof args.eventTimestamp === 'number' ? { eventTimestamp: args.eventTimestamp } : {}),
			processingStartedAt: now,
			updatedAt: now
		};

		if (existing) {
			await ctx.db.patch(existing._id, eventPatch);
			return {
				eventId: existing._id,
				sessionId,
				duplicate: false,
				status: 'processing'
			};
		}

		const eventId = await ctx.db.insert('lineWebhookEvents', {
			eventKey,
			...eventPatch,
			createdAt: now
		});

		return {
			eventId,
			sessionId,
			duplicate: false,
			status: 'processing'
		};
	}
});

export const completeEvent = mutation({
	args: {
		eventId: v.id('lineWebhookEvents'),
		sessionId: v.id('chatSessions'),
		userContent: v.optional(v.string()),
		assistantContent: v.string(),
		replyMode: replyModeValidator,
		lineReplyStatus: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('LINE event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return { completed: false, duplicate: true };
		}

		const now = Date.now();
		const userContent = args.userContent?.trim();
		const assistantContent = args.assistantContent.trim();
		let userMessageId: Id<'chatMessages'> | undefined;
		let assistantMessageId: Id<'chatMessages'> | undefined;

		if (userContent) {
			userMessageId = await ctx.db.insert('chatMessages', {
				sessionId: args.sessionId,
				role: 'user',
				content: userContent,
				timestamp: now
			});
		}

		if (assistantContent) {
			assistantMessageId = await ctx.db.insert('chatMessages', {
				sessionId: args.sessionId,
				role: 'assistant',
				content: assistantContent,
				timestamp: now
			});
		}

		await ctx.db.patch(args.eventId, {
			sessionId: args.sessionId,
			status: 'replied',
			replyMode: args.replyMode,
			lineReplyStatus: args.lineReplyStatus,
			processedAt: now,
			updatedAt: now
		});
		await ctx.db.patch(args.sessionId, { lastSeenAt: now });

		return {
			completed: true,
			duplicate: false,
			userMessageId,
			assistantMessageId
		};
	}
});

export const markEventIgnored = mutation({
	args: {
		eventId: v.id('lineWebhookEvents'),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('LINE event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return { ignored: false, duplicate: true };
		}

		const now = Date.now();
		await ctx.db.patch(args.eventId, {
			status: 'ignored',
			replyMode: 'ignored',
			error: args.reason,
			processedAt: now,
			updatedAt: now
		});
		return { ignored: true, duplicate: false };
	}
});

export const markEventFailed = mutation({
	args: {
		eventId: v.id('lineWebhookEvents'),
		error: v.string()
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('LINE event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return { failed: false, duplicate: true };
		}

		const now = Date.now();
		await ctx.db.patch(args.eventId, {
			status: 'failed',
			replyMode: 'failed',
			error: args.error.slice(0, 1000),
			processedAt: now,
			updatedAt: now
		});
		return { failed: true, duplicate: false };
	}
});
