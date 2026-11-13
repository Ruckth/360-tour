import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { guestMutation, guestQuery, internalMutation, internalQuery, type MutationCtx, publicMutation } from '../auth/model';
import { PRESENCE_WRITE_THROTTLE_MS } from '../shared/chatPresence';
import { cleanCapture, marketingCaptureValidator } from '../shared/marketingAttribution';
import { assertValidEmail, normalizeEmail } from '../shared/validation';
import { buildAdminChatMetadataPatch, buildAdminSearchText, getAdminChatSortAt, patchSessionAfterMessages } from './adminChatMetadata';
import { consumeChatAdmission } from './chatAdmission';
import { createGuestToken, hashGuestToken, requireGuestToken } from './guestToken';
import { answerAccepted, guestReceived, replyOutcomeValidator } from './inboxState';
import { recordLead } from './leadWriter';
import { recordGuest } from './pipeline';
import { enforceRateLimit } from './rateLimit';
import { asksForStaff, queueStaffAlert } from './staffRequests';

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

/** Guest-facing session metadata; internal staff state stays on the server. */
function publicSession(session: Doc<'conversations'>) {
	return {
		_id: session._id,
		_creationTime: session._creationTime,
		propertySlug: session.propertySlug,
		channel: session.channel,
		messageCount: session.messageCount,
		latestMessageAt: session.latestMessageAt,
		createdAt: session.createdAt,
		aiPaused: Boolean(session.aiPaused)
	};
}

export const createSession = publicMutation({
  reason: "Anonymous web chat bootstrap; creation is rate limited and returns a new guest credential.",
	args: {
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		// Messaging sessions are created by the webhooks; a public caller must not
		// be able to mint one (their phone is trusted for bookings).
		channel: v.literal('web'),
		visitorId: v.optional(v.string()),
		currentPath: v.optional(v.string()),
		referrer: v.optional(v.string()),
		/** Release 3a: stored on the session and resolved when the chat books. Untrusted. */
		marketing: v.optional(marketingCaptureValidator),
		userAgent: v.optional(v.string()),
		timeZone: v.optional(v.string()),
		browserLanguage: v.optional(v.string()),
		screenSize: v.optional(v.string()),
		viewportSize: v.optional(v.string()),
		platform: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await enforceRateLimit(ctx, 'chat-session:global', 2000, 60 * 60 * 1000);
		let propertyId = args.propertyId;
		if (!propertyId && args.propertySlug) {
			const property = await ctx.db
				.query('properties')
				.withIndex('by_slug', (q) => q.eq('slug', args.propertySlug!))
				.unique();
			propertyId = property?._id;
		}

		const marketingCapture = cleanCapture(args.marketing);
		const now = Date.now();
		const guestToken = createGuestToken();
		const sessionId = await ctx.db.insert('conversations', {
			guestTokenHash: await hashGuestToken(guestToken),
			...(marketingCapture ? { marketingCapture } : {}),
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
			messageCount: 0,
			adminSortAt: now,
			adminSearchText: buildAdminSearchText({
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
			}),
			createdAt: now
		});
		return { sessionId, guestToken };
	}
});

export const touchSession = guestMutation({
	args: {
		sessionId: v.id('conversations'),
		guestToken: v.optional(v.string()),
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
		const session = ctx.guestSession;

		// Runs every 30s per open chat, so only fields that changed are written and the villa
		// lookup happens only when the page's villa changes. lastSeenAt is always written: it is
		// what marks the guest as online.
		const now = Date.now();
		const slugChanged = args.propertySlug !== undefined && args.propertySlug !== session.propertySlug;
		const propertyId =
			args.propertySlug && (slugChanged || !session.propertyId)
				? await resolvePropertyId(ctx, args.propertySlug)
				: session.propertyId;

		const context = {
			propertySlug: args.propertySlug ?? session.propertySlug,
			currentPath: args.currentPath ?? session.currentPath,
			referrer: args.referrer ?? session.referrer,
			userAgent: args.userAgent ?? session.userAgent,
			timeZone: args.timeZone ?? session.timeZone,
			browserLanguage: args.browserLanguage ?? session.browserLanguage,
			screenSize: args.screenSize ?? session.screenSize,
			viewportSize: args.viewportSize ?? session.viewportSize,
			platform: args.platform ?? session.platform
		};
		const changed = Object.fromEntries(
			Object.entries(context).filter(([key, value]) => session[key as keyof typeof context] !== value)
		) as Partial<typeof context>;
		const nextSession = { ...session, ...context, propertyId, lastSeenAt: now };
		const adminSortAt = getAdminChatSortAt(nextSession);
		const adminSearchText =
			Object.keys(changed).length > 0 || session.adminSearchText === undefined
				? buildAdminSearchText(nextSession)
				: session.adminSearchText;

		// Nothing but the presence timestamp would move, the chat already sorts by its latest
		// message (not lastSeenAt), it is already open, and we refreshed presence very recently.
		// Skipping the write here never changes an observable value: isChatSessionActive() tolerates
		// a gap up to ACTIVE_CHAT_WINDOW_MS (90s) and with a 30s heartbeat the worst-case gap between
		// writes is PRESENCE_WRITE_THROTTLE_MS (45s) + 30s = 75s, so the guest stays "online" while the
		// high-churn write that every inbox/session reader reruns on is avoided. OCC contention on
		// this mutation was already negligible (one retry in 72h), so this is a cost reduction, not
		// a fix: message-less chats (which sort by lastSeenAt) and newly-opened chats still write.
		const presenceOnlyBeat =
			Object.keys(changed).length === 0 &&
			propertyId === session.propertyId &&
			adminSearchText === session.adminSearchText &&
			adminSortAt === session.adminSortAt &&
			typeof session.latestMessageAt === 'number' &&
			typeof session.lastSeenAt === 'number' &&
			now - session.lastSeenAt < PRESENCE_WRITE_THROTTLE_MS &&
			(!args.isOpen || (session.lastOpenedAt ?? 0) > (session.lastClosedAt ?? 0));
		if (presenceOnlyBeat) return;

		await ctx.db.patch(args.sessionId, {
			...changed,
			...(propertyId !== session.propertyId ? { propertyId } : {}),
			lastSeenAt: now,
			...(args.isOpen ? { lastOpenedAt: now } : {}),
			...(adminSortAt !== session.adminSortAt ? { adminSortAt } : {}),
			...(adminSearchText !== session.adminSearchText ? { adminSearchText } : {})
		});
	}
});

export const closeSession = guestMutation({
	args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const now = Date.now();
		await ctx.db.patch(args.sessionId, {
			lastClosedAt: now,
			lastSeenAt: now
		});
	}
});

export const createBrowserHandoff = guestMutation({
	args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()) },
	handler: async (ctx, args) => {
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

export const claimBrowserHandoff = publicMutation({
  reason: "One-use expiring handoff capability rotates the guest credential.",
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
		if (!session || session.channel !== 'web') return null;

		const guestToken = createGuestToken();
		const now = Date.now();
		await ctx.db.patch(handoff._id, { claimedAt: now });
		await ctx.db.patch(handoff.sessionId, {
			guestTokenHash: await hashGuestToken(guestToken),
			lastSeenAt: now,
			lastOpenedAt: now
		});

		return { sessionId: handoff.sessionId, guestToken };
	}
});

export const identifyVisitor = guestMutation({
	args: {
		sessionId: v.id('conversations'),
		guestToken: v.optional(v.string()),
		name: v.optional(v.string()),
		email: v.optional(v.string()),
		phone: v.optional(v.string()),
		contactApp: v.optional(
			v.union(
				v.literal('whatsapp'),
				v.literal('line'),
				v.literal('facebook'),
				v.literal('instagram')
			)
		),
		contactHandle: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const session = ctx.guestSession;

		const name = args.name?.trim() || undefined;
		const phone = args.phone?.trim() || undefined;
		const contactHandle = args.contactHandle?.trim() || phone || undefined;
		const email = args.email?.trim() ? normalizeEmail(args.email) : undefined;
		if (email) assertValidEmail(email);

		const nextSession = {
			...session,
			visitorName: name,
			visitorEmail: email,
			visitorPhone: args.contactApp === 'whatsapp' ? contactHandle : phone,
			visitorContactApp: args.contactApp,
			visitorContactHandle: contactHandle,
			lastSeenAt: Date.now()
		};

		await ctx.db.patch(args.sessionId, {
			visitorName: nextSession.visitorName,
			visitorEmail: nextSession.visitorEmail,
			visitorPhone: nextSession.visitorPhone,
			visitorContactApp: nextSession.visitorContactApp,
			visitorContactHandle: nextSession.visitorContactHandle,
			lastSeenAt: nextSession.lastSeenAt,
			...buildAdminChatMetadataPatch(nextSession)
		});

		if (email) {
			await recordLead(ctx, { email, source: 'chat', propertyId: session.propertyId });
		}
	}
});

export const acceptGuestMessage = internalMutation({
	args: {
		sessionId: v.id('conversations'),
		guestToken: v.optional(v.string()),
		content: v.string(),
		/** Release 3a: the guest's tab and consent as of this message; `{}` clears it. Web chat only. */
		marketing: v.optional(marketingCaptureValidator)
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');
		if (args.guestToken !== undefined) await requireGuestToken(session, args.guestToken);
		if (!['web', 'line', 'facebook', 'whatsapp', 'instagram'].includes(session.channel)) throw new Error('Unsupported chat channel');
		if (args.content.length > 2000) throw new Error('Message is too long');
		await consumeChatAdmission(ctx, args.sessionId);
		// A chat can outlive the tab and the consent it started with, so each guest message refreshes them.
		if (args.marketing !== undefined && session.channel === 'web') {
			const marketingCapture = cleanCapture(args.marketing);
			if (JSON.stringify(marketingCapture) !== JSON.stringify(session.marketingCapture)) await ctx.db.patch(args.sessionId, { marketingCapture });
		}

		const timestamp = Date.now();
		const messageId = await ctx.db.insert('messages', {
			sessionId: args.sessionId,
			role: 'user',
			content: args.content,
			timestamp
		});
		await patchSessionAfterMessages(ctx, args.sessionId, {
			addedMessages: 1,
			latestMessageAt: timestamp,
			lastSeenAt: timestamp,
		});
		await guestReceived(ctx, args.sessionId, messageId);
		if (asksForStaff(args.content)) await queueStaffAlert(ctx, args.sessionId, args.content, messageId);

		return messageId;
	}
});

export const addAssistantMessageWithSuggestions = internalMutation({
	args: {
		sessionId: v.id('conversations'),
		content: v.string(),
		action: v.optional(chatActionValidator),
		locale: v.optional(v.string()),
		propertySlug: v.optional(v.string()),
		replyToMessageId: v.optional(v.id('messages')),
		skipSuggestions: v.optional(v.boolean()),
		outcome: v.optional(replyOutcomeValidator)
	},
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');
		if (session.aiPaused) return { stored: false as const, messageId: null };

		const timestamp = Date.now();
		const messageId = await ctx.db.insert('messages', {
			sessionId: args.sessionId,
			role: 'assistant',
			content: args.content,
			replyToMessageId: args.replyToMessageId,
			...(args.action ? { action: args.action } : {}),
			timestamp
		});
		await patchSessionAfterMessages(ctx, args.sessionId, {
			addedMessages: 1,
			latestMessageAt: timestamp,
			lastSeenAt: timestamp,
		});

		await answerAccepted(ctx, { sessionId: args.sessionId, replyToMessageId: args.replyToMessageId,
			messageId, source: 'ai', outcome: args.outcome ?? (args.skipSuggestions ? 'needs_staff' : 'answered') });
		return { stored: true as const, messageId };
	}
});

/** Public view of a chat session: no admin-only or visitor-contact fields. */
export const getSession = guestQuery({
	args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()) },
	handler: async (ctx) => {
		const session = ctx.guestSession;
		return publicSession(session);
	}
});

export const getSessionInternal = internalQuery({
	args: { sessionId: v.id('conversations') },
	handler: async (ctx, args) => await ctx.db.get(args.sessionId)
});

/** Guest view of whether staff took over this chat. */
export const isAiPaused = guestQuery({
	args: { sessionId: v.id('conversations'), guestToken: v.optional(v.string()) },
	handler: async (ctx) => {
		const session = ctx.guestSession;
		return Boolean(session?.aiPaused);
	}
});

export const getMessages = guestQuery({
	args: {
		sessionId: v.id('conversations'),
		guestToken: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const recent = await ctx.db
			.query('messages')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('desc')
			.take(args.limit ?? 100);
		return recent.reverse();
	}
});

export const getRecentMessages = internalQuery({
 args: { sessionId: v.id('conversations'), limit: v.number(), throughMessageId: v.optional(v.id('messages')) },
 handler: async (ctx, args) => {
  const limit = Math.min(100, Math.max(1, args.limit));
  const through = args.throughMessageId ? await ctx.db.get(args.throughMessageId) : null;
  if (!through) return (await ctx.db.query('messages').withIndex('by_session', q => q.eq('sessionId', args.sessionId)).order('desc').take(limit)).reverse();
  const [users, answers] = await Promise.all([
    ctx.db.query('messages').withIndex('by_sessionId_and_role', q => q.eq('sessionId', args.sessionId).eq('role', 'user').lte('_creationTime', through._creationTime)).order('desc').take(limit),
    ctx.db.query('messages').withIndex('by_sessionId_and_role', q => q.eq('sessionId', args.sessionId).eq('role', 'assistant')).order('desc').take(limit),
  ]);
  const unlinked = answers.filter(row => !row.replyToMessageId && row._creationTime <= through._creationTime);
  // Unlinked greetings/staff replies keep their chronological position. Linked AI
  // answers stay with their guest turn even when a newer question arrived first.
  const anchors = [...users, ...unlinked].sort((a, b) => a._creationTime - b._creationTime);
  const ordered = anchors.flatMap(row => row.role === 'user'
    ? [row, ...answers.filter(answer => answer.replyToMessageId === row._id).reverse()]
    : [row]);
  return ordered.slice(-limit);
 }
});

/** Acknowledgement means both the user message and the durable work exist. */
export const sendMessage = guestMutation({
  args: {
    clientMessageId: v.string(), content: v.string(), locale: v.optional(v.string()), propertySlug: v.optional(v.string()),
    actionHint: v.optional(chatActionValidator), marketing: v.optional(marketingCaptureValidator),
  },
  returns: v.object({ eventId: v.id('channelEvents'), userMessageId: v.id('messages'), duplicate: v.boolean() }),
  handler: async (ctx, args) => {
    if (!/^[a-zA-Z0-9_-]{16,100}$/.test(args.clientMessageId)) throw new Error('Invalid client message identifier');
    const content = args.content.trim();
    if (!content || content.length > 2000) throw new Error('Message must be between 1 and 2000 characters');
    const eventKey = `${args.sessionId}:${args.clientMessageId}`;
    const prior = await ctx.db.query('channelEvents').withIndex('by_channel_and_eventKey', q => q.eq('channel', 'web').eq('eventKey', eventKey)).unique();
    if (prior?.userMessageId) {
      if (prior.messageText !== content) throw new Error('This message identifier was used for different content');
      return { eventId: prior._id, userMessageId: prior.userMessageId, duplicate: true };
    }
    await consumeChatAdmission(ctx, args.sessionId);
    if (args.marketing !== undefined) await ctx.db.patch(args.sessionId, { marketingCapture: cleanCapture(args.marketing) });
    const now = Date.now();
    const userMessageId = await recordGuest(ctx, args.sessionId, content);
    const eventId = await ctx.db.insert('channelEvents', {
      channel: 'web', eventKey, sessionId: args.sessionId, eventType: 'message', messageText: content, userMessageId,
      locale: args.locale, propertySlug: args.propertySlug, actionHint: args.actionHint,
      status: ctx.guestSession.aiPaused ? 'ignored' : 'received', attempts: 0, admittedAt: now, arrivedAt: now,
      processingStartedAt: now, nextAttemptAt: now, createdAt: now, updatedAt: now,
    });
    if (!ctx.guestSession.aiPaused) await ctx.scheduler.runAfter(0, internal.messaging.worker.run, { eventId });
    return { eventId, userMessageId, duplicate: false };
  },
});
