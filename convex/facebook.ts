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

function facebookVisitorId(facebookUserId: string) {
	return `facebook:${facebookUserId}`;
}

async function getOrCreateFacebookSession(
	ctx: MutationCtx,
	facebookUserId?: string,
	profileName?: string
) {
	const trimmedFacebookUserId = facebookUserId?.trim();
	if (!trimmedFacebookUserId) return undefined;

	const visitorId = facebookVisitorId(trimmedFacebookUserId);
	const existingSessions = await ctx.db
		.query('chatSessions')
		.withIndex('by_visitor', (q) => q.eq('visitorId', visitorId))
		.order('desc')
		.take(10);
	const existingSession = existingSessions.find((session) => session.channel === 'facebook');
	const now = Date.now();
	const trimmedProfileName = profileName?.trim() || undefined;

	if (existingSession) {
		const patch = {
			visitorContactApp: 'facebook' as const,
			visitorContactHandle: trimmedFacebookUserId,
			...(trimmedProfileName ? { visitorName: trimmedProfileName } : {}),
			lastSeenAt: now
		};
		await ctx.db.patch(existingSession._id, {
			...patch,
			...buildAdminChatMetadataPatch({ ...existingSession, ...patch })
		});
		return existingSession._id;
	}

	return await ctx.db.insert('chatSessions', {
		channel: 'facebook',
		visitorId,
		...(trimmedProfileName ? { visitorName: trimmedProfileName } : {}),
		visitorContactApp: 'facebook',
		visitorContactHandle: trimmedFacebookUserId,
		lastSeenAt: now,
		lastOpenedAt: now,
		messageCount: 0,
		adminSortAt: now,
		adminSearchText: buildAdminSearchText({
			channel: 'facebook',
			visitorId,
			...(trimmedProfileName ? { visitorName: trimmedProfileName } : {}),
			visitorContactApp: 'facebook',
			visitorContactHandle: trimmedFacebookUserId,
		}),
		createdAt: now
	});
}

export const claimEvent = mutation({
	args: {
		eventKey: v.string(),
		facebookUserId: v.optional(v.string()),
		profileName: v.optional(v.string()),
		pageId: v.optional(v.string()),
		eventType: eventTypeValidator,
		messageText: v.optional(v.string()),
		postbackData: v.optional(v.string()),
		eventTimestamp: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const eventKey = args.eventKey.trim();
		if (!eventKey) throw new Error('Facebook event key is required');

		const existing = await ctx.db
			.query('facebookWebhookEvents')
			.withIndex('by_event_key', (q) => q.eq('eventKey', eventKey))
			.unique();
		const now = Date.now();

		if (
			existing &&
			(existing.status === 'processing' ||
				existing.status === 'replied' ||
				existing.status === 'ignored' ||
				(existing.status === 'failed' &&
					typeof existing.facebookReplyStatus === 'number' &&
					existing.facebookReplyStatus >= 200 &&
					existing.facebookReplyStatus < 300))
		) {
			return {
				eventId: existing._id,
				sessionId: existing.sessionId,
				duplicate: true,
				status: existing.status
			};
		}

		const sessionId =
			existing?.sessionId ?? (await getOrCreateFacebookSession(ctx, args.facebookUserId, args.profileName));
		const facebookUserId = args.facebookUserId?.trim() || undefined;
		const pageId = args.pageId?.trim() || undefined;
		const eventPatch = {
			...(sessionId ? { sessionId } : {}),
			...(facebookUserId ? { facebookUserId } : {}),
			...(pageId ? { pageId } : {}),
			eventType: args.eventType,
			...(args.messageText ? { messageText: args.messageText } : {}),
			...(args.postbackData ? { postbackData: args.postbackData } : {}),
			status: 'received' as const,
			...(typeof args.eventTimestamp === 'number' ? { eventTimestamp: args.eventTimestamp } : {}),
			processingStartedAt: existing?.processingStartedAt ?? now,
			replyMode: undefined,
			facebookReplyStatus: undefined,
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

		const eventId = await ctx.db.insert('facebookWebhookEvents', {
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
		eventId: v.id('facebookWebhookEvents'),
		sessionId: v.id('chatSessions'),
		userContent: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Facebook event not found');
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
		eventId: v.id('facebookWebhookEvents'),
		sessionId: v.id('chatSessions'),
		userContent: v.optional(v.string()),
		assistantContent: v.string(),
		replyMode: replyModeValidator,
		facebookReplyStatus: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Facebook event not found');
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
			facebookReplyStatus: args.facebookReplyStatus,
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
		eventId: v.id('facebookWebhookEvents'),
		reason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Facebook event not found');
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
		eventId: v.id('facebookWebhookEvents'),
		error: v.string(),
		facebookReplyStatus: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const event = await ctx.db.get(args.eventId);
		if (!event) throw new Error('Facebook event not found');
		if (event.status === 'replied' || event.status === 'ignored') {
			return { failed: false, duplicate: true };
		}

		const now = Date.now();
		await ctx.db.patch(args.eventId, {
			status: 'failed',
			replyMode: 'failed',
			error: args.error.slice(0, 1000),
			...(typeof args.facebookReplyStatus === 'number'
				? { facebookReplyStatus: args.facebookReplyStatus }
				: {}),
			processedAt: now,
			updatedAt: now
		});
		return { failed: true, duplicate: false };
	}
});
