// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const list = makeFunctionReference<
	'query',
	{ entityType: string; entityId?: string; paginationOpts: PaginationOptions },
	PaginationResult<Doc<'recordChanges'>>
>('recordHistory:list');
const records = makeFunctionReference<
	'query',
	{ propertyId?: Id<'properties'>; paginationOpts: PaginationOptions },
	PaginationResult<Doc<'configurationHistoryIndex'>>
>('configurationHistory:records');
const page = { numItems: 100, cursor: null };
function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	return {
		t,
		admin: t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' }),
		stranger: t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' })
	};
}
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('configuration history and safe restoration', () => {
	it('discovers removed time off without its deleted id and pages all retained changes with admin authorization', async () => {
		const { admin, stranger } = setup();
		const staffId = await admin.mutation(api.services.commands.createStaff.createStaff, {
			name: 'Mali', role: 'Therapist', color: '#abc',
			workingHours: [{ weekday: 1, start: '09:00', end: '18:00' }], breaks: []
		});
		const start = Date.parse('2026-10-30T02:00:00Z');
		const [created] = await admin.mutation(api.services.commands.addTimeOff.addTimeOff, { staffId, start, end: start + 3600000, label: 'Sick leave' });
		await admin.mutation(api.services.commands.removeTimeOff.removeTimeOff, { timeOffId: created.timeOffId! });
		const args = { entityType: 'timeOff', paginationOpts: { numItems: 1, cursor: null } };
		const first = await admin.query(list, args);
		expect(first.page).toMatchObject([{ kind: 'removed', before: { staffId, label: 'Sick leave' } }]);
		expect(first.isDone).toBe(false);
		const next = await admin.query(list, { ...args, paginationOpts: { numItems: 1, cursor: first.continueCursor } });
		expect(next.page).toMatchObject([{ kind: 'created', after: { staffId, staffName: 'Mali' } }]);
		expect(next.isDone).toBe(true);
		await expect(stranger.query(list, args)).rejects.toThrow();
	});
	it('records settings before/after, actor and time while excluding AI instructions and environment secrets', async () => {
		const { admin } = setup();
		vi.stubEnv('AI_API_KEY', 'provider-ai-secret');
		vi.stubEnv('STRIPE_SECRET_KEY', 'stripe-secret');
		await admin.mutation(api.settings.update, {
			business: { businessName: 'New name' },
			ai: { extraInstructions: 'private prompt or embedded credential', tone: 'Calm', maxWords: 80 },
			email: { fromName: 'Reception' }
		});
		const result = await admin.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page });
		expect(result.page).toHaveLength(1);
		expect(result.page[0]).toMatchObject({
			actor: 'admin@example.com',
			recordedAt: Date.now(),
			effectiveAt: Date.now(),
			kind: 'updated',
			before: { businessName: 'Auralis Cove Retreat' },
			after: { businessName: 'New name', ai: { tone: 'Calm', maxWords: 80 }, email: { fromName: 'Reception' } }
		});
		expect(JSON.stringify(result)).not.toMatch(/provider-ai-secret|stripe-secret|private prompt|extraInstructions/);
		expect(result.page[0].reason).toContain('excluded');
	});
	it('restores a safe snapshot as a new validated revision and retains excluded instructions', async () => {
		const { admin } = setup();
		await admin.mutation(api.settings.update, {
			business: { businessName: 'Earlier' },
			ai: { tone: 'Earlier tone', extraInstructions: 'First private instruction' }
		});
		const [earlier] = (await admin.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page }))
			.page;
		await admin.mutation(api.settings.update, {
			business: { businessName: 'Current' },
			ai: { tone: 'Current tone', extraInstructions: 'Retain this private instruction' }
		});
		const restored = await admin.mutation(api.settings.restore, {
			historyId: earlier._id,
			expectedRevision: 2,
			side: 'after'
		});
		expect(restored).toMatchObject({
			businessName: 'Earlier',
			revision: 3,
			ai: { tone: 'Earlier tone', extraInstructions: 'Retain this private instruction' }
		});
		expect(
			(await admin.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page })).page[0]
		).toMatchObject({
			kind: 'restored',
			actor: 'admin@example.com',
			before: { businessName: 'Current' },
			after: { businessName: 'Earlier' }
		});
		await expect(
			admin.mutation(api.settings.restore, { historyId: earlier._id, expectedRevision: 2, side: 'before' })
		).rejects.toThrow('Settings changed');
		await expect(
			admin.mutation(api.settings.update, { expectedRevision: 2, business: { businessName: 'Stale draft' } })
		).rejects.toThrow('Settings changed');
		expect((await admin.query(api.settings.get, {})).revision).toBe(3);
	});
	it('supports a legacy settings row without revision and rejects malformed or unrelated restore entries atomically', async () => {
		const { t, admin } = setup();
		await t.run((ctx) =>
			ctx.db.insert('siteSettings', {
				key: 'default',
				businessName: 'Legacy',
				updatedAt: 0,
				updatedByEmail: 'old@example.com'
			})
		);
		await admin.mutation(api.settings.update, { expectedRevision: 0, business: { businessName: 'Current' } });
		const original = (await admin.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page }))
			.page[0];
		const bad = await t.run((ctx) =>
			ctx.db.insert('recordChanges', {
				entityType: 'settings',
				entityId: 'default',
				actor: 'legacy',
				kind: 'updated',
				recordedAt: 0,
				effectiveAt: 0,
				after: { ...original.after, currency: 'INVALID' }
			})
		);
		await expect(
			admin.mutation(api.settings.restore, { historyId: bad, expectedRevision: 1, side: 'after' })
		).rejects.toThrow('3-letter');
		const unrelated = await t.run((ctx) =>
			ctx.db.insert('recordChanges', {
				entityType: 'property',
				entityId: 'default',
				actor: 'legacy',
				kind: 'updated',
				recordedAt: 0,
				effectiveAt: 0,
				after: original.after
			})
		);
		await expect(
			admin.mutation(api.settings.restore, { historyId: unrelated, expectedRevision: 1, side: 'after' })
		).rejects.toThrow('history not found');
		const incomplete = await t.run((ctx) =>
			ctx.db.insert('recordChanges', {
				entityType: 'settings',
				entityId: 'default',
				actor: 'legacy',
				kind: 'updated',
				recordedAt: 0,
				effectiveAt: 0,
				before: { businessName: 'Incomplete' }
			})
		);
		await expect(
			admin.mutation(api.settings.restore, { historyId: incomplete, expectedRevision: 1, side: 'before' })
		).rejects.toThrow('Incomplete');
		expect(await admin.query(api.settings.get, {})).toMatchObject({ businessName: 'Current', revision: 1 });
		expect(
			(await admin.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page })).page.filter(
				(event) => event.kind === 'restored'
			)
		).toHaveLength(0);
	});
	it('protects history, discovery and restoration with server-side authorization', async () => {
		const { t, admin, stranger } = setup();
		await admin.mutation(api.settings.update, { business: { businessName: 'Saved' } });
		const event = (await admin.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page }))
			.page[0];
		await expect(t.query(list, { entityType: 'settings', entityId: 'default', paginationOpts: page })).rejects.toThrow(
			'Not authenticated'
		);
		await expect(stranger.query(records, { paginationOpts: { numItems: 10, cursor: null } })).rejects.toThrow(
			'Not authorized'
		);
		await expect(
			stranger.mutation(api.settings.restore, { historyId: event._id, expectedRevision: 1, side: 'before' })
		).rejects.toThrow('Not authorized');
		await expect(
			admin.query(list, {
				entityType: 'settings',
				entityId: 'default',
				paginationOpts: { numItems: 101, cursor: null }
			})
		).rejects.toThrow('Page size');
	});
	it('keeps archive/restore, photos, slug, room images, hotspots and reorder history with no export token', async () => {
		const { t, admin } = setup();
		const id = await admin.mutation(api.catalog.adminProperties.create, { name: 'Villa' });
		await t.run((ctx) => ctx.db.patch(id, { icalExportToken: 'private-export-token' }));
		await admin.mutation(api.catalog.properties.update, { propertyId: id, images: ['/photos/one.jpg'], pricePerNight: 500000 });
		await admin.mutation(api.catalog.adminProperties.setSlug, { propertyId: id, slug: 'new-villa' });
		for (const status of ['active', 'archived', 'active'] as const)
			await admin.mutation(api.catalog.adminProperties.setStatus, { propertyId: id, status });
		const room = await admin.mutation(api.catalog.adminProperties.createRoom, {
			propertyId: id,
			name: 'Living',
			imagePath: '/living.jpg'
		});
		const room2 = await admin.mutation(api.catalog.adminProperties.createRoom, {
			propertyId: id,
			name: 'Pool',
			imagePath: '/pool.jpg'
		});
		await admin.mutation(api.catalog.properties.updateRoom, { roomId: room, name: 'Lounge', imagePath: '/lounge.jpg' });
		await admin.mutation(api.catalog.adminProperties.setHotspots, {
			roomId: room,
			hotspots: [{ label: 'Pool', targetRoomSlug: 'pool', position: [1, 2, 3] }]
		});
		await admin.mutation(api.catalog.adminProperties.reorderRooms, { propertyId: id, roomSlugs: ['pool', 'living'] });
		const history = (await admin.query(list, { entityType: 'property', entityId: id, paginationOpts: page })).page;
		expect(history.some((event) => event.after?.status === 'archived' && event.before?.status === 'active')).toBe(true);
		expect(history.some((event) => event.before?.status === 'archived' && event.after?.status === 'active')).toBe(true);
		expect(history.some((event) => event.after?.images?.[0] === '/photos/one.jpg')).toBe(true);
		expect(history[0].after.tourRoomIds).toEqual(['pool', 'living']);
		expect(JSON.stringify(history)).not.toContain('private-export-token');
		expect(JSON.stringify(history)).not.toContain('icalExportToken');
		const roomHistory = (await admin.query(list, { entityType: 'room', entityId: room, paginationOpts: page })).page;
		expect(roomHistory[0].after.hotspots[0]).toMatchObject({ label: 'Pool', position: [1, 2, 3] });
		expect(
			roomHistory.some((event) => event.before?.imagePath === '/living.jpg' && event.after?.imagePath === '/lounge.jpg')
		).toBe(true);
		await admin.mutation(api.catalog.adminProperties.deleteRoom, { roomId: room2 });
		expect(
			(await admin.query(list, { entityType: 'room', entityId: room, paginationOpts: page })).page[0].after.hotspots
		).toEqual([]);
		const deletedRoom = (
			await admin.query(records, { propertyId: id, paginationOpts: { numItems: 50, cursor: null } })
		).page.find((row) => row.entityId === room2);
		expect(deletedRoom).toMatchObject({ deleted: true, name: 'Pool' });
	});
	it('retains deleted villa and room snapshots and discovers them without the primary records', async () => {
		const { t, admin } = setup();
		const id = await admin.mutation(api.catalog.adminProperties.create, { name: 'Deleted draft' });
		const room = await admin.mutation(api.catalog.adminProperties.createRoom, {
			propertyId: id,
			name: 'Living',
			imagePath: '/living.jpg'
		});
		await admin.mutation(api.catalog.adminProperties.deleteDraft, { propertyId: id });
		expect(await admin.query(api.catalog.adminProperties.get, { propertyId: id })).toBeNull();
		expect(await t.run((ctx) => ctx.db.get(room))).toBeNull();
		const index = await admin.query(records, { paginationOpts: { numItems: 10, cursor: null } });
		expect(index.page).toMatchObject([{ entityId: id, deleted: true, name: 'Deleted draft' }]);
		expect(
			(await admin.query(list, { entityType: 'property', entityId: id, paginationOpts: page })).page[0]
		).toMatchObject({ kind: 'deleted', before: { name: 'Deleted draft', tourRoomIds: ['living'] }, after: null });
		const roomIndex = (await admin.query(records, { propertyId: id, paginationOpts: { numItems: 50, cursor: null } }))
			.page;
		expect(roomIndex).toHaveLength(1);
		expect(roomIndex[0]).toMatchObject({ entityType: 'room', deleted: true, entityId: room });
		expect(
			(await admin.query(list, { entityType: 'room', entityId: room, paginationOpts: page })).page[0]
		).toMatchObject({ kind: 'deleted', before: { name: 'Living', imagePath: '/living.jpg' }, after: null });
	});
	it('paginates beyond the first history page and logs OTA edits and removals', async () => {
		const { admin } = setup();
		const id = await admin.mutation(api.catalog.adminProperties.create, { name: 'Villa' });
		for (let index = 0; index < 12; index++)
			await admin.mutation(api.catalog.properties.update, { propertyId: id, tagline: `Tagline ${index}` });
		const first = await admin.query(list, {
			entityType: 'property',
			entityId: id,
			paginationOpts: { numItems: 10, cursor: null }
		});
		const second = await admin.query(list, {
			entityType: 'property',
			entityId: id,
			paginationOpts: { numItems: 10, cursor: first.continueCursor }
		});
		expect(first.isDone).toBe(false);
		expect(second.isDone).toBe(true);
		expect(new Set([...first.page, ...second.page].map((event) => event._id)).size).toBe(13);
		const rateId = await admin.mutation(api.catalog.properties.upsertOtaRate, {
			propertyId: id,
			platform: 'agoda',
			nightlyRate: 120000
		});
		await admin.mutation(api.catalog.properties.removeOtaRate, { rateId });
		expect(
			(await admin.query(list, { entityType: 'property', entityId: id, paginationOpts: page })).page[0]
		).toMatchObject({ kind: 'ota_rate_removed', before: { platform: 'agoda', nightlyRate: 120000 }, after: null });
	});
});
