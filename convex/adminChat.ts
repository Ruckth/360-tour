import { query, type QueryCtx } from './_generated/server';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import {
	getAdminChatMessageCount,
	getAdminChatSortAt,
	normalizeAdminSearchText
} from './lib/adminChatMetadata';
import { isChatSessionActive } from './lib/chatPresence';

const PAGE_SIZE = 10;
const SEARCH_SESSION_LIMIT = 50;
const SEARCH_MESSAGE_LIMIT = 100;
const FUZZY_SCAN_LIMIT = 200;
const FILTER_SOURCE_PAGE_SIZE = 100;

type FilterCursor = {
	sourceCursor: string | null;
	sourceDone: boolean;
	overflowIds: Id<'chatSessions'>[];
};

const sessionStatusValidator = v.union(
	v.literal('all'),
	v.literal('active'),
	v.literal('inactive')
);

const emptyFilterValidator = v.union(
	v.literal('all'),
	v.literal('empty'),
	v.literal('non_empty')
);

const channelFilterValidator = v.union(
	v.literal('all'),
	v.literal('web'),
	v.literal('line'),
	v.literal('facebook'),
	v.literal('whatsapp'),
	v.literal('instagram')
);

type SessionStatus = 'all' | 'active' | 'inactive';
type EmptyFilter = 'all' | 'empty' | 'non_empty';
type ChannelFilter = 'all' | 'web' | 'line' | 'facebook' | 'whatsapp' | 'instagram';

function parseSearchCursor(cursor: string | null) {
	if (!cursor) return 0;
	try {
		const parsed = JSON.parse(cursor) as { offset?: unknown };
		return typeof parsed.offset === 'number' && parsed.offset > 0
			? Math.floor(parsed.offset)
			: 0;
	} catch {
		return 0;
	}
}

function searchCursor(offset: number) {
	return JSON.stringify({ offset });
}

function parseFilterCursor(cursor: string | null): FilterCursor {
	if (!cursor) return { sourceCursor: null, sourceDone: false, overflowIds: [] };
	try {
		const parsed = JSON.parse(cursor) as {
			type?: unknown;
			sourceCursor?: unknown;
			sourceDone?: unknown;
			overflowIds?: unknown;
		};
		if (parsed.type !== 'filtered') {
			return { sourceCursor: cursor, sourceDone: false, overflowIds: [] };
		}
		return {
			sourceCursor: typeof parsed.sourceCursor === 'string' ? parsed.sourceCursor : null,
			sourceDone: typeof parsed.sourceDone === 'boolean' ? parsed.sourceDone : false,
			overflowIds: Array.isArray(parsed.overflowIds)
				? parsed.overflowIds.filter((id): id is Id<'chatSessions'> => typeof id === 'string')
				: []
		};
	} catch {
		return { sourceCursor: cursor, sourceDone: false, overflowIds: [] };
	}
}

function filterCursor(cursor: FilterCursor) {
	return JSON.stringify({
		type: 'filtered',
		sourceCursor: cursor.sourceCursor,
		sourceDone: cursor.sourceDone,
		overflowIds: cursor.overflowIds
	});
}

function boundedEditDistance(a: string, b: string, maxDistance: number) {
	if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

	const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	const current = Array.from({ length: b.length + 1 }, () => 0);

	for (let i = 1; i <= a.length; i++) {
		current[0] = i;
		let rowMin = current[0];

		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				previous[j] + 1,
				current[j - 1] + 1,
				previous[j - 1] + cost
			);
			rowMin = Math.min(rowMin, current[j]);
		}

		if (rowMin > maxDistance) return maxDistance + 1;
		for (let j = 0; j <= b.length; j++) previous[j] = current[j];
	}

	return previous[b.length];
}

function typoTolerantContactScore(query: string, searchText?: string) {
	const haystack = normalizeAdminSearchText(searchText);
	if (!query || !haystack) return 0;
	if (haystack.includes(query)) return 70;

	const queryTokens = query.split(' ').filter(Boolean);
	const haystackTokens = haystack.split(' ').filter(Boolean);
	if (queryTokens.length === 0 || haystackTokens.length === 0) return 0;

	let matched = 0;
	for (const queryToken of queryTokens) {
		const maxDistance = queryToken.length >= 4 ? 2 : 1;
		if (
			haystackTokens.some((candidate) => {
				if (candidate.includes(queryToken) || queryToken.includes(candidate)) return true;
				if (Math.min(candidate.length, queryToken.length) < 4) return false;
				return boundedEditDistance(queryToken, candidate, maxDistance) <= maxDistance;
			})
		) {
			matched++;
		}
	}

	return matched === queryTokens.length ? 55 + matched : 0;
}

function getSessionLatestMessageSortAt(session: Doc<'chatSessions'>) {
	return session.latestMessageAt ?? Number.NEGATIVE_INFINITY;
}

async function sessionHasStoredMessages(ctx: QueryCtx, session: Doc<'chatSessions'>) {
	if (session.messages && session.messages.length > 0) return true;

	const message = await ctx.db
		.query('chatMessages')
		.withIndex('by_session', (q) => q.eq('sessionId', session._id))
		.first();

	return Boolean(message);
}

async function getSessionLatestMessageAt(ctx: QueryCtx, session: Doc<'chatSessions'>) {
	const latestStoredMessage = await ctx.db
		.query('chatMessages')
		.withIndex('by_session', (q) => q.eq('sessionId', session._id))
		.order('desc')
		.first();
	const latestLegacyMessageAt = session.messages?.reduce<number | undefined>(
		(latest, message) =>
			typeof latest === 'number' ? Math.max(latest, message.timestamp) : message.timestamp,
		undefined
	);

	return latestStoredMessage?.timestamp ?? latestLegacyMessageAt ?? session.latestMessageAt;
}

async function sessionMatchesFilters(
	ctx: QueryCtx,
	session: Doc<'chatSessions'>,
	options: {
		status: SessionStatus;
		empty: EmptyFilter;
		channel: ChannelFilter;
		messageStartAt?: number;
		messageEndAt?: number;
		now: number;
	}
) {
	const active = isChatSessionActive(session, options.now);
	if (options.status === 'active' && !active) return false;
	if (options.status === 'inactive' && active) return false;
	if (options.channel !== 'all' && session.channel !== options.channel) return false;

	const messageCount = getAdminChatMessageCount(session);
	if (options.empty === 'empty') {
		if (messageCount !== 0) return false;
		if (await sessionHasStoredMessages(ctx, session)) return false;
	}
	if (options.empty === 'non_empty') {
		if (messageCount === 0 && !(await sessionHasStoredMessages(ctx, session))) {
			return false;
		}
	}

	if (
		typeof options.messageStartAt === 'number' ||
		typeof options.messageEndAt === 'number'
	) {
		const latestMessageAt = await getSessionLatestMessageAt(ctx, session);
		if (typeof latestMessageAt !== 'number') return false;
		if (
			typeof options.messageStartAt === 'number' &&
			latestMessageAt < options.messageStartAt
		) {
			return false;
		}
		if (
			typeof options.messageEndAt === 'number' &&
			latestMessageAt > options.messageEndAt
		) {
			return false;
		}
	}

	return true;
}

async function decorateSession(ctx: QueryCtx, session: Doc<'chatSessions'>, now: number) {
	const [
		latestMessage,
		latestLineEvent,
		latestFacebookEvent,
		latestWhatsAppEvent,
		latestInstagramEvent,
		property
	] = await Promise.all([
		ctx.db
			.query('chatMessages')
			.withIndex('by_session', (q) => q.eq('sessionId', session._id))
			.order('desc')
			.first(),
		session.channel === 'line'
			? ctx.db
					.query('lineWebhookEvents')
					.withIndex('by_session', (q) => q.eq('sessionId', session._id))
					.order('desc')
					.first()
			: null,
		session.channel === 'facebook'
			? ctx.db
					.query('facebookWebhookEvents')
					.withIndex('by_session', (q) => q.eq('sessionId', session._id))
					.order('desc')
					.first()
			: null,
		session.channel === 'whatsapp'
			? ctx.db
					.query('whatsappWebhookEvents')
					.withIndex('by_session', (q) => q.eq('sessionId', session._id))
					.order('desc')
					.first()
			: null,
		session.channel === 'instagram'
			? ctx.db
					.query('instagramWebhookEvents')
					.withIndex('by_session', (q) => q.eq('sessionId', session._id))
					.order('desc')
					.first()
			: null,
		session.propertyId ? ctx.db.get(session.propertyId) : null
	]);

	return {
		...session,
		messageCount: Math.max(getAdminChatMessageCount(session), latestMessage ? 1 : 0),
		latestMessageAt: latestMessage?.timestamp ?? session.latestMessageAt,
		adminSortAt: getAdminChatSortAt(session),
		propertyName: property?.name,
		latestMessage,
		latestLineEvent,
		latestFacebookEvent,
		latestWhatsAppEvent,
		latestInstagramEvent,
		isActive: isChatSessionActive(session, now)
	};
}

async function decorateSessions(
	ctx: QueryCtx,
	sessions: Doc<'chatSessions'>[],
	now: number
) {
	return await Promise.all(sessions.map((session) => decorateSession(ctx, session, now)));
}

async function searchSessions(
	ctx: QueryCtx,
	options: {
		query: string;
		cursor: string | null;
		status: SessionStatus;
		empty: EmptyFilter;
		channel: ChannelFilter;
		messageStartAt?: number;
		messageEndAt?: number;
		propertySlug?: string;
		now: number;
	}
) {
	const normalizedQuery = normalizeAdminSearchText(options.query);
	if (!normalizedQuery) {
		return { sessions: [], continueCursor: null, isDone: true };
	}

	const scored = new Map<Id<'chatSessions'>, number>();
	const bump = (sessionId: Id<'chatSessions'>, score: number) => {
		scored.set(sessionId, Math.max(scored.get(sessionId) ?? 0, score));
	};

	const [contactMatches, messageMatches, fuzzyCandidates] = await Promise.all([
		ctx.db
			.query('chatSessions')
			.withSearchIndex('search_adminSearchText', (q) =>
				q.search('adminSearchText', normalizedQuery)
			)
			.take(SEARCH_SESSION_LIMIT),
		ctx.db
			.query('chatMessages')
			.withSearchIndex('search_content', (q) => q.search('content', options.query))
			.take(SEARCH_MESSAGE_LIMIT),
		ctx.db
			.query('chatSessions')
			.withIndex('by_adminSortAt')
			.order('desc')
			.take(FUZZY_SCAN_LIMIT)
	]);

	for (const session of contactMatches) bump(session._id, 85);
	for (const message of messageMatches) bump(message.sessionId, 75);
	for (const session of fuzzyCandidates) {
		const score = typoTolerantContactScore(normalizedQuery, session.adminSearchText);
		if (score > 0) bump(session._id, score);
	}

	const hydrated = (
		await Promise.all(
			Array.from(scored.keys()).map(async (sessionId) => await ctx.db.get(sessionId))
		)
	).filter((session): session is Doc<'chatSessions'> => Boolean(session));

	const filtered: Doc<'chatSessions'>[] = [];
	for (const session of hydrated) {
		if (options.propertySlug && session.propertySlug !== options.propertySlug) continue;
		if (await sessionMatchesFilters(ctx, session, options)) filtered.push(session);
	}

	filtered.sort((a, b) => {
		const scoreDelta = (scored.get(b._id) ?? 0) - (scored.get(a._id) ?? 0);
		if (scoreDelta !== 0) return scoreDelta;
		return getSessionLatestMessageSortAt(b) - getSessionLatestMessageSortAt(a);
	});

	const offset = parseSearchCursor(options.cursor);
	const page = filtered.slice(offset, offset + PAGE_SIZE);
	const nextOffset = offset + PAGE_SIZE;
	const isDone = nextOffset >= filtered.length;

	return {
		sessions: await decorateSessions(ctx, page, options.now),
		continueCursor: isDone ? null : searchCursor(nextOffset),
		isDone
	};
}

async function listFilteredSessions(
	ctx: QueryCtx,
	options: {
		cursor: string | null;
		status: SessionStatus;
		empty: EmptyFilter;
		channel: ChannelFilter;
		messageStartAt?: number;
		messageEndAt?: number;
		propertySlug?: string;
		now: number;
	}
) {
	if (
		options.empty === 'empty' &&
		(typeof options.messageStartAt === 'number' || typeof options.messageEndAt === 'number')
	) {
		return { sessions: [], continueCursor: null, nextCursor: null, isDone: true };
	}

	const parsedCursor = parseFilterCursor(options.cursor);
	let cursor = parsedCursor.sourceCursor;
	let sourceDone = parsedCursor.sourceDone;
	const matched: Doc<'chatSessions'>[] = [];
	const seen = new Set<Id<'chatSessions'>>();

	const addIfMatches = async (session: Doc<'chatSessions'>) => {
		if (seen.has(session._id)) return;
		seen.add(session._id);
		if (options.propertySlug && session.propertySlug !== options.propertySlug) return;
		if (!(await sessionMatchesFilters(ctx, session, options))) return;
		matched.push(session);
	};

	for (const sessionId of parsedCursor.overflowIds) {
		const session = await ctx.db.get(sessionId);
		if (!session) continue;
		await addIfMatches(session);
	}

	if (matched.length < PAGE_SIZE && !sourceDone) {
		const paginationOpts = { numItems: FILTER_SOURCE_PAGE_SIZE, cursor };
		// Convex only allows one paginated query per function invocation.
		const page =
			options.empty === 'non_empty'
				? await ctx.db
						.query('chatSessions')
						.withIndex('by_latestMessageAt', (q) => {
							const range = q.gte('latestMessageAt', options.messageStartAt ?? 0);
							return typeof options.messageEndAt === 'number'
								? range.lte('latestMessageAt', options.messageEndAt)
								: range;
						})
						.order('desc')
						.paginate(paginationOpts)
				: await ctx.db
						.query('chatSessions')
						.withIndex('by_adminSortAt')
						.order('desc')
						.paginate(paginationOpts);

		cursor = page.continueCursor;
		sourceDone = page.isDone;

		for (const session of page.page) {
			await addIfMatches(session);
		}
	}

	const pageSessions = matched.slice(0, PAGE_SIZE);
	const overflowIds = matched.slice(PAGE_SIZE).map((session) => session._id);
	const hasMore = overflowIds.length > 0 || !sourceDone;
	const continueCursor = hasMore
		? filterCursor({ sourceCursor: cursor, sourceDone, overflowIds })
		: null;
	return {
		sessions: await decorateSessions(ctx, pageSessions, options.now),
		continueCursor,
		nextCursor: continueCursor,
		isDone: !hasMore
	};
}

export const listSessions = query({
	args: {
		paginationOpts: v.optional(paginationOptsValidator),
		status: v.optional(sessionStatusValidator),
		empty: v.optional(emptyFilterValidator),
		channel: v.optional(channelFilterValidator),
		messageStartAt: v.optional(v.number()),
		messageEndAt: v.optional(v.number()),
		searchQuery: v.optional(v.string()),
		propertySlug: v.optional(v.string()),
		limit: v.optional(v.number()),
		cursor: v.optional(v.number()),
		now: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const now = args.now ?? Date.now();
		const status = args.status ?? 'active';
		const empty = args.empty ?? 'non_empty';
		const channel = args.channel ?? 'all';
		const messageStartAt = args.messageStartAt;
		const messageEndAt = args.messageEndAt;
		const searchQuery = args.searchQuery?.trim();
		const paginationOpts = {
			numItems: PAGE_SIZE,
			cursor:
				args.paginationOpts?.cursor ??
				(typeof args.cursor === 'number' ? String(args.cursor) : null)
		};

		if (searchQuery) {
			return await searchSessions(ctx, {
				query: searchQuery,
				cursor: paginationOpts.cursor,
				status,
				empty,
				channel,
				messageStartAt,
				messageEndAt,
				propertySlug: args.propertySlug,
				now
			});
		}

		return await listFilteredSessions(ctx, {
			cursor: paginationOpts.cursor,
			status,
			empty,
			channel,
			messageStartAt,
			messageEndAt,
			propertySlug: args.propertySlug,
			now
		});
	}
});

export const getSessionDetail = query({
	args: { sessionId: v.id('chatSessions'), now: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const now = args.now ?? Date.now();
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const [lineEvents, facebookEvents, whatsappEvents, instagramEvents, property] = await Promise.all([
			session.channel === 'line'
				? ctx.db
						.query('lineWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'facebook'
				? ctx.db
						.query('facebookWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'whatsapp'
				? ctx.db
						.query('whatsappWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'instagram'
				? ctx.db
						.query('instagramWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.propertyId ? ctx.db.get(session.propertyId) : null
		]);

		return {
			session: {
				...session,
				propertyName: property?.name,
				isActive: isChatSessionActive(session, now)
			},
			lineEvents,
			facebookEvents,
			whatsappEvents,
			instagramEvents
		};
	}
});

export const listTranscriptMessages = query({
	args: {
		sessionId: v.id('chatSessions'),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		return await ctx.db
			.query('chatMessages')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

export const getTranscript = query({
	args: { sessionId: v.id('chatSessions'), now: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const now = args.now ?? Date.now();
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const [messages, lineEvents, facebookEvents, whatsappEvents, instagramEvents, property] = await Promise.all([
			ctx.db
				.query('chatMessages')
				.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
				.order('asc')
				.take(500),
			session.channel === 'line'
				? ctx.db
						.query('lineWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'facebook'
				? ctx.db
						.query('facebookWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'whatsapp'
				? ctx.db
						.query('whatsappWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'instagram'
				? ctx.db
						.query('instagramWebhookEvents')
						.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.propertyId ? ctx.db.get(session.propertyId) : null
		]);

		return {
			session: {
				...session,
				propertyName: property?.name,
				isActive: isChatSessionActive(session, now)
			},
			messages,
			lineEvents,
			facebookEvents,
			whatsappEvents,
			instagramEvents
		};
	}
});
