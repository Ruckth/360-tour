import { internalMutation, internalQuery, mutation, query, type MutationCtx } from './_generated/server';
import { v } from 'convex/values';
import { internal } from './_generated/api';
import {
	DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT,
	isReusableChatMessageCount
} from './lib/chatReuse';
import { assertValidEmail, normalizeEmail } from './lib/validation';

const BROWSER_HANDOFF_TTL_MS = 5 * 60 * 1000;
const chatActionValidator = v.union(v.literal('booking'), v.literal('tour'), v.literal('none'));

function createBrowserHandoffToken() {
	const bytes = new Uint8Array(24);
	crypto.getRandomValues(bytes);
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function resolvePropertyId(
	ctx: MutationCtx,
	propertySlug?: string
) {
	if (!propertySlug) return undefined;
	const property = await ctx.db
		.query('properties')
		.withIndex('by_slug', (q) => q.eq('slug', propertySlug))
		.unique();
	return property?._id;
}

export const createSession = mutation({
	args: {
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		channel: v.union(v.literal('web'), v.literal('whatsapp'), v.literal('line')),
		visitorId: v.optional(v.string()),
		currentPath: v.optional(v.string()),
		referrer: v.optional(v.string()),
		userAgent: v.optional(v.string()),
		timeZone: v.optional(v.string()),
		browserLanguage: v.optional(v.string()),
		screenSize: v.optional(v.string()),
		viewportSize: v.optional(v.string()),
		platform: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		let propertyId = args.propertyId;
		if (!propertyId && args.propertySlug) {
			const property = await ctx.db
				.query('properties')
				.withIndex('by_slug', (q) => q.eq('slug', args.propertySlug!))
				.unique();
			propertyId = property?._id;
		}

		const now = Date.now();
		return await ctx.db.insert('chatSessions', {
			propertyId,
			propertySlug: args.propertySlug,
			channel: args.channel,
			visitorId: args.visitorId,
			currentPath: args.currentPath,
			referrer: args.referrer,
			userAgent: args.userAgent,
			timeZone: args.timeZone,
			browserLanguage: args.browserLanguage,
			screenSize: args.screenSize,
			viewportSize: args.viewportSize,
			platform: args.platform,
			lastSeenAt: now,
			lastOpenedAt: now,
			createdAt: now
		});
	}
});

export const touchSession = mutation({
	args: {
		sessionId: v.id('chatSessions'),
		propertySlug: v.optional(v.string()),
		currentPath: v.optional(v.string()),
		referrer: v.optional(v.string()),
		userAgent: v.optional(v.string()),
		timeZone: v.optional(v.string()),
		browserLanguage: v.optional(v.string()),
		screenSize: v.optional(v.string()),
		viewportSize: v.optional(v.string()),
		platform: v.optional(v.string()),
		isOpen: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const now = Date.now();
		const propertyId = args.propertySlug
			? await resolvePropertyId(ctx, args.propertySlug)
			: session.propertyId;

		await ctx.db.patch(args.sessionId, {
			propertyId,
			propertySlug: args.propertySlug ?? session.propertySlug,
			currentPath: args.currentPath ?? session.currentPath,
			referrer: args.referrer ?? session.referrer,
			userAgent: args.userAgent ?? session.userAgent,
			timeZone: args.timeZone ?? session.timeZone,
			browserLanguage: args.browserLanguage ?? session.browserLanguage,
			screenSize: args.screenSize ?? session.screenSize,
			viewportSize: args.viewportSize ?? session.viewportSize,
			platform: args.platform ?? session.platform,
			lastSeenAt: now,
			lastOpenedAt: args.isOpen ? now : session.lastOpenedAt
		});
	}
});

export const getReusableSession = query({
	args: {
		visitorId: v.string(),
		messageLimit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const visitorId = args.visitorId.trim();
		const messageLimit = Math.max(
			0,
			Math.floor(args.messageLimit ?? DEFAULT_REUSABLE_CHAT_MESSAGE_LIMIT)
		);
		if (!visitorId || messageLimit <= 0) return null;

		const sessions = await ctx.db
			.query('chatSessions')
			.withIndex('by_visitor', (q) => q.eq('visitorId', visitorId))
			.order('desc')
			.take(25);

		for (const session of sessions) {
			if (session.channel !== 'web') continue;
			if (
				session.lastClosedAt &&
				(!session.lastOpenedAt || session.lastClosedAt >= session.lastOpenedAt)
			) {
				continue;
			}

			const legacyMessageCount = session.messages?.length ?? 0;
			if (!isReusableChatMessageCount(legacyMessageCount, messageLimit)) continue;

			const messages = await ctx.db
				.query('chatMessages')
				.withIndex('by_session', (q) => q.eq('sessionId', session._id))
				.take(messageLimit - legacyMessageCount);

			if (isReusableChatMessageCount(legacyMessageCount + messages.length, messageLimit)) {
				return session;
			}
		}

		return null;
	}
});

export const closeSession = mutation({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const now = Date.now();
		await ctx.db.patch(args.sessionId, {
			lastClosedAt: now,
			lastSeenAt: now
		});
	}
});

export const createBrowserHandoff = mutation({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const now = Date.now();
		const token = createBrowserHandoffToken();
		await ctx.db.insert('chatBrowserHandoffs', {
			token,
			sessionId: args.sessionId,
			expiresAt: now + BROWSER_HANDOFF_TTL_MS,
			createdAt: now
		});

		return token;
	}
});

export const claimBrowserHandoff = mutation({
	args: { token: v.string() },
	handler: async (ctx, args) => {
		const token = args.token.trim();
		if (!token) return null;

		const handoff = await ctx.db
			.query('chatBrowserHandoffs')
			.withIndex('by_token', (q) => q.eq('token', token))
			.unique();
		if (!handoff || handoff.claimedAt || handoff.expiresAt <= Date.now()) {
			return null;
		}

		const session = await ctx.db.get(handoff.sessionId);
		if (!session) return null;

		const now = Date.now();
		await ctx.db.patch(handoff._id, { claimedAt: now });
		await ctx.db.patch(handoff.sessionId, {
			lastSeenAt: now,
			lastOpenedAt: now
		});

		return handoff.sessionId;
	}
});

export const identifyVisitor = mutation({
	args: {
		sessionId: v.id('chatSessions'),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		contactApp: v.optional(v.union(v.literal('whatsapp'), v.literal('line'))),
		contactHandle: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const name = args.name?.trim() || undefined;
		const phone = args.phone?.trim() || undefined;
		const contactHandle = args.contactHandle?.trim() || phone || undefined;
		const email = args.email?.trim() ? normalizeEmail(args.email) : undefined;
		if (email) assertValidEmail(email);

		await ctx.db.patch(args.sessionId, {
			visitorName: name,
			visitorEmail: email,
			visitorPhone: args.contactApp === 'whatsapp' ? contactHandle : phone,
			visitorContactApp: args.contactApp,
			visitorContactHandle: contactHandle,
			lastSeenAt: Date.now()
		});

		if (email) {
			const existingLead = await ctx.db
				.query('leads')
				.withIndex('by_email', (q) => q.eq('email', email))
				.first();

			if (!existingLead) {
				await ctx.db.insert('leads', {
					propertyId: session.propertyId,
					email,
					source: 'chat',
					createdAt: Date.now()
				});
			}
		}
	}
});

export const addMessage = mutation({
	args: {
		sessionId: v.id('chatSessions'),
		role: v.union(v.literal('user'), v.literal('assistant')),
		content: v.string(),
		action: v.optional(chatActionValidator)
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		return await ctx.db.insert('chatMessages', {
			sessionId: args.sessionId,
			role: args.role,
			content: args.content,
			...(args.action ? { action: args.action } : {}),
			timestamp: Date.now()
		});
	}
});

export const addAssistantMessageWithSuggestions = internalMutation({
	args: {
		sessionId: v.id('chatSessions'),
		content: v.string(),
		action: v.optional(chatActionValidator),
		locale: v.optional(v.string()),
		propertySlug: v.optional(v.string()),
		replyToMessageId: v.optional(v.id('chatMessages'))
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const messageId = await ctx.db.insert('chatMessages', {
			sessionId: args.sessionId,
			role: 'assistant',
			content: args.content,
			...(args.action ? { action: args.action } : {}),
			timestamp: Date.now()
		});

		await ctx.scheduler.runAfter(0, internal.chatSuggestions.generateForAssistant, {
			sessionId: args.sessionId,
			assistantMessageId: messageId,
			userMessageId: args.replyToMessageId,
			locale: args.locale,
			propertySlug: args.propertySlug ?? session.propertySlug
		});

		return messageId;
	}
});

export const getSession = query({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		return await ctx.db.get(args.sessionId);
	}
});

export const getMessages = query({
	args: {
		sessionId: v.id('chatSessions'),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		return await ctx.db
			.query('chatMessages')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('asc')
			.take(args.limit ?? 100);
	}
});

export const getRecentMessages = internalQuery({
	args: {
		sessionId: v.id('chatSessions'),
		limit: v.number()
	},
	handler: async (ctx, args) => {
		const recent = await ctx.db
			.query('chatMessages')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('desc')
			.take(args.limit);

		return recent.reverse();
	}
});
