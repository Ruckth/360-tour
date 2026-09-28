// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

afterEach(() => vi.unstubAllEnvs());

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const propertyId = await admin.mutation(api.adminProperties.create, { name: 'Villa' });
	return { t, admin, propertyId };
}

const fields = (rating: number, date = '2026-09-01') => ({
	authorName: 'Ann', authorCity: 'Paris', authorCountry: 'France', rating, title: 'Great stay', body: 'Lovely villa',
	date, verified: true
});
const review = (propertyId: Id<'properties'>, rating: number, date?: string) => ({ propertyId, ...fields(rating, date) });

async function socialProof(t: Awaited<ReturnType<typeof setup>>['t'], propertyId: Id<'properties'>) {
	return await t.run((ctx) => ctx.db.query('socialProof').withIndex('by_property', (q) => q.eq('propertyId', propertyId)).first());
}

describe('admin reviews', () => {
	it('requires an admin', async () => {
		const { t, propertyId } = await setup();
		await expect(t.query(api.adminReviews.list, { propertyId })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		await expect(stranger.mutation(api.adminReviews.create, review(propertyId, 5))).rejects.toThrow('Not authorized');
	});

	it('keeps social proof in sync with real reviews', async () => {
		const { t, admin, propertyId } = await setup();
		const first = await admin.mutation(api.adminReviews.create, review(propertyId, 5, '2026-08-01'));
		const second = await admin.mutation(api.adminReviews.create, { ...review(propertyId, 4, '2026-09-10'), photos: ['https://images.unsplash.com/p.jpg'] });
		expect(await socialProof(t, propertyId)).toMatchObject({ overallRating: 4.5, totalReviews: 2 });

		const listed = await admin.query(api.adminReviews.list, { propertyId });
		expect(listed.reviews.map((r) => r._id)).toEqual([second, first]);
		expect(listed.summary).toEqual({ overallRating: 4.5, totalReviews: 2 });

		await admin.mutation(api.adminReviews.update, { reviewId: first, ...fields(3) });
		expect(await socialProof(t, propertyId)).toMatchObject({ overallRating: 3.5, totalReviews: 2 });

		await admin.mutation(api.adminReviews.remove, { reviewId: second });
		await admin.mutation(api.adminReviews.remove, { reviewId: first });
		expect(await socialProof(t, propertyId)).toBeNull();
	});

	it('replaces seeded breakdown and superhost values on recompute', async () => {
		const { t, admin, propertyId } = await setup();
		await t.run(async (ctx) => {
			await ctx.db.insert('socialProof', {
				propertyId, overallRating: 4.9, totalReviews: 120, isSuperhost: true,
				breakdown: { cleanliness: 5, accuracy: 5, communication: 5, location: 5, checkIn: 5, value: 5 }
			});
		});
		await admin.mutation(api.adminReviews.create, review(propertyId, 4));
		const row = await socialProof(t, propertyId);
		expect(row).toMatchObject({ overallRating: 4, totalReviews: 1 });
		expect(row?.breakdown).toBeUndefined();
		expect(row?.isSuperhost).toBeUndefined();
	});

	it('validates review input', async () => {
		const { admin, propertyId } = await setup();
		await expect(admin.mutation(api.adminReviews.create, review(propertyId, 6))).rejects.toThrow('Rating');
		await expect(admin.mutation(api.adminReviews.create, review(propertyId, 4.5))).rejects.toThrow('whole number');
		await expect(admin.mutation(api.adminReviews.create, review(propertyId, 5, '01/09/2026'))).rejects.toThrow('YYYY-MM-DD');
		await expect(admin.mutation(api.adminReviews.create, { ...review(propertyId, 5), authorName: ' ' })).rejects.toThrow('Guest name');
		await expect(admin.mutation(api.adminReviews.create, { ...review(propertyId, 5), body: '' })).rejects.toThrow('Review text');
		await expect(
			admin.mutation(api.adminReviews.create, { ...review(propertyId, 5), photos: ['http://example.com/x.jpg'] })
		).rejects.toThrow('Images must be');
		await expect(admin.mutation(api.adminReviews.create, { ...review(propertyId, 5), photos: ['https://example.com/x.jpg'] })).rejects.toThrow('uploaded photo');
	});
});

describe('recomputeAllSocialProof migration', () => {
	it('replaces invented seed figures with numbers from real reviews', async () => {
		const { t, admin, propertyId } = await setup();
		const empty = await admin.mutation(api.adminProperties.create, { name: 'Empty villa' });
		await t.run(async (ctx) => {
			await ctx.db.insert('socialProof', { propertyId, overallRating: 4.9, totalReviews: 127 });
			await ctx.db.insert('socialProof', { propertyId: empty, overallRating: 4.8, totalReviews: 88 });
			await ctx.db.insert('reviews', { ...review(propertyId, 4), authorAvatarUrl: '' });
		});

		expect(await t.mutation(internal.migrations.recomputeAllSocialProof, {})).toEqual({ villas: 2 });
		expect(await socialProof(t, propertyId)).toMatchObject({ overallRating: 4, totalReviews: 1 });
		expect(await socialProof(t, empty)).toBeNull();
	});
});
