import { v } from 'convex/values';
import {
	action,
	internalMutation,
	internalQuery,
	mutation,
	query,
	type MutationCtx,
	type QueryCtx
} from './_generated/server';
import { internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { callAI, type ChatMessage } from './lib/chatLlm';
import { requireAdmin } from './lib/adminAuth';
import { normalizeSuggestedQuestion } from './lib/chatSuggestions';

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

export function asksForStaff(message: string) {
	return /\b(human|real person|live agent|staff member|representative)\b|\b(speak|talk|chat|connect|contact|reach)\b.{0,30}\b(staff|agent|host|manager|owner|someone)\b|(?:พนักงาน|เจ้าหน้าที่|คนจริง|真人客服|人工客服|担当者|직원)/iu.test(message);
}

export async function queueStaffAlert(ctx: MutationCtx, sessionId: Id<'chatSessions'>, message: string) {
	const session = await ctx.db.get(sessionId);
	if (!session) return false;
	const now = Date.now();
	if (session.lastStaffAlertAt && now - session.lastStaffAlertAt < 30 * 60 * 1000) return false;
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

	const existing = await ctx.db
		.query('chatAnswerTopics')
		.withIndex('by_answerId', (q) => q.eq('answerId', answerId))
		.take(100);
	for (const row of existing) {
		await ctx.db.delete(row._id);
	}

	for (const topicName of uniqueTopicNames(topicNames)) {
		const topicId = await getOrCreateTopic(ctx, propertyId, topicName);
		await ctx.db.insert('chatAnswerTopics', {
			propertyId,
			answerId,
			topicId,
			createdAt: Date.now()
		});
	}
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

async function syncApprovedQuestions(
	ctx: MutationCtx,
	args: {
		answerId: Id<'chatAnswers'>;
		propertyId?: Id<'properties'>;
		questionTexts: string[];
		adminEmail: string;
	}
) {
	const desiredQuestionTexts = uniqueQuestionTexts(args.questionTexts);
	if (desiredQuestionTexts.length === 0) throw new Error('At least one approved question is required');

	const existing = await ctx.db
		.query('chatQuestions')
		.withIndex('by_answerId', (q) => q.eq('answerId', args.answerId))
		.take(200);
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
		if (question.status === 'approved' && !keptQuestionIds.has(question._id)) {
			await ctx.db.delete(question._id);
		}
	}
}

async function getExactCandidates(
	ctx: QueryCtx,
	normalizedQuestion: string,
	propertyId?: Id<'properties'>,
	propertySlug?: string
) {
	const questions = await ctx.db
		.query('chatQuestions')
		.withIndex('by_status_and_normalizedQuestion', (q) =>
			q.eq('status', 'approved').eq('normalizedQuestion', normalizedQuestion)
		)
		.take(100);
	const normalizedPropertySlug = propertySlug ? normalizePropertySlug(propertySlug) : undefined;
	const candidates: Array<{
		question: Doc<'chatQuestions'>;
		answer: Doc<'chatAnswers'>;
		scopeRank: number;
	}> = [];

	for (const question of questions) {
		const answer = await ctx.db.get(question.answerId);
		if (!answer || answer.status !== 'approved') continue;

		const scopes = await getAnswerPropertyScopes(ctx, answer);
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

export const adminListAnswers = query({
	args: {
		status: v.optional(answerStatusValidator),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
		const answers = args.status
			? await ctx.db
					.query('chatAnswers')
					.withIndex('by_status_and_updatedAt', (q) => q.eq('status', args.status as AnswerStatus))
					.order('desc')
					.take(limit)
			: await ctx.db.query('chatAnswers').withIndex('by_createdAt').order('desc').take(limit);

		return await Promise.all(
			answers.map(async (answer) => {
				const [questions, topics, property] = await Promise.all([
					ctx.db
						.query('chatQuestions')
						.withIndex('by_answerId', (q) => q.eq('answerId', answer._id))
						.order('desc')
						.take(100),
					getAnswerTopics(ctx, answer._id),
					answer.propertyId ? ctx.db.get(answer.propertyId) : Promise.resolve(null)
				]);
				const propertyScopes = await getAnswerPropertyScopes(ctx, answer);
				return {
					...answer,
					propertyName: property?.name,
					propertySlug: property?.slug,
					propertyScopes,
					propertySlugs: propertyScopes.map((scope) => scope.propertySlug),
					questions,
					topics
				};
			})
		);
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
			adminEmail: admin.email
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
		topicNames: v.optional(v.array(v.string()))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const existing = await ctx.db.get(args.answerId);
		if (!existing) throw new Error('Answer not found');

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
		if (args.primaryQuestion !== undefined || args.questions !== undefined) {
			await syncApprovedQuestions(ctx, {
				answerId: args.answerId,
				propertyId,
				questionTexts: [args.primaryQuestion, ...(args.questions ?? [])].filter(
					(question): question is string => typeof question === 'string'
				),
				adminEmail: admin.email
			});
		}
		await syncAnswerTopics(ctx, args.answerId, propertyId, args.topicNames);
		return { updated: true };
	}
});

export const adminListUnknownQuestions = query({
	args: {
		status: v.optional(unknownQuestionStatusValidator),
		limit: v.optional(v.number())
	},
	handler: async (ctx, args) => {
		await requireAdmin(ctx);

		const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
		const status = args.status ?? 'new';
		const rows = status === 'all'
			? await ctx.db.query('chatUnknownQuestions').withIndex('by_createdAt').order('desc').take(limit)
			: await ctx.db
					.query('chatUnknownQuestions')
					.withIndex('by_status_and_createdAt', (q) => q.eq('status', status))
					.order('desc')
					.take(limit);

		return await Promise.all(
			rows.map(async (row) => {
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
		);
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
		adminEmail: v.string()
	},
	handler: async (ctx, args) => {
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
		await ctx.db.patch(args.unknownQuestionId, {
			status: 'resolved',
			resolvedAnswerId: answerId,
			resolvedQuestionId: questionId,
			resolvedAt: now,
			updatedAt: now
		});
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
		const questionId = await insertApprovedQuestion(ctx, {
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

	const apiBase = process.env.AI_API_BASE_URL || 'https://api.x.ai/v1';
	const model = process.env.AI_SIMPLE_MODEL || 'grok-4.3';
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
