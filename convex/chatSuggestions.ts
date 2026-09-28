import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { callAI, type ChatMessage } from './lib/chatLlm';
import { requireAdmin } from './lib/adminAuth';
import {
	clampSuggestionScore,
	getSuggestedQuestionForLocale,
	normalizeSuggestedQuestion,
	normalizeSuggestionLocale,
	supportedSuggestionLocales,
	type SuggestedQuestionTranslations
} from './lib/chatSuggestions';

const DEFAULT_LIMIT = 2;
const SCORE_ORDERED_CANDIDATE_SCAN_LIMIT = 100;
const SEMANTIC_MATCH_CONFIDENCE_THRESHOLD = 0.82;
const SEMANTIC_MATCH_CANDIDATE_LIMIT = 25;

type SuggestionTopic =
	| 'villa_fit'
	| 'direct_booking'
	| 'tour'
	| 'availability'
	| 'booking'
	| 'amenities'
	| 'contact';

type CuratedAnswerMode = 'static' | 'dynamic';

type DynamicIntent = 'availability' | 'pricing' | 'property_details' | 'booking_help' | 'contact';

type CuratedResolutionCandidate = Doc<'curatedChatQuestions'> & {
	scopeRank: number;
};

type CuratedQuestionMatch = {
	source: 'exact' | 'semantic';
	suggestionId: Id<'curatedChatQuestions'>;
	question: string;
	answer?: string;
	answerMode: CuratedAnswerMode;
	dynamicIntent?: DynamicIntent;
	topic: string;
	score: number;
	propertySlug?: string;
	confidence?: number;
};

const suggestionTopics = [
	'villa_fit',
	'direct_booking',
	'tour',
	'availability',
	'booking',
	'amenities',
	'contact'
] as const;

const dynamicIntents = [
	'availability',
	'pricing',
	'property_details',
	'booking_help',
	'contact'
] as const;

const staticSuggestionRefValidator = v.object({
	source: v.literal('static'),
	suggestionId: v.string()
});

const curatedSuggestionRefValidator = v.object({
	source: v.literal('curated'),
	suggestionId: v.id('curatedChatQuestions')
});

const suggestionRefValidator = v.union(
	staticSuggestionRefValidator,
	curatedSuggestionRefValidator
);

const answerModeValidator = v.union(v.literal('static'), v.literal('dynamic'));

const dynamicIntentValidator = v.union(
	v.literal('availability'),
	v.literal('pricing'),
	v.literal('property_details'),
	v.literal('booking_help'),
	v.literal('contact')
);

function normalizeTopic(topic: string) {
	const trimmed = topic.trim();
	return suggestionTopics.includes(trimmed as SuggestionTopic) ? trimmed : 'villa_fit';
}

function sanitizeQuestionText(question: string) {
	const trimmed = question.trim();
	if (!trimmed) throw new Error('Question is required');
	if (trimmed.length > 160) throw new Error('Question must be 160 characters or fewer');
	return trimmed;
}

function sanitizeAnswerText(answer?: string) {
	const trimmed = answer?.trim();
	if (!trimmed) return undefined;
	if (trimmed.length > 1200) throw new Error('Answer must be 1200 characters or fewer');
	return trimmed;
}

function sanitizePropertySlug(propertySlug?: string) {
	const trimmed = propertySlug?.trim();
	return trimmed || undefined;
}

function sanitizeTranslations(question: string, translations?: Record<string, string>) {
	const sanitized: SuggestedQuestionTranslations = { en: question };
	for (const locale of supportedSuggestionLocales) {
		if (locale === 'en') continue;
		const translated = translations?.[locale]?.trim();
		if (translated && translated.length <= 160) sanitized[locale] = translated;
	}
	return sanitized;
}

function sanitizeAnswerTranslations(answer?: string, translations?: Record<string, string>) {
	if (!answer) return undefined;
	const sanitized: SuggestedQuestionTranslations = { en: answer };
	for (const locale of supportedSuggestionLocales) {
		if (locale === 'en') continue;
		const translated = translations?.[locale]?.trim();
		if (translated && translated.length <= 1200) sanitized[locale] = translated;
	}
	return sanitized;
}

function normalizeAnswerMode(answerMode?: CuratedAnswerMode, answer?: string): CuratedAnswerMode {
	if (answerMode) return answerMode;
	return answer ? 'static' : 'dynamic';
}

function normalizeDynamicIntent(intent?: string, topic?: string): DynamicIntent | undefined {
	const trimmed = intent?.trim();
	if (trimmed && dynamicIntents.includes(trimmed as DynamicIntent)) {
		return trimmed as DynamicIntent;
	}
	switch (topic) {
		case 'availability':
			return 'availability';
		case 'direct_booking':
			return 'pricing';
		case 'booking':
			return 'booking_help';
		case 'contact':
			return 'contact';
		case 'amenities':
		case 'tour':
		case 'villa_fit':
			return 'property_details';
		default:
			return undefined;
	}
}

function getSuggestedAnswerForLocale(
	candidate: Pick<Doc<'curatedChatQuestions'>, 'answer' | 'answerTranslations'>,
	locale?: string
) {
	const answer = candidate.answer?.trim();
	if (!answer) return undefined;
	const normalizedLocale = normalizeSuggestionLocale(locale);
	if (normalizedLocale === 'en') return answer;
	return candidate.answerTranslations?.[normalizedLocale]?.trim() || answer;
}

function normalizeOptionalScore(score?: number) {
	return clampSuggestionScore(score ?? 50);
}

function detectMessageLocale(message: string, locale?: string) {
	if (locale) return normalizeSuggestionLocale(locale);
	return /[\u0E00-\u0E7F]/u.test(message) ? normalizeSuggestionLocale('th') : normalizeSuggestionLocale('en');
}

function curatedQuestionAnswerMode(question: Pick<Doc<'curatedChatQuestions'>, 'answerMode' | 'answer'>): CuratedAnswerMode {
	return question.answerMode ?? (question.answer ? 'static' : 'dynamic');
}

function curatedQuestionVariants(question: Doc<'curatedChatQuestions'>) {
	return [
		question.question,
		question.normalizedQuestion,
		...Object.values(question.translations ?? {})
	]
		.filter((value): value is string => typeof value === 'string')
		.map(normalizeSuggestedQuestion)
		.filter(Boolean);
}

function sortCuratedResolutionCandidates(candidates: CuratedResolutionCandidate[]) {
	return [...candidates].sort((left, right) => {
		if (right.scopeRank !== left.scopeRank) return right.scopeRank - left.scopeRank;
		if (right.score !== left.score) return right.score - left.score;
		return right.updatedAt - left.updatedAt;
	});
}

function serializeCuratedMatch(
	question: Doc<'curatedChatQuestions'>,
	source: CuratedQuestionMatch['source'],
	locale: string,
	confidence?: number
): CuratedQuestionMatch {
	const answerMode = curatedQuestionAnswerMode(question);
	return {
		source,
		suggestionId: question._id,
		question: getSuggestedQuestionForLocale(question, locale),
		...(answerMode === 'static' ? { answer: getSuggestedAnswerForLocale(question, locale) } : {}),
		answerMode,
		...(answerMode === 'dynamic' ? { dynamicIntent: question.dynamicIntent } : {}),
		topic: question.topic,
		score: question.score,
		...(question.propertySlug ? { propertySlug: question.propertySlug } : {}),
		...(typeof confidence === 'number' ? { confidence } : {})
	};
}

async function getCuratedResolutionCandidates(
	ctx: QueryCtx,
	sessionId: Id<'chatSessions'>
): Promise<CuratedResolutionCandidate[]> {
	const session = await ctx.db.get(sessionId);
	if (!session) return [];

	const [globalQuestions, propertyQuestions] = await Promise.all([
		ctx.db
			.query('curatedChatQuestions')
			.withIndex('by_status_and_propertySlug_and_score', (q) =>
				q.eq('status', 'active').eq('propertySlug', undefined)
			)
			.order('desc')
			.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT),
		session.propertySlug
			? ctx.db
					.query('curatedChatQuestions')
					.withIndex('by_status_and_propertySlug_and_score', (q) =>
						q.eq('status', 'active').eq('propertySlug', session.propertySlug)
					)
					.order('desc')
					.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT)
			: Promise.resolve([])
	]);

	return sortCuratedResolutionCandidates([
		...globalQuestions.map((question) => ({ ...question, scopeRank: 0 })),
		...propertyQuestions.map((question) => ({ ...question, scopeRank: 1 }))
	]);
}

function resolveExactCuratedMatch({
	candidates,
	locale,
	messageText
}: {
	candidates: CuratedResolutionCandidate[];
	locale: string;
	messageText: string;
}) {
	const normalizedMessage = normalizeSuggestedQuestion(messageText);
	if (!normalizedMessage) return null;

	const match = sortCuratedResolutionCandidates(candidates).find((question) =>
		curatedQuestionVariants(question).includes(normalizedMessage)
	);
	return match ? serializeCuratedMatch(match, 'exact', locale) : null;
}

function parseSemanticQuestionMatch(content: string | null) {
	if (!content) return null;
	const json = extractJsonObject(content);
	if (!json) return null;

	try {
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== 'object') return null;
		const row = parsed as Record<string, unknown>;
		const matched = row.matched === true;
		const questionId = typeof row.questionId === 'string' ? row.questionId.trim() : '';
		const confidenceValue = typeof row.confidence === 'number' ? row.confidence : Number(row.confidence);
		const confidence = Number.isFinite(confidenceValue) ? confidenceValue : 0;
		return { matched, questionId, confidence };
	} catch {
		return null;
	}
}

function extractJsonObject(value: string) {
	const trimmed = value.trim();
	if (trimmed.startsWith('{')) return trimmed;
	const match = trimmed.match(/\{[\s\S]*\}/);
	return match?.[0] ?? null;
}

function parseDraftTranslations(content: string | null) {
	if (!content) return { questionTranslations: {}, answerTranslations: {} };
	const json = extractJsonObject(content);
	if (!json) return { questionTranslations: {}, answerTranslations: {} };

	try {
		const parsed = JSON.parse(json) as unknown;
		if (!parsed || typeof parsed !== 'object') {
			return { questionTranslations: {}, answerTranslations: {} };
		}
		const row = parsed as Record<string, unknown>;
		const sanitizeTranslationRecord = (value: unknown, maxLength: number) => {
			const result: Record<string, string> = {};
			if (!value || typeof value !== 'object') return result;
			const translations = value as Record<string, unknown>;
			for (const locale of supportedSuggestionLocales) {
				if (locale === 'en') continue;
				const translated = translations[locale];
				if (typeof translated === 'string') {
					const trimmed = translated.trim();
					if (trimmed && trimmed.length <= maxLength) result[locale] = trimmed;
				}
			}
			return result;
		};
		return {
			questionTranslations: sanitizeTranslationRecord(row.questionTranslations, 160),
			answerTranslations: sanitizeTranslationRecord(row.answerTranslations, 1200)
		};
	} catch {
		return { questionTranslations: {}, answerTranslations: {} };
	}
}

export const getCuratedResolutionContext = internalQuery({
	args: {
		sessionId: v.id('chatSessions')
	},
	handler: async (ctx, args): Promise<CuratedResolutionCandidate[]> => {
		return await getCuratedResolutionCandidates(ctx, args.sessionId);
	}
});

export const resolveCuratedExact = query({
	args: {
		sessionId: v.id('chatSessions'),
		messageText: v.string(),
		locale: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<CuratedQuestionMatch | null> => {
		const messageText = args.messageText.trim();
		if (!messageText) return null;
		const locale = detectMessageLocale(messageText, args.locale);
		const candidates = await getCuratedResolutionCandidates(ctx, args.sessionId);
		return resolveExactCuratedMatch({ candidates, locale, messageText });
	}
});

export const resolveCuratedSemantic = action({
	args: {
		sessionId: v.id('chatSessions'),
		messageText: v.string(),
		locale: v.optional(v.string())
	},
	handler: async (ctx, args): Promise<CuratedQuestionMatch | null> => {
		const messageText = args.messageText.trim();
		if (!messageText) return null;

		const apiKey = process.env.AI_API_KEY;
		if (!apiKey) return null;

		const locale = detectMessageLocale(messageText, args.locale);
		const candidates: CuratedResolutionCandidate[] = await ctx.runQuery(
			internal.chatSuggestions.getCuratedResolutionContext,
			{ sessionId: args.sessionId }
		);
		const boundedCandidates = sortCuratedResolutionCandidates(candidates).slice(
			0,
			SEMANTIC_MATCH_CANDIDATE_LIMIT
		);
		if (boundedCandidates.length === 0) return null;

		const candidateLines = boundedCandidates
			.map((candidate, index) => {
				const translations = Object.entries(candidate.translations ?? {})
					.filter(([translationLocale]) => translationLocale !== 'en')
					.map(([translationLocale, value]) => `${translationLocale}: ${value}`)
					.join('; ');
				return `${index + 1}. id=${candidate._id}
question=${candidate.question}
translations=${translations || 'none'}
topic=${candidate.topic}
answerMode=${curatedQuestionAnswerMode(candidate)}
propertySlug=${candidate.propertySlug ?? 'global'}`;
			})
			.join('\n\n');

		const messages: ChatMessage[] = [
			{
				role: 'system',
				content:
					'You match a LINE guest message to one existing concierge question-bank item. Return compact JSON only.'
			},
			{
				role: 'user',
				content: `Guest message:
${messageText}

Candidate question-bank items:
${candidateLines}

Return exactly:
{
  "matched": boolean,
  "questionId": "id from candidates or empty string",
  "confidence": number
}

Rules:
- Match only when the guest is asking the same thing as a candidate question, including translated variants.
- Do not match just because topics are loosely related.
- Use confidence from 0 to 1.
- If no candidate clearly matches, return matched false and confidence 0.`
			}
		];

		const apiBase = process.env.AI_API_BASE_URL || 'https://api.x.ai/v1';
		const model = process.env.AI_SIMPLE_MODEL || 'grok-4.3';
		const response = await callAI(apiBase, apiKey, model, messages, []);
		const parsed = parseSemanticQuestionMatch(response.content);
		if (
			!parsed?.matched ||
			parsed.confidence < SEMANTIC_MATCH_CONFIDENCE_THRESHOLD ||
			!parsed.questionId
		) {
			return null;
		}

		const match = boundedCandidates.find((candidate) => candidate._id === parsed.questionId);
		return match ? serializeCuratedMatch(match, 'semantic', locale, parsed.confidence) : null;
	}
});

export const adminListCurated = query({
	args: {
		status: v.optional(v.union(v.literal('all'), v.literal('active'), v.literal('archived'))),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const limit = Math.min(Math.max(args.limit ?? 100, 1), 100);
		if (args.status && args.status !== 'all') {
			return await ctx.db
				.query('curatedChatQuestions')
				.withIndex('by_status_and_created_at', (q) => q.eq('status', args.status as 'active' | 'archived'))
				.order('desc')
				.take(limit);
		}

		return await ctx.db
			.query('curatedChatQuestions')
			.withIndex('by_created_at')
			.order('desc')
			.take(limit);
	}
});

export const adminCreateCurated = mutation({
	args: {
		question: v.string(),
		translations: v.optional(v.record(v.string(), v.string())),
		answer: v.optional(v.string()),
		answerTranslations: v.optional(v.record(v.string(), v.string())),
		answerMode: v.optional(answerModeValidator),
		dynamicIntent: v.optional(dynamicIntentValidator),
		topic: v.string(),
		score: v.optional(v.number()),
		propertySlug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const question = sanitizeQuestionText(args.question);
		const answer = sanitizeAnswerText(args.answer);
		const answerMode = normalizeAnswerMode(args.answerMode, answer);
		if (args.answerMode === 'static' && !answer) {
			throw new Error('Answer is required for static questions');
		}
		const storedAnswer = answerMode === 'static' ? answer : undefined;
		const topic = normalizeTopic(args.topic);
		const now = Date.now();
		return await ctx.db.insert('curatedChatQuestions', {
			question,
			normalizedQuestion: normalizeSuggestedQuestion(question),
			translations: sanitizeTranslations(question, args.translations),
			...(storedAnswer ? { answer: storedAnswer } : {}),
			...(storedAnswer ? { answerTranslations: sanitizeAnswerTranslations(storedAnswer, args.answerTranslations) } : {}),
			answerMode,
			...(answerMode === 'dynamic'
				? { dynamicIntent: normalizeDynamicIntent(args.dynamicIntent, topic) }
				: {}),
			propertySlug: sanitizePropertySlug(args.propertySlug),
			topic,
			score: normalizeOptionalScore(args.score),
			status: 'active',
			createdAt: now,
			updatedAt: now,
			createdByAdminEmail: admin.email,
			updatedByAdminEmail: admin.email
		});
	}
});

export const adminUpdateCurated = mutation({
	args: {
		questionId: v.id('curatedChatQuestions'),
		question: v.string(),
		translations: v.optional(v.record(v.string(), v.string())),
		answer: v.optional(v.string()),
		answerTranslations: v.optional(v.record(v.string(), v.string())),
		answerMode: v.optional(answerModeValidator),
		dynamicIntent: v.optional(dynamicIntentValidator),
		topic: v.string(),
		score: v.optional(v.number()),
		propertySlug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = await ctx.db.get(args.questionId);
		if (!existing) throw new Error('Question not found');

		const question = sanitizeQuestionText(args.question);
		const answer = sanitizeAnswerText(args.answer);
		const answerMode = normalizeAnswerMode(args.answerMode, answer);
		if (args.answerMode === 'static' && !answer) {
			throw new Error('Answer is required for static questions');
		}
		const storedAnswer = answerMode === 'static' ? answer : undefined;
		const topic = normalizeTopic(args.topic);
		await ctx.db.patch(args.questionId, {
			question,
			normalizedQuestion: normalizeSuggestedQuestion(question),
			translations: sanitizeTranslations(question, args.translations),
			answer: storedAnswer,
			answerTranslations: sanitizeAnswerTranslations(storedAnswer, args.answerTranslations),
			answerMode,
			dynamicIntent: answerMode === 'dynamic' ? normalizeDynamicIntent(args.dynamicIntent, topic) : undefined,
			propertySlug: sanitizePropertySlug(args.propertySlug),
			topic,
			score: normalizeOptionalScore(args.score),
			updatedAt: Date.now(),
			updatedByAdminEmail: admin.email
		});
		return { updated: true };
	}
});

export const adminTranslateCuratedDraft = action({
	args: {
		question: v.string(),
		answer: v.optional(v.string()),
		targetLocales: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await translateCuratedContent(
			sanitizeQuestionText(args.question),
			sanitizeAnswerText(args.answer),
			args.targetLocales
		);
	}
});

/** One LLM call that translates a question (and its fixed answer) into the target locales. */
async function translateCuratedContent(question: string, answer: string | undefined, locales?: string[]) {
	const requestedLocales = locales?.length ? locales : supportedSuggestionLocales.filter((locale) => locale !== 'en');
	const uniqueTargetLocales = Array.from(
		new Set(requestedLocales.map((locale) => normalizeSuggestionLocale(locale)).filter((locale) => locale !== 'en'))
	);
	if (uniqueTargetLocales.length === 0) {
		return { questionTranslations: {}, answerTranslations: {} };
	}

	const apiKey = process.env.AI_API_KEY;
	if (!apiKey) throw new Error('AI_API_KEY is required to translate question bank content');

	const apiBase = process.env.AI_API_BASE_URL || 'https://api.x.ai/v1';
	const model = process.env.AI_SIMPLE_MODEL || 'grok-4.3';
	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You translate admin-authored concierge question bank content. Return compact JSON only.'
		},
		{
			role: 'user',
			content: `Source language: English
Target locales: ${uniqueTargetLocales.join(', ')}
Question: ${question}
${answer ? `Answer: ${answer}` : 'Answer: '}

Return exactly this JSON shape:
{
  "questionTranslations": { "locale": "translated question" },
  "answerTranslations": { "locale": "translated answer" }
}

Rules:
- Include every target locale key.
- Keep villa names, property slugs, prices, dates, currency symbols, URLs, emails, phone numbers, WhatsApp, LINE, and booking rules factually unchanged.
- Translate only human-readable prose.
- If the answer is empty, return an empty answerTranslations object.`
		}
	];

	const response = await callAI(apiBase, apiKey, model, messages, []);
	return parseDraftTranslations(response.content);
}

const TRANSLATION_SCAN_LIMIT = 500;
const TRANSLATION_BATCH_DEFAULT = 5;
const TRANSLATION_BATCH_MAX = 10;
const TRANSLATION_LOCALES = supportedSuggestionLocales.filter((locale) => locale !== 'en');

/** Locales a curated item still lacks, for its question and (fixed) answer. */
function missingCuratedLocales(
	row: Pick<Doc<'curatedChatQuestions'>, 'answer' | 'answerMode' | 'translations' | 'answerTranslations'>
) {
	const needsAnswer = curatedQuestionAnswerMode(row) === 'static' && Boolean(row.answer);
	return TRANSLATION_LOCALES.filter(
		(locale) =>
			!row.translations?.[locale]?.trim() || (needsAnswer && !row.answerTranslations?.[locale]?.trim())
	);
}

export const listCuratedMissingTranslations = internalQuery({
	args: { limit: v.number(), skipIds: v.array(v.id('curatedChatQuestions')) },
	handler: async (ctx, args) => {
		const skip = new Set(args.skipIds);
		const rows = await ctx.db
			.query('curatedChatQuestions')
			.withIndex('by_status_and_created_at', (q) => q.eq('status', 'active'))
			.order('desc')
			.take(TRANSLATION_SCAN_LIMIT);
		const missing = rows.filter((row) => !skip.has(row._id) && missingCuratedLocales(row).length > 0);
		return {
			total: missing.length,
			batch: missing.slice(0, args.limit).map((row) => ({
				_id: row._id,
				question: row.question,
				answer: curatedQuestionAnswerMode(row) === 'static' ? row.answer : undefined,
				locales: missingCuratedLocales(row)
			}))
		};
	}
});

/** Fills only empty locales, so translations an admin wrote by hand are never overwritten. */
export const applyCuratedTranslations = internalMutation({
	args: {
		questionId: v.id('curatedChatQuestions'),
		questionTranslations: v.record(v.string(), v.string()),
		answerTranslations: v.record(v.string(), v.string()),
		adminEmail: v.string()
	},
	handler: async (ctx, args) => {
		const row = await ctx.db.get(args.questionId);
		if (!row) return { filled: 0 };
		const translations: Record<string, string> = { ...row.translations };
		const answerTranslations: Record<string, string> = { ...row.answerTranslations };
		let filled = 0;
		for (const locale of TRANSLATION_LOCALES) {
			if (!translations[locale]?.trim() && args.questionTranslations[locale]) {
				translations[locale] = args.questionTranslations[locale];
				filled++;
			}
			if (row.answer && !answerTranslations[locale]?.trim() && args.answerTranslations[locale]) {
				answerTranslations[locale] = args.answerTranslations[locale];
				filled++;
			}
		}
		if (filled === 0) return { filled };
		await ctx.db.patch(args.questionId, {
			translations: sanitizeTranslations(row.question, translations),
			...(row.answer ? { answerTranslations: sanitizeAnswerTranslations(row.answer, answerTranslations) } : {}),
			updatedAt: Date.now(),
			updatedByAdminEmail: args.adminEmail
		});
		return { filled };
	}
});

/**
 * Translates one bounded batch of active suggestions that are missing languages. The UI calls it
 * repeatedly, passing back `processedIds` as `skipIds`, until `remaining` is 0.
 */
export const adminTranslateMissingCurated = action({
	args: {
		batchSize: v.optional(v.number()),
		skipIds: v.optional(v.array(v.id('curatedChatQuestions')))
	},
	handler: async (
		ctx,
		args
	): Promise<{
		translated: number;
		failed: number;
		processedIds: Id<'curatedChatQuestions'>[];
		remaining: number;
	}> => {
		const admin = await requireAdmin(ctx);
		const limit = Math.min(Math.max(Math.round(args.batchSize ?? TRANSLATION_BATCH_DEFAULT), 1), TRANSLATION_BATCH_MAX);
		const { total, batch } = await ctx.runQuery(internal.chatSuggestions.listCuratedMissingTranslations, {
			limit,
			skipIds: args.skipIds ?? []
		});
		const results = await Promise.allSettled(
			batch.map(async (row) => {
				const translated = await translateCuratedContent(row.question, row.answer, row.locales);
				const { filled } = await ctx.runMutation(internal.chatSuggestions.applyCuratedTranslations, {
					questionId: row._id,
					...translated,
					adminEmail: admin.email
				});
				if (filled === 0) throw new Error('No translations returned');
			})
		);
		const failed = results.filter((result) => result.status === 'rejected').length;
		return {
			translated: batch.length - failed,
			failed,
			processedIds: batch.map((row) => row._id),
			remaining: Math.max(total - batch.length, 0)
		};
	}
});

/** Archive or restore many curated suggestions at once. Returns changed ids so the UI can undo. */
export const adminSetCuratedStatus = mutation({
	args: {
		questionIds: v.array(v.id('curatedChatQuestions')),
		status: v.union(v.literal('active'), v.literal('archived'))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const questionIds = [...new Set(args.questionIds)];
		if (questionIds.length > 200) throw new Error('Select 200 or fewer at a time');
		const now = Date.now();
		const changedIds: Id<'curatedChatQuestions'>[] = [];
		for (const questionId of questionIds) {
			const row = await ctx.db.get(questionId);
			if (!row || row.status === args.status) continue;
			const archived = args.status === 'archived';
			await ctx.db.patch(questionId, {
				status: args.status,
				archivedAt: archived ? now : undefined,
				archivedByAdminEmail: archived ? admin.email : undefined,
				updatedAt: now,
				updatedByAdminEmail: admin.email
			});
			changedIds.push(questionId);
		}
		return { changedIds };
	}
});

export const adminArchiveCurated = mutation({
	args: { questionId: v.id('curatedChatQuestions') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = await ctx.db.get(args.questionId);
		if (!existing) throw new Error('Question not found');

		const now = Date.now();
		await ctx.db.patch(args.questionId, {
			status: 'archived',
			archivedAt: now,
			archivedByAdminEmail: admin.email,
			updatedAt: now,
			updatedByAdminEmail: admin.email
		});
		return { archived: true };
	}
});

export const adminRestoreCurated = mutation({
	args: { questionId: v.id('curatedChatQuestions') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = await ctx.db.get(args.questionId);
		if (!existing) throw new Error('Question not found');

		await ctx.db.patch(args.questionId, {
			status: 'active',
			archivedAt: undefined,
			archivedByAdminEmail: undefined,
			updatedAt: Date.now(),
			updatedByAdminEmail: admin.email
		});
		return { restored: true };
	}
});

export const adminDeleteArchivedCurated = mutation({
	args: { questionId: v.id('curatedChatQuestions') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const existing = await ctx.db.get(args.questionId);
		if (!existing) throw new Error('Question not found');
		if (existing.status !== 'archived') {
			throw new Error('Archive the question before deleting it permanently');
		}

		await ctx.db.delete(args.questionId);
		await deleteCuratedInteractionBatch(ctx, args.questionId);
		return { deleted: true };
	}
});

const INTERACTION_DELETE_BATCH = 500;

/** Deletes one batch of a curated question's interactions and schedules the rest. */
async function deleteCuratedInteractionBatch(ctx: MutationCtx, questionId: Id<'curatedChatQuestions'>) {
	const interactions = await ctx.db
		.query('chatQuestionInteractions')
		.withIndex('by_questionId', (q) => q.eq('questionId', questionId))
		.take(INTERACTION_DELETE_BATCH);
	for (const interaction of interactions) await ctx.db.delete(interaction._id);
	if (interactions.length === INTERACTION_DELETE_BATCH) {
		await ctx.scheduler.runAfter(0, internal.chatSuggestions.deleteCuratedInteractions, { questionId });
	}
}

export const deleteCuratedInteractions = internalMutation({
	args: { questionId: v.id('curatedChatQuestions') },
	handler: async (ctx, args) => {
		await deleteCuratedInteractionBatch(ctx, args.questionId);
		return null;
	}
});

export const nextForSession = query({
	args: {
		sessionId: v.id('chatSessions'),
		candidateSuggestionIds: v.array(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), 5);
		const session = await ctx.db.get(args.sessionId);
		if (!session) return [];

		const interactions = await ctx.db
			.query('chatStaticSuggestionInteractions')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT);
		const hiddenSuggestionKeys = new Set(
			interactions
				.filter((interaction) => interaction.shownAt || interaction.clickedAt)
				.map((interaction) => interaction.suggestionKey)
		);
		const seenCandidateKeys = new Set<string>();
		const selected = [];
		for (const suggestionId of args.candidateSuggestionIds) {
			const trimmed = suggestionId.trim();
			if (!trimmed || seenCandidateKeys.has(trimmed) || hiddenSuggestionKeys.has(trimmed)) {
				continue;
			}
			seenCandidateKeys.add(trimmed);
			selected.push({ source: 'static' as const, suggestionId: trimmed });
			if (selected.length >= limit) break;
		}

		return selected;
	}
});

export const markShown = mutation({
	args: {
		sessionId: v.id('chatSessions'),
		suggestions: v.array(suggestionRefValidator)
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		let updated = 0;
		for (const suggestionRef of args.suggestions.slice(0, 5)) {
			if (suggestionRef.source === 'static') {
				const suggestionKey = suggestionRef.suggestionId.trim();
				if (!suggestionKey) continue;
				const existing = await ctx.db
					.query('chatStaticSuggestionInteractions')
					.withIndex('by_session_and_suggestionKey', (q) =>
						q.eq('sessionId', args.sessionId).eq('suggestionKey', suggestionKey)
					)
					.take(1);
				const interaction = existing[0];
				if (interaction?.shownAt) continue;
				if (interaction) {
					await ctx.db.patch(interaction._id, {
						shownAt: now,
						updatedAt: now
					});
				} else {
					await ctx.db.insert('chatStaticSuggestionInteractions', {
						sessionId: args.sessionId,
						suggestionKey,
						shownAt: now,
						createdAt: now,
						updatedAt: now
					});
				}
				updated++;
				continue;
			}

			const question = await ctx.db.get(suggestionRef.suggestionId);
			if (!question || question.status !== 'active') continue;
			const existing = await ctx.db
				.query('chatQuestionInteractions')
				.withIndex('by_session_and_question', (q) =>
					q.eq('sessionId', args.sessionId).eq('questionId', suggestionRef.suggestionId)
				)
				.unique();
			if (existing?.shownAt) continue;
			if (existing) {
				await ctx.db.patch(existing._id, { shownAt: now });
			} else {
				await ctx.db.insert('chatQuestionInteractions', {
					sessionId: args.sessionId,
					questionId: suggestionRef.suggestionId,
					shownAt: now,
					createdAt: now
				});
			}
			updated++;
		}
		return { updated };
	}
});

export const markClicked = mutation({
	args: {
		sessionId: v.id('chatSessions'),
		suggestion: suggestionRefValidator
	},
	handler: async (ctx, args) => {
		const now = Date.now();
		if (args.suggestion.source === 'static') {
			const suggestionKey = args.suggestion.suggestionId.trim();
			if (!suggestionKey) return { clicked: false };
			const existing = await ctx.db
				.query('chatStaticSuggestionInteractions')
				.withIndex('by_session_and_suggestionKey', (q) =>
					q.eq('sessionId', args.sessionId).eq('suggestionKey', suggestionKey)
				)
				.take(1);
			const interaction = existing[0];
			if (interaction) {
				await ctx.db.patch(interaction._id, {
					shownAt: interaction.shownAt ?? now,
					clickedAt: now,
					updatedAt: now
				});
			} else {
				await ctx.db.insert('chatStaticSuggestionInteractions', {
					sessionId: args.sessionId,
					suggestionKey,
					shownAt: now,
					clickedAt: now,
					createdAt: now,
					updatedAt: now
				});
			}
			return { clicked: true };
		}

		const curatedSuggestionId = args.suggestion.suggestionId;
		const question = await ctx.db.get(curatedSuggestionId);
		if (!question || question.status !== 'active') return { clicked: false };
		const existing = await ctx.db
			.query('chatQuestionInteractions')
			.withIndex('by_session_and_question', (q) =>
				q.eq('sessionId', args.sessionId).eq('questionId', curatedSuggestionId)
			)
			.unique();
		if (existing) {
			await ctx.db.patch(existing._id, {
				shownAt: existing.shownAt ?? now,
				clickedAt: now
			});
		} else {
			await ctx.db.insert('chatQuestionInteractions', {
				sessionId: args.sessionId,
				questionId: curatedSuggestionId,
				shownAt: now,
				clickedAt: now,
				createdAt: now
			});
		}
		return { clicked: true };
	}
});
