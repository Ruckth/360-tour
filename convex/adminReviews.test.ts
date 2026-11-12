// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

afterEach(() => vi.unstubAllEnvs());

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const propertyId = await admin.mutation(api.catalog.adminProperties.create, { name: 'Villa' });
	return { t, admin, propertyId };
}

const fields = (rating: number, date = '2026-09-01') => ({
	authorName: 'Ann', authorCity: 'Paris', authorCountry: 'France', rating, title: 'Great stay', body: 'Lovely villa',
	date, verified: true
});
const review = (propertyId: Id<'properties'>, rating: number, date?: string) => ({ propertyId, ...fields(rating, date) });

async function reviewStats(t: Awaited<ReturnType<typeof setup>>['t'], propertyId: Id<'properties'>) {
	return await t.run((ctx) => ctx.db.query('reviewStats').withIndex('by_property', (q) => q.eq('propertyId', propertyId)).first());
}

describe('admin reviews', () => {
	it('requires an admin', async () => {
		const { t, propertyId } = await setup();
		await expect(t.query(api.catalog.adminReviews.list, { propertyId })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		await expect(stranger.mutation(api.catalog.adminReviews.create, review(propertyId, 5))).rejects.toThrow('Not authorized');
	});

	it('keeps social proof in sync with real reviews', async () => {
		const { t, admin, propertyId } = await setup();
		const first = await admin.mutation(api.catalog.adminReviews.create, review(propertyId, 5, '2026-08-01'));
		const second = await admin.mutation(api.catalog.adminReviews.create, { ...review(propertyId, 4, '2026-09-10'), photos: ['https://images.unsplash.com/p.jpg'] });
		expect(await reviewStats(t, propertyId)).toMatchObject({ overallRating: 4.5, totalReviews: 2 });

		const listed = await admin.query(api.catalog.adminReviews.list, { propertyId });
		expect(listed.reviews.map((r) => r._id)).toEqual([second, first]);
		expect(listed.summary).toEqual({ overallRating: 4.5, totalReviews: 2 });

		await admin.mutation(api.catalog.adminReviews.update, { reviewId: first, ...fields(3) });
		expect(await reviewStats(t, propertyId)).toMatchObject({ overallRating: 3.5, totalReviews: 2 });

		await admin.mutation(api.catalog.adminReviews.remove, { reviewId: second });
		await admin.mutation(api.catalog.adminReviews.remove, { reviewId: first });
		expect(await reviewStats(t, propertyId)).toBeNull();
	});

	it('validates review input', async () => {
		const { admin, propertyId } = await setup();
		await expect(admin.mutation(api.catalog.adminReviews.create, review(propertyId, 6))).rejects.toThrow('Rating');
		await expect(admin.mutation(api.catalog.adminReviews.create, review(propertyId, 4.5))).rejects.toThrow('whole number');
		await expect(admin.mutation(api.catalog.adminReviews.create, review(propertyId, 5, '01/09/2026'))).rejects.toThrow('YYYY-MM-DD');
		await expect(admin.mutation(api.catalog.adminReviews.create, { ...review(propertyId, 5), authorName: ' ' })).rejects.toThrow('Guest name');
		await expect(admin.mutation(api.catalog.adminReviews.create, { ...review(propertyId, 5), body: '' })).rejects.toThrow('Review text');
		await expect(
			admin.mutation(api.catalog.adminReviews.create, { ...review(propertyId, 5), photos: ['http://example.com/x.jpg'] })
		).rejects.toThrow('Images must be');
		await expect(admin.mutation(api.catalog.adminReviews.create, { ...review(propertyId, 5), photos: ['https://example.com/x.jpg'] })).rejects.toThrow('uploaded photo');
	});
});
