// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import schema from './schema';
import { slugify } from './lib/slug';

const modules = import.meta.glob('./**/*.ts');

afterEach(() => vi.unstubAllEnvs());

function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
	return { t, admin, stranger };
}

async function insertBooking(t: ReturnType<typeof setup>['t'], propertyId: Id<'properties'>) {
	await t.run(async (ctx) => {
		await ctx.db.insert('bookings', {
			propertyId, guestName: 'Guest', guestPhone: '123', checkIn: '2026-10-01', checkOut: '2026-10-03', guests: 1,
			nights: 2, subtotal: 200, discountAmount: 0, total: 200, currency: 'THB', paymentStatus: 'paid', status: 'confirmed', createdAt: 0
		});
	});
}

describe('slugify', () => {
	it('makes URL-safe slugs', () => {
		expect(slugify('  Tideglass Pool Résidence! ')).toBe('tideglass-pool-residence');
		expect(slugify('บ้านริมทะเล')).toBe('');
	});
});

describe('villa create, slug and delete', () => {
	it('requires an admin', async () => {
		const { t, stranger } = setup();
		await expect(t.mutation(api.adminProperties.create, { name: 'Villa' })).rejects.toThrow('Not authenticated');
		await expect(stranger.mutation(api.adminProperties.create, { name: 'Villa' })).rejects.toThrow('Not authorized');
	});

	it('creates drafts with unique auto slugs and validates manual slugs', async () => {
		const { t, admin } = setup();
		const first = await admin.mutation(api.adminProperties.create, { name: 'Sea Breeze Villa' });
		const second = await admin.mutation(api.adminProperties.create, { name: 'Sea breeze villa' });
		const thai = await admin.mutation(api.adminProperties.create, { name: 'บ้านริมทะเล' });
		const docs = await t.run(async (ctx) => Promise.all([first, second, thai].map((id) => ctx.db.get(id))));
		expect(docs.map((doc) => doc?.slug)).toEqual(['sea-breeze-villa', 'sea-breeze-villa-2', 'villa']);
		expect(docs[0]).toMatchObject({ status: 'draft', pricePerNight: 0, currency: 'THB', images: [], tourRoomIds: [] });
		expect(await t.query(api.properties.list, {})).toHaveLength(0);

		await expect(admin.mutation(api.adminProperties.create, { name: 'X', slug: 'sea-breeze-villa' })).rejects.toThrow('already used');
		await expect(admin.mutation(api.adminProperties.create, { name: 'X', slug: 'Bad Slug!' })).rejects.toThrow('lowercase');
		await expect(admin.mutation(api.adminProperties.create, { name: ' ' })).rejects.toThrow('Name is required');
		const manual = await admin.mutation(api.adminProperties.create, { name: 'X', slug: 'my-villa' });
		expect((await t.run((ctx) => ctx.db.get(manual)))?.slug).toBe('my-villa');
		expect(await admin.query(api.adminProperties.get, { propertyId: 'not-an-id' })).toBeNull();
	});

	it('changes the slug until the villa has bookings', async () => {
		const { t, admin } = setup();
		const propertyId = await admin.mutation(api.adminProperties.create, { name: 'Villa One' });
		const other = await admin.mutation(api.adminProperties.create, { name: 'Villa Two' });
		expect(await admin.mutation(api.adminProperties.setSlug, { propertyId, slug: 'first-villa' })).toBe('first-villa');
		await expect(admin.mutation(api.adminProperties.setSlug, { propertyId: other, slug: 'first-villa' })).rejects.toThrow('already used');
		expect((await admin.query(api.adminProperties.get, { propertyId }))?.slugLocked).toBe(false);

		await insertBooking(t, propertyId);
		expect((await admin.query(api.adminProperties.get, { propertyId }))?.slugLocked).toBe(true);
		await expect(admin.mutation(api.adminProperties.setSlug, { propertyId, slug: 'renamed' })).rejects.toThrow('locked');
		expect((await t.run((ctx) => ctx.db.get(propertyId)))?.slug).toBe('first-villa');
	});

	it('publishes only priced villas and archives or restores them', async () => {
		const { t, admin } = setup();
		const propertyId = await admin.mutation(api.adminProperties.create, { name: 'Villa' });
		await expect(admin.mutation(api.adminProperties.setStatus, { propertyId, status: 'active' })).rejects.toThrow('price');
		await admin.mutation(api.properties.update, { propertyId, pricePerNight: 5000 });
		await admin.mutation(api.adminProperties.setStatus, { propertyId, status: 'active' });
		expect(await t.query(api.properties.list, {})).toHaveLength(1);
		await admin.mutation(api.adminProperties.setStatus, { propertyId, status: 'archived' });
		expect(await t.query(api.properties.list, {})).toHaveLength(0);
	});

	it('deletes only unused drafts and cascades their content', async () => {
		const { t, admin } = setup();
		const propertyId = await admin.mutation(api.adminProperties.create, { name: 'Villa' });
		await admin.mutation(api.adminProperties.createRoom, { propertyId, name: 'Living', imagePath: '/living.webp' });
		await admin.mutation(api.adminReviews.create, {
			propertyId, authorName: 'Ann', authorCity: 'Paris', authorCountry: 'France', rating: 5, title: '', body: 'Lovely',
			date: '2026-09-01', verified: true
		});
		await admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'agoda', nightlyRate: 9000 });

		await admin.mutation(api.properties.update, { propertyId, pricePerNight: 100 });
		await admin.mutation(api.adminProperties.setStatus, { propertyId, status: 'active' });
		await expect(admin.mutation(api.adminProperties.deleteDraft, { propertyId })).rejects.toThrow('Only draft');
		await admin.mutation(api.adminProperties.setStatus, { propertyId, status: 'draft' });
		expect((await admin.query(api.adminProperties.get, { propertyId }))?.deleteBlocker).toBeNull();

		await admin.mutation(api.adminProperties.deleteDraft, { propertyId });
		const leftovers = await t.run(async (ctx) => ({
			property: await ctx.db.get(propertyId),
			rooms: await ctx.db.query('rooms').collect(),
			reviews: await ctx.db.query('reviews').collect(),
			socialProof: await ctx.db.query('socialProof').collect(),
			otaRates: await ctx.db.query('otaRates').collect()
		}));
		expect(leftovers).toEqual({ property: null, rooms: [], reviews: [], socialProof: [], otaRates: [] });
	});

	it('refuses to delete drafts with bookings, calendar entries or chats', async () => {
		const { t, admin } = setup();
		const booked = await admin.mutation(api.adminProperties.create, { name: 'Booked' });
		await insertBooking(t, booked);
		await expect(admin.mutation(api.adminProperties.deleteDraft, { propertyId: booked })).rejects.toThrow('bookings');

		const blocked = await admin.mutation(api.adminProperties.create, { name: 'Blocked' });
		await t.run(async (ctx) => {
			await ctx.db.insert('availability', { propertyId: blocked, date: '2026-10-01', status: 'blocked', source: 'manual' });
		});
		await expect(admin.mutation(api.adminProperties.deleteDraft, { propertyId: blocked })).rejects.toThrow('calendar');

		const chatted = await admin.mutation(api.adminProperties.create, { name: 'Chatted' });
		await t.run(async (ctx) => {
			await ctx.db.insert('chatSessions', { propertyId: chatted, channel: 'web', createdAt: 0 });
		});
		await expect(admin.mutation(api.adminProperties.deleteDraft, { propertyId: chatted })).rejects.toThrow('chatted');
		expect(await t.run((ctx) => ctx.db.get(chatted))).not.toBeNull();
	});
});

describe('image uploads', () => {
	async function storeFile(t: ReturnType<typeof setup>['t'], contentType: string, size: number) {
		return await t.run(async (ctx) => {
			const storageId = await ctx.storage.store(new Blob(['image-bytes']));
			// convex-test doesn't record these; patch them to stand in for a real upload.
			await ctx.db.patch(storageId as never, { contentType, size } as never);
			return storageId;
		});
	}

	it('requires an admin for upload URLs and saving uploads', async () => {
		const { t, admin, stranger } = setup();
		await expect(t.mutation(api.adminProperties.generateUploadUrl, {})).rejects.toThrow('Not authenticated');
		await expect(stranger.mutation(api.adminProperties.generateUploadUrl, {})).rejects.toThrow('Not authorized');
		expect(await admin.mutation(api.adminProperties.generateUploadUrl, {})).toMatch(/^https:\/\//);
		const storageId = await storeFile(t, 'image/webp', 1000);
		await expect(stranger.mutation(api.adminProperties.saveUploadedImage, { storageId, kind: 'photo' })).rejects.toThrow('Not authorized');
	});

	it('returns a URL for valid images and deletes rejected ones', async () => {
		const { t, admin } = setup();
		const good = await storeFile(t, 'image/jpeg', 7 * 1024 * 1024);
		const result = await admin.mutation(api.adminProperties.saveUploadedImage, { storageId: good, kind: 'photo' });
		expect(result).toEqual({ url: expect.stringMatching(/^https:\/\/.+\.convex\.cloud\//) });

		const pdf = await storeFile(t, 'application/pdf', 1000);
		expect(await admin.mutation(api.adminProperties.saveUploadedImage, { storageId: pdf, kind: 'photo' })).toEqual({
			error: 'Images must be JPEG, PNG or WebP'
		});
		const bigPhoto = await storeFile(t, 'image/png', 9 * 1024 * 1024);
		expect(await admin.mutation(api.adminProperties.saveUploadedImage, { storageId: bigPhoto, kind: 'photo' })).toEqual({
			error: 'Photos must be 8 MB or smaller'
		});
		const panorama = await storeFile(t, 'image/webp', 11 * 1024 * 1024);
		expect(await admin.mutation(api.adminProperties.saveUploadedImage, { storageId: panorama, kind: 'panorama' })).toHaveProperty('url');
		const bigPanorama = await storeFile(t, 'image/webp', 13 * 1024 * 1024);
		expect(await admin.mutation(api.adminProperties.saveUploadedImage, { storageId: bigPanorama, kind: 'panorama' })).toEqual({
			error: 'Panoramas must be 12 MB or smaller'
		});
		const remaining = await t.run(async (ctx) =>
			Promise.all([pdf, bigPhoto, bigPanorama, good].map(async (id) => (await ctx.db.system.get(id)) !== null))
		);
		expect(remaining).toEqual([false, false, false, true]);
	});
});

describe('360 rooms', () => {
	async function villaWithRooms() {
		const env = setup();
		const propertyId = await env.admin.mutation(api.adminProperties.create, { name: 'Villa' });
		const add = (name: string, slug?: string) =>
			env.admin.mutation(api.adminProperties.createRoom, { propertyId, name, slug, imagePath: 'https://example.com/pano.webp' });
		const living = await add('Living Room');
		const pool = await add('Pool');
		const bedroom = await add('Bedroom');
		return { ...env, propertyId, living, pool, bedroom };
	}

	it('adds rooms with unique slugs and appends them to the tour', async () => {
		const { t, admin, propertyId } = await villaWithRooms();
		await expect(
			admin.mutation(api.adminProperties.createRoom, { propertyId, name: 'X', slug: 'pool', imagePath: '/x.webp' })
		).rejects.toThrow('already used');
		await admin.mutation(api.adminProperties.createRoom, { propertyId, name: 'Pool', imagePath: '/x.webp' });
		await expect(
			admin.mutation(api.adminProperties.createRoom, { propertyId, name: 'X', imagePath: 'javascript:alert(1)' })
		).rejects.toThrow('Images must be');
		expect((await t.run((ctx) => ctx.db.get(propertyId)))?.tourRoomIds).toEqual(['living-room', 'pool', 'bedroom', 'pool-2']);

		// Room slugs only need to be unique within a villa.
		const other = await admin.mutation(api.adminProperties.create, { name: 'Other' });
		await admin.mutation(api.adminProperties.createRoom, { propertyId: other, name: 'Pool', imagePath: '/x.webp' });
		expect((await admin.query(api.adminProperties.get, { propertyId: other }))?.rooms.map((room) => room.slug)).toEqual(['pool']);
	});

	it('reorders rooms and rejects stale orders', async () => {
		const { admin, propertyId } = await villaWithRooms();
		await admin.mutation(api.adminProperties.reorderRooms, { propertyId, roomSlugs: ['pool', 'bedroom', 'living-room'] });
		const data = await admin.query(api.adminProperties.get, { propertyId });
		expect(data?.rooms.map((room) => room.slug)).toEqual(['pool', 'bedroom', 'living-room']);
		await expect(admin.mutation(api.adminProperties.reorderRooms, { propertyId, roomSlugs: ['pool', 'bedroom'] })).rejects.toThrow('out of date');
		await expect(
			admin.mutation(api.adminProperties.reorderRooms, { propertyId, roomSlugs: ['pool', 'pool', 'bedroom'] })
		).rejects.toThrow('out of date');
	});

	it('saves validated hotspots', async () => {
		const { t, admin, living } = await villaWithRooms();
		await admin.mutation(api.adminProperties.setHotspots, {
			roomId: living,
			hotspots: [
				{ label: ' Pool ', targetRoomSlug: 'pool', position: [300, -30, -200] },
				{ label: 'Pool again', targetRoomSlug: 'pool', position: [1, 2, 3] }
			]
		});
		expect((await t.run((ctx) => ctx.db.get(living)))?.hotspots).toEqual([
			{ id: 'living-room-to-pool', label: 'Pool', targetRoomSlug: 'pool', position: [300, -30, -200] },
			{ id: 'living-room-to-pool-2', label: 'Pool again', targetRoomSlug: 'pool', position: [1, 2, 3] }
		]);
		const save = (hotspot: { label: string; targetRoomSlug: string; position: number[] }) =>
			admin.mutation(api.adminProperties.setHotspots, { roomId: living, hotspots: [hotspot] });
		await expect(save({ label: 'Self', targetRoomSlug: 'living-room', position: [0, 0, 0] })).rejects.toThrow('another room');
		await expect(save({ label: 'Gone', targetRoomSlug: 'garage', position: [0, 0, 0] })).rejects.toThrow('another room');
		await expect(save({ label: 'Flat', targetRoomSlug: 'pool', position: [0, 0] })).rejects.toThrow('x, y and z');
		await expect(save({ label: 'Far', targetRoomSlug: 'pool', position: [0, 0, 5000] })).rejects.toThrow('position');
		await expect(save({ label: ' ', targetRoomSlug: 'pool', position: [0, 0, 0] })).rejects.toThrow('label is required');
	});

	it('deletes a room and cleans hotspots and the tour order', async () => {
		const { t, admin, propertyId, living, pool, bedroom } = await villaWithRooms();
		await admin.mutation(api.adminProperties.setHotspots, {
			roomId: living,
			hotspots: [
				{ label: 'Pool', targetRoomSlug: 'pool', position: [1, 0, 0] },
				{ label: 'Bedroom', targetRoomSlug: 'bedroom', position: [0, 0, 1] }
			]
		});
		await admin.mutation(api.adminProperties.setHotspots, {
			roomId: bedroom,
			hotspots: [{ label: 'Pool', targetRoomSlug: 'pool', position: [1, 0, 0] }]
		});
		await admin.mutation(api.adminProperties.deleteRoom, { roomId: pool });

		const state = await t.run(async (ctx) => ({
			pool: await ctx.db.get(pool),
			living: await ctx.db.get(living),
			bedroom: await ctx.db.get(bedroom),
			property: await ctx.db.get(propertyId)
		}));
		expect(state.pool).toBeNull();
		expect(state.living?.hotspots.map((hotspot) => hotspot.targetRoomSlug)).toEqual(['bedroom']);
		expect(state.bedroom?.hotspots).toEqual([]);
		expect(state.property?.tourRoomIds).toEqual(['living-room', 'bedroom']);
	});

	it('duplicates a villa as a draft with photos, rooms, hotspots and OTA rates', async () => {
		const { t, admin, stranger, propertyId, living } = await villaWithRooms();
		await admin.mutation(api.adminProperties.setHotspots, {
			roomId: living,
			hotspots: [{ label: 'Pool', targetRoomSlug: 'pool', position: [1, 2, 3] }]
		});
		await t.run(async (ctx) => {
			await ctx.db.patch(propertyId, {
				pricePerNight: 9000,
				images: ['https://example.com/a.webp'],
				status: 'active',
				icalExportToken: 'secret'
			});
			await ctx.db.insert('otaRates', { propertyId, platform: 'agoda', nightlyRate: 9900, updatedAt: 0 });
			await ctx.db.insert('reviews', {
				propertyId, authorName: 'G', authorCity: '', authorCountry: '', authorAvatarUrl: '', rating: 5,
				title: 'Nice', body: 'Nice', date: '2026-01-01', verified: true
			});
		});
		await insertBooking(t, propertyId);

		const copyId = await admin.mutation(api.adminProperties.duplicate, { propertyId });
		const copy = await admin.query(api.adminProperties.get, { propertyId: copyId });
		expect(copy?.property).toMatchObject({
			name: 'Villa (copy)',
			slug: 'villa-copy',
			status: 'draft',
			pricePerNight: 9000,
			images: ['https://example.com/a.webp'],
			tourRoomIds: ['living-room', 'pool', 'bedroom']
		});
		expect(copy?.property.icalExportToken).toBeUndefined();
		expect(copy?.slugLocked).toBe(false);
		expect(copy?.rooms.map((room) => room.slug)).toEqual(['living-room', 'pool', 'bedroom']);
		const copiedLiving = copy?.rooms.find((room) => room.slug === 'living-room');
		expect(copiedLiving?._id).not.toBe(living);
		expect(copiedLiving?.hotspots).toEqual([{ id: 'living-room-to-pool', label: 'Pool', targetRoomSlug: 'pool', position: [1, 2, 3] }]);
		const children = await t.run(async (ctx) => ({
			rates: await ctx.db.query('otaRates').withIndex('by_property_platform', (q) => q.eq('propertyId', copyId)).collect(),
			reviews: await ctx.db.query('reviews').withIndex('by_property', (q) => q.eq('propertyId', copyId)).collect()
		}));
		expect(children.rates).toEqual([expect.objectContaining({ platform: 'agoda', nightlyRate: 9900 })]);
		expect(children.reviews).toEqual([]);

		expect((await admin.query(api.adminProperties.get, { propertyId: await admin.mutation(api.adminProperties.duplicate, { propertyId }) }))?.property.slug).toBe('villa-copy-2');
		await expect(stranger.mutation(api.adminProperties.duplicate, { propertyId })).rejects.toThrow('Not authorized');
	});

	it('requires an admin for room changes', async () => {
		const { stranger, propertyId, living } = await villaWithRooms();
		await expect(stranger.mutation(api.adminProperties.deleteRoom, { roomId: living })).rejects.toThrow('Not authorized');
		await expect(
			stranger.mutation(api.adminProperties.createRoom, { propertyId, name: 'X', imagePath: '/x.webp' })
		).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.adminProperties.reorderRooms, { propertyId, roomSlugs: [] })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.adminProperties.setHotspots, { roomId: living, hotspots: [] })).rejects.toThrow('Not authorized');
	});
});
