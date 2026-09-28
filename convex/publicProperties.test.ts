// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

type Status = 'active' | 'draft' | 'archived';

function villa(slug: string, status: Status) {
	return {
		slug, name: slug.toUpperCase(), tagline: 'Tagline', description: 'Description', pricePerNight: 5000,
		currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 50, images: [], amenities: ['WiFi'],
		tourRoomIds: [], directDiscountPercent: 15, status, icalExportToken: `secret-${slug}`
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
		await ctx.db.insert('socialProof', { propertyId: active, overallRating: 4.5, totalReviews: 2 });
		await ctx.db.insert('reviews', review(draft, 5, '2026-02-01'));
		return { active, draft, archived };
	});
	return { t, ...ids };
}

afterEach(() => vi.unstubAllEnvs());

describe('public villa queries', () => {
	it('lists only active villas with a review summary and no internal fields', async () => {
		const { t } = await setup();
		const result = await t.query(api.publicProperties.list, {});
		expect(result.hasProperties).toBe(true);
		expect(result.villas.map((item) => item.slug)).toEqual(['active-villa']);
		expect(result.villas[0]).toMatchObject({ reviewCount: 2, averageRating: 4.5, translations: [], contentEditedAt: null });
		expect(result.villas[0]).not.toHaveProperty('icalExportToken');
		expect(result.villas[0]).not.toHaveProperty('status');
	});

	it('reports an empty database so the site can fall back to bundled content', async () => {
		const t = convexTest(schema, modules);
		expect(await t.query(api.publicProperties.list, {})).toEqual({ hasProperties: false, villas: [] });
	});

	it('returns null for draft, archived and unknown slugs', async () => {
		const { t } = await setup();
		for (const slug of ['draft-villa', 'archived-villa', 'missing']) {
			expect(await t.query(api.publicProperties.getBySlug, { slug })).toBeNull();
		}
		const detail = await t.query(api.publicProperties.getBySlug, { slug: 'active-villa' });
		expect(detail?.villa.slug).toBe('active-villa');
		expect(detail?.reviews.map((item) => item.date)).toEqual(['2026-03-01', '2026-01-01']);
	});

	it('features top reviews from active villas only', async () => {
		const { t } = await setup();
		const reviews = await t.query(api.publicProperties.featuredReviews, { limit: 6 });
		expect(reviews.map((item) => [item.propertySlug, item.rating])).toEqual([
			['active-villa', 5],
			['active-villa', 4]
		]);
	});

	it('uses the full social proof count and shows only the newest 20 reviews', async () => {
		const { t, active } = await setup();
		await t.run(async ctx => {
			for (let i = 0; i < 205; i++) {
				await ctx.db.insert('reviews', review(active, 3, `2027-${String(Math.floor(i / 28) + 1).padStart(2, '0')}-${String(i % 28 + 1).padStart(2, '0')}`));
			}
			const proof = await ctx.db.query('socialProof').withIndex('by_property', q => q.eq('propertyId', active)).first();
			await ctx.db.patch(proof!._id, { totalReviews: 207, overallRating: 3.01 });
		});
		const detail = await t.query(api.publicProperties.getBySlug, { slug: 'active-villa' });
		expect(detail?.villa).toMatchObject({ reviewCount: 207, averageRating: 3.01 });
		expect(detail?.reviews).toHaveLength(20);
		expect(detail?.reviews[0].date).toBe('2027-08-09');
		const listed = await t.query(api.publicProperties.list, {});
		expect(listed.villas[0].reviewCount).toBe(207);
	});

	it('bounds the featured review scan before inactive villas are filtered', async () => {
		const { t, draft } = await setup();
		await t.run(async ctx => {
			for (let i = 0; i < 201; i++) await ctx.db.insert('reviews', review(draft, 5, `2028-01-${String(i % 28 + 1).padStart(2, '0')}`));
		});
		expect(await t.query(api.publicProperties.featuredReviews, { limit: 6 })).toEqual([]);
	});

	it('marks content as edited only when guest-facing copy changes', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const { t, active } = await setup();
		const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
		const editedAt = async () => (await t.run((ctx) => ctx.db.get(active)))?.contentEditedAt;

		await admin.mutation(api.properties.update, { propertyId: active, pricePerNight: 6000, tagline: 'Tagline', amenities: ['WiFi'] });
		expect(await editedAt()).toBeUndefined();

		await admin.mutation(api.properties.update, { propertyId: active, description: 'New description' });
		expect(await editedAt()).toEqual(expect.any(Number));
	});
});
