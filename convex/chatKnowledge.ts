import { durableTurnValidator, currentClaim } from './messaging/claims';
import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import { internalMutation, mutation, query, type MutationCtx, type QueryCtx } from './auth/model';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import { normalizeSuggestedQuestion } from './lib/chatSuggestions';
import { staffNeeded } from './lib/inboxLifecycle';
import { groupUnknownQuestions } from './lib/knowledgeGrouping';


const unknownQuestionStatusValidator = v.union(
	v.literal('all'),
	v.literal('new'),
	v.literal('resolved'),
	v.literal('ignored')
);


function sanitizeRequiredText(value: string, field: string, maxLength: number) {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${field} is required`);
	if (trimmed.length > maxLength) throw new Error(`${field} must be ${maxLength} characters or fewer`);
	return trimmed;
}


function sanitizeOptionalText(value: string | undefined, maxLength: number) {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > maxLength) return trimmed.slice(0, maxLength);
	return trimmed;
}


function normalizeQuestion(value: string) {
	return normalizeSuggestedQuestion(value);
}


// A staff request needs a "talk/contact" verb near a "person/staff" noun (either order), so plain
// questions about staff ("is there cleaning staff?", "price per person") don't page the owner.
// Words in spaced scripts get unicode word boundaries; Thai/CJK terms are matched bare.
const word = (alternatives: string) => String.raw`(?<!\p{L})(?:${alternatives})(?!\p{L})`;

const STAFF_VERBS = [
	word('speak|talk|chat|connect|contact|reach|sprech(?:en|e)|reden|kontakt(?:ieren)?|hablar|hablo|contactar|comunicar(?:me)?|parler|contacter|joindre|parlare|contattare|बात|संपर्क'),
	'поговори|свяж|соедини|позов|คุย|ติดต่อ|พูด|โทร|話|連絡|つない|繋い|转人工|转接|联系|找|통화|얘기|이야기|연결'
].join('|');

const STAFF_PEOPLE = [
	word('staff|agent|host|manager|owner|someone|anyone|(?:a|the|real) (?:person|human)|menschen|mitarbeiter|gastgeber|jemandem|persona|alguien|anfitri[oó]n|humano|personal|encargado|personne|quelqu.un|h[ôo]te|humain|personnel|responsable|qualcuno|umano|responsabile|человеком|кем-нибудь|хозяином|оператором|менеджером|сотрудником|इंसान|व्यक्ति|स्टाफ|मैनेजर|मालिक|상담원|(?:직원|사람)(?:과|이랑|하고|에게|한테)?'),
	'พนักงาน|เจ้าหน้าที่|แอดมิน|เจ้าของ|คนจริง|スタッフ|担当者|人間|オペレーター|人工|客服|真人|老板|经理'
].join('|');

const STAFF_ALONE = [word('human|real person|live agent|staff member|representative|상담원'), 'คนจริง|真人客服|人工客服|转人工|担当者'].join('|');

const STAFF_REQUEST = new RegExp(`${STAFF_ALONE}|(?:${STAFF_VERBS}).{0,30}(?:${STAFF_PEOPLE})|(?:${STAFF_PEOPLE}).{0,30}(?:${STAFF_VERBS})`, 'iu');


export function asksForStaff(message: string) {
	return STAFF_REQUEST.test(message);
}


async function claimStaffAlertSlot(ctx: MutationCtx, now: number) {
	const key = 'staff-alert:global';
	const hour = 60 * 60 * 1000;
	const row = await ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique();
	// The count fallback handles a row created by the old fixed-window limiter.
	const recent = row?.timestamps?.filter(time => time > now - hour)
		?? (row && row.expiresAt > now ? Array(Math.min(row.count, 30)).fill(now) as number[] : []);
	if (recent.length >= 30) return false;
	const timestamps = [...recent, now];
	if (row) await ctx.db.patch(row._id, { count: timestamps.length, expiresAt: now + hour, timestamps });
	else await ctx.db.insert('rateLimits', { key, count: 1, expiresAt: now + hour, timestamps });
	return true;
}


export async function queueStaffAlert(ctx: MutationCtx, sessionId: Id<'conversations'>, message: string, replyToMessageId?: Id<'messages'>) {
	const session = await ctx.db.get(sessionId);
	if (!session || session.visitorId?.startsWith("eval:")) return false;
	if (!await staffNeeded(ctx, sessionId, replyToMessageId)) return false;
	const now = Date.now();
	if (session.lastStaffAlertAt && now - session.lastStaffAlertAt < 30 * 60 * 1000) return false;
	// Sessions are created by anonymous clients, so enforce a rolling global hour as well.
	if (!(await claimStaffAlertSlot(ctx, now))) {
		console.warn('Staff alert rate limit reached, skipping alert for session', sessionId);
		return false;
	}
	await ctx.db.patch(sessionId, { lastStaffAlertAt: now });
	await ctx.scheduler.runAfter(0, internal.emails.sendStaffAlert, {
		sessionId,
		channel: session.channel,
		guestName: session.visitorName?.trim() || 'Unknown guest',
		lastMessage: message.slice(0, 1000)
	});
	return true;
}


export const alertStaffForHandoff = internalMutation({
	args: { durableTurn: v.optional(durableTurnValidator), sessionId: v.id('conversations'), lastMessage: v.string(), replyToMessageId: v.optional(v.id('messages')) },
	handler: async (ctx, args) => {
    if (args.durableTurn) { const event = await currentClaim(ctx, args.durableTurn.eventId, args.durableTurn.claimToken); if (event.sessionId !== args.sessionId) throw new Error('Turn conversation mismatch'); }
    return await queueStaffAlert(ctx, args.sessionId, args.lastMessage, args.replyToMessageId);
  }
});


async function resolveSessionProperty(
	ctx: QueryCtx | MutationCtx,
	session: Doc<'conversations'> | null,
	propertySlug?: string
) {
	if (!propertySlug?.trim() && session?.propertyId) {
		return {
			propertyId: session.propertyId,
			propertySlug: session.propertySlug
		};
	}
	const slug = propertySlug?.trim() || session?.propertySlug;
	if (!slug) return { propertyId: undefined, propertySlug: session?.propertySlug ?? propertySlug };
	const property = await ctx.db
		.query('properties')
		.withIndex('by_slug', (q) => q.eq('slug', slug))
		.unique();
	return {
		propertyId: property?._id,
		propertySlug: slug
	};
}


async function reopenUnknownQuestion(ctx: MutationCtx, unknownQuestionId: Id<'chatUnknownQuestions'>) {
	await ctx.db.patch(unknownQuestionId, {
		status: 'new',
		resolvedFactId: undefined,
		resolvedSource: undefined,
		resolvedAt: undefined,
		ignoredAt: undefined,
		updatedAt: Date.now()
	});
}


export const recordUnknownQuestion = internalMutation({
	args: { durableTurn: v.optional(durableTurnValidator),
		sessionId: v.optional(v.id('conversations')),
		replyToMessageId: v.optional(v.id('messages')),
		userQuestion: v.string(),
		detectedTopic: v.optional(v.string()),
		pageUrl: v.optional(v.string()),
		propertySlug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
    if (args.durableTurn) { const event = await currentClaim(ctx, args.durableTurn.eventId, args.durableTurn.claimToken); if (event.sessionId !== args.sessionId) throw new Error('Turn conversation mismatch'); }
		const userQuestion = sanitizeRequiredText(args.userQuestion, 'Question', 1000);
		const normalizedQuestion = normalizeQuestion(userQuestion);
		if (!normalizedQuestion) throw new Error('Question is required');

		const session = args.sessionId ? await ctx.db.get(args.sessionId) : null;
		const { propertyId, propertySlug } = await resolveSessionProperty(ctx, session, args.propertySlug);
		const now = Date.now();
		if (args.sessionId && session) await queueStaffAlert(ctx, args.sessionId, userQuestion, args.replyToMessageId);

		if (args.sessionId) {
			const existingRows = await ctx.db
				.query('chatUnknownQuestions')
				.withIndex('by_sessionId_and_normalizedQuestion', (q) =>
					q.eq('sessionId', args.sessionId).eq('normalizedQuestion', normalizedQuestion)
				)
				.take(10);
			const existing = existingRows.find((row) => row.status === 'new');
			if (existing) {
				await ctx.db.patch(existing._id, {
					detectedTopic: sanitizeOptionalText(args.detectedTopic, 80) ?? existing.detectedTopic,
					updatedAt: now
				});
				return existing._id;
			}
		}

		return await ctx.db.insert('chatUnknownQuestions', {
			propertyId,
			propertySlug,
			sessionId: args.sessionId,
			userQuestion,
			normalizedQuestion,
			detectedTopic: sanitizeOptionalText(args.detectedTopic, 80),
			userId: session?.visitorId,
			pageUrl: sanitizeOptionalText(args.pageUrl, 500) ?? session?.currentPath,
			status: 'new',
			adminNotified: false,
			createdAt: now,
			updatedAt: now
		});
	}
});


export const adminListUnknownQuestions = query({
	args: {
		paginationOpts: paginationOptsValidator,
		status: v.optional(unknownQuestionStatusValidator),
		search: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const status = args.status ?? 'new';
		const search = args.search?.trim();
		const result = search
			? await ctx.db
					.query('chatUnknownQuestions')
					.withSearchIndex('search_userQuestion', (q) =>
						status === 'all'
							? q.search('userQuestion', search)
							: q.search('userQuestion', search).eq('status', status)
					)
					.paginate(args.paginationOpts)
			: status === 'all'
				? await ctx.db
						.query('chatUnknownQuestions')
						.withIndex('by_createdAt')
						.order('desc')
						.paginate(args.paginationOpts)
				: await ctx.db
						.query('chatUnknownQuestions')
						.withIndex('by_status_and_createdAt', (q) => q.eq('status', status))
						.order('desc')
						.paginate(args.paginationOpts);

		return {
			...result,
			page: await Promise.all(
				result.page.map(async (row) => {
					const [property, fact] = await Promise.all([
						row.propertyId ? ctx.db.get(row.propertyId) : Promise.resolve(null),
						row.resolvedFactId ? ctx.db.get(row.resolvedFactId) : Promise.resolve(null)
					]);
					return {
						...row,
						propertyName: property?.name,
						propertySlug: row.propertySlug ?? property?.slug,
						resolvedFactTitle: fact?.title,
						resolvedSource: row.resolvedSource
					};
				})
			)
		};
	}
});


export const adminIgnoreUnknown = mutation({
	args: { unknownQuestionId: v.id('chatUnknownQuestions') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const unknown = await ctx.db.get(args.unknownQuestionId);
		if (!unknown) throw new Error('Unknown question not found');
		const now = Date.now();
		await ctx.db.patch(args.unknownQuestionId, {
			status: 'ignored',
			ignoredAt: now,
			updatedAt: now
		});
		return { ignored: true };
	}
});


export const adminReopenUnknown = mutation({
	args: { unknownQuestionId: v.id('chatUnknownQuestions') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const unknown = await ctx.db.get(args.unknownQuestionId);
		if (!unknown) throw new Error('Unknown question not found');
		if (unknown.status === 'new') return { reopened: false };
		await reopenUnknownQuestion(ctx, args.unknownQuestionId);
		return { reopened: true };
	}
});


// ---------------------------------------------------------------------------
// Bulk review: grouped unknown questions, pending variant queue, answer status.
// ---------------------------------------------------------------------------

const UNKNOWN_GROUP_SCAN_LIMIT = 500;

const BULK_GROUP_LIMIT = 100;

const BULK_GROUP_ROW_LIMIT = 100;

const BULK_ID_LIMIT = 200;


type UnknownStatus = 'new' | 'resolved' | 'ignored';


function bulkIds<T>(ids: T[], limit = BULK_ID_LIMIT) {
	const unique = [...new Set(ids)];
	if (unique.length > limit) throw new Error(`Select ${limit} or fewer at a time`);
	return unique;
}


function groupKeys(normalizedQuestions: string[]) {
	return bulkIds(normalizedQuestions.map((key) => key.trim()).filter(Boolean), BULK_GROUP_LIMIT);
}


async function unknownsInGroup(ctx: QueryCtx, status: UnknownStatus, normalizedQuestion: string, limit = BULK_GROUP_ROW_LIMIT) {
	return await ctx.db
		.query('chatUnknownQuestions')
		.withIndex('by_status_and_normalizedQuestion', (q) =>
			q.eq('status', status).eq('normalizedQuestion', normalizedQuestion)
		)
		.take(limit);
}


const REMAINING_COUNT_LIMIT = BULK_GROUP_ROW_LIMIT;


/** Bounded pending count; a positive lower bound lets the UI offer another 100-row batch. */
async function remainingInGroups(ctx: QueryCtx, keys: string[], statuses: UnknownStatus[]) {
	let remaining = 0;
	groups: for (const key of keys) {
		for (const status of statuses) {
			if (remaining > REMAINING_COUNT_LIMIT) break groups;
			const rows = await ctx.db
				.query('chatUnknownQuestions')
				.withIndex('by_status_and_normalizedQuestion', (q) => q.eq('status', status).eq('normalizedQuestion', key))
				.take(REMAINING_COUNT_LIMIT + 1 - remaining);
			remaining += rows.length;
		}
	}
	return {
		remaining: Math.min(remaining, REMAINING_COUNT_LIMIT),
		remainingIsLowerBound: remaining > REMAINING_COUNT_LIMIT,
		hasMore: remaining > 0
	};
}


/**
 * Unknown questions grouped by identical (normalized) text, most-asked first. Scans the newest
 * rows for the filter; `truncated` says older rows were left out.
 */
export const adminListUnknownGroups = query({
	args: {
		status: v.optional(unknownQuestionStatusValidator),
		search: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const status = args.status ?? 'new';
		const search = args.search?.trim();
		const rows = search
			? await ctx.db
					.query('chatUnknownQuestions')
					.withSearchIndex('search_userQuestion', (q) =>
						status === 'all'
							? q.search('userQuestion', search)
							: q.search('userQuestion', search).eq('status', status)
					)
					.take(UNKNOWN_GROUP_SCAN_LIMIT)
			: status === 'all'
				? await ctx.db
						.query('chatUnknownQuestions')
						.withIndex('by_createdAt')
						.order('desc')
						.take(UNKNOWN_GROUP_SCAN_LIMIT)
				: await ctx.db
						.query('chatUnknownQuestions')
						.withIndex('by_status_and_createdAt', (q) => q.eq('status', status))
						.order('desc')
						.take(UNKNOWN_GROUP_SCAN_LIMIT);

		const channels = new Map<Id<'conversations'>, Promise<string | undefined>>();
		const channelFor = (sessionId: Id<'conversations'>) => {
			let channel = channels.get(sessionId);
			if (!channel) {
				channel = ctx.db.get(sessionId).then((session) => session?.channel);
				channels.set(sessionId, channel);
			}
			return channel;
		};

		const groups = await Promise.all(
			groupUnknownQuestions(rows).map(async (group) => {
				const latest = group.latest;
				const [groupChannels, property, resolvedFact] = await Promise.all([
					Promise.all(group.rows.map((row) => (row.sessionId ? channelFor(row.sessionId) : undefined))),
					latest.propertyId ? ctx.db.get(latest.propertyId) : Promise.resolve(null),
					latest.resolvedFactId ? ctx.db.get(latest.resolvedFactId) : Promise.resolve(null)
				]);
				return {
					normalizedQuestion: group.normalizedQuestion,
					count: group.count,
					counts: group.counts,
					latestAt: group.latestAt,
					channels: [...new Set(groupChannels.filter((channel): channel is string => Boolean(channel)))],
					latest: {
						...latest,
						propertyName: property?.name,
						propertySlug: latest.propertySlug ?? property?.slug,
						resolvedFactTitle: resolvedFact?.title,
						resolvedSource: latest.resolvedSource
					}
				};
			})
		);
		return { groups, truncated: rows.length === UNKNOWN_GROUP_SCAN_LIMIT };
	}
});


/** Ignores at most 100 "new" reports across the groups. Returns bounded IDs for Undo. */
export const adminIgnoreUnknownGroups = mutation({
	args: { normalizedQuestions: v.array(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const now = Date.now();
		const unknownQuestionIds: Id<'chatUnknownQuestions'>[] = [];
		const keys = groupKeys(args.normalizedQuestions);
		for (const key of keys) {
			const budget = BULK_GROUP_ROW_LIMIT - unknownQuestionIds.length;
			if (budget === 0) break;
			for (const row of await unknownsInGroup(ctx, 'new', key, budget)) {
				await ctx.db.patch(row._id, { status: 'ignored', ignoredAt: now, updatedAt: now });
				unknownQuestionIds.push(row._id);
			}
		}
		return { ignored: unknownQuestionIds.length, unknownQuestionIds, ...await remainingInGroups(ctx, keys, ['new']) };
	}
});


/** Reopens at most 100 resolved/ignored reports across groups and explicit Undo IDs. */
export const adminReopenUnknownGroups = mutation({
	args: {
		normalizedQuestions: v.optional(v.array(v.string())),
		unknownQuestionIds: v.optional(v.array(v.id('chatUnknownQuestions')))
	},
		handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const keys = groupKeys(args.normalizedQuestions ?? []);
		if ((args.unknownQuestionIds?.length ?? 0) > BULK_GROUP_ROW_LIMIT) {
			throw new Error(`Reopen ${BULK_GROUP_ROW_LIMIT} or fewer report IDs at a time`);
		}
		const reopenedIds = new Set<Id<'chatUnknownQuestions'>>();
		for (const id of bulkIds(args.unknownQuestionIds ?? [], BULK_GROUP_ROW_LIMIT)) {
			const row = await ctx.db.get(id);
			if (!row || row.status === 'new') continue;
			await reopenUnknownQuestion(ctx, row._id);
			reopenedIds.add(row._id);
		}
		for (const key of keys) {
			for (const status of ['resolved', 'ignored'] as const) {
				const budget = BULK_GROUP_ROW_LIMIT - reopenedIds.size;
				if (budget === 0) break;
				for (const row of await unknownsInGroup(ctx, status, key, budget)) {
					await reopenUnknownQuestion(ctx, row._id);
					reopenedIds.add(row._id);
				}
			}
			if (reopenedIds.size === BULK_GROUP_ROW_LIMIT) break;
		}
		return { reopened: reopenedIds.size, ...await remainingInGroups(ctx, keys, ['resolved', 'ignored']) };
	}
});