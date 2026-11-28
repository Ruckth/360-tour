// @vitest-environment edge-runtime

import { asTestOwner, seedTestBranch } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

describe('admin leads list', () => {
	it('filters by source, newest first', async () => {
		const t = convexTest(schema, modules);
		const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
		await t.mutation(api.messaging.leads.save, { email: 'a@example.com', source: 'chat' });
		await t.mutation(api.messaging.leads.save, { email: 'b@example.com', source: 'tour_completion' });
		await t.mutation(api.messaging.leads.save, { email: 'c@example.com', source: 'chat' });

		const chat = await admin.query(api.messaging.leads.list, { source: 'chat', paginationOpts: { numItems: 10, cursor: null } });
		expect(chat.page.map((lead) => lead.email)).toEqual(['c@example.com', 'a@example.com']);
		const all = await admin.query(api.messaging.leads.list, { paginationOpts: { numItems: 10, cursor: null } });
		expect(all.page).toHaveLength(3);
		await expect(t.query(api.messaging.leads.list, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow('Not authenticated');
		await expect(
			t
				.withIdentity({ emailVerified: true, email: 'other@example.com', tokenIdentifier: 'other' })
				.query(api.messaging.leads.list, { paginationOpts: { numItems: 10, cursor: null } })
		).rejects.toThrow('Not authorized');
	});

	it('records a repeat sign-up from a new source or villa, but not an identical repeat', async () => {
		const t = convexTest(schema, modules);
		const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
		const propertyId = await t.run((ctx) =>
			ctx.db.insert('properties', {
				slug: 'villa-a',
				name: 'Villa A',
				tagline: 'Private stay',
				description: 'A villa for testing.',
				pricePerNight: 850000,
				currency: 'THB',
				maxGuests: 4,
				bedrooms: 2,
				bathrooms: 2,
				area: 180,
				images: [],
				amenities: [],
				tourRoomIds: [],
				directDiscountPercent: 1500,
				status: 'active'
			})
		);

		const first = await t.mutation(api.messaging.leads.save, { email: 'Guest@Example.com', source: 'chat' });
		expect(await t.mutation(api.messaging.leads.save, { email: 'guest@example.com', source: 'chat' })).toBe(first);
		await t.mutation(api.messaging.leads.save, { email: 'guest@example.com', source: 'tour_completion' });
		await t.mutation(api.messaging.leads.save, { email: 'guest@example.com', source: 'tour_completion', propertyId });

		const { rows, truncated } = await admin.query(api.messaging.leads.exportRows, {});
		expect(truncated).toBe(false);
		expect(rows.map((lead) => [lead.source, lead.propertyId ?? null])).toEqual([
			['tour_completion', propertyId],
			['tour_completion', null],
			['chat', null]
		]);
		expect((await admin.query(api.messaging.leads.exportRows, { source: 'chat' })).rows).toHaveLength(1);
	});

	it('lets admins delete a lead', async () => {
		const t = convexTest(schema, modules);
		const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
		const leadId = await t.mutation(api.messaging.leads.save, { email: 'a@example.com', source: 'chat' });

		await expect(t.mutation(api.messaging.leads.remove, { leadId })).rejects.toThrow('Not authenticated');
		await expect(t.query(api.messaging.leads.exportRows, {})).rejects.toThrow('Not authenticated');
		await admin.mutation(api.messaging.leads.remove, { leadId });
		expect((await admin.query(api.messaging.leads.exportRows, {})).rows).toHaveLength(0);
	});

	it('applies the same company-wide scope and filters to list and CSV for each permitted role (D05, D39)', async () => {
		const t = convexTest(schema, modules);
		const owner = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
		const { branchB } = await t.run(async (ctx) => {
			const branchA = await seedTestBranch(ctx, 'beach');
			const branchB = await seedTestBranch(ctx, 'hills');
			const now = Date.now();
			const grant = (email: string, role: 'manager' | 'cashier', branchIds: typeof branchA[]) =>
				ctx.db.insert('staffGrants', { role, email, tokenIdentifier: `issuer|${email}`, branchIds, createdAt: now, updatedAt: now, updatedByEmail: 'system:test' });
			await grant('manager@example.com', 'manager', [branchA]);
			await grant('cashier@example.com', 'cashier', [branchA, branchB]);
			return { branchB };
		});
		expect(branchB).toBeDefined();
		const propertyId = await t.run((ctx) => ctx.db.insert('properties', {
			slug: 'villa-b', name: 'Villa B', tagline: 't', description: 'd', pricePerNight: 1, currency: 'THB', maxGuests: 2,
			bedrooms: 1, bathrooms: 1, area: 1, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		}));
		for (let index = 0; index < 30; index++) await t.mutation(api.messaging.leads.save, { email: `guest${index}@example.com`, source: 'chat' });
		await t.mutation(api.messaging.leads.save, { email: 'Known@Example.com', source: 'tour_completion', propertyId });
		await t.mutation(api.messaging.leads.save, { email: 'known@example.com', source: 'chat' });
		for (let index = 0; index < 30; index++) await t.mutation(api.messaging.leads.save, { email: `late${index}@example.com`, source: 'chat' });

		const manager = t.withIdentity({ emailVerified: true, email: 'manager@example.com', tokenIdentifier: 'issuer|manager@example.com' });
		const cashier = t.withIdentity({ emailVerified: true, email: 'cashier@example.com', tokenIdentifier: 'issuer|cashier@example.com' });
		const page = { numItems: 25, cursor: null };
		// The known address is past the first 25 rows, so lookup must reach it across pages.
		const firstPage = await owner.query(api.messaging.leads.list, { paginationOpts: page });
		expect(firstPage.page.map((lead) => lead.email)).not.toContain('known@example.com');
		for (const actor of [owner, manager]) {
			const found = await actor.query(api.messaging.leads.list, { paginationOpts: page, email: '  KNOWN@example.com ' });
			expect(found.page.map((lead) => [lead.source, lead.propertyId ?? null])).toEqual([['chat', null], ['tour_completion', propertyId]]);
			const tour = await actor.query(api.messaging.leads.list, { paginationOpts: page, email: 'known@example.com', source: 'tour_completion' });
			expect(tour.page).toHaveLength(1);
			const csv = await actor.query(api.messaging.leads.exportRows, { email: 'known@example.com' });
			expect(csv).toMatchObject({ truncated: false, limit: 5000 });
			expect(csv.rows.map((lead) => lead._id)).toEqual(found.page.map((lead) => lead._id));
			// Without filters, CSV covers every lead (linked and unlinked) beyond the loaded page.
			expect((await actor.query(api.messaging.leads.exportRows, {})).rows).toHaveLength(62);
		}
		expect((await owner.query(api.messaging.leads.list, { paginationOpts: page, email: 'nobody@example.com' })).page).toEqual([]);
		expect((await owner.query(api.messaging.leads.list, { paginationOpts: page, email: '   ' })).page).toHaveLength(25);
		await expect(cashier.query(api.messaging.leads.list, { paginationOpts: page, email: 'known@example.com' })).rejects.toThrow('Not authorized');
		await expect(cashier.query(api.messaging.leads.exportRows, { email: 'known@example.com' })).rejects.toThrow('Not authorized');
	});
});
