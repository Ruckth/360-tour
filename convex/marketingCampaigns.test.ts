import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import type { FunctionArgs, FunctionReturnType } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import type { QueryCtx } from './_generated/server';
import { ReadBudget } from './lib/readBudget';
import { listCampaignOptions, listCampaigns } from './marketing/queries';
import schema from './schema';
import { CAMPAIGN_PAGE_SIZE } from './shared/marketingTypes';

const modules = import.meta.glob('./**/*.ts');
const audit = { createdAt: 1, updatedAt: 1, updatedByEmail: 'owner@example.com' };
const campaign = { ...audit, name: 'Happy holidays', source: 'Meta', medium: 'Paid Social', notes: 'Patio offer', status: 'active' as const };

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllEnvs();
});

async function setup() {
	const t = convexTest(schema, modules);
	const owner = await asTestOwner(t, { email: audit.updatedByEmail, emailVerified: true, tokenIdentifier: 'owner' });
	const viewer = t.withIdentity({ email: 'viewer@example.com', emailVerified: true, tokenIdentifier: 'viewer' });
	await t.run(ctx => ctx.db.insert('marketingGrants', { ...audit, email: 'viewer@example.com', role: 'viewer', tokenIdentifier: 'viewer' }));
	return { t, owner, viewer };
}

it('reads only the first 500 campaigns for pickers, with extra fields limited to the owning screen', async () => {
	const { t, viewer } = await setup();
	const { first, archived, beyond } = await t.run(async ctx => {
		const first = await ctx.db.insert('marketingCampaigns', { ...campaign, budget: 120_000 });
		for (let index = 1; index < 499; index++) {
			await ctx.db.insert('marketingCampaigns', { ...campaign, name: `Campaign ${index}` });
		}
		const archived = await ctx.db.insert('marketingCampaigns', { ...campaign, name: 'Archived campaign', status: 'archived' });
		const beyond = await ctx.db.insert('marketingCampaigns', { ...campaign, name: 'Later draft', status: 'draft' });
		return { first, archived, beyond };
	});

	const endpoint = api.marketing.queries.listCampaignOptions;
	const read: (ctx: QueryCtx, args: FunctionArgs<typeof endpoint>) => Promise<FunctionReturnType<typeof endpoint>> = Reflect.get(listCampaignOptions, '_handler');
	await viewer.run(async ctx => {
		const queries = vi.spyOn(ctx.db, 'query');
		const options = await read(ctx, {});
		expect(queries.mock.calls.map(([table]) => table)).toEqual(['staffGrants', 'marketingGrants', 'marketingCampaigns']);
		queries.mockRestore();
		expect(options).toHaveLength(500);
		expect(options[0]).toEqual({ _id: first, name: 'Happy holidays', status: 'active' });
		expect(options[499]).toEqual({ _id: archived, name: 'Archived campaign', status: 'archived' });
		expect(options.some(option => option._id === beyond)).toBe(false);
	});

	const [search] = await viewer.query(endpoint, { projection: 'search' });
	const [attribution] = await viewer.query(endpoint, { projection: 'attribution' });
	expect(search).toEqual({ _id: first, name: 'Happy holidays', status: 'active', searchText: 'happy holidays meta paid social patio offer' });
	expect(attribution).toEqual({ _id: first, name: 'Happy holidays', status: 'active', source: 'Meta', medium: 'Paid Social' });
	await expect(t.query(endpoint, {})).rejects.toThrow();
});

it('enriches only each requested page, preserving exact legacy counts, opens and the cap indicator', async () => {
	const { t, owner, viewer } = await setup();
	const campaignIds = await t.run(async ctx => {
		const ids: Id<'marketingCampaigns'>[] = [];
		for (let index = 0; index <= CAMPAIGN_PAGE_SIZE; index++) {
			ids.push(await ctx.db.insert('marketingCampaigns', { ...campaign, name: `Campaign ${index}` }));
		}
		for (const [i, campaignId] of ids.entries()) {
			const count = i === 0 ? 501 : 1;
			for (let j = 0; j < count; j++) {
				await ctx.db.insert('marketingLinks', {
					...audit, campaignId, name: 'Visit link', slug: `visit-${i}-${j}`, status: 'draft', destination: { kind: 'home' },
					entry: 'link', opens: j === 500 ? 1000 : 2
				});
				const couponId = await ctx.db.insert('coupons', {
					...audit, campaignId, code: `OFFER-${i}-${j}`, status: 'draft', currentVersion: 1, used: 0, discountGranted: 0
				});
				if (i === CAMPAIGN_PAGE_SIZE) {
					await ctx.db.insert('couponVersions', {
						couponId, version: 1, benefit: { kind: 'percent', percent: 1000 }, scope: 'accommodation',
						createdAt: audit.createdAt, createdByEmail: audit.updatedByEmail
					});
				}
			}
		}
		return ids;
	});
	const firstPage = campaignIds.slice(0, CAMPAIGN_PAGE_SIZE).reverse();
	const secondPage = campaignIds.slice(CAMPAIGN_PAGE_SIZE);
	const endpoint = api.marketing.queries.listCampaigns;
	const read: (ctx: QueryCtx, args: FunctionArgs<typeof endpoint>) => Promise<FunctionReturnType<typeof endpoint>> = Reflect.get(listCampaigns, '_handler');
	const rows = await viewer.run(async ctx => {
		const queries = vi.spyOn(ctx.db, 'query');
		const documents = vi.spyOn(ReadBudget.prototype, 'document');
		const result = await read(ctx, { campaignIds: firstPage });
		expect(queries.mock.calls.map(([table]) => table)).toEqual([
			'staffGrants', 'marketingGrants', ...firstPage.flatMap(() => ['marketingLinks', 'coupons'])
		]);
		expect(documents).toHaveBeenCalledTimes(CAMPAIGN_PAGE_SIZE + 1000 + 2 * (CAMPAIGN_PAGE_SIZE - 1));
		documents.mockRestore();
		queries.mockRestore();
		return result;
	});

	expect(rows.map(row => row._id)).toEqual(firstPage);
	expect(rows[CAMPAIGN_PAGE_SIZE - 1]).toMatchObject({ linkCount: 500, couponCount: 500, opens: 1000, countsCapped: true });
	const nextRows = await viewer.query(endpoint, { campaignIds: secondPage });
	expect(nextRows).toMatchObject([{ _id: secondPage[0], linkCount: 1, couponCount: 1, opens: 2, countsCapped: false }]);
	// The drawer reaches the displayed campaign's children behind 501 unrelated ones.
	await expect(viewer.query(api.marketing.queries.listLinks, { campaignId: secondPage[0] })).resolves.toMatchObject([
		{ campaignId: secondPage[0], slug: `visit-${CAMPAIGN_PAGE_SIZE}-0` }
	]);
	await expect(viewer.query(api.marketing.queries.listCampaignCoupons, { campaignId: secondPage[0] })).resolves.toMatchObject([
		{ campaignId: secondPage[0], code: `OFFER-${CAMPAIGN_PAGE_SIZE}-0`, rules: { version: 1 } }
	]);
	const legacy = await owner.query(api.marketing.queries.listCampaigns, { status: 'active' });
	expect([...rows.reverse(), ...nextRows]).toEqual(legacy);
	await expect(viewer.query(endpoint, { campaignIds })).rejects.toThrow('Choose up to');
	await expect(t.query(endpoint, { campaignIds: firstPage })).rejects.toThrow();
});
