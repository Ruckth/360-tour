import { paginationOptsValidator } from 'convex/server';
import { v } from 'convex/values';
import {
	action,
	internalAction,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { callAI, DEFAULT_AI_API_BASE_URL, DEFAULT_AI_MODEL, type ChatMessage } from './lib/chatLlm';
import { requiresLiveFacts, capabilityReply } from './lib/conciergePolicy';
import { requireAdmin } from './lib/adminAuth';
import { readBudget, ReadBudgetExceeded, readRangeWithinBudget } from './lib/readBudget';
import { normalizeSuggestedQuestion } from './lib/chatSuggestions';
import { createAnswerMatcher, groupUnknownQuestions } from './lib/knowledgeGrouping';

const answerStatusValidator = v.union(
	v.literal('draft'),
	v.literal('approved'),
	v.literal('archived')
);

const unknownQuestionStatusValidator = v.union(
	v.literal('all'),
	v.literal('new'),
	v.literal('resolved'),
	v.literal('ignored')
);

type AnswerStatus = 'draft' | 'approved' | 'archived';

type AnswerGenerationContext = {
	answer: Doc<'chatAnswers'>;
	primaryQuestion: Doc<'chatQuestions'> | null;
	questions: Doc<'chatQuestions'>[];
	topics: Doc<'chatTopics'>[];
};

type PropertyScopeSelection = {
	propertyId?: Id<'properties'>;
	propertySlug: string;
	normalizedSlug: string;
	source: 'property' | 'custom';
	label: string;
};

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

export async function queueStaffAlert(ctx: MutationCtx, sessionId: Id<'chatSessions'>, message: string) {
	const session = await ctx.db.get(sessionId);
	if (!session) return false;
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
	args: { sessionId: v.id('chatSessions'), lastMessage: v.string() },
	handler: async (ctx, args) => await queueStaffAlert(ctx, args.sessionId, args.lastMessage)
});

function normalizeTopicName(value: string) {
	return normalizeSuggestedQuestion(value);
}

function normalizePropertySlug(value: string) {
	return value
		.trim()
		.toLowerCase()
		.replace(/[\s_]+/g, '-')
		.replace(/[^a-z0-9-]/g, '')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '');
}

function sanitizePropertySlug(value: string) {
	const slug = normalizePropertySlug(value);
	if (!slug) throw new Error('Property slug is required');
	if (slug.length > 80) throw new Error('Property slug must be 80 characters or fewer');
	return slug;
}

function uniqueQuestionTexts(values: Array<string | undefined>) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const text = value?.trim();
		if (!text) continue;
		const normalized = normalizeQuestion(text);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(sanitizeRequiredText(text, 'Question', 240));
	}
	return result;
}

function uniqueTopicNames(values: Array<string | undefined>) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const name = value?.trim();
		if (!name) continue;
		const normalized = normalizeTopicName(name);
		if (!normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		result.push(sanitizeRequiredText(name, 'Topic', 80));
	}
	return result;
}

function uniquePropertySlugs(values: Array<string | undefined>) {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const slug = value ? sanitizePropertySlug(value) : undefined;
		if (!slug || seen.has(slug)) continue;
		seen.add(slug);
		result.push(slug);
	}
	return result;
}

async function getPropertyBySlug(ctx: QueryCtx | MutationCtx, slug: string) {
	return await ctx.db
		.query('properties')
		.withIndex('by_slug', (q) => q.eq('slug', slug))
		.unique();
}

async function getCustomScopeBySlug(ctx: QueryCtx | MutationCtx, slug: string) {
	const normalizedSlug = sanitizePropertySlug(slug);
	return await ctx.db
		.query('chatKnowledgeScopes')
		.withIndex('by_normalizedSlug', (q) => q.eq('normalizedSlug', normalizedSlug))
		.unique();
}

async function ensureCustomPropertyScope(ctx: MutationCtx, slug: string, adminEmail: string) {
	const normalizedSlug = sanitizePropertySlug(slug);
	const existing = await getCustomScopeBySlug(ctx, normalizedSlug);
	const now = Date.now();
	if (existing) {
		await ctx.db.patch(existing._id, {
			slug: normalizedSlug,
			label: normalizedSlug,
			updatedAt: now,
			updatedByAdminEmail: adminEmail
		});
		return existing;
	}

	const scopeId = await ctx.db.insert('chatKnowledgeScopes', {
		slug: normalizedSlug,
		normalizedSlug,
		label: normalizedSlug,
		createdAt: now,
		updatedAt: now,
		createdByAdminEmail: adminEmail,
		updatedByAdminEmail: adminEmail
	});
	return await ctx.db.get(scopeId);
}

async function resolvePropertyScopeSelections(
	ctx: MutationCtx,
	args: {
		propertyId?: Id<'properties'>;
		propertySlug?: string;
		propertySlugs?: string[];
	},
	adminEmail: string
) {
	const slugs = [...(args.propertySlugs ?? []), args.propertySlug];
	if (args.propertyId) {
		const property = await ctx.db.get(args.propertyId);
		if (!property) throw new Error('Property not found');
		slugs.push(property.slug);
	}

	const selections: PropertyScopeSelection[] = [];
	for (const slug of uniquePropertySlugs(slugs)) {
		const property = await getPropertyBySlug(ctx, slug);
		if (property) {
			selections.push({
				propertyId: property._id,
				propertySlug: property.slug,
				normalizedSlug: sanitizePropertySlug(property.slug),
				source: 'property',
				label: property.name
			});
			continue;
		}

		const customScope = await ensureCustomPropertyScope(ctx, slug, adminEmail);
		selections.push({
			propertySlug: customScope?.slug ?? slug,
			normalizedSlug: customScope?.normalizedSlug ?? sanitizePropertySlug(slug),
			source: 'custom',
			label: customScope?.label ?? slug
		});
	}

	return selections;
}

function primaryPropertyIdForScopes(scopes: PropertyScopeSelection[]) {
	return scopes.length === 1 && scopes[0]?.source === 'property' ? scopes[0].propertyId : undefined;
}

async function syncAnswerPropertyScopes(
	ctx: MutationCtx,
	answerId: Id<'chatAnswers'>,
	scopes: PropertyScopeSelection[],
	adminEmail: string
) {
	const existing = await ctx.db
		.query('chatAnswerPropertyScopes')
		.withIndex('by_answerId', (q) => q.eq('answerId', answerId))
		.take(100);
	for (const row of existing) {
		await ctx.db.delete(row._id);
	}

	const now = Date.now();
	for (const scope of scopes) {
		await ctx.db.insert('chatAnswerPropertyScopes', {
			propertyId: scope.propertyId,
			answerId,
			propertySlug: scope.propertySlug,
			normalizedSlug: scope.normalizedSlug,
			source: scope.source,
			createdAt: now,
			updatedAt: now,
			createdByAdminEmail: adminEmail,
			updatedByAdminEmail: adminEmail
		});
	}
}

async function getAnswerPropertyScopes(ctx: QueryCtx, answer: Doc<'chatAnswers'>) {
	const scopes = await ctx.db
		.query('chatAnswerPropertyScopes')
		.withIndex('by_answerId', (q) => q.eq('answerId', answer._id))
		.take(100);
	if (scopes.length > 0) {
		return await Promise.all(
			scopes.map(async (scope) => {
				const property = scope.propertyId ? await ctx.db.get(scope.propertyId) : null;
				return {
					...scope,
					label: property?.name ?? scope.propertySlug
				};
			})
		);
	}

	if (!answer.propertyId) return [];
	const property = await ctx.db.get(answer.propertyId);
	if (!property) return [];
	return [
		{
			_id: `${answer._id}:legacy-property-scope`,
			answerId: answer._id,
			propertyId: property._id,
			propertySlug: property.slug,
			normalizedSlug: sanitizePropertySlug(property.slug),
			source: 'property' as const,
			label: property.name,
			createdAt: answer.createdAt,
			updatedAt: answer.updatedAt
		}
	];
}

async function resolveSessionProperty(
	ctx: QueryCtx | MutationCtx,
	session: Doc<'chatSessions'> | null,
	propertySlug?: string
) {
	if (session?.propertyId) {
		return {
			propertyId: session.propertyId,
			propertySlug: session.propertySlug
		};
	}
	const slug = session?.propertySlug ?? propertySlug?.trim();
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

async function getOrCreateTopic(
	ctx: MutationCtx,
	propertyId: Id<'properties'> | undefined,
	name: string,
	description = ''
) {
	const normalizedName = normalizeTopicName(name);
	if (!normalizedName) throw new Error('Topic is required');
	const existing = await ctx.db
		.query('chatTopics')
		.withIndex('by_propertyId_and_normalizedName', (q) =>
			q.eq('propertyId', propertyId).eq('normalizedName', normalizedName)
		)
		.unique();
	if (existing) return existing._id;

	const now = Date.now();
	return await ctx.db.insert('chatTopics', {
		propertyId,
		name,
		normalizedName,
		description,
		createdAt: now,
		updatedAt: now
	});
}

async function syncAnswerTopics(
	ctx: MutationCtx,
	answerId: Id<'chatAnswers'>,
	propertyId: Id<'properties'> | undefined,
	topicNames?: string[]
) {
	if (!topicNames) return;

	const previousTopicIds = await deleteAnswerTopicLinks(ctx, answerId);
	for (const topicName of uniqueTopicNames(topicNames)) {
		const topicId = await getOrCreateTopic(ctx, propertyId, topicName);
		await ctx.db.insert('chatAnswerTopics', {
			propertyId,
			answerId,
			topicId,
			createdAt: Date.now()
		});
	}
	await deleteOrphanTopics(ctx, previousTopicIds);
}

async function deleteAnswerTopicLinks(ctx: MutationCtx, answerId: Id<'chatAnswers'>) {
	const links = await ctx.db
		.query('chatAnswerTopics')
		.withIndex('by_answerId', (q) => q.eq('answerId', answerId))
		.take(100);
	for (const link of links) await ctx.db.delete(link._id);
	return links.map((link) => link.topicId);
}

/** Topics only exist to label answers, so drop any that no answer links to anymore. */
async function deleteOrphanTopics(ctx: MutationCtx, topicIds: Id<'chatTopics'>[]) {
	for (const topicId of new Set(topicIds)) {
		const stillLinked = await ctx.db
			.query('chatAnswerTopics')
			.withIndex('by_topicId', (q) => q.eq('topicId', topicId))
			.first();
		if (!stillLinked && (await ctx.db.get(topicId))) await ctx.db.delete(topicId);
	}
}

async function reopenUnknownQuestion(ctx: MutationCtx, unknownQuestionId: Id<'chatUnknownQuestions'>) {
	await ctx.db.patch(unknownQuestionId, {
		status: 'new',
		resolvedAnswerId: undefined,
		resolvedQuestionId: undefined,
		resolvedAt: undefined,
		ignoredAt: undefined,
		updatedAt: Date.now()
	});
}

async function getAnswerTopics(ctx: QueryCtx, answerId: Id<'chatAnswers'>) {
	const joins = await ctx.db
		.query('chatAnswerTopics')
		.withIndex('by_answerId', (q) => q.eq('answerId', answerId))
		.take(50);
	const topics = await Promise.all(joins.map((join) => ctx.db.get(join.topicId)));
	return topics.filter((topic): topic is Doc<'chatTopics'> => Boolean(topic));
}

async function insertApprovedQuestion(
	ctx: MutationCtx,
	args: {
		answerId: Id<'chatAnswers'>;
		propertyId?: Id<'properties'>;
		questionText: string;
		isPrimary: boolean;
		isAiTrigger: boolean;
		adminEmail: string;
	}
) {
	const questionText = sanitizeRequiredText(args.questionText, 'Question', 240);
	const now = Date.now();
	return await ctx.db.insert('chatQuestions', {
		propertyId: args.propertyId,
		answerId: args.answerId,
		questionText,
		normalizedQuestion: normalizeQuestion(questionText),
		isPrimary: args.isPrimary,
		isAiTrigger: args.isAiTrigger,
		createdBy: 'admin',
		status: 'approved',
		createdAt: now,
		updatedAt: now,
		approvedAt: now,
		createdByAdminEmail: args.adminEmail,
		updatedByAdminEmail: args.adminEmail
	});
}

const APPROVED_QUESTIONS_LIMIT = 1000;
const OTHER_QUESTIONS_LIMIT = 100;

async function syncApprovedQuestions(
	ctx: MutationCtx,
	args: {
		answerId: Id<'chatAnswers'>;
		propertyId?: Id<'properties'>;
		questionTexts: string[];
		adminEmail: string;
		/** Approved questions the editor had loaded; only these may be deleted. Others are kept. */
		removableIds: Set<Id<'chatQuestions'>>;
	}
) {
	const desiredQuestionTexts = uniqueQuestionTexts(args.questionTexts);
	if (desiredQuestionTexts.length === 0) throw new Error('At least one approved question is required');

	const existing = await ctx.db
		.query('chatQuestions')
		.withIndex('by_answerId_and_status', (q) => q.eq('answerId', args.answerId).eq('status', 'approved'))
		.take(APPROVED_QUESTIONS_LIMIT + 1);
	if (existing.length > APPROVED_QUESTIONS_LIMIT) throw new Error('This answer has too many approved questions to edit at once');
	const approvedByNormalized = new Map<string, Doc<'chatQuestions'>>();
	for (const question of existing) {
		if (question.status !== 'approved') continue;
		if (!approvedByNormalized.has(question.normalizedQuestion)) {
			approvedByNormalized.set(question.normalizedQuestion, question);
		}
	}

	const keptQuestionIds = new Set<Id<'chatQuestions'>>();
	const now = Date.now();
	for (let index = 0; index < desiredQuestionTexts.length; index++) {
		const questionText = desiredQuestionTexts[index];
		const normalizedQuestion = normalizeQuestion(questionText);
		if (!normalizedQuestion) continue;
		const existingQuestion = approvedByNormalized.get(normalizedQuestion);
		const isPrimary = index === 0;
		if (existingQuestion) {
			keptQuestionIds.add(existingQuestion._id);
			await ctx.db.patch(existingQuestion._id, {
				propertyId: args.propertyId,
				questionText,
				normalizedQuestion,
				isPrimary,
				isAiTrigger: isPrimary,
				approvedAt: existingQuestion.approvedAt ?? now,
				rejectedAt: undefined,
				updatedAt: now,
				updatedByAdminEmail: args.adminEmail
			});
		} else {
			const questionId = await insertApprovedQuestion(ctx, {
				answerId: args.answerId,
				propertyId: args.propertyId,
				questionText,
				isPrimary,
				isAiTrigger: isPrimary,
				adminEmail: args.adminEmail
			});
			keptQuestionIds.add(questionId);
		}
	}

	for (const question of existing) {
		if (question.status !== 'approved' || keptQuestionIds.has(question._id)) continue;
		if (!args.removableIds.has(question._id)) {
			// Added (or made primary) after the editor loaded: keep it, but not as a second primary.
			if (question.isPrimary || question.isAiTrigger) {
				await ctx.db.patch(question._id, { isPrimary: false, isAiTrigger: false, updatedAt: now });
			}
			continue;
		}
		if (!(await clearQuestionReferences(ctx, question._id))) {
			await ctx.scheduler.runAfter(0, internal.chatKnowledge.clearDeletedQuestionReferences, { questionId: question._id });
		}
		await ctx.db.delete(question._id);
	}
}

const QUESTION_REFERENCE_BATCH = 100;

/**
 * Unlinks one batch of unknown questions from a variant (they stay resolved to its answer).
 * Returns true once none are left.
 */
async function clearQuestionReferences(ctx: MutationCtx, questionId: Id<'chatQuestions'>) {
	const refs = await ctx.db
		.query('chatUnknownQuestions')
		.withIndex('by_resolvedQuestionId', (q) => q.eq('resolvedQuestionId', questionId))
		.take(QUESTION_REFERENCE_BATCH + 1);
	for (const ref of refs.slice(0, QUESTION_REFERENCE_BATCH)) {
		await ctx.db.patch(ref._id, { resolvedQuestionId: undefined, updatedAt: Date.now() });
	}
	return refs.length <= QUESTION_REFERENCE_BATCH;
}

/** Continues unlinking unknown questions from a variant that was already deleted. */
export const clearDeletedQuestionReferences = internalMutation({
	args: { questionId: v.id('chatQuestions') },
	handler: async (ctx, args) => {
		if (!(await clearQuestionReferences(ctx, args.questionId))) {
			await ctx.scheduler.runAfter(0, internal.chatKnowledge.clearDeletedQuestionReferences, args);
		}
	}
});

const EXACT_MATCH_BUDGET_ERROR = 'Too many answers share this question to pick one safely.';

/** Scope rows of each answer, read once per call; matching needs no villa names. */
function scopeRowsReader(ctx: QueryCtx) {
	const cache = new Map<Id<'chatAnswers'>, Promise<Doc<'chatAnswerPropertyScopes'>[]>>();
	return (answerId: Id<'chatAnswers'>) => {
		let rows = cache.get(answerId);
		if (!rows) {
			rows = readRangeWithinBudget(
				ctx,
				ctx.db.query('chatAnswerPropertyScopes').withIndex('by_answerId', (q) => q.eq('answerId', answerId))
			);
			cache.set(answerId, rows);
		}
		return rows;
	};
}

/**
 * Approved questions worded exactly like the message that could answer for this session, ranked:
 * this villa's (by scope row, custom or real, or legacy villa id) first, then answers for every
 * villa; within a rank the AI trigger, then the primary question, then the newest. Every
 * candidate range is read in full: this villa's answers are found through their scope rows before
 * any question is read, so other villas' answers sharing the wording can't crowd them out. If the
 * ranges don't fit the read budget it throws instead of guessing.
 */
export async function getExactCandidates(
	ctx: QueryCtx,
	normalizedQuestion: string,
	propertyId?: Id<'properties'>,
	propertySlug?: string
) {
	const normalizedPropertySlug = propertySlug ? normalizePropertySlug(propertySlug) : undefined;
	const approvedWithText = (questionPropertyId: Id<'properties'> | undefined) =>
		readRangeWithinBudget(
			ctx,
			ctx.db
				.query('chatQuestions')
				.withIndex('by_status_and_normalizedQuestion_and_propertyId', (q) =>
					q.eq('status', 'approved').eq('normalizedQuestion', normalizedQuestion).eq('propertyId', questionPropertyId)
				),
			EXACT_MATCH_BUDGET_ERROR
		);

	// 1. Answers scoped to this villa (custom slug, real villa or multi-villa), however many exist.
	const [bySlug, byProperty] = await Promise.all([
		normalizedPropertySlug
			? readRangeWithinBudget(
					ctx,
					ctx.db
						.query('chatAnswerPropertyScopes')
						.withIndex('by_normalizedSlug', (q) => q.eq('normalizedSlug', normalizedPropertySlug)),
					EXACT_MATCH_BUDGET_ERROR
				)
			: Promise.resolve([]),
		propertyId
			? readRangeWithinBudget(
					ctx,
					ctx.db.query('chatAnswerPropertyScopes').withIndex('by_propertyId', (q) => q.eq('propertyId', propertyId)),
					EXACT_MATCH_BUDGET_ERROR
				)
			: Promise.resolve([])
	]);
	// One scoped answer at a time: a villa can have any number of them, and each read checks the
	// range budget before it starts, so a large set stops at the budget instead of launching every
	// read at once.
	const scopedQuestions: Doc<'chatQuestions'>[] = [];
	for (const answerId of new Set([...bySlug, ...byProperty].map((scope) => scope.answerId))) {
		scopedQuestions.push(
			...(await readRangeWithinBudget(
				ctx,
				ctx.db
					.query('chatQuestions')
					.withIndex('by_answerId_and_normalizedQuestion', (q) =>
						q.eq('answerId', answerId).eq('normalizedQuestion', normalizedQuestion)
					),
				EXACT_MATCH_BUDGET_ERROR
			))
		);
	}
	// 2. Legacy villa questions and 3. questions with no villa id (global, custom or multi-villa).
	const [villaQuestions, unscopedQuestions] = await Promise.all([
		propertyId ? approvedWithText(propertyId) : Promise.resolve([]),
		approvedWithText(undefined)
	]);
	const questions = new Map(
		[...scopedQuestions, ...villaQuestions, ...unscopedQuestions]
			.filter((question) => question.status === 'approved')
			.map((question) => [question._id, question])
	);

	const budget = readBudget(ctx);
	// Each answer is read and counted once, however many of its questions matched.
	const answers = new Map<Id<'chatAnswers'>, Doc<'chatAnswers'> | null>();
	const scopeRows = scopeRowsReader(ctx);
	const candidates: Array<{
		question: Doc<'chatQuestions'>;
		answer: Doc<'chatAnswers'>;
		scopeRank: number;
	}> = [];

	for (const question of questions.values()) {
		if (!answers.has(question.answerId)) {
			if (!budget.range()) throw new ReadBudgetExceeded(EXACT_MATCH_BUDGET_ERROR);
			const fetched = await ctx.db.get(question.answerId);
			if (!budget.document(fetched)) throw new ReadBudgetExceeded(EXACT_MATCH_BUDGET_ERROR);
			answers.set(question.answerId, fetched);
		}
		const answer = answers.get(question.answerId);
		if (!answer || answer.status !== 'approved') continue;

		const scopes = await scopeRows(answer._id);
		let scopeRank = -1;
		if (scopes.length > 0) {
			const matchesScopedProperty =
				(normalizedPropertySlug &&
					scopes.some((scope) => scope.normalizedSlug === normalizedPropertySlug)) ||
				(propertyId && scopes.some((scope) => scope.propertyId === propertyId));
			scopeRank = matchesScopedProperty ? 2 : -1;
		} else {
			const legacyPropertyId = question.propertyId ?? answer.propertyId;
			if (legacyPropertyId) {
				scopeRank = propertyId && legacyPropertyId === propertyId ? 2 : -1;
			} else {
				scopeRank = 1;
			}
		}

		if (scopeRank >= 0) candidates.push({ question, answer, scopeRank });
	}

	return candidates.sort((left, right) => {
		if (right.scopeRank !== left.scopeRank) return right.scopeRank - left.scopeRank;
		if (Number(right.question.isAiTrigger) !== Number(left.question.isAiTrigger)) {
			return Number(right.question.isAiTrigger) - Number(left.question.isAiTrigger);
		}
		if (Number(right.question.isPrimary) !== Number(left.question.isPrimary)) {
			return Number(right.question.isPrimary) - Number(left.question.isPrimary);
		}
		return right.question.updatedAt - left.question.updatedAt;
	});
}

export const resolveExact = query({
	args: {
		sessionId: v.id('chatSessions'),
		messageText: v.string()
	},
	handler: async (ctx, args) => {
		if (requiresLiveFacts(args.messageText) || capabilityReply(args.messageText)) return null;
		const normalizedQuestion = normalizeQuestion(args.messageText);
		if (!normalizedQuestion) return null;

		const session = await ctx.db.get(args.sessionId);
		if (!session) return null;
		const { propertyId, propertySlug } = await resolveSessionProperty(ctx, session);
		const candidates = await getExactCandidates(ctx, normalizedQuestion, propertyId, propertySlug);

		for (const candidate of candidates) {
			return {
				source: 'approved_exact' as const,
				answerId: candidate.answer._id,
				questionId: candidate.question._id,
				title: candidate.answer.title,
				answer: candidate.answer.answer,
				questionText: candidate.question.questionText,
				normalizedQuestion,
				propertyId: candidate.answer.propertyId,
				propertySlug
			};
		}

		return null;
	}
});

const APPROVED_CONTEXT_LIMIT = 30;
const APPROVED_CONTEXT_BUDGET_ERROR = 'Too much approved knowledge to build the AI context safely.';

/**
 * Owner-approved answers for the concierge prompt: this villa's answers first (newest first), then
 * answers for every villa, newest first, up to 30. Other villas' answers are never included.
 *
 * Nothing is capped before eligibility is known. This villa's scope rows (custom slug, real villa,
 * multi-villa) and its legacy answers are read in full; answers for every villa are read newest
 * first until 30 are found, skipping scoped ones. Every read counts against the invocation's
 * budget, checked before it starts; if the budget runs out this throws instead of returning a
 * partial context.
 */
export async function approvedContextFor(ctx: QueryCtx, session: Doc<'chatSessions'>) {
	const { propertyId, propertySlug } = await resolveSessionProperty(ctx, session);
	const normalizedSlug = propertySlug ? normalizePropertySlug(propertySlug) : undefined;
	const budget = readBudget(ctx);
	const scopeRows = scopeRowsReader(ctx);
	const readAll = <T>(range: AsyncIterable<T>) => readRangeWithinBudget(ctx, range, APPROVED_CONTEXT_BUDGET_ERROR);

	// This villa's scope rows and its legacy answers (answer.propertyId, possibly without scope rows).
	const [bySlug, byProperty, legacy] = await Promise.all([
		normalizedSlug
			? readAll(
					ctx.db
						.query('chatAnswerPropertyScopes')
						.withIndex('by_normalizedSlug', (q) => q.eq('normalizedSlug', normalizedSlug))
				)
			: Promise.resolve([]),
		propertyId
			? readAll(ctx.db.query('chatAnswerPropertyScopes').withIndex('by_propertyId', (q) => q.eq('propertyId', propertyId)))
			: Promise.resolve([]),
		propertyId
			? readAll(
					ctx.db
						.query('chatAnswers')
						.withIndex('by_propertyId_and_status_and_updatedAt', (q) =>
							q.eq('propertyId', propertyId).eq('status', 'approved')
						)
				)
			: Promise.resolve([])
	]);

	const villa = new Map<Id<'chatAnswers'>, Doc<'chatAnswers'>>();
	const legacyById = new Map(legacy.map((answer) => [answer._id, answer]));
	for (const answerId of new Set([...bySlug, ...byProperty].map((scope) => scope.answerId))) {
		// Legacy answers were already read; the rest are read one at a time within the budget.
		let answer = legacyById.get(answerId) ?? null;
		if (!answer) {
			if (!budget.range()) throw new ReadBudgetExceeded(APPROVED_CONTEXT_BUDGET_ERROR);
			answer = await ctx.db.get(answerId);
			if (!budget.document(answer)) throw new ReadBudgetExceeded(APPROVED_CONTEXT_BUDGET_ERROR);
		}
		if (answer?.status === 'approved') villa.set(answer._id, answer);
	}
	for (const answer of legacy) {
		// Answers scoped to this villa are already in; any other scope means another villa.
		if (!villa.has(answer._id) && (await scopeRows(answer._id)).length === 0) villa.set(answer._id, answer);
	}

	// Answers for every villa: no villa id and no scope rows (custom and multi-villa answers also
	// have no villa id; theirs were matched above). Newest first, stopping once 30 are found.
	const global: Doc<'chatAnswers'>[] = [];
	if (villa.size < APPROVED_CONTEXT_LIMIT) {
		if (!budget.range()) throw new ReadBudgetExceeded(APPROVED_CONTEXT_BUDGET_ERROR);
		for await (const answer of ctx.db
			.query('chatAnswers')
			.withIndex('by_propertyId_and_status_and_updatedAt', (q) =>
				q.eq('propertyId', undefined).eq('status', 'approved')
			)
			.order('desc')) {
			if (!budget.document(answer)) throw new ReadBudgetExceeded(APPROVED_CONTEXT_BUDGET_ERROR);
			if (!villa.has(answer._id) && (await scopeRows(answer._id)).length === 0) global.push(answer);
			if (villa.size + global.length >= APPROVED_CONTEXT_LIMIT) break;
		}
	}

	const byNewest = (left: Doc<'chatAnswers'>, right: Doc<'chatAnswers'>) => right.updatedAt - left.updatedAt;
	return [...[...villa.values()].sort(byNewest), ...global]
		.slice(0, APPROVED_CONTEXT_LIMIT)
		.map(({ title, answer }) => ({ title, answer }));
}

export const getApprovedContext = internalQuery({
	args: { sessionId: v.id('chatSessions') },
	handler: async (ctx, args) => {
		const session = await ctx.db.get(args.sessionId);
		return session ? await approvedContextFor(ctx, session) : [];
	}
});

export const recordUnknownQuestion = mutation({
	args: {
		sessionId: v.optional(v.id('chatSessions')),
		userQuestion: v.string(),
		detectedTopic: v.optional(v.string()),
		pageUrl: v.optional(v.string()),
		propertySlug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const userQuestion = sanitizeRequiredText(args.userQuestion, 'Question', 1000);
		const normalizedQuestion = normalizeQuestion(userQuestion);
		if (!normalizedQuestion) throw new Error('Question is required');

		const session = args.sessionId ? await ctx.db.get(args.sessionId) : null;
		const { propertyId, propertySlug } = await resolveSessionProperty(ctx, session, args.propertySlug);
		const now = Date.now();
		if (args.sessionId && session) await queueStaffAlert(ctx, args.sessionId, userQuestion);

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

export const adminListPropertyScopes = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);

		const [properties, customScopes] = await Promise.all([
			ctx.db
				.query('properties')
				.withIndex('by_status', (q) => q.eq('status', 'active'))
				.take(100),
			ctx.db.query('chatKnowledgeScopes').withIndex('by_createdAt').order('asc').take(100)
		]);

		const propertyOptions = properties.map((property) => ({
			slug: property.slug,
			normalizedSlug: sanitizePropertySlug(property.slug),
			label: property.name,
			source: 'property' as const,
			propertyId: property._id,
			canDelete: false
		}));
		const realPropertySlugs = new Set(propertyOptions.map((property) => property.normalizedSlug));
		const customOptions = await Promise.all(
			customScopes
				.filter((scope) => !realPropertySlugs.has(scope.normalizedSlug))
				.map(async (scope) => {
					const linkedAnswer = await ctx.db
						.query('chatAnswerPropertyScopes')
						.withIndex('by_normalizedSlug', (q) => q.eq('normalizedSlug', scope.normalizedSlug))
						.first();
					return {
						slug: scope.slug,
						normalizedSlug: scope.normalizedSlug,
						label: scope.label,
						source: 'custom' as const,
						canDelete: !linkedAnswer
					};
				})
		);

		return [...propertyOptions, ...customOptions].sort((left, right) => {
			if (left.source !== right.source) return left.source === 'property' ? -1 : 1;
			return left.slug.localeCompare(right.slug);
		});
	}
});

export const adminCreatePropertyScope = mutation({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const slug = sanitizePropertySlug(args.slug);
		const property = await getPropertyBySlug(ctx, slug);
		if (property) {
			return {
				slug: property.slug,
				normalizedSlug: sanitizePropertySlug(property.slug),
				label: property.name,
				source: 'property' as const,
				propertyId: property._id,
				canDelete: false
			};
		}

		const scope = await ensureCustomPropertyScope(ctx, slug, admin.email);
		const linkedAnswer = await ctx.db
			.query('chatAnswerPropertyScopes')
			.withIndex('by_normalizedSlug', (q) => q.eq('normalizedSlug', scope?.normalizedSlug ?? slug))
			.first();
		return {
			slug: scope?.slug ?? slug,
			normalizedSlug: scope?.normalizedSlug ?? slug,
			label: scope?.label ?? slug,
			source: 'custom' as const,
			canDelete: !linkedAnswer
		};
	}
});

export const adminDeletePropertyScope = mutation({
	args: { slug: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const slug = sanitizePropertySlug(args.slug);
		const property = await getPropertyBySlug(ctx, slug);
		if (property) throw new Error('Real properties cannot be deleted here');

		const scope = await getCustomScopeBySlug(ctx, slug);
		if (!scope) return { deleted: false };
		const linkedAnswer = await ctx.db
			.query('chatAnswerPropertyScopes')
			.withIndex('by_normalizedSlug', (q) => q.eq('normalizedSlug', scope.normalizedSlug))
			.first();
		if (linkedAnswer) throw new Error('Cannot delete a property scope that is linked to an answer');

		await ctx.db.delete(scope._id);
		return { deleted: true };
	}
});

const SEARCH_RESULT_LIMIT = 50;

const APPROVED_PREVIEW_LIMIT = 10;
const SUGGESTED_PREVIEW_LIMIT = 3;
const REJECTED_PREVIEW_LIMIT = 10;

function questionsByStatus(
	ctx: QueryCtx,
	answerId: Id<'chatAnswers'>,
	status: 'approved' | 'suggested' | 'rejected',
	limit: number,
	order: 'asc' | 'desc' = 'desc'
) {
	return ctx.db
		.query('chatQuestions')
		.withIndex('by_answerId_and_status', (q) => q.eq('answerId', answerId).eq('status', status))
		.order(order)
		.take(limit);
}

/**
 * A few questions of each status for the list row, the primary one always included. `truncated`
 * says a status has more than shown; the edit dialog loads them all with `adminGetAnswerDetail`.
 */
async function answerQuestionPreview(ctx: QueryCtx, answerId: Id<'chatAnswers'>) {
	const [primary, approved, suggested, rejected] = await Promise.all([
		ctx.db
			.query('chatQuestions')
			.withIndex('by_answerId_and_status_and_isPrimary', (q) =>
				q.eq('answerId', answerId).eq('status', 'approved').eq('isPrimary', true)
			)
			.first(),
		questionsByStatus(ctx, answerId, 'approved', APPROVED_PREVIEW_LIMIT + 1, 'asc'),
		questionsByStatus(ctx, answerId, 'suggested', SUGGESTED_PREVIEW_LIMIT + 1),
		questionsByStatus(ctx, answerId, 'rejected', REJECTED_PREVIEW_LIMIT + 1)
	]);
	const approvedPreview = approved.slice(0, APPROVED_PREVIEW_LIMIT);
	if (primary && !approvedPreview.some((question) => question._id === primary._id)) {
		approvedPreview.splice(APPROVED_PREVIEW_LIMIT - 1, 1, primary);
	}
	return {
		questions: [
			...approvedPreview,
			...suggested.slice(0, SUGGESTED_PREVIEW_LIMIT),
			...rejected.slice(0, REJECTED_PREVIEW_LIMIT)
		],
		questionsTruncated: {
			approved: approved.length > APPROVED_PREVIEW_LIMIT,
			suggested: suggested.length > SUGGESTED_PREVIEW_LIMIT,
			rejected: rejected.length > REJECTED_PREVIEW_LIMIT
		}
	};
}

async function answerSummary(ctx: QueryCtx, answer: Doc<'chatAnswers'>) {
	const [topics, property, propertyScopes] = await Promise.all([
		getAnswerTopics(ctx, answer._id),
		answer.propertyId ? ctx.db.get(answer.propertyId) : Promise.resolve(null),
		getAnswerPropertyScopes(ctx, answer)
	]);
	return {
		...answer,
		propertyName: property?.name,
		propertySlug: property?.slug,
		propertyScopes,
		propertySlugs: propertyScopes.map((scope) => scope.propertySlug),
		topics
	};
}

/** Title matches first, then answer-body matches. Search results are one relevance-ranked page. */
async function searchAnswers(ctx: QueryCtx, search: string, status?: AnswerStatus) {
	const [byTitle, byAnswer] = await Promise.all([
		ctx.db
			.query('chatAnswers')
			.withSearchIndex('search_title', (q) =>
				status ? q.search('title', search).eq('status', status) : q.search('title', search)
			)
			.take(SEARCH_RESULT_LIMIT),
		ctx.db
			.query('chatAnswers')
			.withSearchIndex('search_answer', (q) =>
				status ? q.search('answer', search).eq('status', status) : q.search('answer', search)
			)
			.take(SEARCH_RESULT_LIMIT)
	]);
	const seen = new Set<Id<'chatAnswers'>>();
	const merged: Doc<'chatAnswers'>[] = [];
	for (const answer of [...byTitle, ...byAnswer]) {
		if (seen.has(answer._id)) continue;
		seen.add(answer._id);
		merged.push(answer);
	}
	return merged.slice(0, SEARCH_RESULT_LIMIT);
}

export const adminListAnswers = query({
	args: {
		paginationOpts: paginationOptsValidator,
		status: v.optional(answerStatusValidator),
		search: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const search = args.search?.trim();
		const result = search
			? { page: await searchAnswers(ctx, search, args.status), isDone: true, continueCursor: '' }
			: args.status
				? await ctx.db
						.query('chatAnswers')
						.withIndex('by_status_and_updatedAt', (q) => q.eq('status', args.status as AnswerStatus))
						.order('desc')
						.paginate(args.paginationOpts)
				: await ctx.db.query('chatAnswers').withIndex('by_createdAt').order('desc').paginate(args.paginationOpts);

		// List rows carry a question preview only; loading every variant of every row was the
		// bulk of this query's reads. The edit dialog uses adminGetAnswerDetail.
		return {
			...result,
			page: await Promise.all(
				result.page.map(async (answer) => ({
					...(await answerSummary(ctx, answer)),
					...(await answerQuestionPreview(ctx, answer._id))
				}))
			)
		};
	}
});

/**
 * One answer with every approved question (up to the edit limit) for the edit dialog. The dialog
 * sends back the ids it loaded, so questions it never saw are never deleted.
 */
export const adminGetAnswerDetail = query({
	args: { answerId: v.id('chatAnswers') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const answer = await ctx.db.get(args.answerId);
		if (!answer) return null;
		const [summary, approved, suggested, rejected] = await Promise.all([
			answerSummary(ctx, answer),
			questionsByStatus(ctx, answer._id, 'approved', APPROVED_QUESTIONS_LIMIT + 1),
			questionsByStatus(ctx, answer._id, 'suggested', OTHER_QUESTIONS_LIMIT),
			questionsByStatus(ctx, answer._id, 'rejected', OTHER_QUESTIONS_LIMIT)
		]);
		return {
			...summary,
			questions: [...approved.slice(0, APPROVED_QUESTIONS_LIMIT), ...suggested, ...rejected],
			// Past the edit limit the question list can't be saved from the dialog (see syncApprovedQuestions).
			questionsEditable: approved.length <= APPROVED_QUESTIONS_LIMIT
		};
	}
});

/** Approved answers for the "link existing answer" picker. */
export const adminListAnswerOptions = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const answers = await ctx.db
			.query('chatAnswers')
			.withIndex('by_status_and_updatedAt', (q) => q.eq('status', 'approved'))
			.order('desc')
			.take(300);
		return answers
			.map((answer) => ({ _id: answer._id, title: answer.title }))
			.sort((left, right) => left.title.localeCompare(right.title));
	}
});

/** Distinct topic names for the topic picker. */
export const adminListTopics = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const topics = await ctx.db.query('chatTopics').withIndex('by_normalizedName').take(500);
		const names = new Map<string, string>();
		for (const topic of topics) {
			if (!names.has(topic.normalizedName)) names.set(topic.normalizedName, topic.name);
		}
		return [...names.values()];
	}
});

export const adminCreateAnswer = mutation({
	args: {
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		propertySlugs: v.optional(v.array(v.string())),
		title: v.string(),
		answer: v.string(),
		status: v.optional(answerStatusValidator),
		primaryQuestion: v.optional(v.string()),
		questions: v.optional(v.array(v.string())),
		topicNames: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const propertyScopes = await resolvePropertyScopeSelections(ctx, args, admin.email);
		const propertyId = primaryPropertyIdForScopes(propertyScopes);
		const title = sanitizeRequiredText(args.title, 'Title', 160);
		const answer = sanitizeRequiredText(args.answer, 'Answer', 2000);
		const status = args.status ?? 'approved';
		const now = Date.now();

		const answerId = await ctx.db.insert('chatAnswers', {
			propertyId,
			title,
			answer,
			status,
			createdAt: now,
			updatedAt: now,
			createdByAdminEmail: admin.email,
			updatedByAdminEmail: admin.email
		});

		const questionTexts = uniqueQuestionTexts([args.primaryQuestion, ...(args.questions ?? [])]);
		await syncAnswerPropertyScopes(ctx, answerId, propertyScopes, admin.email);
		await syncApprovedQuestions(ctx, {
			answerId,
			propertyId,
			questionTexts,
			adminEmail: admin.email,
			removableIds: new Set()
		});
		await syncAnswerTopics(ctx, answerId, propertyId, args.topicNames);

		return answerId;
	}
});

export const adminUpdateAnswer = mutation({
	args: {
		answerId: v.id('chatAnswers'),
		propertyId: v.optional(v.id('properties')),
		propertySlug: v.optional(v.string()),
		propertySlugs: v.optional(v.array(v.string())),
		title: v.string(),
		answer: v.string(),
		status: answerStatusValidator,
		primaryQuestion: v.optional(v.string()),
		questions: v.optional(v.array(v.string())),
		/** Required with `questions`: the approved question ids the editor loaded (adminGetAnswerDetail). */
		baseQuestionIds: v.optional(v.array(v.id('chatQuestions'))),
		topicNames: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = await ctx.db.get(args.answerId);
		if (!existing) throw new Error('Answer not found');
		const editsQuestions = args.primaryQuestion !== undefined || args.questions !== undefined;
		// An editor built from a list preview would otherwise delete every question it never loaded.
		if (editsQuestions && !args.baseQuestionIds) {
			throw new Error('Reload the page, then edit the questions again.');
		}

		const propertyScopes = await resolvePropertyScopeSelections(ctx, args, admin.email);
		const propertyId = primaryPropertyIdForScopes(propertyScopes);
		const now = Date.now();
		await ctx.db.patch(args.answerId, {
			propertyId,
			title: sanitizeRequiredText(args.title, 'Title', 160),
			answer: sanitizeRequiredText(args.answer, 'Answer', 2000),
			status: args.status,
			archivedAt: args.status === 'archived' ? existing.archivedAt ?? now : undefined,
			archivedByAdminEmail: args.status === 'archived' ? admin.email : undefined,
			updatedAt: now,
			updatedByAdminEmail: admin.email
		});

		await syncAnswerPropertyScopes(ctx, args.answerId, propertyScopes, admin.email);
		if (editsQuestions) {
			await syncApprovedQuestions(ctx, {
				answerId: args.answerId,
				propertyId,
				questionTexts: [args.primaryQuestion, ...(args.questions ?? [])].filter(
					(question): question is string => typeof question === 'string'
				),
				adminEmail: admin.email,
				removableIds: new Set(args.baseQuestionIds)
			});
		} else if (propertyId !== existing.propertyId) {
			// Questions weren't edited, but they still follow the answer's property for matching.
			const approved = await ctx.db
				.query('chatQuestions')
				.withIndex('by_answerId_and_status', (q) => q.eq('answerId', args.answerId).eq('status', 'approved'))
				.take(APPROVED_QUESTIONS_LIMIT);
			for (const question of approved) await ctx.db.patch(question._id, { propertyId, updatedAt: now });
		}
		await syncAnswerTopics(ctx, args.answerId, propertyId, args.topicNames);
		return { updated: true };
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
					const [property, answer] = await Promise.all([
						row.propertyId ? ctx.db.get(row.propertyId) : Promise.resolve(null),
						row.resolvedAnswerId ? ctx.db.get(row.resolvedAnswerId) : Promise.resolve(null)
					]);
					return {
						...row,
						propertyName: property?.name,
						propertySlug: row.propertySlug ?? property?.slug,
						resolvedAnswerTitle: answer?.title
					};
				})
			)
		};
	}
});

export const getAnswerGenerationContext = internalQuery({
	args: { answerId: v.id('chatAnswers') },
	handler: async (ctx, args): Promise<AnswerGenerationContext | null> => {
		const answer = await ctx.db.get(args.answerId);
		if (!answer) return null;
		const questions = await ctx.db
			.query('chatQuestions')
			.withIndex('by_answerId', (q) => q.eq('answerId', args.answerId))
			.take(100);
		const primaryQuestion =
			questions.find((question) => question.isPrimary && question.status === 'approved') ??
			questions.find((question) => question.status === 'approved') ??
			null;
		const topics = await getAnswerTopics(ctx, args.answerId);
		return { answer, primaryQuestion, questions, topics };
	}
});

export const storeSuggestedQuestions = internalMutation({
	args: {
		answerId: v.id('chatAnswers'),
		questions: v.array(v.string()),
		adminEmail: v.string(),
		linkUnknownQuestionId: v.optional(v.id('chatUnknownQuestions')),
		linkQuestionId: v.optional(v.id('chatQuestions'))
	},
	handler: async (ctx, args) => {
		if (args.linkUnknownQuestionId && args.linkQuestionId &&
			!(await isLinkActive(ctx, args.linkUnknownQuestionId, args.linkQuestionId))) {
			return { insertedQuestionIds: [] };
		}
		const answer = await ctx.db.get(args.answerId);
		if (!answer) throw new Error('Answer not found');

		const existing = await ctx.db
			.query('chatQuestions')
			.withIndex('by_answerId', (q) => q.eq('answerId', args.answerId))
			.take(200);
		const existingNormalized = new Set(existing.map((question) => question.normalizedQuestion));
		const now = Date.now();
		const insertedQuestionIds: Id<'chatQuestions'>[] = [];

		for (const questionText of uniqueQuestionTexts(args.questions).slice(0, 8)) {
			const normalizedQuestion = normalizeQuestion(questionText);
			if (!normalizedQuestion || existingNormalized.has(normalizedQuestion)) continue;
			existingNormalized.add(normalizedQuestion);
			const questionId = await ctx.db.insert('chatQuestions', {
				propertyId: answer.propertyId,
				answerId: args.answerId,
				questionText,
				normalizedQuestion,
				isPrimary: false,
				isAiTrigger: false,
				createdBy: 'ai',
				status: 'suggested',
				createdAt: now,
				updatedAt: now,
				updatedByAdminEmail: args.adminEmail
			});
			insertedQuestionIds.push(questionId);
		}

		return { insertedQuestionIds };
	}
});

export const createAnswerFromUnknown = internalMutation({
	args: {
		unknownQuestionId: v.id('chatUnknownQuestions'),
		title: v.string(),
		answer: v.string(),
		status: v.optional(answerStatusValidator),
		topicNames: v.optional(v.array(v.string())),
		adminEmail: v.string()
	},
	handler: async (ctx, args) => {
		const unknown = await ctx.db.get(args.unknownQuestionId);
		if (!unknown) throw new Error('Unknown question not found');
		const propertyScopes = await resolvePropertyScopeSelections(
			ctx,
			{ propertyId: unknown.propertyId, propertySlug: unknown.propertySlug },
			args.adminEmail
		);
		const propertyId = primaryPropertyIdForScopes(propertyScopes) ?? unknown.propertyId;
		const now = Date.now();
		const answerId = await ctx.db.insert('chatAnswers', {
			propertyId,
			title: sanitizeRequiredText(args.title, 'Title', 160),
			answer: sanitizeRequiredText(args.answer, 'Answer', 2000),
			status: args.status ?? 'approved',
			createdAt: now,
			updatedAt: now,
			createdByAdminEmail: args.adminEmail,
			updatedByAdminEmail: args.adminEmail
		});
		const questionId = await insertApprovedQuestion(ctx, {
			answerId,
			propertyId,
			questionText: unknown.userQuestion,
			isPrimary: true,
			isAiTrigger: true,
			adminEmail: args.adminEmail
		});
		await syncAnswerPropertyScopes(ctx, answerId, propertyScopes, args.adminEmail);
		await syncAnswerTopics(ctx, answerId, propertyId, args.topicNames);
		// Identical questions from other guests are answered by the same answer.
		const identical = await newUnknownsByNormalizedQuestion(ctx, unknown.normalizedQuestion);
		for (const row of [unknown, ...identical.filter((row) => row._id !== unknown._id)]) {
			await ctx.db.patch(row._id, {
				status: 'resolved',
				resolvedAnswerId: answerId,
				resolvedQuestionId: questionId,
				resolvedAt: now,
				updatedAt: now
			});
		}
		return { answerId, questionId };
	}
});

export const resolveUnknownWithAnswer = internalMutation({
	args: {
		unknownQuestionId: v.id('chatUnknownQuestions'),
		answerId: v.id('chatAnswers'),
		adminEmail: v.string()
	},
	handler: async (ctx, args) => {
		const [unknown, answer] = await Promise.all([
			ctx.db.get(args.unknownQuestionId),
			ctx.db.get(args.answerId)
		]);
		if (!unknown) throw new Error('Unknown question not found');
		if (!answer) throw new Error('Answer not found');
		if (answer.status === 'archived') throw new Error('Cannot link to an archived answer');

		const now = Date.now();
		const normalizedQuestion = normalizeQuestion(unknown.userQuestion);
		const existingQuestions = await ctx.db.query('chatQuestions')
			.withIndex('by_answerId_and_normalizedQuestion', (q) =>
				q.eq('answerId', args.answerId).eq('normalizedQuestion', normalizedQuestion)
			).take(20);
		const matchingQuestion = existingQuestions.find((question) =>
			question.status === 'approved'
		);
		const questionId = matchingQuestion?._id ?? await insertApprovedQuestion(ctx, {
			answerId: args.answerId,
			propertyId: answer.propertyId,
			questionText: unknown.userQuestion,
			isPrimary: false,
			isAiTrigger: false,
			adminEmail: args.adminEmail
		});
		await ctx.db.patch(args.unknownQuestionId, {
			status: 'resolved',
			resolvedAnswerId: args.answerId,
			resolvedQuestionId: questionId,
			resolvedAt: now,
			updatedAt: now
		});
		return { answerId: args.answerId, questionId };
	}
});

function extractJsonArray(value: string | null) {
	const trimmed = value?.trim();
	if (!trimmed) return null;
	if (trimmed.startsWith('[')) return trimmed;
	const match = trimmed.match(/\[[\s\S]*\]/);
	return match?.[0] ?? null;
}

function parseQuestionArray(value: string | null) {
	const json = extractJsonArray(value);
	if (!json) return [];
	try {
		const parsed = JSON.parse(json) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((item) => {
			if (typeof item === 'string') return [item];
			if (item && typeof item === 'object') {
				const row = item as Record<string, unknown>;
				return typeof row.question === 'string' ? [row.question] : [];
			}
			return [];
		});
	} catch {
		return [];
	}
}

function fallbackSimilarQuestions(context: AnswerGenerationContext, sourceQuestion?: string) {
	const title = context.answer.title;
	const question = sourceQuestion ?? context.primaryQuestion?.questionText;
	return uniqueQuestionTexts([
		question,
		`Can you tell me about ${title}?`,
		`What should I know about ${title}?`,
		`Do you have details about ${title}?`,
		`Can you explain ${title}?`
	]);
}

async function generateSimilarQuestionTexts(
	context: AnswerGenerationContext,
	sourceQuestion?: string,
	limit = 5
) {
	const apiKey = process.env.AI_API_KEY;
	if (!apiKey) return fallbackSimilarQuestions(context, sourceQuestion).slice(0, limit);

	const topics = context.topics.map((topic) => topic.name).join(', ') || 'general';
	const existingQuestions = context.questions.map((question) => question.questionText).join('\n');
	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You generate admin-reviewable alternate guest questions for an approved property chatbot answer. Return JSON only.'
		},
		{
			role: 'user',
			content: `Answer title: ${context.answer.title}
Approved answer:
${context.answer.answer}

Primary/source question:
${sourceQuestion ?? context.primaryQuestion?.questionText ?? context.answer.title}

Topics: ${topics}

Existing questions:
${existingQuestions || 'none'}

Create ${Math.min(Math.max(limit, 1), 8)} concise alternate ways a hotel/villa guest might ask for this same answer.
Rules:
- Return a JSON array of strings.
- Keep each question under 160 characters.
- Do not invent facts or add new policy details.
- Do not include answers.`
		}
	];

	const apiBase = process.env.AI_API_BASE_URL || DEFAULT_AI_API_BASE_URL;
	const model = process.env.AI_SIMPLE_MODEL || DEFAULT_AI_MODEL;
	const response = await callAI(apiBase, apiKey, model, messages, []);
	const parsed = parseQuestionArray(response.content);
	return (parsed.length > 0 ? parsed : fallbackSimilarQuestions(context, sourceQuestion)).slice(0, limit);
}

export const adminGenerateSimilarQuestions = action({
	args: {
		answerId: v.id('chatAnswers'),
		sourceQuestion: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const context: AnswerGenerationContext | null = await ctx.runQuery(
			internal.chatKnowledge.getAnswerGenerationContext,
			{ answerId: args.answerId }
		);
		if (!context) throw new Error('Answer not found');

		const questions = await generateSimilarQuestionTexts(
			context,
			args.sourceQuestion,
			Math.min(Math.max(args.limit ?? 5, 1), 8)
		);
		const result: { insertedQuestionIds: Id<'chatQuestions'>[] } = await ctx.runMutation(
			internal.chatKnowledge.storeSuggestedQuestions,
			{
				answerId: args.answerId,
				questions,
				adminEmail: admin.email
			}
		);
		return result;
	}
});

export const adminCreateAnswerFromUnknown = action({
	args: {
		unknownQuestionId: v.id('chatUnknownQuestions'),
		title: v.string(),
		answer: v.string(),
		status: v.optional(answerStatusValidator),
		topicNames: v.optional(v.array(v.string())),
		generateSimilar: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const created: { answerId: Id<'chatAnswers'>; questionId: Id<'chatQuestions'> } =
			await ctx.runMutation(internal.chatKnowledge.createAnswerFromUnknown, {
				unknownQuestionId: args.unknownQuestionId,
				title: args.title,
				answer: args.answer,
				status: args.status,
				topicNames: args.topicNames,
				adminEmail: admin.email
			});

		let insertedQuestionIds: Id<'chatQuestions'>[] = [];
		if (args.generateSimilar !== false) {
			const context: AnswerGenerationContext | null = await ctx.runQuery(
				internal.chatKnowledge.getAnswerGenerationContext,
				{ answerId: created.answerId }
			);
			if (context) {
				const questions = await generateSimilarQuestionTexts(context, context.primaryQuestion?.questionText);
				const stored: { insertedQuestionIds: Id<'chatQuestions'>[] } = await ctx.runMutation(
					internal.chatKnowledge.storeSuggestedQuestions,
					{
						answerId: created.answerId,
						questions,
						adminEmail: admin.email
					}
				);
				insertedQuestionIds = stored.insertedQuestionIds;
			}
		}

		return { ...created, suggestedQuestionIds: insertedQuestionIds };
	}
});

export const adminResolveUnknownWithAnswer = action({
	args: {
		unknownQuestionId: v.id('chatUnknownQuestions'),
		answerId: v.id('chatAnswers'),
		generateSimilar: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const resolved: { answerId: Id<'chatAnswers'>; questionId: Id<'chatQuestions'> } =
			await ctx.runMutation(internal.chatKnowledge.resolveUnknownWithAnswer, {
				unknownQuestionId: args.unknownQuestionId,
				answerId: args.answerId,
				adminEmail: admin.email
			});

		let insertedQuestionIds: Id<'chatQuestions'>[] = [];
		if (args.generateSimilar !== false) {
			const context: AnswerGenerationContext | null = await ctx.runQuery(
				internal.chatKnowledge.getAnswerGenerationContext,
				{ answerId: resolved.answerId }
			);
			if (context) {
				const questions = await generateSimilarQuestionTexts(context, context.primaryQuestion?.questionText);
				const stored: { insertedQuestionIds: Id<'chatQuestions'>[] } = await ctx.runMutation(
					internal.chatKnowledge.storeSuggestedQuestions,
					{
						answerId: resolved.answerId,
						questions,
						adminEmail: admin.email
					}
				);
				insertedQuestionIds = stored.insertedQuestionIds;
			}
		}

		return { ...resolved, suggestedQuestionIds: insertedQuestionIds };
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

const DELETE_CASCADE_BATCH = 100;

/** Unlinks one batch of unknown questions, deleting the variant once none point at it. */
async function deleteQuestionBatch(ctx: MutationCtx, questionId: Id<'chatQuestions'>) {
	if (!(await clearQuestionReferences(ctx, questionId))) return false;
	if (await ctx.db.get(questionId)) await ctx.db.delete(questionId);
	return true;
}

export const continueDeleteQuestion = internalMutation({
	args: { questionId: v.id('chatQuestions') },
	handler: async (ctx, args) => {
		if (!(await deleteQuestionBatch(ctx, args.questionId))) {
			await ctx.scheduler.runAfter(0, internal.chatKnowledge.continueDeleteQuestion, args);
		}
	}
});

async function deleteAnswerBatch(ctx: MutationCtx, answerId: Id<'chatAnswers'>) {
	const answer = await ctx.db.get(answerId);
	if (!answer || answer.status !== 'archived') return { done: true, reopened: 0 };
	let reopened = 0;
	const unknowns = await ctx.db.query('chatUnknownQuestions')
		.withIndex('by_resolvedAnswerId', (q) => q.eq('resolvedAnswerId', answerId)).take(DELETE_CASCADE_BATCH);
	for (const unknown of unknowns) { await reopenUnknownQuestion(ctx, unknown._id); reopened++; }
	if (await ctx.db.query('chatUnknownQuestions')
		.withIndex('by_resolvedAnswerId', (q) => q.eq('resolvedAnswerId', answerId)).first()) return { done: false, reopened };
	const questions = await ctx.db.query('chatQuestions')
		.withIndex('by_answerId', (q) => q.eq('answerId', answerId)).take(50);
	for (const question of questions) {
		const done = await deleteQuestionBatch(ctx, question._id);
		if (!done) return { done: false, reopened };
	}
	if (await ctx.db.query('chatQuestions').withIndex('by_answerId', (q) => q.eq('answerId', answerId)).first()) return { done: false, reopened };
	const scopes = await ctx.db.query('chatAnswerPropertyScopes')
		.withIndex('by_answerId', (q) => q.eq('answerId', answerId)).take(DELETE_CASCADE_BATCH);
	for (const scope of scopes) await ctx.db.delete(scope._id);
	if (await ctx.db.query('chatAnswerPropertyScopes').withIndex('by_answerId', (q) => q.eq('answerId', answerId)).first()) return { done: false, reopened };
	await deleteOrphanTopics(ctx, await deleteAnswerTopicLinks(ctx, answerId));
	if (await ctx.db.query('chatAnswerTopics').withIndex('by_answerId', (q) => q.eq('answerId', answerId)).first()) return { done: false, reopened };
	await ctx.db.delete(answerId);
	return { done: true, reopened };
}

export const continueDeleteAnswer = internalMutation({
	args: { answerId: v.id('chatAnswers') },
	handler: async (ctx, args) => {
		if (!(await deleteAnswerBatch(ctx, args.answerId)).done) {
			await ctx.scheduler.runAfter(0, internal.chatKnowledge.continueDeleteAnswer, args);
		}
	}
});

/** Permanently deletes an archived answer with its questions, scopes and topic links. */
export const adminDeleteAnswer = mutation({
	args: { answerId: v.id('chatAnswers') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const answer = await ctx.db.get(args.answerId);
		if (!answer) throw new Error('Answer not found');
		if (answer.status !== 'archived') throw new Error('Archive the answer before deleting it');

		const result = await deleteAnswerBatch(ctx, args.answerId);
		if (!result.done) await ctx.scheduler.runAfter(0, internal.chatKnowledge.continueDeleteAnswer, args);
		return { deleted: true, reopenedUnknownQuestions: result.reopened };
	}
});

/** Deletes one question variant. The primary question stays until another one is made primary. */
export const adminDeleteQuestion = mutation({
	args: { questionId: v.id('chatQuestions') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const question = await ctx.db.get(args.questionId);
		if (!question) throw new Error('Question not found');
		if (question.status === 'approved' && question.isPrimary) {
			throw new Error('Make another question primary before deleting this one');
		}
		if (!(await deleteQuestionBatch(ctx, args.questionId))) {
			await ctx.scheduler.runAfter(0, internal.chatKnowledge.continueDeleteQuestion, args);
		}
		return { deleted: true };
	}
});

export const adminApproveQuestion = mutation({
	args: {
		questionId: v.id('chatQuestions'),
		isPrimary: v.optional(v.boolean()),
		isAiTrigger: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const question = await ctx.db.get(args.questionId);
		if (!question) throw new Error('Question not found');
		const answer = await ctx.db.get(question.answerId);
		if (!answer) throw new Error('Answer not found');

		const now = Date.now();
		const isPrimary = args.isPrimary ?? question.isPrimary;
		const isAiTrigger = args.isAiTrigger ?? question.isAiTrigger;

		if (isPrimary || isAiTrigger) {
			const siblings = await ctx.db
				.query('chatQuestions')
				.withIndex('by_answerId', (q) => q.eq('answerId', question.answerId))
				.take(100);
			for (const sibling of siblings) {
				if (sibling._id === args.questionId) continue;
				const patch: Partial<Doc<'chatQuestions'>> = {};
				if (isPrimary && sibling.isPrimary) patch.isPrimary = false;
				if (isAiTrigger && sibling.isAiTrigger) patch.isAiTrigger = false;
				if (Object.keys(patch).length > 0) await ctx.db.patch(sibling._id, patch);
			}
		}

		await ctx.db.patch(args.questionId, {
			status: 'approved',
			isPrimary,
			isAiTrigger,
			approvedAt: now,
			rejectedAt: undefined,
			updatedAt: now,
			updatedByAdminEmail: admin.email
		});
		return { approved: true };
	}
});

export const adminRejectQuestion = mutation({
	args: { questionId: v.id('chatQuestions') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const question = await ctx.db.get(args.questionId);
		if (!question) throw new Error('Question not found');
		await ctx.db.patch(args.questionId, {
			status: 'rejected',
			isPrimary: false,
			isAiTrigger: false,
			rejectedAt: Date.now(),
			updatedAt: Date.now(),
			updatedByAdminEmail: admin.email
		});
		return { rejected: true };
	}
});

// ---------------------------------------------------------------------------
// Bulk review: grouped unknown questions, pending variant queue, answer status.
// ---------------------------------------------------------------------------

const UNKNOWN_GROUP_SCAN_LIMIT = 500;
const BULK_GROUP_LIMIT = 100;
const BULK_GROUP_ROW_LIMIT = 100;
const BULK_ID_LIMIT = 200;
const PENDING_VARIANT_LIMIT = 200;

type UnknownStatus = 'new' | 'resolved' | 'ignored';

function bulkIds<T>(ids: T[], limit = BULK_ID_LIMIT) {
	const unique = [...new Set(ids)];
	if (unique.length > limit) throw new Error(`Select ${limit} or fewer at a time`);
	return unique;
}

function groupKeys(normalizedQuestions: string[]) {
	return bulkIds(normalizedQuestions.map((key) => key.trim()).filter(Boolean), BULK_GROUP_LIMIT);
}

async function unknownsInGroup(ctx: QueryCtx, status: UnknownStatus, normalizedQuestion: string) {
	return await ctx.db
		.query('chatUnknownQuestions')
		.withIndex('by_status_and_normalizedQuestion', (q) =>
			q.eq('status', status).eq('normalizedQuestion', normalizedQuestion)
		)
		.take(BULK_GROUP_ROW_LIMIT);
}

const REMAINING_COUNT_LIMIT = 1000;

/** Rows still matching the groups after a bulk action (capped), so the UI can offer to repeat it. */
async function remainingInGroups(ctx: QueryCtx, keys: string[], statuses: UnknownStatus[]) {
	let remaining = 0;
	for (const key of keys) {
		for (const status of statuses) {
			if (remaining >= REMAINING_COUNT_LIMIT) return remaining;
			const rows = await ctx.db
				.query('chatUnknownQuestions')
				.withIndex('by_status_and_normalizedQuestion', (q) => q.eq('status', status).eq('normalizedQuestion', key))
				.take(REMAINING_COUNT_LIMIT - remaining);
			remaining += rows.length;
		}
	}
	return remaining;
}

async function newUnknownsByNormalizedQuestion(ctx: QueryCtx, normalizedQuestion: string) {
	return await unknownsInGroup(ctx, 'new', normalizedQuestion);
}

/** Approved answers plus their approved questions, for the lexical "best match" suggestion. */
async function answerMatchCandidates(ctx: QueryCtx) {
	const [answers, questions] = await Promise.all([
		ctx.db
			.query('chatAnswers')
			.withIndex('by_status_and_updatedAt', (q) => q.eq('status', 'approved'))
			.order('desc')
			.take(300),
		ctx.db
			.query('chatQuestions')
			.withIndex('by_status_and_createdAt', (q) => q.eq('status', 'approved'))
			.order('desc')
			.take(1000)
	]);
	const titles = new Map(answers.map((answer) => [answer._id, answer.title]));
	return [
		...answers.map((answer) => ({ answerId: answer._id, title: answer.title, text: answer.title })),
		...questions.flatMap((question) => {
			const title = titles.get(question.answerId);
			return title ? [{ answerId: question.answerId, title, text: question.questionText }] : [];
		})
	];
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

		const channels = new Map<Id<'chatSessions'>, Promise<string | undefined>>();
		const channelFor = (sessionId: Id<'chatSessions'>) => {
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
				const [groupChannels, property, resolvedAnswer] = await Promise.all([
					Promise.all(group.rows.map((row) => (row.sessionId ? channelFor(row.sessionId) : undefined))),
					latest.propertyId ? ctx.db.get(latest.propertyId) : Promise.resolve(null),
					latest.resolvedAnswerId ? ctx.db.get(latest.resolvedAnswerId) : Promise.resolve(null)
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
						resolvedAnswerTitle: resolvedAnswer?.title
					}
				};
			})
		);
		return { groups, truncated: rows.length === UNKNOWN_GROUP_SCAN_LIMIT };
	}
});

/**
 * Best existing answer for each listed unknown-question group (lexical match on answer titles and
 * approved questions). Separate from adminListUnknownGroups so a new guest question reruns only
 * the cheap list, not this scan of answers and questions.
 */
export const adminSuggestAnswersForUnknownGroups = query({
	args: { groups: v.array(v.object({ normalizedQuestion: v.string(), userQuestion: v.string() })) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (args.groups.length > UNKNOWN_GROUP_SCAN_LIMIT) throw new Error('Too many groups');
		if (args.groups.length === 0) return {};
		const matchAnswer = createAnswerMatcher(await answerMatchCandidates(ctx));
		const suggestions: Record<string, { answerId: Id<'chatAnswers'>; title: string; score: number }> = {};
		for (const group of args.groups) {
			const match = matchAnswer(group.userQuestion);
			if (match) {
				suggestions[group.normalizedQuestion] = {
					answerId: match.candidate.answerId,
					title: match.candidate.title,
					score: Math.round(match.score * 100)
				};
			}
		}
		return suggestions;
	}
});

/** Ignores every "new" question in the given groups. Returns the ids so the UI can undo. */
export const adminIgnoreUnknownGroups = mutation({
	args: { normalizedQuestions: v.array(v.string()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const now = Date.now();
		const unknownQuestionIds: Id<'chatUnknownQuestions'>[] = [];
		const keys = groupKeys(args.normalizedQuestions);
		for (const key of keys) {
			for (const row of await unknownsInGroup(ctx, 'new', key)) {
				await ctx.db.patch(row._id, { status: 'ignored', ignoredAt: now, updatedAt: now });
				unknownQuestionIds.push(row._id);
			}
		}
		return { ignored: unknownQuestionIds.length, unknownQuestionIds, remaining: await remainingInGroups(ctx, keys, ['new']) };
	}
});

/** Reopens resolved/ignored questions, either whole groups or specific rows (used by Undo). */
export const adminReopenUnknownGroups = mutation({
	args: {
		normalizedQuestions: v.optional(v.array(v.string())),
		unknownQuestionIds: v.optional(v.array(v.id('chatUnknownQuestions')))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const keys = groupKeys(args.normalizedQuestions ?? []);
		const rows: Doc<'chatUnknownQuestions'>[] = [];
		for (const id of bulkIds(args.unknownQuestionIds ?? [], BULK_GROUP_LIMIT * BULK_GROUP_ROW_LIMIT)) {
			const row = await ctx.db.get(id);
			if (row) rows.push(row);
		}
		for (const key of keys) {
			rows.push(...(await unknownsInGroup(ctx, 'resolved', key)), ...(await unknownsInGroup(ctx, 'ignored', key)));
		}
		const reopenedIds = new Set<Id<'chatUnknownQuestions'>>();
		for (const row of rows) {
			if (row.status === 'new' || reopenedIds.has(row._id)) continue;
			await reopenUnknownQuestion(ctx, row._id);
			reopenedIds.add(row._id);
		}
		return { reopened: reopenedIds.size, remaining: await remainingInGroups(ctx, keys, ['resolved', 'ignored']) };
	}
});

/**
 * Answers every "new" question in the given groups with one existing answer. Each group's text
 * becomes an approved question on the answer so the chatbot matches it next time.
 */
export const adminLinkUnknownGroups = mutation({
	args: {
		normalizedQuestions: v.array(v.string()),
		answerId: v.id('chatAnswers'),
		generateSimilar: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const answer = await ctx.db.get(args.answerId);
		if (!answer) throw new Error('Answer not found');
		if (answer.status === 'archived') throw new Error('Cannot link to an archived answer');

		const now = Date.now();
		const unknownQuestionIds: Id<'chatUnknownQuestions'>[] = [];
		const questionChanges: Array<{ questionId: Id<'chatQuestions'>; previousStatus: 'approved' | 'suggested' | 'rejected' | null }> = [];
		const keys = groupKeys(args.normalizedQuestions);
		for (const key of keys) {
			const rows = await unknownsInGroup(ctx, 'new', key);
			if (rows.length === 0) continue;
			const questionText = rows[0].userQuestion.slice(0, 240);
			const normalizedQuestion = normalizeQuestion(questionText);
			const existing = await ctx.db
				.query('chatQuestions')
				.withIndex('by_answerId_and_normalizedQuestion', (q) =>
					q.eq('answerId', args.answerId).eq('normalizedQuestion', normalizedQuestion)
				)
				.take(20);
			const reusable = existing.find((question) => question.status === 'approved') ?? existing[0];
			if (reusable && reusable.status !== 'approved') {
				await ctx.db.patch(reusable._id, {
					status: 'approved',
					approvedAt: now,
					rejectedAt: undefined,
					updatedAt: now,
					updatedByAdminEmail: admin.email
				});
			}
			const questionId =
				reusable?._id ??
				(await insertApprovedQuestion(ctx, {
					answerId: args.answerId,
					propertyId: answer.propertyId,
					questionText,
					isPrimary: false,
					isAiTrigger: false,
					adminEmail: admin.email
				}));
			questionChanges.push({ questionId, previousStatus: reusable?.status ?? null });
			for (const row of rows) {
				await ctx.db.patch(row._id, {
					status: 'resolved',
					resolvedAnswerId: args.answerId,
					resolvedQuestionId: questionId,
					resolvedAt: now,
					updatedAt: now
				});
				unknownQuestionIds.push(row._id);
			}
		}
		if (args.generateSimilar && unknownQuestionIds.length > 0) {
			await ctx.scheduler.runAfter(60_000, internal.chatKnowledge.generateSuggestedVariants, {
				answerId: args.answerId,
				adminEmail: admin.email,
				linkUnknownQuestionId: unknownQuestionIds[0],
				linkQuestionId: questionChanges[0].questionId
			});
		}
		return { linked: unknownQuestionIds.length, remaining: await remainingInGroups(ctx, keys, ['new']), undo: { unknownQuestionIds, questionChanges } };
	}
});

/**
 * Undo for adminLinkUnknownGroups: reopens the linked questions and reverts each variant it
 * created (deleted unless something else now points at it) or re-approved (previous status back).
 */
export const adminUndoLinkUnknownGroups = mutation({
	args: {
		unknownQuestionIds: v.array(v.id('chatUnknownQuestions')),
		questionChanges: v.array(
			v.object({
				questionId: v.id('chatQuestions'),
				previousStatus: v.union(v.literal('approved'), v.literal('suggested'), v.literal('rejected'), v.null())
			})
		)
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const changes = new Map(args.questionChanges.map((change) => [change.questionId, change.previousStatus]));
		bulkIds([...changes.keys()], BULK_GROUP_LIMIT);
		let reopened = 0;
		for (const id of bulkIds(args.unknownQuestionIds, BULK_GROUP_LIMIT * BULK_GROUP_ROW_LIMIT)) {
			const row = await ctx.db.get(id);
			if (row?.status !== 'resolved' || !row.resolvedQuestionId || !changes.has(row.resolvedQuestionId)) continue;
			await reopenUnknownQuestion(ctx, id);
			reopened++;
		}
		const now = Date.now();
		for (const [questionId, previousStatus] of changes) {
			const question = await ctx.db.get(questionId);
			if (!question || question.status !== 'approved' || previousStatus === 'approved') continue;
			if (previousStatus === null) {
				const stillUsed = await ctx.db
					.query('chatUnknownQuestions')
					.withIndex('by_resolvedQuestionId', (q) => q.eq('resolvedQuestionId', questionId))
					.first();
				if (!stillUsed && !question.isPrimary) await ctx.db.delete(questionId);
			} else {
				await ctx.db.patch(questionId, {
					status: previousStatus,
					approvedAt: undefined,
					rejectedAt: previousStatus === 'rejected' ? now : undefined,
					updatedAt: now
				});
			}
		}
		return { reopened };
	}
});

async function isLinkActive(ctx: QueryCtx | MutationCtx, unknownQuestionId: Id<'chatUnknownQuestions'>, questionId: Id<'chatQuestions'>) {
	const [unknown, question] = await Promise.all([ctx.db.get(unknownQuestionId), ctx.db.get(questionId)]);
	return unknown?.status === 'resolved' && unknown.resolvedQuestionId === questionId && question?.status === 'approved';
}

export const isLinkActiveForGeneration = internalQuery({
	args: { unknownQuestionId: v.id('chatUnknownQuestions'), questionId: v.id('chatQuestions') },
	handler: async (ctx, args) => await isLinkActive(ctx, args.unknownQuestionId, args.questionId)
});

/** Background "suggest more ways to ask" after linking; reviewed in the pending variants queue. */
export const generateSuggestedVariants = internalAction({
	args: { answerId: v.id('chatAnswers'), adminEmail: v.string(), linkUnknownQuestionId: v.id('chatUnknownQuestions'), linkQuestionId: v.id('chatQuestions') },
	handler: async (ctx, args) => {
		if (!(await ctx.runQuery(internal.chatKnowledge.isLinkActiveForGeneration, { unknownQuestionId: args.linkUnknownQuestionId, questionId: args.linkQuestionId }))) return null;
		const context: AnswerGenerationContext | null = await ctx.runQuery(
			internal.chatKnowledge.getAnswerGenerationContext,
			{ answerId: args.answerId }
		);
		if (!context) return null;
		const questions = await generateSimilarQuestionTexts(context, context.primaryQuestion?.questionText);
		await ctx.runMutation(internal.chatKnowledge.storeSuggestedQuestions, {
			answerId: args.answerId,
			questions,
			adminEmail: args.adminEmail,
			linkUnknownQuestionId: args.linkUnknownQuestionId,
			linkQuestionId: args.linkQuestionId
		});
		return null;
	}
});

/** Every AI-suggested question variant still waiting for review, across all live answers. */
export const adminListPendingVariants = query({
	args: {},
	handler: async (ctx) => {
		await requireAdmin(ctx);
		const suggested = await ctx.db
			.query('chatQuestions')
			.withIndex('by_status_and_createdAt', (q) => q.eq('status', 'suggested'))
			.order('desc')
			.take(PENDING_VARIANT_LIMIT);
		const answers = new Map<Id<'chatAnswers'>, Doc<'chatAnswers'> | null>();
		const variants = [];
		for (const question of suggested) {
			if (!answers.has(question.answerId)) answers.set(question.answerId, await ctx.db.get(question.answerId));
			const answer = answers.get(question.answerId);
			if (!answer || answer.status === 'archived') continue;
			variants.push({
				_id: question._id,
				questionText: question.questionText,
				createdAt: question.createdAt,
				answerId: answer._id,
				answerTitle: answer.title
			});
		}
		return { variants, truncated: suggested.length === PENDING_VARIANT_LIMIT };
	}
});

async function setQuestionsStatus(
	ctx: MutationCtx,
	questionIds: Id<'chatQuestions'>[],
	status: Doc<'chatQuestions'>['status'],
	adminEmail: string
) {
	const now = Date.now();
	let changed = 0;
	for (const questionId of bulkIds(questionIds)) {
		const question = await ctx.db.get(questionId);
		// The primary question is what the answer is "for"; it is never reviewed in bulk.
		if (!question || question.status === status || question.isPrimary) continue;
		await ctx.db.patch(questionId, {
			status,
			isAiTrigger: false,
			approvedAt: status === 'approved' ? now : undefined,
			rejectedAt: status === 'rejected' ? now : undefined,
			updatedAt: now,
			updatedByAdminEmail: adminEmail
		});
		changed++;
	}
	return changed;
}

export const adminApproveQuestions = mutation({
	args: { questionIds: v.array(v.id('chatQuestions')) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		return { approved: await setQuestionsStatus(ctx, args.questionIds, 'approved', admin.email) };
	}
});

export const adminRejectQuestions = mutation({
	args: { questionIds: v.array(v.id('chatQuestions')) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		return { rejected: await setQuestionsStatus(ctx, args.questionIds, 'rejected', admin.email) };
	}
});

/** Puts reviewed variants back in the pending queue (Undo for bulk approve/reject). */
export const adminUnreviewQuestions = mutation({
	args: { questionIds: v.array(v.id('chatQuestions')) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		return { reset: await setQuestionsStatus(ctx, args.questionIds, 'suggested', admin.email) };
	}
});

/** Archive or restore many answers. Returns the previous statuses so the UI can undo. */
export const adminSetAnswersStatus = mutation({
	args: { answerIds: v.array(v.id('chatAnswers')), status: answerStatusValidator },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const now = Date.now();
		const changed: { answerId: Id<'chatAnswers'>; previousStatus: AnswerStatus }[] = [];
		for (const answerId of bulkIds(args.answerIds)) {
			const answer = await ctx.db.get(answerId);
			if (!answer || answer.status === args.status) continue;
			const archived = args.status === 'archived';
			await ctx.db.patch(answerId, {
				status: args.status,
				archivedAt: archived ? now : undefined,
				archivedByAdminEmail: archived ? admin.email : undefined,
				updatedAt: now,
				updatedByAdminEmail: admin.email
			});
			changed.push({ answerId, previousStatus: answer.status });
		}
		return { changed };
	}
});
