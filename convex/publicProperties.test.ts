// @vitest-environment edge-runtime

import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { featuredReviews } from './catalog/publicProperties';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

type Status = 'active' | 'draft' | 'archived';

function villa(slug: string, status: Status) {
	return {
		slug, name: slug.toUpperCase(), tagline: 'Tagline', description: 'Description', pricePerNight: 500000,
		currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50, images: [], amenities: ['WiFi'],
		tourRoomIds: [], directDiscountPercent: 1500, status, icalExportToken: `secret-${slug}`
	};
}

function review(propertyId: Id<'properties'>, rating: number, date: string) {
	return {
		propertyId, authorName: 'Guest', authorCity: 'Paris', authorCountry: 'France', authorAvatarUrl: '',
		rating, title: `${rating} stars`, body: 'Lovely', date, verified: true
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	const ids = await t.run(async (ctx) => {
		const active = await ctx.db.insert('properties', villa('active-villa', 'active'));
		const draft = await ctx.db.insert('properties', villa('draft-villa', 'draft'));
		const archived = await ctx.db.insert('properties', villa('archived-villa', 'archived'));
		await ctx.db.insert('reviews', review(active, 5, '2026-01-01'));
		await ctx.db.insert('reviews', review(active, 4, '2026-03-01'));
		await ctx.db.insert('reviewStats', { propertyId: active, overallRating: 4.5, totalReviews: 2 });
		await ctx.db.insert('reviews', review(draft, 5, '2026-02-01'));
		return { active, draft, archived };
	});
	return { t, ...ids };
}

describe('public villa queries', () => {
	it('lists only active villas with a review summary and no internal fields', async () => {
		const { t } = await setup();
		const result = await t.query(api.catalog.publicProperties.list, {});
		expect(result.hasProperties).toBe(true);
		expect(result.villas.map((item) => item.slug)).toEqual(['active-villa']);
		expect(result.villas[0]).toMatchObject({ reviewCount: 2, averageRating: 4.5, translations: [], contentEditedAt: null });
		expect(result.villas[0]).not.toHaveProperty('icalExportToken');
		expect(result.villas[0]).not.toHaveProperty('status');
	});

	it('reports an empty database', async () => {
		const t = convexTest(schema, modules);
		expect(await t.query(api.catalog.publicProperties.list, {})).toEqual({ hasProperties: false, villas: [] });
	});

	it('returns null for draft, archived and unknown slugs', async () => {
		const { t } = await setup();
		for (const slug of ['draft-villa', 'archived-villa', 'missing']) {
			expect(await t.query(api.catalog.publicProperties.getBySlug, { slug })).toBeNull();
		}
		const detail = await t.query(api.catalog.publicProperties.getBySlug, { slug: 'active-villa' });
		expect(detail?.villa.slug).toBe('active-villa');
		expect(detail?.reviews.map((item) => item.date)).toEqual(['2026-03-01', '2026-01-01']);
	});

	it('resolves active slugs beyond the featured catalog and enumerates them in disjoint pages', async () => {
		const { t } = await setup();
		await t.run(async ctx => {
			for (let i = 0; i < 100; i++) await ctx.db.insert('properties', villa(`extra-${i}`, 'active'));
		});

		const list = await t.query(api.catalog.publicProperties.list, {});
		expect(list.villas).toHaveLength(100);
		expect(list.villas.some(item => item.slug === 'extra-99')).toBe(false);
		expect(await t.query(api.catalog.publicProperties.getBySlug, { slug: 'extra-99' }))
			.toMatchObject({ villa: { slug: 'extra-99' }, reviews: [] });
		const first = await t.query(api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: 100, cursor: null } });
		expect(first).toMatchObject({ isDone: false, page: list.villas.map(item => item.slug) });
		const second = await t.query(api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: 100, cursor: first.continueCursor } });
		expect(second).toMatchObject({ isDone: true, page: ['extra-99'] });
		await expect(t.query(api.catalog.publicProperties.listSlugs, { paginationOpts: { numItems: 101, cursor: null } }))
			.rejects.toThrow('Villa page size');
		expect(await t.query(api.catalog.publicProperties.listSlugs, {
			paginationOpts: { numItems: 1, cursor: null, endCursor: first.continueCursor }
		})).toMatchObject({ page: ['active-villa'], isDone: false });

		const getPicker = (includeSlug: string) => t.query(api.catalog.properties.list, { includeSlug });
		const direct = await getPicker('extra-99');
		expect(direct).toHaveLength(101);
		expect(direct[100]).toMatchObject({ slug: 'extra-99' });
		for (const slug of ['active-villa', 'archived-villa', 'draft-villa', 'missing']) {
			expect(await getPicker(slug)).toHaveLength(100);
		}
	});

	it('features top reviews from active villas only', async () => {
		const { t } = await setup();
		const reviews = await t.query(api.catalog.publicProperties.featuredReviews, { limit: 6 });
		expect(reviews.map((item) => [item.propertySlug, item.rating])).toEqual([
			['active-villa', 5],
			['active-villa', 4]
		]);
	});

	it('reads only the reviews needed for the exact ranked result and keeps the 200-row ceiling', async () => {
		const t = convexTest(schema, modules);
		const { draft, expected } = await t.run(async ctx => {
			const active = await ctx.db.insert('properties', villa('active', 'active'));
			const draft = await ctx.db.insert('properties', villa('draft', 'draft'));
			const archive = await ctx.db.insert('properties', villa('archived', 'archived'));
			for (let i = 0; i < 200; i++) await ctx.db.insert('reviews', review(active, 3, '2026-01-01'));
			const expected = [];
			for (const rating of [4, 4, 5, 5, 5, 5]) {
				expected.unshift(await ctx.db.insert('reviews', review(active, rating, '2026-01-01')));
			}
			for (const propertyId of [draft, archive, draft]) {
				await ctx.db.insert('reviews', review(propertyId, 5, '2026-01-01'));
			}
			return { draft, expected };
		});

		const measure = (stream: boolean) => t.run(async ctx => {
			const start = await ctx.meta.getTransactionMetrics();
			let ids: Id<'reviews'>[];
			if (stream) {
				const result: { id: Id<'reviews'> }[] = await Reflect.get(featuredReviews, '_handler')(ctx, { limit: 6 });
				ids = result.map(item => item.id);
			} else {
				// Reproduce the old eager read and its one property lookup per distinct ID.
				const ranked = await ctx.db.query('reviews').withIndex('by_rating').order('desc').take(200);
				const eligible = new Map<Id<'properties'>, boolean>();
				ids = [];
				for (const review of ranked) {
					if (!eligible.has(review.propertyId)) {
						const property = await ctx.db.get(review.propertyId);
						eligible.set(review.propertyId, property?.status === 'active');
					}
					if (eligible.get(review.propertyId)) ids.push(review._id);
					if (ids.length === 6) break;
				}
			}
			const end = await ctx.meta.getTransactionMetrics();
			return { ids, reads: end.documentsRead.used - start.documentsRead.used, bytes: end.bytesRead.used - start.bytesRead.used };
		});

		const before = await measure(false);
		const after = await measure(true);
		expect(before).toMatchObject({ ids: expected, reads: 203 });
		expect(after).toMatchObject({ ids: expected, reads: 12 });
		expect(after.bytes).toBeLessThan(before.bytes * 0.7);
		expect((await t.query(api.catalog.publicProperties.featuredReviews, { limit: 6 })).map(item => item.id)).toEqual(expected);

		await t.run(async ctx => {
			for (let i = 0; i < 200; i++) await ctx.db.insert('reviews', review(draft, 5, '2026-01-01'));
		});
		const worst = await measure(false);
		expect(worst).toMatchObject({ ids: [], reads: 201 });
		expect(await measure(true)).toEqual(worst);
	});

	it('uses the full social proof count and shows only the newest 20 reviews', async () => {
		const { t, active } = await setup();
		await t.run(async ctx => {
			for (let i = 0; i < 205; i++) {
				await ctx.db.insert('reviews', review(active, 3, `2027-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`));
			}
			const proof = await ctx.db.query('reviewStats').withIndex('by_property', q => q.eq('propertyId', active)).first();
			await ctx.db.patch(proof!._id, { totalReviews: 207, overallRating: 3.01 });
		});
		const detail = await t.query(api.catalog.publicProperties.getBySlug, { slug: 'active-villa' });
		expect(detail?.villa).toMatchObject({ reviewCount: 207, averageRating: 3.01 });
		expect(detail?.reviews).toHaveLength(20);
		expect(detail?.reviews[0].date).toBe('2027-08-09');
		const listed = await t.query(api.catalog.publicProperties.list, {});
		expect(listed.villas[0].reviewCount).toBe(207);
	});

	it('bounds the featured review scan before inactive villas are filtered', async () => {
		const { t, draft } = await setup();
		await t.run(async ctx => {
			for (let i = 0; i < 201; i++) await ctx.db.insert('reviews', review(draft, 5, `2028-01-${String(i % 28 + 1).padStart(2, '0')}`));
		});
		expect(await t.query(api.catalog.publicProperties.featuredReviews, { limit: 6 })).toEqual([]);
	});

	it('marks content as edited only when guest-facing copy changes', async () => {
		const { t, active } = await setup();
		const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
		const editedAt = async () => (await t.run((ctx) => ctx.db.get(active)))?.contentEditedAt;

		await admin.mutation(api.catalog.properties.update, { propertyId: active, pricePerNight: 600000, tagline: 'Tagline', amenities: ['WiFi'] });
		expect(await editedAt()).toBeUndefined();

		await admin.mutation(api.catalog.properties.update, { propertyId: active, description: 'New description' });
		expect(await editedAt()).toEqual(expect.any(Number));
	});
});
