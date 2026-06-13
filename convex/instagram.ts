import { mutation, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import type { Id } from './_generated/dataModel';
import {
	buildAdminChatMetadataPatch,
	buildAdminSearchText,
	patchSessionAfterMessages
} from './lib/adminChatMetadata';

const eventTypeValidator = v.union(
	v.literal('message'),
	v.literal('postback'),
	v.literal('unsupported')
);

const replyModeValidator = v.union(
	v.literal('exact'),
	v.literal('approved_exact'),
	v.literal('question_bank_exact'),
	v.literal('question_bank_semantic'),
	v.literal('ai'),
	v.literal('unknown_fallback'),
	v.literal('postback'),
	v.literal('ignored'),
	v.literal('failed')
);

function instagramVisitorId(instagramUserId: string) {
	return `instagram:${instagramUserId}`;
}

async function getOrCreateInstagramSession(ctx: MutationCtx, instagramUserId?: string) {
	const trimmedInstagramUserId = instagramUserId?.trim();
	if (!trimmedInstagramUserId) return undefined;

	const visitorId = instagramVisitorId(trimmedInstagramUserId);
	const existingSessions = await ctx.db
		.query('chatSessions')
		.withIndex('by_visitor', (q) => q.eq('visitorId', visitorId))
		.order('desc')
		.take(10);
	const existingSession = existingSessions.find((session) => session.channel === 'instagram');
	const now = Date.now();

	if (existingSession) {
		const patch = {
			visitorContactApp: 'instagram' as const,
			visitorContactHandle: trimmedInstagramUserId,
			lastSeenAt: now
		};
		await ctx.db.patch(existingSession._id, {
			...patch,
			...buildAdminChatMetadataPatch({ ...existingSession, ...patch })
		});
		return existingSession._id;
	}

	return await ctx.db.insert('chatSessions', {
		channel: 'instagram',
		visitorId,
		visitorContactApp: 'instagram',
		visitorContactHandle: trimmedInstagramUserId,
		lastSeenAt: now,
		lastOpenedAt: now,
		messageCount: 0,
		adminSortAt: now,
		adminSearchText: buildAdminSearchText({
			channel: 'instagram',
			visitorId,
			visitorContactApp: 'instagram',
			visitorContactHandle: trimmedInstagramUserId,
		}),
		createdAt: now
	});
}

export const claimEvent = mutation({
	args: {
		eventKey: v.string(),
		instagramUserId: v.optional(v.string()),
		instagramAccountId: v.optional(v.string()),
		eventType: eventTypeValidator,
		messageText: v.optional(v.string()),
		postbackData: v.optional(v.string()),
		eventTimestamp: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const eventKey = args.eventKey.trim();
		if (!eventKey) throw new Error('Instagram event key is required');

		const existing = await ctx.db
			.query('instagramWebhookEvents')
			.withIndex('by_event_key', (q) => q.eq('eventKey', eventKey))
			.unique();
		const now = Date.now();

		if (
			existing &&
			(existing.status === 'processing' ||
				existing.status === 'replied' ||
				existing.status === 'ignored' ||
				(existing.status === 'failed' &&
					typeof existing.instagramReplyStatus === 'number' &&
					existing.instagramReplyStatus >= 200 &&
					existing.instagramReplyStatus < 300))
		) {
			return {
				eventId: existing._id,
				sessionId: existing.sessionId,
				duplicate: true,
				status: existing.status
			};
		}

		const sessionId =
			existing?.sessionId ?? (await getOrCreateInstagramSession(ctx, args.instagramUserId));
		const instagramUserId = args.instagramUserId?.trim() || undefined;
		const instagramAccountId = args.instagramAccountId?.trim() || undefined;
		const eventPatch = {
			...(sessionId ? { sessionId } : {}),
			...(instagramUserId ? { instagramUserId } : {}),
			...(instagramAccountId ? { instagramAccountId } : {}),
			eventType: args.eventType,
			...(args.messageText ? { messageText: args.messageText } : {}),
			...(args.postbackData ? { postbackData: args.postbackData } : {}),
			status: 'received' as const,
			...(typeof args.eventTimestamp === 'number' ? { eventTimestamp: args.eventTimestamp } : {}),
			processingStartedAt: existing?.processingStartedAt ?? now,
			replyMode: undefined,
			instagramReplyStatus: undefined,
			error: undefined,
			processedAt: undefined,
			updatedAt: now
		};

		if (existing) {
			await ctx.db.patch(existing._id, eventPatch);
			return {
				eventId: existing._id,
				sessionId,
				duplicate: false,
				status: 'received'
			};
		}

		const eventId = await ctx.db.insert('instagramWebhookEvents', {
			eventKey,
			...eventPatch,
			createdAt: now
		});

		return {
			eventId,
			sessionId,
			duplicate: false,
			status: 'received'
		};
	}
});

export const recordInboundEvent = mutation({
	args: {
		eventId: v.id('instagramWebhookEvents'),
		sessionId: v.id('chatSessions'),
		userContent: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Instagram event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return {
				recorded: false,
				duplicate: true,
				userMessageId: event.userMessageId
			};
		}

		const now = Date.now();
		const userContent = args.userContent?.trim();
		let userMessageId = event.userMessageId;

		if (userContent && !userMessageId) {
			const timestamp = event.eventTimestamp ?? now;
			userMessageId = await ctx.db.insert('chatMessages', {
				sessionId: args.sessionId,
				role: 'user',
				content: userContent,
				timestamp
			});
			await patchSessionAfterMessages(ctx, args.sessionId, {
				addedMessages: 1,
				latestMessageAt: timestamp,
				lastSeenAt: now,
			});
		}

		await ctx.db.patch(args.eventId, {
			sessionId: args.sessionId,
			...(userMessageId ? { userMessageId } : {}),
			status: 'processing',
			processingStartedAt: event.processingStartedAt ?? now,
			updatedAt: now
		});
		if (!userMessageId) {
			const session = await ctx.db.get(args.sessionId);
			if (session) {
				await ctx.db.patch(args.sessionId, {
					lastSeenAt: now,
					...buildAdminChatMetadataPatch({ ...session, lastSeenAt: now })
				});
			}
		}

		return {
			recorded: Boolean(userMessageId),
			duplicate: false,
			userMessageId
		};
	}
});

export const completeEvent = mutation({
	args: {
		eventId: v.id('instagramWebhookEvents'),
		sessionId: v.id('chatSessions'),
		userContent: v.optional(v.string()),
		assistantContent: v.string(),
		replyMode: replyModeValidator,
		instagramReplyStatus: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Instagram event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return { completed: false, duplicate: true };
		}

		const now = Date.now();
		const userContent = args.userContent?.trim();
		const assistantContent = args.assistantContent.trim();
		let userMessageId = event.userMessageId;
		let assistantMessageId: Id<'chatMessages'> | undefined;
		let addedMessages = 0;
		let latestMessageAt = event.eventTimestamp ?? now;

		if (userContent && !userMessageId) {
			userMessageId = await ctx.db.insert('chatMessages', {
				sessionId: args.sessionId,
				role: 'user',
				content: userContent,
				timestamp: now
			});
			addedMessages++;
			latestMessageAt = Math.max(latestMessageAt, now);
		}

		if (assistantContent) {
			assistantMessageId = await ctx.db.insert('chatMessages', {
				sessionId: args.sessionId,
				role: 'assistant',
				content: assistantContent,
				timestamp: now
			});
			addedMessages++;
			latestMessageAt = Math.max(latestMessageAt, now);
		}

		await ctx.db.patch(args.eventId, {
			sessionId: args.sessionId,
			status: 'replied',
			replyMode: args.replyMode,
			instagramReplyStatus: args.instagramReplyStatus,
			...(userMessageId ? { userMessageId } : {}),
			...(assistantMessageId ? { assistantMessageId } : {}),
			error: undefined,
			processedAt: now,
			updatedAt: now
		});
		if (addedMessages > 0) {
			await patchSessionAfterMessages(ctx, args.sessionId, {
				addedMessages,
				latestMessageAt,
				lastSeenAt: now,
			});
		} else {
			const session = await ctx.db.get(args.sessionId);
			if (session) {
				await ctx.db.patch(args.sessionId, {
					lastSeenAt: now,
					...buildAdminChatMetadataPatch({ ...session, lastSeenAt: now })
				});
			}
		}

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
		eventId: v.id('instagramWebhookEvents'),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Instagram event not found');
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
		eventId: v.id('instagramWebhookEvents'),
		error: v.string(),
		instagramReplyStatus: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Instagram event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return { failed: false, duplicate: true };
		}

		const now = Date.now();
		await ctx.db.patch(args.eventId, {
			status: 'failed',
			replyMode: 'failed',
			error: args.error.slice(0, 1000),
			...(typeof args.instagramReplyStatus === 'number'
				? { instagramReplyStatus: args.instagramReplyStatus }
				: {}),
			processedAt: now,
			updatedAt: now
		});
		return { failed: true, duplicate: false };
	}
});
