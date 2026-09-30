// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

afterEach(() => vi.unstubAllEnvs());

describe('admin leads list', () => {
	it('filters by source, newest first', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const t = convexTest(schema, modules);
		const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
		await t.mutation(api.leads.save, { email: 'a@example.com', source: 'chat' });
		await t.mutation(api.leads.save, { email: 'b@example.com', source: 'tour_completion' });
		await t.mutation(api.leads.save, { email: 'c@example.com', source: 'chat' });

		const chat = await admin.query(api.leads.list, { source: 'chat', paginationOpts: { numItems: 10, cursor: null } });
		expect(chat.page.map((lead) => lead.email)).toEqual(['c@example.com', 'a@example.com']);
		const all = await admin.query(api.leads.list, { paginationOpts: { numItems: 10, cursor: null } });
		expect(all.page).toHaveLength(3);
		await expect(t.query(api.leads.list, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow('Not authenticated');
		await expect(
			t
				.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other' })
				.query(api.leads.list, { paginationOpts: { numItems: 10, cursor: null } })
		).rejects.toThrow('Not authorized');
	});

	it('records a repeat sign-up from a new source or villa, but not an identical repeat', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const t = convexTest(schema, modules);
		const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
		const propertyId = await t.run((ctx) =>
			ctx.db.insert('properties', {
				slug: 'villa-a',
				name: 'Villa A',
				tagline: 'Private stay',
				description: 'A villa for testing.',
				pricePerNight: 8500,
				currency: 'THB',
				maxGuests: 4,
				bedrooms: 2,
				bathrooms: 2,
				area: 180,
				images: [],
				amenities: [],
				tourRoomIds: [],
				directDiscountPercent: 15,
				status: 'active'
			})
		);

		const first = await t.mutation(api.leads.save, { email: 'Guest@Example.com', source: 'chat' });
		expect(await t.mutation(api.leads.save, { email: 'guest@example.com', source: 'chat' })).toBe(first);
		await t.mutation(api.leads.save, { email: 'guest@example.com', source: 'tour_completion' });
		await t.mutation(api.leads.save, { email: 'guest@example.com', source: 'tour_completion', propertyId });

		const { rows, truncated } = await admin.query(api.leads.exportRows, {});
		expect(truncated).toBe(false);
		expect(rows.map((lead) => [lead.source, lead.propertyId ?? null])).toEqual([
			['tour_completion', propertyId],
			['tour_completion', null],
			['chat', null]
		]);
		expect((await admin.query(api.leads.exportRows, { source: 'chat' })).rows).toHaveLength(1);
	});

	it('lets admins delete a lead', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const t = convexTest(schema, modules);
		const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
		const leadId = await t.mutation(api.leads.save, { email: 'a@example.com', source: 'chat' });

		await expect(t.mutation(api.leads.remove, { leadId })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.leads.exportRows, {})).rejects.toThrow('Not authenticated');
		await admin.mutation(api.leads.remove, { leadId });
		expect((await admin.query(api.leads.exportRows, {})).rows).toHaveLength(0);
	});
});
