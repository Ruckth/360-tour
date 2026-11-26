// @vitest-environment edge-runtime
import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { getDocumentSize } from 'convex/values';
import { afterEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const targetOrigin = 'http://127.0.0.1:3210';
const snapshotSha256 = 'a'.repeat(64);
const page = makeFunctionReference<'mutation', {
	targetOrigin: string;
	snapshotSha256: string;
	propertyId?: Id<'properties'>;
	mode: 'check' | 'clear';
	cursor: string | null;
	checkpoint: string | null;
}, {
	scanned: number;
	certified: number;
	cleared: number;
	isDone: boolean;
	cursor: string | null;
	checkpoint: string | null;
}>('maintenance/tourCertificates:page');

afterEach(() => vi.unstubAllEnvs());

it('clears a paused, target-bound import by resumable pages before a formerly certified room can grow', async () => {
	vi.stubEnv('CONVEX_CLOUD_URL', targetOrigin);
	const t = convexTest(schema, modules);
	const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
	const propertyId = await admin.mutation(api.catalog.adminProperties.create, { name: 'Import target' });
	const otherProperty = await admin.mutation(api.catalog.adminProperties.create, { name: 'Unaffected villa' });
	const create = (villa: typeof propertyId, slug: string, name: string) =>
		admin.mutation(api.catalog.adminProperties.createRoom, { propertyId: villa, slug, name, imagePath: '/image.webp' });
	const ordinary = await create(propertyId, 'living', 'Living');
	const unaffected = await create(otherProperty, 'unaffected', 'Unaffected');
	const extra = await create(propertyId, 'dining', 'Dining');
	expect((await t.run(ctx => ctx.db.get(ordinary)))?.ordinaryTourCertified).toBe(true);

	const args = { targetOrigin, snapshotSha256, propertyId, mode: 'clear' as const, cursor: null, checkpoint: null };
	await expect(t.mutation(page, args)).rejects.toThrow('Pause public writes');
	vi.stubEnv('ARCH_RESET_PAUSED', '1');
	await expect(t.mutation(page, { ...args, targetOrigin: 'https://wrong.convex.cloud' })).rejects.toThrow('target mismatch');
	await expect(t.mutation(page, { ...args, snapshotSha256: 'unverified' })).rejects.toThrow('SHA-256');

	// Simulate a writer outside this version adding uncertified rows to a formerly ordinary villa.
	await t.run(async ctx => {
		await ctx.db.patch(propertyId, { status: 'active' });
		for (let i = 0; i < 49; i++) {
			await ctx.db.insert('tourScenes', {
				propertyId, slug: `imported-${i}`, name: i < 3 ? 'x'.repeat(600_000) : 'Small', imagePath: '/image.webp', hotspots: [],
			});
		}
		const rooms = await ctx.db.query('tourScenes').withIndex('by_property', q => q.eq('propertyId', propertyId)).take(51);
		const bytes = rooms.reduce((total, row) => total + getDocumentSize(row), 0);
		const pad = rooms[2];
		await ctx.db.patch(pad._id, { name: pad.name + 'x'.repeat(2 * 1024 * 1024 - bytes) });
	});
	const grow = () => admin.mutation(api.catalog.properties.updateRoom, { roomId: ordinary, name: 'Living ' + '1'.repeat(200) });
	await expect(grow()).rejects.toThrow('temporarily unavailable');
	const check = await t.mutation(page, { ...args, mode: 'check' });
	expect(check).toMatchObject({ scanned: 8, certified: 2, cleared: 0, isDone: false });
	let result = await t.mutation(page, args);
	expect(result).toMatchObject({ scanned: 8, cleared: 2, isDone: false });
	expect(result.checkpoint).toMatch(/^[a-f0-9]{64}$/);
	expect(await t.mutation(page, args)).toMatchObject({ cleared: 0, cursor: result.cursor, checkpoint: result.checkpoint });
	const resume = { ...args, cursor: result.cursor, checkpoint: result.checkpoint };
	await expect(t.mutation(page, { ...resume, checkpoint: 'b'.repeat(64) })).rejects.toThrow('checkpoint mismatch');
	await expect(t.mutation(page, { ...resume, propertyId: otherProperty })).rejects.toThrow('checkpoint mismatch');
	await expect(t.mutation(page, { ...resume, mode: 'check' })).rejects.toThrow('checkpoint mismatch');

	let scanned = result.scanned;
	while (!result.isDone) {
		result = await t.mutation(page, { ...args, cursor: result.cursor, checkpoint: result.checkpoint });
		expect(result.cleared).toBe(0);
		scanned += result.scanned;
	}
	expect(scanned).toBe(51);
	expect(result).toMatchObject({ cursor: null, checkpoint: null });
	expect((await t.run(ctx => ctx.db.get(ordinary)))?.ordinaryTourCertified).toBeUndefined();
	expect((await t.run(ctx => ctx.db.get(extra)))?.ordinaryTourCertified).toBeUndefined();
	expect((await t.run(ctx => ctx.db.get(unaffected)))?.ordinaryTourCertified).toBe(true);
	vi.stubEnv('ARCH_RESET_PAUSED', '');
	await expect(grow()).rejects.toThrow('exceed its safe size limit');
	expect(await t.query(api.catalog.properties.getTourRooms, { slug: 'import-target' })).toHaveLength(50);
});
