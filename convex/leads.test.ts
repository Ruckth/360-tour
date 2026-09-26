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
});
