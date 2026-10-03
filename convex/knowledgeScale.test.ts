// @vitest-environment edge-runtime
// The legacy saved-answer readers are retired: the public query entry points never answer, even
// at scale. The underlying scope/precedence/read-budget protections still exist as pure helpers
// (used by the live concierge retrieval), so those are exercised directly against historical rows.

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

/** A historical approved answer scoped to one villa, with one approved question (direct insert). */
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

/** A historical approved answer with one custom scope (no real villa), question carrying no villa id. */
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

/** A historical curated item + its variant lookup rows (direct insert). */
async function curatedItem(
	t: Tester,
	args: {
		question: string;
		translations?: Record<string, string>;
		answer?: string;
		answerMode?: 'static' | 'dynamic';
		topic?: string;
		score?: number;
		propertySlug?: string;
		status?: 'active' | 'archived';
	}
): Promise<Id<'curatedChatQuestions'>> {
	return await t.run(async (ctx) => {
		const now = 1;
		const translations = { en: args.question, ...(args.translations ?? {}) };
		const questionId = await ctx.db.insert('curatedChatQuestions', {
			question: args.question,
			normalizedQuestion: normalizeSuggestedQuestion(args.question),
			translations,
			...(args.answer ? { answer: args.answer } : {}),
			answerMode: args.answerMode ?? (args.answer ? 'static' : 'dynamic'),
			propertySlug: args.propertySlug,
			topic: args.topic ?? 'amenities',
			score: args.score ?? 50,
			status: args.status ?? 'active',
			createdAt: now,
			updatedAt: now,
			createdByAdminEmail: adminEmail,
			updatedByAdminEmail: adminEmail
		});
		for (const value of Object.values(translations)) {
			const normalizedVariant = normalizeSuggestedQuestion(value);
			if (!normalizedVariant) continue;
			await ctx.db.insert('curatedChatQuestionVariants', { questionId, normalizedVariant, propertySlug: args.propertySlug });
		}
		return questionId;
	});
}

describe('retired readers never answer at scale (public entry points)', () => {
	it('getApprovedContext returns nothing even with many eligible historical rows', async () => {
		const { t } = setup();
		const pool = await property(t, 'pool-villa');
		const garden = await property(t, 'garden-villa');
		await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: 'Pool heating', question: 'Is the pool heated?', updatedAt: 1 });
		for (let i = 0; i < 50; i++) {
			await scopedAnswer(t, { propertyId: garden, slug: 'garden-villa', title: `Garden ${i}`, question: `Garden question ${i}`, updatedAt: 100 + i });
		}
		expect(await t.query(internal.chatKnowledge.getApprovedContext, { sessionId: await session(t, pool, 'pool-villa') })).toEqual([]);
	});

	it("resolveExact returns null even when this villa has a historical matching answer", async () => {
		const { t } = setup();
		for (let i = 0; i < 20; i++) {
			const other = await property(t, `villa-${i}`);
			await scopedAnswer(t, { propertyId: other, slug: `villa-${i}`, title: `Wifi ${i}`, question: 'What is the wifi password?', updatedAt: i });
		}
		const pool = await property(t, 'pool-villa');
		await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: 'Pool wifi', question: 'What is the wifi password?', updatedAt: 500 });
		expect(
			await t.query(api.chatKnowledge.resolveExact, { sessionId: await session(t, pool, 'pool-villa'), messageText: 'What is the wifi password?' }),
		).toBeNull();
	});

	it('resolveCuratedExact returns null even for a historical translated item', async () => {
		const { t } = setup();
		await curatedItem(t, { question: 'Is there wifi?', translations: { th: 'มีไวไฟไหม' }, answer: 'Yes, fast wifi.', answerMode: 'static', score: 1 });
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		expect(await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'มีไวไฟไหม' })).toBeNull();
		expect(await t.query(api.chatSuggestions.resolveCuratedExact, { sessionId, messageText: 'is there wifi' })).toBeNull();
	});
});

// The pure ranking/scope/budget helpers remain live (the concierge retrieval still relies on the
// same read-budget machinery), so their protections are exercised directly against historical rows.
describe('exact-answer helper keeps scope precedence at scale', () => {
	it("finds this villa's answer when 105 other villas share the same question", async () => {
		const { t } = setup();
		for (let i = 0; i < 105; i++) {
			const other = await property(t, `villa-${i}`);
			await scopedAnswer(t, { propertyId: other, slug: `villa-${i}`, title: `Wifi ${i}`, question: 'What is the wifi password?', updatedAt: i });
		}
		const pool = await property(t, 'pool-villa');
		const poolAnswer = await scopedAnswer(t, { propertyId: pool, slug: 'pool-villa', title: 'Pool wifi', question: 'What is the wifi password?', updatedAt: 500 });

		const candidates = await t.run((ctx) =>
			getExactCandidates(ctx, normalizeSuggestedQuestion('What is the wifi password?'), pool, 'pool-villa'),
		);
		expect(candidates[0]?.answer._id).toBe(poolAnswer);
	});

	it('finds the custom-scoped answer behind 102 other custom scopes sharing the wording, and keeps precedence', async () => {
		const { t } = setup();
		const ids: Id<'chatAnswers'>[] = [];
		for (let i = 0; i < 103; i++) {
			ids.push(await customScopedAnswer(t, { slug: `retreat-${i}`, title: `Pets ${i}`, question: 'Are pets allowed?', updatedAt: i }));
		}
		const global = await customScopedAnswer(t, { title: 'Pets (all villas)', question: 'Are pets allowed?', updatedAt: 1000 });
		const normalized = normalizeSuggestedQuestion('Are pets allowed?');

		// The villa's own answer beats the newer answer for every villa.
		expect((await t.run((ctx) => getExactCandidates(ctx, normalized, undefined, 'retreat-102')))[0]?.answer._id).toBe(ids[102]);
		// With no villa, only the answer for every villa applies; the custom-scoped ones never leak.
		expect((await t.run((ctx) => getExactCandidates(ctx, normalized, undefined, undefined)))[0]?.answer._id).toBe(global);
		expect((await t.run((ctx) => getExactCandidates(ctx, normalized, undefined, 'retreat-none')))[0]?.answer._id).toBe(global);
	});
});

describe('curated exact helper keeps precedence at scale', () => {
	it('matches a low-score item by translation behind 101 higher-score items', async () => {
		const { t } = setup();
		for (let i = 0; i < 101; i++) {
			await curatedItem(t, { question: `Popular question ${i}`, topic: 'amenities', score: 90, answer: `Answer ${i}` });
		}
		const wifi = await curatedItem(t, { question: 'Is there wifi?', translations: { th: 'มีไวไฟไหม' }, topic: 'amenities', score: 1, answer: 'Yes, fast wifi.' });
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));

		const thai = await t.run(async (ctx) => {
			const s = (await ctx.db.get(sessionId))!;
			return await exactCuratedCandidates(ctx, s, normalizeSuggestedQuestion('มีไวไฟไหม'));
		});
		expect(thai.map((row) => row._id)).toContain(wifi);
	});

	it("keeps a villa's legacy translated item ahead of a new indexed item for every villa", async () => {
		const { t } = setup();
		await curatedItem(t, { question: 'Is breakfast included?', translations: { th: 'มีอาหารเช้าไหม' }, topic: 'amenities', score: 99, answer: 'Global.' });
		const legacy = await curatedItem(t, {
			question: 'Breakfast at Pool Villa?',
			translations: { th: 'มีอาหารเช้าไหม' },
			answer: 'Pool Villa serves breakfast.',
			answerMode: 'static',
			propertySlug: 'pool-villa',
			score: 1
		});
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { propertySlug: 'pool-villa', channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		const candidates = await t.run(async (ctx) => {
			const s = (await ctx.db.get(sessionId))!;
			return await exactCuratedCandidates(ctx, s, normalizeSuggestedQuestion('มีอาหารเช้าไหม'));
		});
		// The villa-scoped item ranks ahead of the global one.
		const sorted = candidates.sort((a, b) => b.scopeRank - a.scopeRank);
		expect(sorted[0]?._id).toBe(legacy);
	});

	it('finds the active item behind 25 archived items with the same wording', async () => {
		const { t } = setup();
		for (let i = 0; i < 25; i++) {
			await curatedItem(t, { question: 'Is there a gym?', translations: { th: 'มียิมไหม' }, topic: 'amenities', score: 1, answer: 'Old.', status: 'archived' });
		}
		const active = await curatedItem(t, { question: 'Is there a gym?', translations: { th: 'มียิมไหม' }, topic: 'amenities', score: 1, answer: 'Yes.' });
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'line', createdAt: 1, lastSeenAt: 1 }));
		const candidates = await t.run(async (ctx) => {
			const s = (await ctx.db.get(sessionId))!;
			return await exactCuratedCandidates(ctx, s, normalizeSuggestedQuestion('มียิมไหม'));
		});
		expect(candidates.map((row) => row._id)).toEqual([active]);
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

describe('curated variant backfill migration is preserved', () => {
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
	});
});

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
		const { t } = setup();
		for (let i = 0; i < 40; i++) {
			await curatedItem(t, {
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

describe('approved-context helper reads every eligible answer and guards its budget', () => {
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
		const sessionId = await session(t, pool, 'pool-villa');
		const context = await t.run(async (ctx) => approvedContextFor(ctx, (await ctx.db.get(sessionId))!));
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
		const context = await t.run(async (ctx) => approvedContextFor(ctx, (await ctx.db.get(sessionId))!));
		expect(context[0]?.title).toBe('Retreat yoga (edited)');
	});

	it('finds an older answer for every villa behind 201 newer answers scoped to other retreats', async () => {
		const { t } = setup();
		await customScopedAnswer(t, { title: 'Check-out time', question: 'When is check-out?', updatedAt: 1 });
		for (let i = 0; i < 201; i++) {
			await customScopedAnswer(t, { slug: `other-${i}`, title: `Other ${i}`, question: `Other question ${i}`, updatedAt: 100 + i });
		}
		const sessionId = await t.run((ctx) => ctx.db.insert('chatSessions', { channel: 'web', createdAt: 1, lastSeenAt: 1 }));
		const context = await t.run(async (ctx) => approvedContextFor(ctx, (await ctx.db.get(sessionId))!));
		expect(context).toEqual([{ title: 'Check-out time', answer: 'Check-out time.' }]);
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
		await t.run(async (ctx) => {
			await expect(approvedContextFor(ctx, (await ctx.db.get(sessionId))!)).rejects.toThrow('Too much approved knowledge');
		});

		// Same with the range budget nearly spent: no partial list, and the refusal comes before reading on.
		await t.run(async (ctx) => {
			const budget = readBudget(ctx);
			budget.ranges = budget.maxRanges;
			const current = (await ctx.db.get(sessionId))!;
			await expect(approvedContextFor(ctx, current)).rejects.toThrow(ReadBudgetExceeded);
		});
	});
});
