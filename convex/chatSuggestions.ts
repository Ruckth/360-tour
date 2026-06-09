import { v } from 'convex/values';
import { internal } from './_generated/api';
import { action, internalAction, internalMutation, internalQuery, mutation, query, type QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { callAI, type ChatMessage } from './lib/chatLlm';
import { requireAdmin } from './lib/adminAuth';
import {
	clampSuggestionScore,
	getSuggestedQuestionForLocale,
	normalizeSuggestedQuestion,
	normalizeSuggestionLocale,
	selectRankedSuggestedQuestions,
	supportedSuggestionLocales,
	type SuggestedQuestionTranslations
} from './lib/chatSuggestions';

const DEFAULT_LIMIT = 2;
const GENERATION_CANDIDATE_LIMIT = 5;
const SCORE_ORDERED_CANDIDATE_SCAN_LIMIT = 100;
const HISTORY_LIMIT = 12;
const SEMANTIC_MATCH_CONFIDENCE_THRESHOLD = 0.82;
const SEMANTIC_MATCH_CANDIDATE_LIMIT = 25;
// V1 keeps the repeat check bounded to the latest session turns.
const ASKED_MESSAGE_LOOKBACK_LIMIT = 200;

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

type GenerationContext = {
	session: Doc<'chatSessions'>;
	assistantMessage: Doc<'chatMessages'>;
	userMessage: Doc<'chatMessages'> | null;
	recentMessages: Doc<'chatMessages'>[];
	property: Doc<'properties'> | null;
};

type GeneratedQuestion = {
	question: string;
	translations?: SuggestedQuestionTranslations;
	topic: string;
	score: number;
};

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

const generatedSuggestionRefValidator = v.object({
	source: v.literal('generated'),
	suggestionId: v.id('chatSuggestedQuestions')
});

const curatedSuggestionRefValidator = v.object({
	source: v.literal('curated'),
	suggestionId: v.id('curatedChatQuestions')
});

const suggestionRefValidator = v.union(
	generatedSuggestionRefValidator,
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

function curatedQuestionAnswerMode(question: Doc<'curatedChatQuestions'>): CuratedAnswerMode {
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

function detectTopic(text: string): SuggestionTopic {
	const lower = text.toLocaleLowerCase();
	if (/(available|availability|date|dates|check.?in|check.?out)/i.test(lower)) return 'availability';
	if (/(book|booking|reserve|reservation|payment|pay)/i.test(lower)) return 'booking';
	if (/(direct|discount|price|saving|ota|fee|airport pickup)/i.test(lower)) return 'direct_booking';
	if (/(360|tour|virtual|hotspot|view|see)/i.test(lower)) return 'tour';
	if (/(whatsapp|line|contact|host|message)/i.test(lower)) return 'contact';
	if (/(pool|bedroom|bathroom|amenit|breakfast|kitchen|wifi)/i.test(lower)) return 'amenities';
	return 'villa_fit';
}

function fallbackQuestionsForEnglish(topic: SuggestionTopic, propertyName?: string): GeneratedQuestion[] {
	const villaLabel = propertyName ?? 'this villa';
	const banks: Record<SuggestionTopic, GeneratedQuestion[]> = {
		villa_fit: [
			{ question: 'What is included when booking direct?', topic: 'direct_booking', score: 91 },
			{ question: 'Can I see the villa in 360?', topic: 'tour', score: 84 },
			{ question: 'Which villa is best for my dates?', topic: 'availability', score: 78 },
			{ question: 'How many guests can stay comfortably?', topic: 'amenities', score: 70 }
		],
		direct_booking: [
			{ question: 'Can I check availability for my dates?', topic: 'availability', score: 92 },
			{ question: `Can I tour ${villaLabel} before booking?`, topic: 'tour', score: 84 },
			{ question: 'Which villa gives the best value?', topic: 'villa_fit', score: 79 },
			{ question: 'How do I contact the host directly?', topic: 'contact', score: 68 }
		],
		tour: [
			{ question: 'Which villa is best for a couple?', topic: 'villa_fit', score: 89 },
			{ question: 'What is included when booking direct?', topic: 'direct_booking', score: 82 },
			{ question: 'Can I check availability for my dates?', topic: 'availability', score: 80 },
			{ question: 'What amenities are included?', topic: 'amenities', score: 72 }
		],
		availability: [
			{ question: 'Which villa should I choose for this stay?', topic: 'villa_fit', score: 91 },
			{ question: 'What is the direct booking total?', topic: 'direct_booking', score: 86 },
			{ question: 'Can I message the host on WhatsApp?', topic: 'contact', score: 73 },
			{ question: 'Can I see the villa in 360?', topic: 'tour', score: 70 }
		],
		booking: [
			{ question: 'What is included when booking direct?', topic: 'direct_booking', score: 88 },
			{ question: 'Can I check availability for my dates?', topic: 'availability', score: 84 },
			{ question: 'Can I message the host on WhatsApp?', topic: 'contact', score: 76 },
			{ question: 'Which villa fits my group best?', topic: 'villa_fit', score: 72 }
		],
		amenities: [
			{ question: 'Which villa has the best amenities for us?', topic: 'villa_fit', score: 90 },
			{ question: 'Can I see these spaces in 360?', topic: 'tour', score: 83 },
			{ question: 'What is included when booking direct?', topic: 'direct_booking', score: 76 },
			{ question: 'Can I check availability for my dates?', topic: 'availability', score: 72 }
		],
		contact: [
			{ question: 'Can I check availability for my dates?', topic: 'availability', score: 88 },
			{ question: 'What is included when booking direct?', topic: 'direct_booking', score: 82 },
			{ question: 'Which villa should I ask the host about?', topic: 'villa_fit', score: 76 },
			{ question: 'Can I see the villa in 360?', topic: 'tour', score: 68 }
		]
	};

	return banks[topic];
}

function extractJsonArray(value: string) {
	const trimmed = value.trim();
	if (trimmed.startsWith('[')) return trimmed;
	const match = trimmed.match(/\[[\s\S]*\]/);
	return match?.[0] ?? null;
}

function extractJsonObject(value: string) {
	const trimmed = value.trim();
	if (trimmed.startsWith('{')) return trimmed;
	const match = trimmed.match(/\{[\s\S]*\}/);
	return match?.[0] ?? null;
}

function parseGeneratedQuestions(content: string | null): GeneratedQuestion[] {
	if (!content) return [];
	const json = extractJsonArray(content);
	if (!json) return [];

	try {
		const parsed = JSON.parse(json) as unknown;
		if (!Array.isArray(parsed)) return [];
		return parsed.flatMap((item): GeneratedQuestion[] => {
			if (!item || typeof item !== 'object') return [];
			const row = item as Record<string, unknown>;
			const question = typeof row.question === 'string' ? row.question.trim() : '';
			const topic = typeof row.topic === 'string' ? row.topic.trim() : 'villa_fit';
			const score = typeof row.score === 'number' ? row.score : Number(row.score);
			const translations: SuggestedQuestionTranslations = {};
			if (row.translations && typeof row.translations === 'object') {
				const translationRows = row.translations as Record<string, unknown>;
				for (const locale of supportedSuggestionLocales) {
					const translated = translationRows[locale];
					if (typeof translated === 'string' && translated.trim().length > 0) {
						translations[locale] = translated.trim();
					}
				}
			}
			if (!question || question.length > 160) return [];
			return [
				{
					question,
					translations: Object.keys(translations).length > 0 ? translations : undefined,
					topic: topic || 'villa_fit',
					score: clampSuggestionScore(score)
				}
			];
		});
	} catch {
		return [];
	}
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

function sanitizeCandidates(candidates: GeneratedQuestion[]) {
	const seen = new Set<string>();
	const sanitized: GeneratedQuestion[] = [];

	for (const candidate of candidates) {
		const question = candidate.question.trim();
		const normalized = normalizeSuggestedQuestion(question);
		if (!question || !normalized || seen.has(normalized)) continue;
		seen.add(normalized);
		const translations: SuggestedQuestionTranslations = { en: question };
		for (const locale of supportedSuggestionLocales) {
			if (locale === 'en') continue;
			const translated = candidate.translations?.[locale]?.trim();
			translations[locale] = translated && translated.length <= 160 ? translated : question;
		}
		sanitized.push({
			question,
			translations,
			topic: candidate.topic.trim() || 'villa_fit',
			score: clampSuggestionScore(candidate.score)
		});
		if (sanitized.length >= GENERATION_CANDIDATE_LIMIT) break;
	}

	return sanitized;
}

async function generateQuestionsWithAi(context: GenerationContext, locale: string) {
	const apiKey = process.env.AI_API_KEY;
	if (!apiKey) return [];

	const propertyLine = context.property
		? `${context.property.name}: ${context.property.tagline}. ฿${context.property.pricePerNight}/night, ${context.property.maxGuests} guests max.`
		: 'The guest is browsing all villas.';
	const transcript = context.recentMessages
		.map((message) => `${message.role}: ${message.content}`)
		.join('\n');
	const targetLocales = supportedSuggestionLocales.join(', ');
	const messages: ChatMessage[] = [
		{
			role: 'system',
			content:
				'You generate next suggested questions for a luxury villa concierge chat. Return JSON only.'
		},
		{
			role: 'user',
			content: `Locale: ${locale}
Supported locales: ${targetLocales}
Property context: ${propertyLine}

Recent transcript:
${transcript}

Latest assistant reply:
${context.assistantMessage.content}

Create 3 to 5 concise visitor follow-up questions for the next chat chips.
Rules:
- The top-level question field must be English.
- Include a translations object with keys for every supported locale.
- translations.en must exactly match question.
- Translate only the question text. Do not translate villa names, price amounts, currency symbols, or factual rules.
- Each question must be useful after the assistant reply.
- Do not repeat a question the visitor already asked.
- Do not invent resort facts.
- Return a JSON array of objects with question, translations, topic, and score.
- topic must be one of villa_fit, direct_booking, tour, availability, booking, amenities, contact.
- score is 0-100, higher means more useful next.`
		}
	];

	const apiBase = process.env.AI_API_BASE_URL || 'https://api.x.ai/v1';
	const model = process.env.AI_SIMPLE_MODEL || 'grok-4.3';
	const response = await callAI(apiBase, apiKey, model, messages, []);
	return parseGeneratedQuestions(response.content);
}

export const getGenerationContext = internalQuery({
	args: {
		sessionId: v.id('chatSessions'),
		assistantMessageId: v.id('chatMessages'),
		userMessageId: v.optional(v.id('chatMessages'))
	},
	handler: async (ctx, args): Promise<GenerationContext | null> => {
		const [session, assistantMessage, userMessage] = await Promise.all([
			ctx.db.get(args.sessionId),
			ctx.db.get(args.assistantMessageId),
			args.userMessageId ? ctx.db.get(args.userMessageId) : Promise.resolve(null)
		]);
		if (!session || !assistantMessage || assistantMessage.role !== 'assistant') return null;

		const recentMessages = await ctx.db
			.query('chatMessages')
			.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
			.order('desc')
			.take(HISTORY_LIMIT);
		const property = session.propertyId ? await ctx.db.get(session.propertyId) : null;

		return {
			session,
			assistantMessage,
			userMessage: userMessage?.role === 'user' ? userMessage : null,
			recentMessages: recentMessages.reverse(),
			property
		};
	}
});

export const storeGenerated = internalMutation({
	args: {
		sessionId: v.id('chatSessions'),
		assistantMessageId: v.id('chatMessages'),
		userMessageId: v.optional(v.id('chatMessages')),
		locale: v.string(),
		propertySlug: v.optional(v.string()),
		candidates: v.array(
			v.object({
				question: v.string(),
				translations: v.optional(v.record(v.string(), v.string())),
				topic: v.string(),
				score: v.number()
			})
		)
	},
	handler: async (ctx, args) => {
		const existing = await ctx.db
			.query('chatSuggestedQuestions')
			.withIndex('by_session_and_assistant', (q) =>
				q.eq('sessionId', args.sessionId).eq('assistantMessageId', args.assistantMessageId)
			)
			.take(1);
		if (existing.length > 0) return { inserted: 0 };

		const now = Date.now();
		let inserted = 0;
		for (const candidate of sanitizeCandidates(args.candidates)) {
			await ctx.db.insert('chatSuggestedQuestions', {
				sessionId: args.sessionId,
				assistantMessageId: args.assistantMessageId,
				userMessageId: args.userMessageId,
				question: candidate.question,
				normalizedQuestion: normalizeSuggestedQuestion(candidate.question),
				...(candidate.translations ? { translations: candidate.translations } : {}),
				locale: args.locale,
				propertySlug: args.propertySlug,
				topic: candidate.topic,
				score: candidate.score,
				status: 'active',
				createdAt: now
			});
			inserted++;
		}

		return { inserted };
	}
});

export const generateForAssistant = internalAction({
	args: {
		sessionId: v.id('chatSessions'),
		assistantMessageId: v.id('chatMessages'),
		userMessageId: v.optional(v.id('chatMessages')),
		locale: v.optional(v.string()),
		propertySlug: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const context: GenerationContext | null = await ctx.runQuery(
			internal.chatSuggestions.getGenerationContext,
			{
				sessionId: args.sessionId,
				assistantMessageId: args.assistantMessageId,
				userMessageId: args.userMessageId
			}
		);
		if (!context) return { inserted: 0 };

		const locale = normalizeSuggestionLocale(args.locale);
		const textForTopic = `${context.userMessage?.content ?? ''} ${context.assistantMessage.content}`;
		let candidates = await generateQuestionsWithAi(context, locale).catch(() => []);
		if (candidates.length === 0 && locale === 'en') {
			candidates = fallbackQuestionsForEnglish(detectTopic(textForTopic), context.property?.name);
		}
		const sanitized = sanitizeCandidates(candidates);
		if (sanitized.length === 0) return { inserted: 0 };

		const result: { inserted: number } = await ctx.runMutation(
			internal.chatSuggestions.storeGenerated,
			{
				sessionId: args.sessionId,
				assistantMessageId: args.assistantMessageId,
				userMessageId: args.userMessageId,
				locale,
				propertySlug: args.propertySlug ?? context.session.propertySlug,
				candidates: sanitized
			}
		);
		return result;
	}
});

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
		const question = sanitizeQuestionText(args.question);
		const answer = sanitizeAnswerText(args.answer);
		const requestedLocales = args.targetLocales?.length
			? args.targetLocales
			: supportedSuggestionLocales.filter((locale) => locale !== 'en');
		const targetLocales = requestedLocales
			.map((locale) => normalizeSuggestionLocale(locale))
			.filter((locale) => locale !== 'en');
		const uniqueTargetLocales = Array.from(new Set(targetLocales));
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
		return { deleted: true };
	}
});

export const nextForSession = query({
	args: {
		sessionId: v.id('chatSessions'),
		locale: v.optional(v.string()),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		const limit = Math.min(Math.max(args.limit ?? DEFAULT_LIMIT, 1), 5);
		const locale = normalizeSuggestionLocale(args.locale);
		const session = await ctx.db.get(args.sessionId);
		if (!session) return [];

		const [activeQuestions, clickedQuestions, messages, globalCuratedQuestions, propertyCuratedQuestions, interactions] = await Promise.all([
			ctx.db
				.query('chatSuggestedQuestions')
				.withIndex('by_session_status_score', (q) =>
					q.eq('sessionId', args.sessionId).eq('status', 'active')
				)
				.order('desc')
				.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT),
			ctx.db
				.query('chatSuggestedQuestions')
				.withIndex('by_session_and_status', (q) =>
					q.eq('sessionId', args.sessionId).eq('status', 'clicked')
				)
				.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT),
			ctx.db
				.query('chatMessages')
				.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
				.order('desc')
				.take(ASKED_MESSAGE_LOOKBACK_LIMIT),
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
				: Promise.resolve([]),
			ctx.db
				.query('chatQuestionInteractions')
				.withIndex('by_session', (q) => q.eq('sessionId', args.sessionId))
				.take(SCORE_ORDERED_CANDIDATE_SCAN_LIMIT)
		]);
		const clickedCuratedIds = new Set(
			interactions
				.filter((interaction) => interaction.clickedAt)
				.map((interaction) => interaction.questionId)
		);
		const curatedQuestions = [...globalCuratedQuestions, ...propertyCuratedQuestions];

		const selected = selectRankedSuggestedQuestions({
			candidates: [
				...activeQuestions.map((question) => ({
				...question,
					_id: question._id,
					source: 'generated' as const,
					suggestionId: question._id
				})),
				...curatedQuestions.map((question) => ({
					...question,
					_id: question._id,
					source: 'curated' as const,
					suggestionId: question._id,
					status: clickedCuratedIds.has(question._id) ? ('clicked' as const) : question.status
				}))
			],
			askedQuestions: messages
				.filter((message) => message.role === 'user')
				.map((message) => message.content),
			clickedQuestions: clickedQuestions.flatMap((question) => [
				question.question,
				...Object.values(question.translations ?? {})
			]),
			limit
		});

		return selected.map((question) => {
			const isCurated = question.source === 'curated';
			const answerMode = isCurated
				? (question.answerMode ?? (question.answer ? 'static' : 'dynamic'))
				: undefined;
			return {
				...question,
				question: getSuggestedQuestionForLocale(question, locale),
				...(isCurated
					? {
							answerMode,
							answer: answerMode === 'static' ? getSuggestedAnswerForLocale(question, locale) : undefined,
							dynamicIntent: answerMode === 'dynamic' ? question.dynamicIntent : undefined
						}
					: {})
			};
		});
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
			if (suggestionRef.source === 'generated') {
				const suggestion = await ctx.db.get(suggestionRef.suggestionId);
				if (!suggestion || suggestion.sessionId !== args.sessionId || suggestion.shownAt) continue;
				await ctx.db.patch(suggestionRef.suggestionId, { shownAt: now });
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
		if (args.suggestion.source === 'generated') {
			const suggestion = await ctx.db.get(args.suggestion.suggestionId);
			if (!suggestion || suggestion.sessionId !== args.sessionId) return { clicked: false };
			await ctx.db.patch(args.suggestion.suggestionId, {
				status: 'clicked',
				clickedAt: now
			});
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

export const adminList = query({
	args: {
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
		const questions = await ctx.db
			.query('chatSuggestedQuestions')
			.withIndex('by_created_at')
			.order('desc')
			.take(limit);

		return await Promise.all(
			questions.map(async (question) => {
				const session = await ctx.db.get(question.sessionId);
				return {
					...question,
					propertySlug: question.propertySlug ?? session?.propertySlug,
					visitorId: session?.visitorId,
					currentPath: session?.currentPath
				};
			})
		);
	}
});
