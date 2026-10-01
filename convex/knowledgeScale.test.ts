// @vitest-environment edge-runtime
// Knowledge lookups must not lose the right answer behind a fixed number of unrelated rows.

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import migrationsTest from '@convex-dev/migrations/test';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { approvedContextFor, getExactCandidates } from './chatKnowledge';
import { exactCuratedCandidates } from './chatSuggestions';
import { normalizeSuggestedQuestion } from './lib/chatSuggestions';
import { readBudget, ReadBudgetExceeded } from './lib/readBudget';
import schema from './schema';

declare global {
	interface ImportMeta {
		glob(pattern: string): Record<string, () => Promise<unknown>>;
	}
}

const modules = import.meta.glob('./**/*.ts');
const adminEmail = 'admin@example.com';
type Tester = ReturnType<typeof convexTest>;

afterEach(() => vi.unstubAllEnvs());

function setup() {
	vi.stubEnv('ADMIN_EMAILS', adminEmail);
	const t = convexTest(schema, modules);
	return { t, admin: t.withIdentity({ email: adminEmail, tokenIdentifier: 'admin' }) };
}

const villa = {
	tagline: '',
	description: '',
	pricePerNight: 100,
	currency: 'THB',
	maxGuests: 2,
	bedrooms: 1,
	bathrooms: 1,
	area: 40,
	images: [],
	amenities: [],
	tourRoomIds: [],
	directDiscountPercent: 0,
	status: 'active' as const
};

async function property(t: Tester, slug: string) {
	return await t.run((ctx) => ctx.db.insert('properties', { ...villa, slug, name: slug }));
}

async function session(t: Tester, propertyId: Id<'properties'>, propertySlug: string) {
	return await t.run((ctx) =>
		ctx.db.insert('chatSessions', { propertyId, propertySlug, channel: 'web', createdAt: 1, lastSeenAt: 1 })
	);
}

/** An approved answer scoped to one villa, with one approved question, written the way the admin form writes it. */
async function scopedAnswer(
	t: Tester,
	args: { propertyId: Id<'properties'>; slug: string; title: string; question: string; updatedAt: number }
) {
	return await t.run(async (ctx) => {
		const base = { createdAt: args.updatedAt, updatedAt: args.updatedAt, createdByAdminEmail: adminEmail, updatedByAdminEmail: adminEmail };
		const answerId = await ctx.db.insert('chatAnswers', { ...base, propertyId: args.propertyId, title: args.title, answer: `${args.title}.`, status: 'approved' });
		await ctx.db.insert('chatAnswerPropertyScopes', {
			...base,
			answerId,
			propertyId: args.propertyId,
			propertySlug: args.slug,
			normalizedSlug: args.slug,
			source: 'property'
		});
		await ctx.db.insert('chatQuestions', {
			answerId,
			propertyId: args.propertyId,
			questionText: args.question,
			normalizedQuestion: normalizeSuggestedQuestion(args.question),
			isPrimary: true,
			isAiTrigger: true,
			createdBy: 'admin',
			status: 'approved',
			createdAt: args.updatedAt,
			updatedAt: args.updatedAt
		});
		return answerId;
	});
}

describe('approved AI context', () => {
	it("includes this villa's older answers behind 120 newer answers for another villa, and none of that villa's", async () => {
		const { t, admin } = setup();
		const pool = await property(t, 'pool-villa');
		const garden = await property(t, 'garden-villa');
		await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: 'Pool heating', question: 'Is the pool heated?', updatedAt: 1 });
		for (let i = 0; i < 120; i++) {
			await scopedAnswer(t, { propertyId: garden, slug: 'garden-villa', title: `Garden ${i}`, question: `Garden question ${i}`, updatedAt: 100 + i });
		}
		await admin.mutation(api.chatKnowledge.adminCreateAnswer, { title: 'Check-in time', answer: 'From 3pm.', primaryQuestion: 'When is check-in?' });

		const context = await t.query(internal.chatKnowledge.getApprovedContext, { sessionId: await session(t, pool, 'pool-villa') });
		expect(context.map((row) => row.title)).toEqual(['Pool heating', 'Check-in time']);
	});
});

describe('exact approved answers', () => {
	it("finds this villa's answer when 105 other villas share the same question", async () => {
		const { t } = setup();
		for (let i = 0; i < 105; i++) {
			const other = await property(t, `villa-${i}`);
			await scopedAnswer(t, { propertyId: other, slug: `villa-${i}`, title: `Wifi ${i}`, question: 'What is the wifi password?', updatedAt: i });
		}
		const pool = await property(t, 'pool-villa');
		const poolAnswer = await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: 'Pool wifi', question: 'What is the wifi password?', updatedAt: 500 });

		const match = await t.query(api.chatKnowledge.resolveExact, {
			sessionId: await session(t, pool, 'pool-villa'),
			messageText: 'What is the wifi password?'
		});
		expect(match?.answerId).toBe(poolAnswer);
	});
});

/** An approved answer with one custom scope (no real villa), its question carrying no villa id. */
async function customScopedAnswer(t: Tester, args: { slug?: string; title: string; question: string; updatedAt: number }) {
	return await t.run(async (ctx) => {
		const base = { createdAt: args.updatedAt, updatedAt: args.updatedAt, createdByAdminEmail: adminEmail, updatedByAdminEmail: adminEmail };
		const answerId = await ctx.db.insert('chatAnswers', { ...base, title: args.title, answer: `${args.title}.`, status: 'approved' });
		if (args.slug) {
			await ctx.db.insert('chatAnswerPropertyScopes', { ...base, answerId, propertySlug: args.slug, normalizedSlug: args.slug, source: 'custom' });
		}
		await ctx.db.insert('chatQuestions', {
			answerId,
			questionText: args.question,
			normalizedQuestion: normalizeSuggestedQuestion(args.question),
			isPrimary: true,
			isAiTrigger: true,
			createdBy: 'admin',
			status: 'approved',
			createdAt: args.updatedAt,
			updatedAt: args.updatedAt
		});
		return answerId;
	});
}

describe('exact approved answers with custom scopes', () => {
	it('finds the custom-scoped answer behind 102 other custom scopes sharing the wording, and keeps precedence', async () => {
		const { t } = setup();
		const ids: Id<'chatAnswers'>[] = [];
		for (let i = 0; i < 103; i++) {
			ids.push(await customScopedAnswer(t, { slug: `retreat-${i}`, title: `Pets ${i}`, question: 'Are pets allowed?', updatedAt: i }));
		}
		const global = await customScopedAnswer(t, { title: 'Pets (all villas)', question: 'Are pets allowed?', updatedAt: 1000 });
		const customSession = await t.run((ctx) =>
			ctx.db.insert('chatSessions', { propertySlug: 'retreat-102', channel: 'web', createdAt: 1, lastSeenAt: 1 })
		);
		// The villa's own answer beats the newer answer for every villa.
		expect((await t.query(api.chatKnowledge.resolveExact, { sessionId: customSession, messageText: 'Are pets allowed?' }))?.answerId).toBe(ids[102]);
		// With no villa, only the answer for every villa applies; the custom-scoped ones never leak.
		const plainSession = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'web', createdAt: 1, lastSeenAt: 1 }));
		expect((await t.query(api.chatKnowledge.resolveExact, { sessionId: plainSession, messageText: 'Are pets allowed?' }))?.answerId).toBe(global);
		const otherSession = await t.run((ctx) =>
			ctx.db.insert('chatSessions', { propertySlug: 'retreat-none', channel: 'web', createdAt: 1, lastSeenAt: 1 })
		);
		expect((await t.query(api.chatKnowledge.resolveExact, { sessionId: otherSession, messageText: 'Are pets allowed?' }))?.answerId).toBe(global);
	});
});

describe('curated exact matches', () => {
	it('matches a low-score item by translation behind 101 higher-score items', async () => {
		const { t, admin } = setup();
		for (let i = 0; i < 101; i++) {
			await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: `Popular question ${i}`, topic: 'amenities', score: 90, answer: `Answer ${i}` });
		}
		const wifi = await admin.mutation(api.chatSuggestions.adminCreateCurated, {
			question: 'Is there wifi?',
			translations: { th: 'มีไวไฟไหม' },
			topic: 'amenities',
			score: 1,
			answer: 'Yes, fast wifi.'
		});
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));

		const thai = await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'มีไวไฟไหม' });
		expect(thai?.suggestionId).toBe(wifi);
		const english = await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'is there wifi' });
		expect(english?.suggestionId).toBe(wifi);

		// Archived items stop matching, and edits move the lookup rows with the text.
		await admin.mutation(api.chatSuggestions.adminUpdateCurated, { questionId: wifi, question: 'Do you have wifi?', translations: {}, topic: 'amenities', score: 1, answer: 'Yes.' });
		expect(await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'มีไวไฟไหม' })).toBeNull();
		await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId: wifi });
		expect(await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'Do you have wifi?' })).toBeNull();
	});

	it('backfills lookup rows for items saved before they existed', async () => {
		const { t } = setup();
		const legacy = await t.run((ctx) =>
			ctx.db.insert('curatedChatQuestions', {
				question: 'Late checkout?',
				normalizedQuestion: 'late checkout',
				translations: { en: 'Late checkout?', th: 'เช็คเอาท์สายได้ไหม' },
				topic: 'booking',
				score: 1,
				status: 'active',
				createdAt: 1,
				updatedAt: 1,
				createdByAdminEmail: adminEmail,
				updatedByAdminEmail: adminEmail
			})
		);
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		migrationsTest.register(t);
		vi.useFakeTimers();
		try {
			await t.mutation(internal.migrations.run, { fn: 'migrations:backfillCuratedQuestionVariants' });
			await t.finishAllScheduledFunctions(vi.runAllTimers);
		} finally {
			vi.useRealTimers();
		}
		const rows = await t.run((ctx) => ctx.db.query('curatedChatQuestionVariants').collect());
		expect(rows.map((row) => row.normalizedVariant).sort()).toEqual(['late checkout', normalizeSuggestedQuestion('เช็คเอาท์สายได้ไหม')].sort());
		expect(rows.every((row) => row.questionId === legacy)).toBe(true);
		expect((await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'เช็คเอาท์สายได้ไหม' }))?.suggestionId).toBe(legacy);
	});
});

describe('curated exact matches during the variants rollout', () => {
	const curatedRow = {
		topic: 'amenities',
		status: 'active' as const,
		createdAt: 1,
		updatedAt: 1,
		createdByAdminEmail: adminEmail,
		updatedByAdminEmail: adminEmail
	};

	it("keeps a villa's legacy translated item ahead of a new indexed item for every villa", async () => {
		const { t, admin } = setup();
		await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: 'Is breakfast included?', translations: { th: 'มีอาหารเช้าไหม' }, topic: 'amenities', score: 99, answer: 'Global.' });
		// Saved before variant rows existed, scoped to the villa, low score.
		const legacy = await t.run((ctx) =>
			ctx.db.insert('curatedChatQuestions', {
				...curatedRow,
				question: 'Breakfast at Pool Villa?',
				normalizedQuestion: normalizeSuggestedQuestion('Breakfast at Pool Villa?'),
				translations: { en: 'Breakfast at Pool Villa?', th: 'มีอาหารเช้าไหม' },
				answer: 'Pool Villa serves breakfast.',
				answerMode: 'static',
				propertySlug: 'pool-villa',
				score: 1
			})
		);
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { propertySlug: 'pool-villa', channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		expect((await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'มีอาหารเช้าไหม' }))?.suggestionId).toBe(legacy);
	});

	it('finds the active item behind 25 archived items with the same wording', async () => {
		const { t, admin } = setup();
		for (let i = 0; i < 101; i++) {
			await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: `Popular ${i}`, topic: 'amenities', score: 90, answer: `A ${i}` });
		}
		for (let i = 0; i < 25; i++) {
			const id = await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: 'Is there a gym?', translations: { th: 'มียิมไหม' }, topic: 'amenities', score: 1, answer: 'Old.' });
			await admin.mutation(api.chatSuggestions.adminArchiveCurated, { questionId: id });
		}
		const active = await admin.mutation(api.chatSuggestions.adminCreateCurated, { question: 'Is there a gym?', translations: { th: 'มียิมไหม' }, topic: 'amenities', score: 1, answer: 'Yes.' });
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		expect((await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'มียิมไหม' }))?.suggestionId).toBe(active);
		expect((await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'Is there a gym?' }))?.suggestionId).toBe(active);
	});
});

/**
 * Wraps `ctx.db` so every `get` and index-range read is counted while in flight: `maxActive` is
 * the most reads running at once, `launched` how many were started. Only what the two exact-match
 * helpers use is wrapped (`get`, `query().withIndex()` iterated to the end).
 */
function instrument(ctx: QueryCtx) {
	const stats = { active: 0, maxActive: 0, launched: 0 };
	const start = () => {
		stats.launched++;
		stats.active++;
		stats.maxActive = Math.max(stats.maxActive, stats.active);
	};
	const db = {
		get: async (id: Id<'chatAnswers'>) => {
			start();
			try {
				return await ctx.db.get(id);
			} finally {
				stats.active--;
			}
		},
		query: (table: 'chatQuestions') => ({
			withIndex: (name: string, range?: unknown) => {
				const indexed = ctx.db.query(table) as unknown as { withIndex(name: string, range?: unknown): AsyncIterable<unknown> };
				const inner = indexed.withIndex(name, range);
				return {
					[Symbol.asyncIterator]() {
						start();
						const iterator = inner[Symbol.asyncIterator]();
						let open = true;
						const close = () => {
							if (open) stats.active--;
							open = false;
						};
						return {
							async next() {
								const step = await iterator.next();
								if (step.done) close();
								return step;
							},
							async return() {
								close();
								await iterator.return?.();
								return { done: true as const, value: undefined };
							}
						};
					}
				};
			}
		})
	};
	return { ctx: { ...ctx, db } as unknown as QueryCtx, stats };
}

describe('exact-match reads run one at a time and stop at the budget', () => {
	const RETREAT = 'retreat-concurrency';

	async function scopedAnswers(t: Tester, count: number) {
		for (let i = 0; i < count; i++) {
			await customScopedAnswer(t, { slug: RETREAT, title: `Parking ${i}`, question: 'Is there parking?', updatedAt: i });
		}
	}

	it('reads 40 scoped answers without running their reads concurrently', async () => {
		const { t } = setup();
		await scopedAnswers(t, 40);
		const { candidates, stats } = await t.run(async (raw) => {
			const { ctx, stats } = instrument(raw);
			const candidates = await getExactCandidates(ctx, normalizeSuggestedQuestion('Is there parking?'), undefined, RETREAT);
			return { candidates: candidates.length, stats };
		});
		expect(candidates).toBe(40);
		// Only the two fixed pairs of ranges run together; per-answer reads are sequential.
		expect(stats.maxActive).toBeLessThanOrEqual(2);
		expect(stats.active).toBe(0);
	});

	it('launches no scoped read once the range budget is spent', async () => {
		const { t } = setup();
		await scopedAnswers(t, 40);
		const stats = await t.run(async (raw) => {
			const { ctx, stats } = instrument(raw);
			const budget = readBudget(ctx);
			budget.ranges = budget.maxRanges - 10;
			await expect(
				getExactCandidates(ctx, normalizeSuggestedQuestion('Is there parking?'), undefined, RETREAT)
			).rejects.toThrow(ReadBudgetExceeded);
			return stats;
		});
		expect(stats.launched).toBeLessThanOrEqual(10);
		expect(stats.maxActive).toBeLessThanOrEqual(2);
	});

	it('reads curated items found by translation one at a time, and stops at the budget', async () => {
		const { t, admin } = setup();
		for (let i = 0; i < 40; i++) {
			await admin.mutation(api.chatSuggestions.adminCreateCurated, {
				question: `Parking question ${i}`,
				translations: { th: 'มีที่จอดรถไหม' },
				topic: 'amenities',
				score: 50,
				answer: `Answer ${i}`
			});
		}
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		const normalized = normalizeSuggestedQuestion('มีที่จอดรถไหม');

		const found = await t.run(async (raw) => {
			const { ctx, stats } = instrument(raw);
			const session = (await raw.db.get(sessionId))!;
			const candidates = await exactCuratedCandidates(ctx, session, normalized);
			return { count: candidates.length, stats };
		});
		expect(found.count).toBe(40);
		expect(found.stats.maxActive).toBeLessThanOrEqual(2);

		const limited = await t.run(async (raw) => {
			const { ctx, stats } = instrument(raw);
			const budget = readBudget(ctx);
			budget.ranges = budget.maxRanges - 10;
			const session = (await raw.db.get(sessionId))!;
			await expect(exactCuratedCandidates(ctx, session, normalized)).rejects.toThrow(ReadBudgetExceeded);
			return stats;
		});
		expect(limited.launched).toBeLessThanOrEqual(10);
	});
});

describe('approved AI context reads every eligible answer', () => {
	it('keeps recently updated old answers for this villa (real and multi-villa scopes) behind 201 newer-created scope rows', async () => {
		const { t } = setup();
		const pool = await property(t, 'pool-villa');
		const garden = await property(t, 'garden-villa');
		// Created first, so their scope rows are the oldest; edited last, so they are the newest answers.
		await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: 'Pool heating (edited)', question: 'Is the pool heated?', updatedAt: 10_000 });
		await t.run(async (ctx) => {
			const base = { createdAt: 1, updatedAt: 9_999, createdByAdminEmail: adminEmail, updatedByAdminEmail: adminEmail };
			const answerId = await ctx.db.insert('chatAnswers', { ...base, title: 'Shared shuttle', answer: 'Shuttle.', status: 'approved' });
			for (const [propertyId, slug] of [[pool, 'pool-villa'], [garden, 'garden-villa']] as const) {
				await ctx.db.insert('chatAnswerPropertyScopes', { ...base, answerId, propertyId, propertySlug: slug, normalizedSlug: slug, source: 'property' });
			}
		});
		for (let i = 0; i < 201; i++) {
			await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: `Pool ${i}`, question: `Pool question ${i}`, updatedAt: 100 + i });
		}
		const context = await t.query(internal.chatKnowledge.getApprovedContext, { sessionId: await session(t, pool, 'pool-villa') });
		expect(context).toHaveLength(30);
		expect(context.slice(0, 2).map((row) => row.title)).toEqual(['Pool heating (edited)', 'Shared shuttle']);
	});

	it('keeps a recently updated old custom-scoped answer behind 201 newer-created custom scope rows', async () => {
		const { t } = setup();
		await customScopedAnswer(t, { slug: 'retreat', title: 'Retreat yoga (edited)', question: 'Is there yoga?', updatedAt: 10_000 });
		for (let i = 0; i < 201; i++) {
			await customScopedAnswer(t, { slug: 'retreat', title: `Retreat ${i}`, question: `Retreat question ${i}`, updatedAt: 100 + i });
		}
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { propertySlug: 'retreat', channel: 'web', createdAt: 1, lastSeenAt: 1 }));
		const context = await t.query(internal.chatKnowledge.getApprovedContext, { sessionId });
		expect(context[0]?.title).toBe('Retreat yoga (edited)');
	});

	it('finds an older answer for every villa behind 201 newer answers scoped to other retreats', async () => {
		const { t } = setup();
		await customScopedAnswer(t, { title: 'Check-out time', question: 'When is check-out?', updatedAt: 1 });
		for (let i = 0; i < 201; i++) {
			await customScopedAnswer(t, { slug: `other-${i}`, title: `Other ${i}`, question: `Other question ${i}`, updatedAt: 100 + i });
		}
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'web', createdAt: 1, lastSeenAt: 1 }));
		expect(await t.query(internal.chatKnowledge.getApprovedContext, { sessionId })).toEqual([
			{ title: 'Check-out time', answer: 'Check-out time.' }
		]);
	});

	it('refuses rather than returning a partial context when the read budget runs out', async () => {
		const { t } = setup();
		// 20 answers for every villa of ~500 KB: fewer than 30, so all are needed, and together past the 8 MiB budget.
		await t.run(async (ctx) => {
			for (let i = 0; i < 20; i++) {
				await ctx.db.insert('chatAnswers', {
					title: `Long ${i}`,
					answer: 'x'.repeat(500_000),
					status: 'approved',
					createdAt: i,
					updatedAt: i,
					createdByAdminEmail: adminEmail,
					updatedByAdminEmail: adminEmail
				});
			}
		});
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'web', createdAt: 1, lastSeenAt: 1 }));
		await expect(t.query(internal.chatKnowledge.getApprovedContext, { sessionId })).rejects.toThrow(
			'Too much approved knowledge'
		);

		// Same with the range budget nearly spent: no partial list, and the refusal comes before reading on.
		await t.run(async (ctx) => {
			const budget = readBudget(ctx);
			budget.ranges = budget.maxRanges;
			const current = (await ctx.db.get(sessionId))!;
			await expect(approvedContextFor(ctx, current)).rejects.toThrow(ReadBudgetExceeded);
		});
	});
});
