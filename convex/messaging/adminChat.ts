import { inboxProjectionReady } from './inboxProjection';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { internal } from '../_generated/api';
import type { Doc, Id } from '../_generated/dataModel';
import { adminMutation, adminQuery, internalMutation, type MutationCtx, type QueryCtx } from '../auth/model';
import { isChatSessionActive } from '../shared/chatPresence';
import { getAdminChatMessageCount, getAdminChatSortAt, normalizeAdminSearchText } from './adminChatMetadata';
import { getChannelReplyWindow } from './channelReplyWindow';
import { answerAccepted, assertNoPendingStaffSend, changeStaffOwnership, finishWithoutReply, inboxNeedsStaff, latestGuestId } from './inboxState';

const PAGE_SIZE = 10;

const SEARCH_SESSION_LIMIT = 50;

const SEARCH_MESSAGE_LIMIT = 100;

const FUZZY_SCAN_LIMIT = 200;

const FILTER_SOURCE_PAGE_SIZE = 100;

const DETAIL_CHANNEL_EVENT_LIMIT = 1;

type FilterCursor = {
	sourceCursor: string | null;
	sourceDone: boolean;
	overflowIds: Id<'conversations'>[];
    sourceIndex?: 'inbox' | 'activity';
};

const sessionStatusValidator = v.union(
	v.literal('all'),
	v.literal('active'),
	v.literal('inactive'),
	v.literal('needs_reply'), v.literal('in_progress')
);

const adminStatusValidator = v.union(
	v.literal('open'),
	v.literal('resolved'),
	v.literal('archived')
);

const adminStatusFilterValidator = v.union(v.literal('all'), v.literal('done'), adminStatusValidator);

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

type SessionStatus = 'all' | 'active' | 'inactive' | 'needs_reply' | 'in_progress';

type AdminStatusFilter = 'all' | 'open' | 'done' | 'resolved' | 'archived';

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
            sourceIndex?: unknown;
		};
		if (parsed.type !== 'filtered') {
			return { sourceCursor: cursor, sourceDone: false, overflowIds: [] };
		}
		return {
			sourceCursor: typeof parsed.sourceCursor === 'string' ? parsed.sourceCursor : null,
			sourceDone: typeof parsed.sourceDone === 'boolean' ? parsed.sourceDone : false,
            sourceIndex: parsed.sourceIndex === 'inbox' ? 'inbox' : 'activity',
			overflowIds: Array.isArray(parsed.overflowIds)
				? parsed.overflowIds.filter((id): id is Id<'conversations'> => typeof id === 'string')
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
		overflowIds: cursor.overflowIds,
        sourceIndex: cursor.sourceIndex
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

function getSessionLatestMessageSortAt(session: Doc<'conversations'>) {
	return session.latestMessageAt ?? Number.NEGATIVE_INFINITY;
}

/**
 * Reads shared by the filter and decoration steps of one list call: each session's latest message
 * and each villa are fetched once, however many filters and rows use them.
 */
type SessionLookups = {
	latestMessage: (sessionId: Id<'conversations'>) => Promise<Doc<'messages'> | null>;
	property: (propertyId: Id<'properties'>) => Promise<Doc<'properties'> | null>;
};

function createSessionLookups(ctx: QueryCtx): SessionLookups {
	const latestMessages = new Map<Id<'conversations'>, Promise<Doc<'messages'> | null>>();
	const properties = new Map<Id<'properties'>, Promise<Doc<'properties'> | null>>();
	return {
		latestMessage(sessionId) {
			let latest = latestMessages.get(sessionId);
			if (!latest) {
				latest = ctx.db
					.query('messages')
					.withIndex('by_session', (q) => q.eq('sessionId', sessionId))
					.order('desc')
					.first();
				latestMessages.set(sessionId, latest);
			}
			return latest;
		},
		property(propertyId) {
			let property = properties.get(propertyId);
			if (!property) {
				property = ctx.db.get(propertyId);
				properties.set(propertyId, property);
			}
			return property;
		}
	};
}

function latestSessionMessage(lookups: SessionLookups, session: Doc<'conversations'>) {
  return session.inboxProjectionVersion === 1 && session.lastMessagePreview !== undefined
    ? Promise.resolve(session.lastMessagePreview)
    : lookups.latestMessage(session._id);
}

async function sessionHasStoredMessages(lookups: SessionLookups, session: Doc<'conversations'>) {
	return Boolean(await latestSessionMessage(lookups, session));
}

async function getSessionLatestMessageAt(lookups: SessionLookups, session: Doc<'conversations'>) {
	const latestStoredMessage = await latestSessionMessage(lookups, session);
 return latestStoredMessage?.timestamp ?? session.latestMessageAt;
}

/** The guest wrote last and no admin marked that message as settled. */
function sessionNeedsReply(
	session: Doc<'conversations'>,
	latestMessage: Doc<'messages'> | null
) {
	return inboxNeedsStaff(session, latestMessage);
}

async function sessionMatchesFilters(
	lookups: SessionLookups,
	session: Doc<'conversations'>,
	options: {
		status: SessionStatus;
		adminStatus: AdminStatusFilter;
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
	const adminStatus = session.adminStatus ?? 'open';
	if (options.status === 'in_progress' && (session.inboxState ? session.inboxState !== 'processing' :
		sessionNeedsReply(session, await latestSessionMessage(lookups, session)))) return false;
	if (options.adminStatus === 'done' ? adminStatus === 'open' : options.adminStatus !== 'all' && adminStatus !== options.adminStatus) {
		return false;
	}
	if (
		options.status === 'needs_reply' &&
		!sessionNeedsReply(session, await latestSessionMessage(lookups, session))
	) {
		return false;
	}

	const messageCount = getAdminChatMessageCount(session);
	if (options.empty === 'empty') {
		if (messageCount !== 0) return false;
		if (await sessionHasStoredMessages(lookups, session)) return false;
	}
	if (options.empty === 'non_empty') {
		if (messageCount === 0 && !(await sessionHasStoredMessages(lookups, session))) {
			return false;
		}
	}

	if (
		typeof options.messageStartAt === 'number' ||
		typeof options.messageEndAt === 'number'
	) {
		const latestMessageAt = await getSessionLatestMessageAt(lookups, session);
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

/**
 * Checks a bounded batch of sessions concurrently and returns the matches in input order. The
 * shared lookups memoize each read, so the documents read are the same as checking one at a time.
 */
async function filterMatchingSessions(
	lookups: SessionLookups,
	sessions: Doc<'conversations'>[],
	options: Parameters<typeof sessionMatchesFilters>[2]
) {
	const matches = await Promise.all(
		sessions.map((session) => sessionMatchesFilters(lookups, session, options))
	);
	return sessions.filter((_, index) => matches[index]);
}

/** Cached heads are internal storage, never additional browser response fields. */
function adminSessionMetadata(session: Doc<'conversations'>): Omit<Doc<'conversations'>, 'lastMessagePreview' | 'lastDeliveryStatus' | 'inboxProjectionVersion' | 'lastActivityAt'> {
  const metadata = { ...session };
  delete metadata.lastMessagePreview;
  delete metadata.lastDeliveryStatus;
  delete metadata.inboxProjectionVersion;
  delete metadata.lastActivityAt;
  return metadata;
}

function latestSessionDelivery(ctx: QueryCtx, session: Doc<'conversations'>, channel: Doc<'channelEvents'>['channel']) {
  if (session.channel !== channel || channel === 'web') return null;
  if (session.inboxProjectionVersion === 1 && session.lastDeliveryStatus !== undefined) return session.lastDeliveryStatus;
  return ctx.db.query('channelEvents').withIndex('by_channel_and_sessionId', q => q.eq('channel', channel).eq('sessionId', session._id)).order('desc').first();
}

async function decorateSession(
	ctx: QueryCtx,
	lookups: SessionLookups,
	session: Doc<'conversations'>,
	now: number
) {
	const [
		latestMessage,
		latestLineEvent,
		latestFacebookEvent,
		latestWhatsAppEvent,
		latestInstagramEvent,
		property
	] = await Promise.all([
		latestSessionMessage(lookups, session),
        latestSessionDelivery(ctx, session, 'line'),
        latestSessionDelivery(ctx, session, 'facebook'),
        latestSessionDelivery(ctx, session, 'whatsapp'),
        latestSessionDelivery(ctx, session, 'instagram'),
		session.propertyId ? lookups.property(session.propertyId) : null
	]);

	return {
		...adminSessionMetadata(session),
		messageCount: Math.max(getAdminChatMessageCount(session), latestMessage ? 1 : 0),
		latestMessageAt: latestMessage?.timestamp ?? session.latestMessageAt,
		adminSortAt: getAdminChatSortAt(session),
		propertyName: property?.name,
		latestMessage,
		needsReply: sessionNeedsReply(session, latestMessage),
		latestLineEvent,
		latestFacebookEvent,
		latestWhatsAppEvent,
		latestInstagramEvent,
		isActive: isChatSessionActive(session, now)
	};
}

async function decorateSessions(
	ctx: QueryCtx,
	lookups: SessionLookups,
	sessions: Doc<'conversations'>[],
	now: number
) {
	return await Promise.all(sessions.map((session) => decorateSession(ctx, lookups, session, now)));
}

async function searchSessions(
	ctx: QueryCtx,
	options: {
		query: string;
		cursor: string | null;
		status: SessionStatus;
		adminStatus: AdminStatusFilter;
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

	const scored = new Map<Id<'conversations'>, number>();
	const bump = (sessionId: Id<'conversations'>, score: number) => {
		scored.set(sessionId, Math.max(scored.get(sessionId) ?? 0, score));
	};

	const [contactMatches, messageMatches, fuzzyCandidates] = await Promise.all([
		ctx.db
			.query('conversations')
			.withSearchIndex('search_adminSearchText', (q) =>
				q.search('adminSearchText', normalizedQuery)
			)
			.take(SEARCH_SESSION_LIMIT),
		ctx.db
			.query('messages')
			.withSearchIndex('search_content', (q) => q.search('content', options.query))
			.take(SEARCH_MESSAGE_LIMIT),
		ctx.db
			.query('conversations')
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
	).filter((session): session is Doc<'conversations'> => Boolean(session));

	const lookups = createSessionLookups(ctx);
	const filtered = await filterMatchingSessions(
		lookups,
		hydrated.filter(
			(session) => !options.propertySlug || session.propertySlug === options.propertySlug
		),
		options
	);

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
		sessions: await decorateSessions(ctx, lookups, page, options.now),
		continueCursor: isDone ? null : searchCursor(nextOffset),
		isDone
	};
}

async function listFilteredSessions(
	ctx: QueryCtx,
	options: {
		cursor: string | null;
		status: SessionStatus;
		adminStatus: AdminStatusFilter;
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

	const lookups = createSessionLookups(ctx);
	const parsedCursor = parseFilterCursor(options.cursor);
	let cursor = parsedCursor.sourceCursor;
	let sourceDone = parsedCursor.sourceDone;
    const sourceIndex = parsedCursor.sourceIndex ?? (options.cursor ? 'activity' : options.status === 'needs_reply' && await inboxProjectionReady(ctx) ? 'inbox' : 'activity');
	const matched: Doc<'conversations'>[] = [];
	const seen = new Set<Id<'conversations'>>();

	// Dedupes synchronously in input order, checks the remaining rows concurrently, then appends
	// matches in input order, so the page and its overflow keep the source order.
	const addMatches = async (sessions: (Doc<'conversations'> | null)[]) => {
		const candidates: Doc<'conversations'>[] = [];
		for (const session of sessions) {
			if (!session || seen.has(session._id)) continue;
			seen.add(session._id);
			if (options.propertySlug && session.propertySlug !== options.propertySlug) continue;
			candidates.push(session);
		}
		matched.push(...(await filterMatchingSessions(lookups, candidates, options)));
	};

	await addMatches(
		await Promise.all(parsedCursor.overflowIds.map((sessionId) => ctx.db.get(sessionId)))
	);

	if (matched.length < PAGE_SIZE && !sourceDone) {
		const ready = sourceIndex === 'inbox';
        const paginationOpts = { numItems: ready ? PAGE_SIZE : FILTER_SOURCE_PAGE_SIZE, cursor };
		const startAt = options.messageStartAt ?? 0;
		const endAt = options.messageEndAt ?? Number.MAX_SAFE_INTEGER;
		// Convex only allows one paginated query per function invocation. Chats with messages
		// are read from the narrowest index for the filters: resolved/archived chats are few, and a
		// channel filter skips other channels' chats. The remaining filters are checked per row.
		const sparseAdminStatus =
			options.adminStatus === 'resolved' || options.adminStatus === 'archived' ? options.adminStatus : null;
		const page = ready
            ? await ctx.db.query('conversations').withIndex('by_inboxState_and_lastActivityAt', q => q.eq('inboxState', 'needs_staff')).order('desc').paginate(paginationOpts)
            : options.empty !== 'non_empty'
				? await ctx.db
						.query('conversations')
						.withIndex('by_adminSortAt')
						.order('desc')
						.paginate(paginationOpts)
				: sparseAdminStatus
					? await ctx.db
							.query('conversations')
							.withIndex('by_adminStatus_and_latestMessageAt', (q) =>
								q.eq('adminStatus', sparseAdminStatus).gte('latestMessageAt', startAt).lte('latestMessageAt', endAt)
							)
							.order('desc')
							.paginate(paginationOpts)
					: options.channel !== 'all'
						? await ctx.db
								.query('conversations')
								.withIndex('by_channel_and_latestMessageAt', (q) =>
									q
										.eq('channel', options.channel as Doc<'conversations'>['channel'])
										.gte('latestMessageAt', startAt)
										.lte('latestMessageAt', endAt)
								)
								.order('desc')
								.paginate(paginationOpts)
						: await ctx.db
								.query('conversations')
								.withIndex('by_latestMessageAt', (q) =>
									q.gte('latestMessageAt', startAt).lte('latestMessageAt', endAt)
								)
								.order('desc')
								.paginate(paginationOpts);

		cursor = page.continueCursor;
		sourceDone = page.isDone;

		await addMatches(page.page);
	}

	const pageSessions = matched.slice(0, PAGE_SIZE);
	const overflowIds = matched.slice(PAGE_SIZE).map((session) => session._id);
	const hasMore = overflowIds.length > 0 || !sourceDone;
	const continueCursor = hasMore
		? filterCursor({ sourceCursor: cursor, sourceDone, overflowIds, sourceIndex })
		: null;
	return {
		sessions: await decorateSessions(ctx, lookups, pageSessions, options.now),
		continueCursor,
		nextCursor: continueCursor,
		isDone: !hasMore
	};
}

export const listSessions = adminQuery({
	args: {
		paginationOpts: v.optional(paginationOptsValidator),
		status: v.optional(sessionStatusValidator),
		adminStatus: v.optional(adminStatusFilterValidator),
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

		const now = args.now ?? Date.now();
		const status = args.status ?? 'active';
		const adminStatus = args.adminStatus ?? 'all';
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
				adminStatus,
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
			adminStatus,
			empty,
			channel,
			messageStartAt,
			messageEndAt,
			propertySlug: args.propertySlug,
			now
		});
	}
});

export const getSessionDetail = adminQuery({
	args: { sessionId: v.id('conversations'), now: v.optional(v.number()) },
	handler: async (ctx, args) => {

		const now = args.now ?? Date.now();
		const session = await ctx.db.get(args.sessionId);
		// Deep links may point at a deleted chat.
		if (!session) return null;

		// The detail view only shows each channel's newest delivery event (`events[0]`), so read one.
		// `getTranscript` keeps its 10-event lists.
		const [lineEvents, facebookEvents, whatsappEvents, instagramEvents, property, replyWindow, latestMessage] = await Promise.all([
			session.channel === 'line'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'line').eq('sessionId', args.sessionId))
						.order('desc')
						.take(DETAIL_CHANNEL_EVENT_LIMIT)
				: [],
			session.channel === 'facebook'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'facebook').eq('sessionId', args.sessionId))
						.order('desc')
						.take(DETAIL_CHANNEL_EVENT_LIMIT)
				: [],
			session.channel === 'whatsapp'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'whatsapp').eq('sessionId', args.sessionId))
						.order('desc')
						.take(DETAIL_CHANNEL_EVENT_LIMIT)
				: [],
			session.channel === 'instagram'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'instagram').eq('sessionId', args.sessionId))
						.order('desc')
						.take(DETAIL_CHANNEL_EVENT_LIMIT)
				: [],
			session.propertyId ? ctx.db.get(session.propertyId) : null,
			getChannelReplyWindow(ctx, session),
			createSessionLookups(ctx).latestMessage(session._id)
		]);

		return {
			session: {
				...adminSessionMetadata(session),
				propertyName: property?.name,
				latestMessage,
				latestGuestMessageId: session.latestGuestMessageId ??
					(latestMessage?.role === 'user' ? latestMessage._id : await latestGuestId(ctx, session)),
				messageCount: Math.max(getAdminChatMessageCount(session), latestMessage ? 1 : 0),
				needsReply: sessionNeedsReply(session, latestMessage),
				isActive: isChatSessionActive(session, now)
			},
			replyWindow,
			lineEvents,
			facebookEvents,
			whatsappEvents,
			instagramEvents
		};
	}
});

export const settleGuestMessage = adminMutation({
	args: { sessionId: v.id('conversations'), messageId: v.id('messages') },
	handler: async (ctx, args) => {

		const message = await ctx.db.get(args.messageId);
		if (!message || message.sessionId !== args.sessionId || message.role !== 'user') {
			throw new Error('Guest message not found');
		}

		await ctx.db.patch(args.sessionId, { settledGuestMessageId: args.messageId });
		const session = await ctx.db.get(args.sessionId);
		if (session && await latestGuestId(ctx, session) === args.messageId) await finishWithoutReply(ctx, args.sessionId);
		return null;
	}
});

export const listTranscriptMessages = adminQuery({
	args: {
		sessionId: v.id('conversations'),
		paginationOpts: paginationOptsValidator
	},
	handler: async (ctx, args) => {

		// No session read: it is patched by every guest heartbeat, which would rerun this live
		// transcript each time. A deleted chat's messages are removed with it, so it pages empty.
		return await ctx.db
			.query('messages')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('desc')
			.paginate(args.paginationOpts);
	}
});

export const getTranscript = adminQuery({
	args: { sessionId: v.id('conversations'), now: v.optional(v.number()) },
	handler: async (ctx, args) => {

		const now = args.now ?? Date.now();
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		const [messages, lineEvents, facebookEvents, whatsappEvents, instagramEvents, property] = await Promise.all([
			ctx.db
				.query('messages')
				.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
				.order('asc')
				.take(500),
			session.channel === 'line'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'line').eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'facebook'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'facebook').eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'whatsapp'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'whatsapp').eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.channel === 'instagram'
				? ctx.db
						.query('channelEvents')
						.withIndex('by_channel_and_sessionId', (q) => q.eq('channel', 'instagram').eq('sessionId', args.sessionId))
						.order('desc')
						.take(10)
				: [],
			session.propertyId ? ctx.db.get(session.propertyId) : null
		]);

		return {
			session: {
				...adminSessionMetadata(session),
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

export const setSessionStatus = adminMutation({
	args: { sessionId: v.id('conversations'), status: adminStatusValidator,
		expectedGuestMessageId: v.optional(v.union(v.id('messages'), v.null())) },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		if (args.status === 'open') await assertNoPendingStaffSend(ctx, session);
		const now = Date.now();
		if (args.status === 'resolved') {
			if (args.expectedGuestMessageId !== undefined &&
				(await latestGuestId(ctx, session) ?? null) !== args.expectedGuestMessageId) {
				throw new Error('A new guest message arrived. Read it before marking No reply needed.');
			}
			await finishWithoutReply(ctx, args.sessionId);
			return null;
		}
		await ctx.db.patch(args.sessionId, {
			adminStatus: args.status === 'open' ? undefined : args.status,
			inboxState: args.status === 'open' ? 'processing' : 'done',
			inboxReason: args.status === 'open' ? 'follow_up' : 'archived',
			staffTask: args.status === 'open' ? (session.staffTask ?? 'Review conversation') : undefined,
			aiPaused: args.status === 'open' ? true : session.keepWithStaff ? true : undefined,
			resolutionSource: undefined,
			inboxSendRequestId: undefined,
			resolvedAt: undefined,
			archivedAt: args.status === 'archived' ? now : undefined
		});
		return null;
	}
});

export const setAiPaused = adminMutation({
	args: { sessionId: v.id('conversations'), paused: v.boolean() },
	handler: async (ctx, args) => {
		const { email } = ctx.admin;
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');

		await changeStaffOwnership(ctx, args.sessionId, email, { paused: args.paused });
		return null;
	}
});

export const setStaffTask = adminMutation({
	args: { sessionId: v.id('conversations'), task: v.union(v.string(), v.null()) },
	handler: async (ctx, args) => {
		const { email } = ctx.admin;
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');
		if (args.task !== null) {
			const task = args.task.trim();
			if (!task || task.length > 300) throw new Error('Enter a follow-up of 1–300 characters');
			await ctx.db.patch(args.sessionId, { staffTask: task,
				inboxState: session.inboxSendError ? 'needs_staff' : 'processing',
				inboxReason: session.inboxSendError ? 'send_failed' : session.inboxReason === 'sending' ? 'sending' : 'follow_up',
				adminStatus: undefined, resolvedAt: undefined, aiPaused: true, assignedAdminEmail: email });
		} else {
			await ctx.db.patch(args.sessionId, { staffTask: undefined });
			// Task edits must not finish a reply before the channel confirms it.
			if (session.inboxReason === 'sending') return null;
			const guestId = await latestGuestId(ctx, session);
			if (!session.inboxHandoff && !session.inboxSendError && guestId === session.answeredGuestMessageId && session.inboxReason !== 'send_failed') {
				await answerAccepted(ctx, { sessionId: args.sessionId, replyToMessageId: guestId,
					messageId: session.resolutionMessageId, source: 'staff', outcome: 'answered' });
			} else {
				await ctx.db.patch(args.sessionId, { inboxState: 'needs_staff', inboxReason: session.inboxReason === 'send_failed' ? 'send_failed' : session.inboxHandoff ? 'handoff' : 'staff_reply' });
			}
		}
		return null;
	}
});

export const setKeepWithStaff = adminMutation({
	args: { sessionId: v.id('conversations'), keep: v.boolean() },
	handler: async (ctx, args) => {
		const { email } = ctx.admin;
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');
		await changeStaffOwnership(ctx, args.sessionId, email, { keep: args.keep });
		return null;
	}
});

const DELETE_BATCH_SIZE = 200;

/** Deletes up to one batch of a session's child rows. Returns true once nothing is left. */
async function deleteSessionChildrenBatch(ctx: MutationCtx, sessionId: Id<'conversations'>) {
	let budget = DELETE_BATCH_SIZE;
	const unknowns = await ctx.db.query('chatUnknownQuestions')
		.withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).take(budget);
	for (const row of unknowns) {
		await ctx.db.patch(row._id, { sessionId: undefined, userId: undefined, updatedAt: Date.now() });
	}
	budget -= unknowns.length;
	if (budget <= 0) return false;
	const batches = [
		(limit: number) =>
			ctx.db.query('messages').withIndex('by_session', (q) => q.eq('sessionId', sessionId)).take(limit),
		(limit: number) =>
			ctx.db.query('adminReplyAttempts').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).take(limit),
		(limit: number) =>
			ctx.db.query('chatBrowserHandoffs').withIndex('by_sessionId', (q) => q.eq('sessionId', sessionId)).take(limit),
		(limit: number) =>
			ctx.db
				.query('chatStaticSuggestionInteractions')
				.withIndex('by_session', (q) => q.eq('sessionId', sessionId))
				.take(limit)
	];

	for (const takeBatch of batches) {
		const rows = await takeBatch(budget);
		for (const row of rows) await ctx.db.delete(row._id);
		budget -= rows.length;
		if (budget <= 0) return false;
	}
	return true;
}

export const deleteSessionChildren = internalMutation({
	args: { sessionId: v.id('conversations') },
	handler: async (ctx, args) => {
		if (!(await deleteSessionChildrenBatch(ctx, args.sessionId))) {
			await ctx.scheduler.runAfter(0, internal.messaging.adminChat.deleteSessionChildren, args);
		}
		return null;
	}
});

/** Hard-deletes an archived chat and (in batches) its transcript and interactions. Webhook logs are kept. */
export const deleteArchivedSession = adminMutation({
	args: { sessionId: v.id('conversations') },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		if (!session) throw new Error('Session not found');
		if (session.adminStatus !== 'archived') throw new Error('Archive the chat before deleting it');

		await ctx.db.delete(args.sessionId);
		if (!(await deleteSessionChildrenBatch(ctx, args.sessionId))) {
			await ctx.scheduler.runAfter(0, internal.messaging.adminChat.deleteSessionChildren, args);
		}
		return null;
	}
});
