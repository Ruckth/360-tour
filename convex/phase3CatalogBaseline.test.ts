// @vitest-environment edge-runtime
// Reproducible pre-change Phase 3 catalog/database baseline harness.
// Measures real public/admin Convex registrations with ctx.meta.getTransactionMetrics(),
// interval counters, and UTF-8 JSON serialized response bytes. No production behavior changes.

import { convexTest } from 'convex-test';
import type { FunctionArgs, FunctionReference, FunctionReturnType } from 'convex/server';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import type { MutationCtx } from './_generated/server';
import schema from './schema';
import { insertFixture } from './testing/completeFixture.test-support';

const modules = import.meta.glob('./**/*.ts');
const ADMIN_EMAIL = 'admin@example.com';
const FIXED_NOW = Date.UTC(2030, 0, 1);
const encoder = new TextEncoder();

type Tester = ReturnType<typeof convexTest>;
type Runner = Pick<Tester, 'run'>;
type TxMetrics = Awaited<ReturnType<MutationCtx['meta']['getTransactionMetrics']>>;

type MetricsDelta = {
	documentsRead: number;
	bytesRead: number;
	databaseQueries: number;
	documentsWritten: number;
	bytesWritten: number;
	functionsScheduled: number;
	scheduledFunctionArgsBytes: number;
};

type BaselineObservation = {
	group: string;
	scenario: string;
	endpoint: string;
	rowsReturned: number;
	serializedBytes: number;
	metrics: MetricsDelta;
	notes?: string;
};

const observations: BaselineObservation[] = [];

function record(
	group: string,
	scenario: string,
	endpoint: string,
	{ rowsReturned, serializedBytes, metrics }: Pick<BaselineObservation, 'rowsReturned' | 'serializedBytes' | 'metrics'>,
	notes?: string
) {
	observations.push({ group, scenario, endpoint, rowsReturned, serializedBytes, metrics, notes });
}

function diffMetrics(before: TxMetrics, after: TxMetrics): MetricsDelta {
	return {
		documentsRead: after.documentsRead.used - before.documentsRead.used,
		bytesRead: after.bytesRead.used - before.bytesRead.used,
		databaseQueries: after.databaseQueries.used - before.databaseQueries.used,
		documentsWritten: after.documentsWritten.used - before.documentsWritten.used,
		bytesWritten: after.bytesWritten.used - before.bytesWritten.used,
		functionsScheduled: after.functionsScheduled.used - before.functionsScheduled.used,
		scheduledFunctionArgsBytes: after.scheduledFunctionArgsBytes.used - before.scheduledFunctionArgsBytes.used
	};
}

function serializedBytesOf(value: unknown): number {
	return encoder.encode(JSON.stringify(value)).length;
}

async function measureQuery<Ref extends FunctionReference<'query', 'public'>>(
	runner: Runner,
	ref: Ref,
	args: FunctionArgs<Ref>,
	countRows: (result: FunctionReturnType<Ref>) => number
) {
	return await runner.run(async (ctx) => {
		const before = await ctx.meta.getTransactionMetrics();
		const result = await ctx.runQuery(ref, args);
		const after = await ctx.meta.getTransactionMetrics();
		return {
			result,
			metrics: diffMetrics(before, after),
			rowsReturned: countRows(result),
			serializedBytes: serializedBytesOf(result)
		};
	});
}

async function measureMutation<Ref extends FunctionReference<'mutation', 'public'>>(
	runner: Runner,
	ref: Ref,
	args: FunctionArgs<Ref>
) {
	return await runner.run(async (ctx) => {
		const before = await ctx.meta.getTransactionMetrics();
		const result = await ctx.runMutation(ref, args);
		const after = await ctx.meta.getTransactionMetrics();
		return {
			result,
			metrics: diffMetrics(before, after),
			rowsReturned: result === null || result === undefined ? 0 : 1,
			serializedBytes: serializedBytesOf(result ?? null)
		};
	});
}

function setupHarness() {
	vi.stubEnv('ADMIN_EMAILS', ADMIN_EMAIL);
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ emailVerified: true, email: ADMIN_EMAIL, tokenIdentifier: 'admin-baseline' });
	return { t, admin };
}

function makeProperty(
	slug: string,
	status: Doc<'properties'>['status'] = 'active',
	tourRoomIds: string[] = []
) {
	return {
		slug,
		name: `Villa ${slug}`,
		tagline: 'Private paradise with infinity pool and sea views',
		description:
			'Experience calm island living in a spacious private residence featuring an infinity pool, open-plan lounge, landscaped tropical garden, and floor-to-ceiling windows framing every room.',
		pricePerNight: 850000,
		currency: 'THB',
		maxGuests: 4,
		bedrooms: 2,
		bathrooms: 2,
		area: 145,
		images: [
			'https://images.unsplash.com/photo-1582719508461-905c673771fd?w=1200&h=800&fit=crop',
			'https://images.unsplash.com/photo-1540518614846-7eded433c457?w=1200&h=800&fit=crop',
			'/pool-villa-bedroom-view.webp',
			'/pool-villa-spa-bathroom.webp',
			'/pool-villa-veranda-view.webp'
		],
		amenities: ['Private Pool', 'WiFi', 'Air Conditioning', 'Kitchen', 'Garden View', 'King Bed'],
		tourRoomIds,
		directDiscountPercent: 1500,
		status,
		icalExportToken: `private-ical-token-${slug}`
	};
}

function makeHotspots(sceneIndex: number, totalScenes: number, hotspotsPerScene: number) {
	if (totalScenes <= 1 || hotspotsPerScene <= 0) return [];
	const count = Math.min(hotspotsPerScene, totalScenes - 1);
	const fromSlug = `scene-${String(sceneIndex).padStart(2, '0')}`;
	return Array.from({ length: count }, (_, offset) => {
		const targetIndex = ((sceneIndex + offset) % totalScenes) + 1;
		const targetSlug = `scene-${String(targetIndex).padStart(2, '0')}`;
		return {
			id: `${fromSlug}-to-${targetSlug}`,
			position: [300 - offset * 25, -30 + offset * 5, -200 + offset * 20],
			targetRoomSlug: targetSlug,
			label: `Go to Scene ${String(targetIndex).padStart(2, '0')} View`
		};
	});
}

function makeScene(
	propertyId: Id<'properties'>,
	sceneIndex: number,
	totalScenes: number,
	hotspotsPerScene: number,
	slugPrefix = 'scene'
) {
	const suffix = String(sceneIndex).padStart(2, '0');
	const slug = `${slugPrefix}-${suffix}`;
	return {
		propertyId,
		slug,
		name: `Scene ${suffix} Lounge Area`,
		imagePath: `/tour/villa-${slug}.webp`,
		hotspots: makeHotspots(sceneIndex, totalScenes, hotspotsPerScene)
	};
}

function isoDateOffset(baseDateUtc: number, dayOffset: number): string {
	return new Date(baseDateUtc + dayOffset * 86_400_000).toISOString().slice(0, 10);
}

function makeReview(propertyId: Id<'properties'>, index: number, rating: number) {
	const suffix = String(index).padStart(3, '0');
	return {
		propertyId,
		authorName: `Guest Reviewer ${suffix}`,
		authorCity: 'Singapore',
		authorCountry: 'Singapore',
		authorAvatarUrl:
			'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=80&h=80&fit=crop&crop=face',
		rating,
		title: `Memorable stay review ${suffix}`,
		body: 'We spent every morning swimming in the infinity pool watching the sunrise over the bay. The villa is impeccably maintained and quieter than expected.',
		date: isoDateOffset(Date.UTC(2026, 0, 1), index),
		verified: true,
		photos: [
			'https://images.unsplash.com/photo-1540541338287-41700207dee6?w=400&h=300&fit=crop',
			'https://images.unsplash.com/photo-1571896349842-33c89424de2d?w=400&h=300&fit=crop'
		]
	};
}

async function seedScenesForProperty(
	ctx: MutationCtx,
	propertyId: Id<'properties'>,
	sceneCount: number,
	hotspotsPerScene: number
) {
	const slugs: string[] = [];
	for (let i = 1; i <= sceneCount; i++) {
		const scene = makeScene(propertyId, i, sceneCount, hotspotsPerScene);
		await ctx.db.insert('tourScenes', scene);
		slugs.push(scene.slug);
	}
	await ctx.db.patch(propertyId, { tourRoomIds: slugs });
	return slugs;
}

async function seedReviewsForProperty(
	ctx: MutationCtx,
	propertyId: Id<'properties'>,
	count: number,
	rating = 5
) {
	let ratingTotal = 0;
	for (let i = 0; i < count; i++) {
		await ctx.db.insert('reviews', makeReview(propertyId, i, rating));
		ratingTotal += rating;
	}
	if (count > 0) {
		await ctx.db.insert('reviewStats', {
			propertyId,
			totalReviews: count,
			ratingTotal,
			overallRating: Math.round((ratingTotal / count) * 100) / 100
		});
	}
}

beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(FIXED_NOW);
});

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

afterAll(() => {
	if (process.env.PHASE3_BASELINE_REPORT === '1') {
		console.log(`PHASE3_BASELINE_JSON:${JSON.stringify(observations)}`);
	}
});

describe('Catalog cost measurements: tour scenes (1 / 10 / 50 scenes and 10x unrelated rows)', () => {
	it.each([
		{ label: '1 scene (0 hotspots)', count: 1, hotspots: 0 },
		{ label: '10 scenes (4 hotspots/scene)', count: 10, hotspots: 4 },
		{ label: '50 scenes (4 hotspots/scene)', count: 50, hotspots: 4 },
		{ label: '50 scenes (20 hotspots/scene, MAX_HOTSPOTS)', count: 50, hotspots: 20 }
	])('measures catalog/properties:getTourRooms at $label', async ({ label, count, hotspots }) => {
		const { t } = setupHarness();
		await t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', makeProperty('target-villa', 'active'));
			await seedScenesForProperty(ctx, propertyId, count, hotspots);
		});

		const m = await measureQuery(
			t,
			api.catalog.properties.getTourRooms,
			{ slug: 'target-villa' },
			(res) => res?.length ?? 0
		);

		expect(m.result).not.toBeNull();
		expect(m.rowsReturned).toBe(count);
		expect(m.metrics.documentsRead).toBe(1 + count);
		expect(m.metrics.databaseQueries).toBe(2);

		const summaryPlusFirstHotspotsBytes = serializedBytesOf(
			(m.result ?? []).map((room, idx) =>
				idx === 0 ? room : { slug: room.slug, name: room.name, imagePath: room.imagePath }
			)
		);
		const hotspotOverheadPct =
			m.serializedBytes > 0
				? Number((((m.serializedBytes - summaryPlusFirstHotspotsBytes) / m.serializedBytes) * 100).toFixed(1))
				: 0;

		record(
			'tour-scenes', label,
			'catalog/properties:getTourRooms', m,
			`summary+first-scene wire=${summaryPlusFirstHotspotsBytes}B (${hotspotOverheadPct}% non-first hotspot bytes)`
		);
	});

	it('keeps getTourRooms constant when unrelated villas and scenes grow 10x', async () => {
		const { t } = setupHarness();
		await t.run(async (ctx) => {
			const targetId = await ctx.db.insert('properties', makeProperty('target-villa', 'active'));
			await seedScenesForProperty(ctx, targetId, 10, 4);
			for (let v = 0; v < 10; v++) {
				const otherId = await ctx.db.insert('properties', makeProperty(`unrelated-${v}`, 'active'));
				await seedScenesForProperty(ctx, otherId, 10, 4);
			}
		});

		const at1x = await measureQuery(
			t,
			api.catalog.properties.getTourRooms,
			{ slug: 'target-villa' },
			(res) => res?.length ?? 0
		);

		await t.run(async (ctx) => {
			for (let v = 10; v < 100; v++) {
				const otherId = await ctx.db.insert('properties', makeProperty(`unrelated-${v}`, 'active'));
				await seedScenesForProperty(ctx, otherId, 10, 4);
			}
		});

		const at10x = await measureQuery(
			t,
			api.catalog.properties.getTourRooms,
			{ slug: 'target-villa' },
			(res) => res?.length ?? 0
		);

		expect(at10x.metrics).toEqual(at1x.metrics);
		expect(at10x.serializedBytes).toBe(at1x.serializedBytes);
		expect(at10x.result).toEqual(at1x.result);
		expect(at10x.metrics.documentsRead).toBe(11);

		record(
			'unrelated-10x', '10 scenes + 10 unrelated villas (100 unrelated scenes)',
			'catalog/properties:getTourRooms', at1x
		);
		record(
			'unrelated-10x', '10 scenes + 100 unrelated villas (1,000 unrelated scenes)',
			'catalog/properties:getTourRooms', at10x,
			'delta vs 1x = 0 docs / 0 bytes'
		);
	});
});

describe('Catalog cost measurements: single-villa detail & OTA (0 / 20 reviews and 10x unrelated)', () => {
	it.each([
		{ label: '0 reviews', storedReviews: 0, expectedReturned: 0, expectedDocsRead: 1 },
		{ label: '20 reviews', storedReviews: 20, expectedReturned: 20, expectedDocsRead: 22 },
		{ label: '50 stored reviews (capped at 20)', storedReviews: 50, expectedReturned: 20, expectedDocsRead: 22 }
	])('measures catalog/publicProperties:getBySlug at $label', async ({ label, storedReviews, expectedReturned, expectedDocsRead }) => {
		const { t } = setupHarness();
		await t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', makeProperty('target-villa', 'active', ['scene-01', 'scene-02']));
			await seedReviewsForProperty(ctx, propertyId, storedReviews, 5);
		});

		const m = await measureQuery(
			t,
			api.catalog.publicProperties.getBySlug,
			{ slug: 'target-villa' },
			(res) => (res ? 1 + res.reviews.length : 0)
		);

		expect(m.result).not.toBeNull();
		expect(m.result?.reviews).toHaveLength(expectedReturned);
		expect(m.result?.villa.reviewCount).toBe(storedReviews);
		expect(m.metrics.documentsRead).toBe(expectedDocsRead);
		expect(m.metrics.databaseQueries).toBe(3);

		record(
			'villa-detail', label,
			'catalog/publicProperties:getBySlug', m,
			`1 villa + ${expectedReturned} reviews returned`
		);
	});

	it('keeps getBySlug and getOtaComparison constant under 10x unrelated villas, reviews and OTA rates', async () => {
		const { t } = setupHarness();
		const platforms = ['booking_com', 'agoda', 'airbnb', 'expedia'] as const;

		await t.run(async (ctx) => {
			const targetId = await ctx.db.insert('properties', makeProperty('target-villa', 'active', ['scene-01']));
			await seedReviewsForProperty(ctx, targetId, 20, 5);
			for (const [idx, platform] of platforms.entries()) {
				await ctx.db.insert('otaRates', {
					propertyId: targetId,
					platform,
					nightlyRate: 950000 + idx * 25000,
					url: `https://example.com/${platform}/target-villa`,
					updatedAt: FIXED_NOW
				});
			}
			for (let v = 0; v < 10; v++) {
				const otherId = await ctx.db.insert('properties', makeProperty(`other-${v}`, 'active'));
				await seedReviewsForProperty(ctx, otherId, 5, 4);
				for (const platform of platforms) {
					await ctx.db.insert('otaRates', {
						propertyId: otherId,
						platform,
						nightlyRate: 900000,
						updatedAt: FIXED_NOW
					});
				}
			}
		});

		const detail1x = await measureQuery(
			t,
			api.catalog.publicProperties.getBySlug,
			{ slug: 'target-villa' },
			(res) => (res ? 1 + res.reviews.length : 0)
		);
		const ota1x = await measureQuery(
			t,
			api.catalog.properties.getOtaComparison,
			{ slug: 'target-villa' },
			(res) => res?.rates.length ?? 0
		);

		await t.run(async (ctx) => {
			for (let v = 10; v < 100; v++) {
				const otherId = await ctx.db.insert('properties', makeProperty(`other-${v}`, 'active'));
				await seedReviewsForProperty(ctx, otherId, 5, 4);
				for (const platform of platforms) {
					await ctx.db.insert('otaRates', {
						propertyId: otherId,
						platform,
						nightlyRate: 900000,
						updatedAt: FIXED_NOW
					});
				}
			}
		});

		const detail10x = await measureQuery(
			t,
			api.catalog.publicProperties.getBySlug,
			{ slug: 'target-villa' },
			(res) => (res ? 1 + res.reviews.length : 0)
		);
		const ota10x = await measureQuery(
			t,
			api.catalog.properties.getOtaComparison,
			{ slug: 'target-villa' },
			(res) => res?.rates.length ?? 0
		);

		expect(detail10x.metrics).toEqual(detail1x.metrics);
		expect(detail10x.serializedBytes).toBe(detail1x.serializedBytes);
		expect(ota10x.metrics).toEqual(ota1x.metrics);
		expect(ota10x.metrics.documentsRead).toBe(5);

		record(
			'unrelated-10x', '20 reviews + 10 unrelated villas (50 unrelated reviews)',
			'catalog/publicProperties:getBySlug', detail1x
		);
		record(
			'unrelated-10x', '20 reviews + 100 unrelated villas (500 unrelated reviews)',
			'catalog/publicProperties:getBySlug', detail10x,
			'delta vs 1x = 0 docs / 0 bytes'
		);
		record(
			'unrelated-10x', '4 OTA rates + 100 unrelated villas (400 unrelated OTA rates)',
			'catalog/properties:getOtaComparison', ota10x,
			'delta vs 1x = 0 docs / 0 bytes'
		);
	});
});

describe('Catalog cost measurements: catalogue listing (1 / 100 active villas and 10x unrelated inactive)', () => {
	it.each([
		{ activeCount: 1, inactiveCount: 0, label: '1 active villa (0 inactive)' },
		{ activeCount: 1, inactiveCount: 100, label: '1 active villa + 100 inactive (draft/archived)' },
		{ activeCount: 100, inactiveCount: 0, label: '100 active villas (0 inactive)' },
		{ activeCount: 100, inactiveCount: 100, label: '100 active villas + 100 inactive (draft/archived)' }
	])('measures publicProperties:list, properties:list and listSlugs at $label', async ({ activeCount, inactiveCount, label }) => {
		const { t } = setupHarness();
		await t.run(async (ctx) => {
			for (let i = 0; i < activeCount; i++) {
				const slug = `active-${String(i).padStart(3, '0')}`;
				const id = await ctx.db.insert('properties', makeProperty(slug, 'active', ['scene-01', 'scene-02']));
				await ctx.db.insert('reviewStats', { propertyId: id, totalReviews: 12, ratingTotal: 57, overallRating: 4.75 });
			}
			for (let i = 0; i < inactiveCount; i++) {
				const status = i % 2 === 0 ? 'archived' : 'draft';
				const slug = `inactive-${String(i).padStart(3, '0')}`;
				const id = await ctx.db.insert('properties', makeProperty(slug, status));
				await ctx.db.insert('reviewStats', { propertyId: id, totalReviews: 5, ratingTotal: 25, overallRating: 5 });
			}
		});

		const pubList = await measureQuery(t, api.catalog.publicProperties.list, {}, (res) => res.villas.length);
		const legacyList = await measureQuery(t, api.catalog.properties.list, {}, (res) => res.length);
		const slugList = await measureQuery(
			t,
			api.catalog.publicProperties.listSlugs,
			{ paginationOpts: { numItems: 100, cursor: null } },
			(res) => res.page.length
		);

		expect(pubList.result.hasProperties).toBe(true);
		expect(pubList.rowsReturned).toBe(activeCount);
		// 1 doc for `properties.first()` + activeCount from `by_status` + activeCount `reviewStats` N+1 joins.
		expect(pubList.metrics.documentsRead).toBe(1 + activeCount * 2);
		expect(pubList.metrics.databaseQueries).toBe(2 + activeCount);

		expect(legacyList.rowsReturned).toBe(activeCount);
		expect(legacyList.metrics.documentsRead).toBe(activeCount);
		expect(legacyList.metrics.databaseQueries).toBe(1);

		expect(slugList.rowsReturned).toBe(activeCount);
		expect(slugList.metrics.documentsRead).toBe(activeCount);
		expect(slugList.metrics.databaseQueries).toBe(1);

		record(
			'catalogue-list', label,
			'catalog/publicProperties:list', pubList,
			`1 hasProperties probe + ${activeCount} properties + ${activeCount} reviewStats N+1 lookups`
		);
		record('catalogue-list', label, 'catalog/properties:list', legacyList);
		record('catalogue-list', label, 'catalog/publicProperties:listSlugs', slugList);
	});
});

describe('Catalog cost measurements: secondary candidate catalog/publicProperties:featuredReviews', () => {
	it('benchmarks ranked reviews on all-active, realistic mixed active/archived, archived-top, bounded-200, and 10x total rows', async () => {
		// Scenario A: 200 reviews, all on 5 active villas (best case for active match density).
		{
			const { t } = setupHarness();
			await t.run(async (ctx) => {
				const activeIds: Id<'properties'>[] = [];
				for (let v = 0; v < 5; v++) {
					activeIds.push(await ctx.db.insert('properties', makeProperty(`active-${v}`, 'active')));
				}
				for (let i = 0; i < 200; i++) {
					await ctx.db.insert('reviews', makeReview(activeIds[i % activeIds.length], i, i >= 120 ? 5 : 4));
				}
			});
			const m = await measureQuery(t, api.catalog.publicProperties.featuredReviews, { limit: 6 }, (r) => r.length);
			expect(m.rowsReturned).toBe(6);
			// Six ranked reviews and five distinct villas.
			expect(m.metrics.documentsRead).toBe(11);
			expect(m.metrics.databaseQueries).toBe(6);
			record(
				'featured-reviews', '200 reviews all active (5 active villas, limit=6)',
				'catalog/publicProperties:featuredReviews', m,
				'6 ranked review docs + 5 property lookups'
			);
		}

		// Scenario B: Realistic mixed 200 reviews (60% active across 6 villas, 40% archived/draft across 4 villas, interleaved).
		{
			const { t } = setupHarness();
			await t.run(async (ctx) => {
				const villas: Id<'properties'>[] = [];
				for (let v = 0; v < 6; v++) {
					villas.push(await ctx.db.insert('properties', makeProperty(`mix-active-${v}`, 'active')));
				}
				for (let v = 0; v < 4; v++) {
					villas.push(
						await ctx.db.insert('properties', makeProperty(`mix-inactive-${v}`, v % 2 === 0 ? 'archived' : 'draft'))
					);
				}
				for (let i = 0; i < 200; i++) {
					const rating = i % 3 === 0 ? 4 : 5;
					await ctx.db.insert('reviews', makeReview(villas[i % villas.length], i, rating));
				}
			});
			const m = await measureQuery(t, api.catalog.publicProperties.featuredReviews, { limit: 6 }, (r) => r.length);
			expect(m.rowsReturned).toBe(6);
			// Reviews and distinct villas needed to return the six highest-ranked eligible reviews.
			expect(m.metrics.documentsRead).toBeGreaterThanOrEqual(6);
			expect(m.metrics.documentsRead).toBeLessThanOrEqual(30);
			record(
				'featured-reviews', 'Realistic mixed 200 reviews (60% active / 40% archived+draft interleaved, limit=6)',
				'catalog/publicProperties:featuredReviews', m,
				`Stops after the sixth active review`
			);
		}

		// Scenario C: Realistic mixed 200 reviews with 80 newest 5-star reviews on 8 archived/draft villas ahead of 120 active reviews.
		{
			const { t } = setupHarness();
			await t.run(async (ctx) => {
				const activeIds: Id<'properties'>[] = [];
				const inactiveIds: Id<'properties'>[] = [];
				for (let v = 0; v < 6; v++) {
					activeIds.push(await ctx.db.insert('properties', makeProperty(`archtop-active-${v}`, 'active')));
				}
				for (let v = 0; v < 8; v++) {
					inactiveIds.push(
						await ctx.db.insert('properties', makeProperty(`archtop-inactive-${v}`, v % 2 === 0 ? 'archived' : 'draft'))
					);
				}
				// Insert active first (older _creationTime), then archived 5-star reviews (newer _creationTime -> scanned first in desc order).
				for (let i = 0; i < 120; i++) {
					await ctx.db.insert('reviews', makeReview(activeIds[i % activeIds.length], i, i >= 60 ? 5 : 4));
				}
				for (let i = 0; i < 80; i++) {
					await ctx.db.insert('reviews', makeReview(inactiveIds[i % inactiveIds.length], 120 + i, 5));
				}
			});
			const m = await measureQuery(t, api.catalog.publicProperties.featuredReviews, { limit: 6 }, (r) => r.length);
			expect(m.rowsReturned).toBe(6);
			// 80 inactive + 6 active reviews, with 14 distinct property lookups.
			expect(m.metrics.documentsRead).toBe(100);
			expect(m.metrics.databaseQueries).toBe(15);
			record(
				'featured-reviews', 'Realistic mixed 200 reviews (80 archived/draft 5-star first, then 120 active, limit=6)',
				'catalog/publicProperties:featuredReviews', m,
				'86 review docs and 14 distinct property lookups'
			);
		}

		// Scenario D: Original bounded-200 behavior (201 archived/draft 5-star reviews ahead of 20 active reviews).
		{
			const { t } = setupHarness();
			await t.run(async (ctx) => {
				const activeId = await ctx.db.insert('properties', makeProperty('bound-active', 'active'));
				const archivedId = await ctx.db.insert('properties', makeProperty('bound-archived', 'archived'));
				for (let i = 0; i < 20; i++) {
					await ctx.db.insert('reviews', makeReview(activeId, i, 5));
				}
				// Inserted after active reviews so by_rating desc visits all 201 archived rows first.
				for (let i = 0; i < 201; i++) {
					await ctx.db.insert('reviews', makeReview(archivedId, 20 + i, 5));
				}
			});
			const m = await measureQuery(t, api.catalog.publicProperties.featuredReviews, { limit: 6 }, (r) => r.length);
			expect(m.result).toEqual([]);
			expect(m.rowsReturned).toBe(0);
			// Bounded-200 scan reads exactly 200 review docs + 1 cached archived property doc = 201.
			expect(m.metrics.documentsRead).toBe(201);
			expect(m.metrics.databaseQueries).toBe(2);
			record(
				'featured-reviews', 'Original bounded-200 cap (201 archived 5-star ahead of 20 active, limit=6)',
				'catalog/publicProperties:featuredReviews', m,
				'Returns [] after bounded 200-review scan + 1 cached inactive property lookup'
			);
		}

		// Scenario E: 10x total reviews (2,000 mixed reviews vs 200) verifies take(200) stays bounded at 200 review reads.
		{
			const { t } = setupHarness();
			await t.run(async (ctx) => {
				const villas: Id<'properties'>[] = [];
				for (let v = 0; v < 6; v++) {
					villas.push(await ctx.db.insert('properties', makeProperty(`scale-active-${v}`, 'active')));
				}
				for (let v = 0; v < 4; v++) {
					villas.push(await ctx.db.insert('properties', makeProperty(`scale-archived-${v}`, 'archived')));
				}
				for (let i = 0; i < 2000; i++) {
					await ctx.db.insert('reviews', makeReview(villas[i % villas.length], i % 365, i % 3 === 0 ? 4 : 5));
				}
			});
			const m = await measureQuery(t, api.catalog.publicProperties.featuredReviews, { limit: 6 }, (r) => r.length);
			expect(m.rowsReturned).toBe(6);
			expect(m.metrics.documentsRead).toBeGreaterThanOrEqual(6);
			expect(m.metrics.documentsRead).toBeLessThanOrEqual(30);
			record(
				'featured-reviews', '10x total reviews (2,000 mixed active/archived, limit=6)',
				'catalog/publicProperties:featuredReviews', m,
				'Stops at the sixth eligible review despite 10× total reviews'
			);
		}
	});
});

describe('Catalog cost measurements: existing booking overlap and initialized inbox scale controls', () => {
	it('measures booking overlap availability controls at 1x and 10x unrelated rows', async () => {
		const { t } = setupHarness();
		const targetId = await t.run(async (ctx) => {
			const id = await ctx.db.insert('properties', makeProperty('booking-target', 'active'));
			for (let i = 0; i < 10; i++) {
				await insertFixture(ctx, 'bookings', {
					propertyId: id,
					guestName: `Past Guest ${i}`,
					guestPhone: '0800000000',
					checkIn: isoDateOffset(Date.UTC(2029, 0, 1), i * 5),
					checkOut: isoDateOffset(Date.UTC(2029, 0, 1), i * 5 + 2),
					guests: 2,
					nights: 2,
					subtotal: 1700000,
					discountAmount: 0,
					total: 1700000,
					currency: 'THB',
					paymentStatus: 'paid',
					status: 'completed',
					createdAt: FIXED_NOW
				});
			}
			for (const day of ['2030-06-02', '2030-06-03', '2030-06-20', '2030-06-21', '2030-06-25']) {
				await ctx.db.insert('availability', { propertyId: id, date: day, status: 'blocked', source: 'airbnb' });
			}
			for (let v = 0; v < 10; v++) {
				const otherId = await ctx.db.insert('properties', makeProperty(`booking-other-${v}`, 'active'));
				for (let b = 0; b < 10; b++) {
					await insertFixture(ctx, 'bookings', {
						propertyId: otherId,
						guestName: 'Other Guest',
						guestPhone: '0811111111',
						checkIn: '2030-06-10',
						checkOut: '2030-06-13',
						guests: 2,
						nights: 3,
						subtotal: 2550000,
						discountAmount: 0,
						total: 2550000,
						currency: 'THB',
						paymentStatus: 'paid',
						status: 'confirmed',
						createdAt: FIXED_NOW
					});
					await ctx.db.insert('availability', {
						propertyId: otherId,
						date: isoDateOffset(Date.UTC(2030, 5, 1), b),
						status: 'blocked',
						source: 'airbnb'
					});
				}
			}
			return id;
		});

		const avail1x = await measureQuery(
			t,
			api.bookings.calendar.availability.isAvailable,
			{ propertyId: targetId, checkIn: '2030-06-10', checkOut: '2030-06-13' },
			() => 1
		);
		const blocked1x = await measureQuery(
			t,
			api.bookings.calendar.availability.getBlockedDates,
			{ propertyId: targetId, startDate: '2030-06-01', endDate: '2030-06-30' },
			(res) => res.length
		);

		await t.run(async (ctx) => {
			for (let v = 10; v < 100; v++) {
				const otherId = await ctx.db.insert('properties', makeProperty(`booking-other-${v}`, 'active'));
				for (let b = 0; b < 10; b++) {
					await insertFixture(ctx, 'bookings', {
						propertyId: otherId,
						guestName: 'Other Guest',
						guestPhone: '0811111111',
						checkIn: '2030-06-10',
						checkOut: '2030-06-13',
						guests: 2,
						nights: 3,
						subtotal: 2550000,
						discountAmount: 0,
						total: 2550000,
						currency: 'THB',
						paymentStatus: 'paid',
						status: 'confirmed',
						createdAt: FIXED_NOW
					});
					await ctx.db.insert('availability', {
						propertyId: otherId,
						date: isoDateOffset(Date.UTC(2030, 5, 1), b),
						status: 'blocked',
						source: 'airbnb'
					});
				}
			}
		});

		const avail10x = await measureQuery(
			t,
			api.bookings.calendar.availability.isAvailable,
			{ propertyId: targetId, checkIn: '2030-06-10', checkOut: '2030-06-13' },
			() => 1
		);
		const blocked10x = await measureQuery(
			t,
			api.bookings.calendar.availability.getBlockedDates,
			{ propertyId: targetId, startDate: '2030-06-01', endDate: '2030-06-30' },
			(res) => res.length
		);

		expect(avail1x.result).toBe(true);
		expect(avail10x.result).toBe(true);
		expect(avail10x.metrics).toEqual(avail1x.metrics);
		expect(blocked1x.rowsReturned).toBe(5);
		expect(blocked10x.metrics).toEqual(blocked1x.metrics);

		record(
			'scale-controls', 'Booking overlap isAvailable (1x -> 10x unrelated villas/bookings)',
			'bookings/calendar/availability:isAvailable', avail10x,
			'100 -> 1,000 unrelated bookings; delta = 0 docs / 0 bytes'
		);
		record(
			'scale-controls', 'Booking month getBlockedDates (1x -> 10x unrelated availability)',
			'bookings/calendar/availability:getBlockedDates', blocked10x,
			'100 -> 1,000 unrelated availability rows; delta = 0 docs / 0 bytes'
		);
	});

	it('measures initialized inbox scale control at pre-init, 1x (60 unrelated), and 10x (600 unrelated)', async () => {
		const { t, admin } = setupHarness();
		await t.run(async (ctx) => {
			for (let i = 0; i < 10; i++) {
				const propertyId = await ctx.db.insert('properties', makeProperty(`inbox-villa-${i}`, 'active'));
				const sessionId = await ctx.db.insert('conversations', {
					channel: 'line',
					propertyId,
					createdAt: i,
					messageCount: 1,
					latestMessageAt: i,
					adminSortAt: i,
					inboxState: 'needs_staff'
				});
				await ctx.db.insert('messages', { sessionId, role: 'user', content: `Guest question ${i}`, timestamp: i });
				await ctx.db.insert('channelEvents', {
					channel: 'line',
					sessionId,
					eventKey: `inbox-evt-${i}`,
					eventType: 'message',
					status: 'received',
					processingStartedAt: i,
					createdAt: i,
					updatedAt: i
				});
			}
		});

		const beforeInit = await measureQuery(
			admin,
			api.messaging.adminChat.listSessions,
			{ status: 'needs_reply', empty: 'non_empty' },
			(res) => res.sessions.length
		);
		expect(beforeInit.rowsReturned).toBe(10);
		expect(beforeInit.metrics.documentsRead).toBe(41);

		await t.mutation(internal.messaging.projectionMaintenance.initializeInbox, { dryRun: false });

		await t.run(async (ctx) => {
			for (let i = 0; i < 60; i++) {
				await ctx.db.insert('conversations', {
					channel: 'web',
					createdAt: 100 + i,
					messageCount: 0,
					adminSortAt: 100 + i,
					lastActivityAt: 100 + i,
					inboxProjectionVersion: 1,
					inboxState: 'processing',
					lastMessagePreview: null,
					lastDeliveryStatus: null
				});
			}
		});

		const afterInit1x = await measureQuery(
			admin,
			api.messaging.adminChat.listSessions,
			{ status: 'needs_reply', empty: 'non_empty' },
			(res) => res.sessions.length
		);

		await t.run(async (ctx) => {
			for (let i = 60; i < 600; i++) {
				await ctx.db.insert('conversations', {
					channel: 'web',
					createdAt: 100 + i,
					messageCount: 0,
					adminSortAt: 100 + i,
					lastActivityAt: 100 + i,
					inboxProjectionVersion: 1,
					inboxState: 'processing',
					lastMessagePreview: null,
					lastDeliveryStatus: null
				});
			}
		});

		const afterInit10x = await measureQuery(
			admin,
			api.messaging.adminChat.listSessions,
			{ status: 'needs_reply', empty: 'non_empty' },
			(res) => res.sessions.length
		);

		expect(afterInit1x.rowsReturned).toBe(10);
		expect(afterInit1x.metrics.documentsRead).toBe(20);
		expect(afterInit10x.metrics).toEqual(afterInit1x.metrics);
		expect(afterInit10x.serializedBytes).toBe(afterInit1x.serializedBytes);

		record(
			'scale-controls', 'Admin inbox needs_reply pre-initialization (10 rows)',
			'messaging/adminChat:listSessions', beforeInit
		);
		record(
			'scale-controls', 'Admin inbox needs_reply initialized + 60 unrelated processing',
			'messaging/adminChat:listSessions', afterInit1x
		);
		record(
			'scale-controls', 'Admin inbox needs_reply initialized + 600 unrelated processing (10x)',
			'messaging/adminChat:listSessions', afterInit10x,
			'delta vs 1x = 0 docs / 0 bytes'
		);
	});
});

describe('Catalog cost measurements: catalog write-path amplification on 10 / 50 scenes', () => {
	it('measures scene edit, hotspot edit, reorder, create, delete, and property update mutations', async () => {
		const { t, admin } = setupHarness();
		const { propertyId, firstRoomId, lastRoomId, slugs } = await t.run(async (ctx) => {
			const id = await ctx.db.insert('properties', makeProperty('write-villa', 'active'));
			const createdSlugs = await seedScenesForProperty(ctx, id, 49, 4);
			const allRooms = await ctx.db
				.query('tourScenes')
				.withIndex('by_property', (q) => q.eq('propertyId', id))
				.collect();
			await ctx.db.patch(allRooms[0]._id, { ordinaryTourCertified: true });
			return {
				propertyId: id,
				firstRoomId: allRooms[0]._id,
				lastRoomId: allRooms[allRooms.length - 1]._id,
				slugs: createdSlugs
			};
		});

		const create50th = await measureMutation(admin, api.catalog.adminProperties.createRoom, {
			propertyId,
			name: 'Scene 50 Deck',
			slug: 'scene-50',
			imagePath: '/tour/villa-scene-50.webp'
		});
		const allSlugs = [...slugs, 'scene-50'];

		const updateRoom = await measureMutation(admin, api.catalog.properties.updateRoom, {
			roomId: firstRoomId,
			name: 'Scene 01 Lounge Updated'
		});

		const setHotspots = await measureMutation(admin, api.catalog.adminProperties.setHotspots, {
			roomId: firstRoomId,
			hotspots: [
				{ label: 'Scene 02', targetRoomSlug: 'scene-02', position: [100, -10, -150] },
				{ label: 'Scene 03', targetRoomSlug: 'scene-03', position: [120, -10, -140] },
				{ label: 'Scene 04', targetRoomSlug: 'scene-04', position: [140, -10, -130] },
				{ label: 'Scene 05', targetRoomSlug: 'scene-05', position: [160, -10, -120] }
			]
		});

		const reversedSlugs = [...allSlugs].reverse();
		const reorder = await measureMutation(admin, api.catalog.adminProperties.reorderRooms, {
			propertyId,
			roomSlugs: reversedSlugs
		});

		const priceUpdate = await measureMutation(admin, api.catalog.properties.update, {
			propertyId,
			pricePerNight: 900000
		});

		const deleteRoom = await measureMutation(admin, api.catalog.adminProperties.deleteRoom, {
			roomId: lastRoomId
		});

		const shrinkRoom = await measureMutation(admin, api.catalog.properties.updateRoom, {
			roomId: firstRoomId,
			name: 'Lounge'
		});

		expect(create50th.metrics.documentsRead).toBeGreaterThanOrEqual(50);
		expect(setHotspots.metrics.documentsRead).toBeGreaterThanOrEqual(50);
		expect(reorder.metrics.documentsRead).toBeGreaterThanOrEqual(50);
		expect(deleteRoom.metrics.documentsRead).toBeGreaterThanOrEqual(50);
		expect(updateRoom.metrics.documentsRead).toBe(2);
		expect(updateRoom.metrics.databaseQueries).toBe(2);
		expect(shrinkRoom.metrics.documentsRead).toBe(4);
		expect(shrinkRoom.metrics.databaseQueries).toBe(2);
		expect(priceUpdate.metrics.documentsRead).toBeLessThan(10);

		record(
			'catalog-writes', 'createRoom (adding 50th room to 49-scene villa)',
			'catalog/adminProperties:createRoom', create50th,
			'Reads all existing scenes via propertyRooms(MAX_ROOMS+1)'
		);
		record(
			'catalog-writes', 'updateRoom (rename 1 room on 50-scene villa)',
			'catalog/properties:updateRoom', updateRoom,
			'A certified scene avoids both its parent lookup and the scene range.'
		);
		record(
			'catalog-writes', 'setHotspots (4 hotspots on 50-scene villa)',
			'catalog/adminProperties:setHotspots', setHotspots,
			'Scans all 50 scenes to validate targetRoomSlug'
		);
		record(
			'catalog-writes', 'reorderRooms (50 scenes)',
			'catalog/adminProperties:reorderRooms', reorder,
			'Scans all 50 scenes to validate permutation + patches property.tourRoomIds'
		);
		record(
			'catalog-writes', 'properties:update (price-only edit on active villa)',
			'catalog/properties:update', priceUpdate,
			'Patches properties doc (invalidates getTourRooms which reads properties by_slug)'
		);
		record(
			'catalog-writes', 'deleteRoom (remove 1 room from 50-scene villa)',
			'catalog/adminProperties:deleteRoom', deleteRoom,
			'Scans all 50 scenes to scrub target hotspots + tourSnippets scan'
		);
		record(
			'catalog-writes', 'updateRoom (shorten the name on a 49-scene villa)',
			'catalog/properties:updateRoom', shrinkRoom,
			'Non-growing edits do not read the property scene range.'
		);
	});
});

describe('Catalog cost measurements: a growing two-room rename', () => {
	it('certifies a complete older scene range once and skips it on later edits', async () => {
		const { t, admin } = setupHarness();
		const { roomId, otherId } = await t.run(async ctx => {
			const propertyId = await ctx.db.insert('properties', makeProperty('two-room-villa', 'active'));
			const roomId = await ctx.db.insert('tourScenes', makeScene(propertyId, 1, 2, 4, 'room'));
			const otherId = await ctx.db.insert('tourScenes', makeScene(propertyId, 2, 2, 4, 'room'));
			return { roomId, otherId };
		});
		const first = await measureMutation(admin, api.catalog.properties.updateRoom, {
			roomId, name: 'Room one with a longer name'
		});
		expect(first.metrics).toMatchObject({ documentsRead: 4, databaseQueries: 3, documentsWritten: 3 });
		expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ ordinaryTourCertified: true });
		expect((await t.run(ctx => ctx.db.get(otherId)))?.ordinaryTourCertified).toBeUndefined();
		const steady = await measureMutation(admin, api.catalog.properties.updateRoom, {
			roomId, name: 'Room one with an even longer name'
		});
		expect(steady.metrics).toMatchObject({ documentsRead: 4, databaseQueries: 2, documentsWritten: 3 });
		record('catalog-writes', 'updateRoom (first uncertified two-scene rename)', 'catalog/properties:updateRoom', first);
		record('catalog-writes', 'updateRoom (steady certified two-scene rename)', 'catalog/properties:updateRoom', steady);
	});
});

describe('Catalog cost measurements: oversize scene fixture (51 scenes) & writer validation coverage', () => {
	it('measures the read cost of preserving the configured first scene at 51 rooms', async () => {
		const { t } = setupHarness();
		await t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', makeProperty('oversize-villa', 'active'));
			for (let i = 1; i <= 51; i++) {
				await ctx.db.insert('tourScenes', makeScene(propertyId, i, 51, 2, 'room'));
			}
			// Place the 51st (last-created) scene FIRST in configured tour order,
			// with room-01 and room-02 next, and room-03..room-50 unlisted.
			await ctx.db.patch(propertyId, { tourRoomIds: ['room-51', 'room-01', 'room-02'] });
		});

		const m = await measureQuery(
			t,
			api.catalog.properties.getTourRooms,
			{ slug: 'oversize-villa' },
			(res) => res?.length ?? 0
		);

		const slugs = (m.result ?? []).map((room) => room.slug);
		expect(slugs).toEqual(['room-51', ...Array.from({ length: 49 }, (_, i) => `room-${String(i + 1).padStart(2, '0')}`)]);
		expect(m.metrics.documentsRead).toBe(52);
		expect(m.metrics.databaseQueries).toBe(2);

		record(
			'oversize-cap', '51 scenes with tourRoomIds[0]=room-51 (last by creation)',
			'catalog/properties:getTourRooms', m,
			'One indexed scene scan orders the legacy tour before applying the public 50-room limit.'
		);
	});

});
