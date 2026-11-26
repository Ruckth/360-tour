// @vitest-environment edge-runtime

import { asTestOwner } from './testing/staff.test-support';
import { convexTest } from 'convex-test';
import { getDocumentSize } from 'convex/values';
import { describe, expect, it } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function setup() {
	const t = convexTest(schema, modules);
	const admin = await asTestOwner(t, { emailVerified: true, email: 'admin@example.com', tokenIdentifier: 'admin' });
	const { propertyId, roomId } = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'pool-villa', name: 'Pool Villa', tagline: 'Sea views', description: 'Villa', pricePerNight: 850000,
			currency: 'THB', maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 145, images: [], amenities: [],
			tourRoomIds: [], directDiscountPercent: 1000, status: 'active'
		});
		const roomId = await ctx.db.insert('tourScenes', { propertyId, slug: 'living', name: 'Living', imagePath: '/living.webp', hotspots: [] });
		return { propertyId, roomId };
	});
	return { t, admin, propertyId, roomId };
}

async function legacyTourWithHeadroom(headroom: number) {
	const { t, admin, propertyId, roomId } = await setup();
	const secondRoom = await t.run(async ctx => {
		const second = await ctx.db.insert('tourScenes', {
			propertyId, slug: 'second', name: 'Second', imagePath: '/second.webp', hotspots: []
		});
		for (let i = 0; i < 49; i++) {
			await ctx.db.insert('tourScenes', {
				propertyId, slug: `room-${i}`, name: i < 3 ? 'x'.repeat(600_000) : 'Small',
				imagePath: '/room.webp', hotspots: []
			});
		}
		const rooms = await ctx.db.query('tourScenes').withIndex('by_property', q => q.eq('propertyId', propertyId)).take(51);
		const bytes = rooms.reduce((total, room) => total + getDocumentSize(room), 0);
		const paddingRoom = rooms[2];
		await ctx.db.patch(paddingRoom._id, { name: paddingRoom.name + 'x'.repeat(2 * 1024 * 1024 - headroom - bytes) });
		return second;
	});
	return { t, admin, propertyId, roomId, secondRoom };
}

describe('admin property editing', () => {
	it('requires an admin for reads and writes', async () => {
		const { t, propertyId, roomId } = await setup();
		await expect(t.query(api.catalog.properties.adminList, {})).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.catalog.properties.update, { propertyId, name: 'X' })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ emailVerified: true, email: 'other@example.com', tokenIdentifier: 'other' });
		await expect(stranger.mutation(api.catalog.properties.updateRoom, { roomId, name: 'X' })).rejects.toThrow('Not authorized');
	});

	it('updates property fields and excludes inactive villas from the public list', async () => {
		const { t, admin, propertyId } = await setup();
		await admin.mutation(api.catalog.properties.update, {
			propertyId, name: '  Tideglass Residence ', currency: 'usd', pricePerNight: 30000, directDiscountPercent: 1500,
			amenities: ['Pool', ' ', 'Wi-Fi'], images: ['https://images.unsplash.com/a.jpg', '/b.webp'], status: 'draft'
		});
		expect(await t.run((ctx) => ctx.db.get(propertyId))).toMatchObject({
			name: 'Tideglass Residence', currency: 'USD', pricePerNight: 30000, directDiscountPercent: 1500,
			amenities: ['Pool', 'Wi-Fi'], images: ['https://images.unsplash.com/a.jpg', '/b.webp'], status: 'draft', tagline: 'Sea views'
		});
		expect(await t.query(api.catalog.properties.list, {})).toHaveLength(0);
		expect(await admin.query(api.catalog.properties.adminList, {})).toHaveLength(1);
	});

	it('validates property input', async () => {
		const { admin, propertyId } = await setup();
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, name: ' ' })).rejects.toThrow('Name is required');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, pricePerNight: -100 })).rejects.toThrow('Price per night');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, directDiscountPercent: 10100 })).rejects.toThrow('between 0 and 100');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, maxGuests: 0 })).rejects.toThrow('Max guests');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, bedrooms: 1.5 })).rejects.toThrow('whole number');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, currency: 'baht' })).rejects.toThrow('3-letter');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, images: ['javascript:alert(1)'] })).rejects.toThrow('Images must be');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, images: ['//evil.com/x.jpg'] })).rejects.toThrow('Images must be');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, images: ['https://example.com/x.jpg'] })).rejects.toThrow('uploaded photo');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, images: ['https://evil.convex.cloud.example.com/x.jpg'] })).rejects.toThrow('uploaded photo');
		await expect(admin.mutation(api.catalog.properties.update, { propertyId, images: ['https://nested.demo.convex.cloud/x.jpg'] })).rejects.toThrow('uploaded photo');
		await admin.mutation(api.catalog.properties.update, { propertyId, images: ['https://demo.convex.cloud/x.jpg', 'https://qr-official.line.me/x.jpg'] });
	});

	it('updates rooms', async () => {
		const { t, admin, propertyId, roomId } = await setup();
		await admin.mutation(api.catalog.properties.updateRoom, { roomId, name: 'Living room', imagePath: '/new-living.webp' });
		expect(await t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' })).toEqual([
			{ slug: 'living', name: 'Living room', imagePath: '/new-living.webp', hotspots: [] }
		]);
		await admin.mutation(api.catalog.properties.update, { propertyId, status: 'draft' });
		expect(await t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' })).toBeNull();
		await expect(admin.mutation(api.catalog.properties.updateRoom, { roomId, name: '' })).rejects.toThrow('Room name is required');
	});

	it('returns tour rooms in tour order, then unlisted rooms by creation, with hotspots', async () => {
		const { t, propertyId } = await setup();
		const hotspot = { id: 'pool-to-living', position: [1, 2, 3], targetRoomSlug: 'living', label: 'Living' };
		await t.run(async (ctx) => {
			await ctx.db.insert('tourScenes', { propertyId, slug: 'pool', name: 'Pool', imagePath: '/pool.webp', hotspots: [hotspot] });
			await ctx.db.insert('tourScenes', { propertyId, slug: 'bedroom', name: 'Bedroom', imagePath: '/bed.webp', hotspots: [] });
			await ctx.db.insert('tourScenes', { propertyId, slug: 'terrace', name: 'Terrace', imagePath: '/terrace.webp', hotspots: [] });
			await ctx.db.patch(propertyId, { tourRoomIds: ['pool', 'living'] });
		});
		const rooms = await t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' });
		expect(rooms?.map((room) => room.slug)).toEqual(['pool', 'living', 'bedroom', 'terrace']);
		expect(rooms?.[0].hotspots).toEqual([hotspot]);
	});

	it('orders a legacy 51-room tour before limiting guests and lets staff reduce it', async () => {
		const { t, admin, propertyId, roomId } = await setup();
		const explicit = await t.run(async (ctx) => {
			for (let i = 1; i < 50; i++) {
				await ctx.db.insert('tourScenes', {
					propertyId, slug: `room-${i}`, name: `Room ${i}`, imagePath: '/room.webp',
					hotspots: i === 1 ? [{ id: 'to-living', position: [1, 2, 3], targetRoomSlug: 'living', label: 'Living' }] : []
				});
			}
			const last = await ctx.db.insert('tourScenes', {
				propertyId, slug: 'last-created', name: 'Opening scene', imagePath: '/opening.webp', hotspots: []
			});
			await ctx.db.patch(propertyId, { tourRoomIds: ['missing', 'last-created', 'room-2', 'last-created'] });
			return last;
		});
		const getTour = () => t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' });
		const rooms = await getTour();
		const ordered = ['last-created', 'room-2', 'living', 'room-1',
			...Array.from({ length: 47 }, (_, index) => `room-${index + 3}`)];
		expect(rooms?.map((room) => room.slug)).toEqual(ordered.slice(0, 50));
		expect(rooms?.[0].imagePath).toBe('/opening.webp');
		expect((await admin.query(api.catalog.adminProperties.get, { propertyId }))?.rooms.map(room => room.slug)).toEqual(ordered);

		await expect(admin.mutation(api.catalog.adminProperties.duplicate, { propertyId })).rejects.toThrow('before duplicating');
		await expect(admin.mutation(api.catalog.adminProperties.createRoom, {
			propertyId, name: 'New room', imagePath: '/new.webp'
		})).rejects.toThrow('at most 50 rooms');

		const reordered = ['room-49', ...ordered.slice(0, -1)];
		await admin.mutation(api.catalog.adminProperties.reorderRooms, { propertyId, roomSlugs: reordered });
		expect((await getTour())?.map(room => room.slug)).toEqual(reordered.slice(0, 50));
		await admin.mutation(api.catalog.adminProperties.deleteRoom, { roomId });
		await admin.mutation(api.catalog.adminProperties.setHotspots, {
			roomId: explicit, hotspots: [{ label: 'Last guest room', targetRoomSlug: 'room-48', position: [0, 0, 1] }]
		});
		const recovered = await getTour();
		expect(recovered?.map(room => room.slug)).toEqual(reordered.filter(slug => slug !== 'living'));
		expect(recovered?.find(room => room.slug === 'room-1')?.hotspots).toEqual([]);
		expect(recovered?.find(room => room.slug === 'last-created')?.hotspots).toMatchObject([{ targetRoomSlug: 'room-48' }]);
	});

	it('rejects a legacy tour over the recovery limit instead of silently selecting from a partial list', async () => {
		const { t, admin, propertyId, roomId } = await setup();
		await t.run(async ctx => {
			for (let i = 1; i < 511; i++) {
				await ctx.db.insert('tourScenes', {
					propertyId, slug: `room-${i}`, name: `Room ${i}`, imagePath: '/room.webp', hotspots: []
				});
			}
			await ctx.db.patch(propertyId, { tourRoomIds: ['room-510'] });
		});
		await expect(t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' })).rejects.toThrow('safe editor limit');
		await expect(admin.query(api.catalog.adminProperties.get, { propertyId })).rejects.toThrow('verified export');
		await expect(admin.mutation(api.catalog.adminProperties.deleteRoom, { roomId })).rejects.toThrow('verified export');
		expect(await t.run(ctx => ctx.db.get(roomId))).not.toBeNull();
	});

	it('keeps the ordinary tour byte tolerance and enforces the byte cap on legacy tours', async () => {
		const { t, admin, propertyId, roomId } = await setup();
		await t.run(async ctx => {
			const largeName = 'Scene '.repeat(125_000);
			for (let i = 1; i < 50; i++) {
				await ctx.db.insert('tourScenes', {
					propertyId, slug: `room-${i}`, name: i <= 3 ? largeName : `Room ${i}`,
					imagePath: '/room.webp', hotspots: []
				});
			}
		});
		const getTour = () => t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' });
		const getEditor = () => admin.query(api.catalog.adminProperties.get, { propertyId });
		expect(await getTour()).toHaveLength(50);
		expect((await getEditor())?.rooms).toHaveLength(50);
		const reads = await admin.run(async ctx => {
			const before = await ctx.meta.getTransactionMetrics();
			const living = await ctx.db.query('tourScenes').withIndex('by_property', q => q.eq('propertyId', propertyId)).first();
			await ctx.runMutation(api.catalog.properties.updateRoom, { roomId: living!._id, name: 'Living room' });
			const after = await ctx.meta.getTransactionMetrics();
			return after.documentsRead.used - before.documentsRead.used;
		});
		expect(reads).toBeLessThan(10);
		expect((await t.run(ctx => ctx.db.get(roomId)))?.ordinaryTourCertified).toBeUndefined();
		await t.run(ctx => ctx.db.insert('tourScenes', {
			propertyId, slug: 'overflow', name: 'Overflow', imagePath: '/room.webp', hotspots: []
		}));
		await expect(getTour()).rejects.toThrow('verified export');
		await expect(getEditor()).rejects.toThrow('verified export');
	});

	it('drops a certificate rather than blocking a valid near-limit room rename', async () => {
		const { admin, t, roomId } = await setup();
		await t.run(ctx => ctx.db.patch(roomId, { ordinaryTourCertified: true }));
		const before = (await t.run(ctx => ctx.db.get(roomId)))!;
		const { ordinaryTourCertified, ...unmarked } = before;
			expect(ordinaryTourCertified).toBe(true);
			const name = 'x'.repeat(1024 * 1024 - getDocumentSize({ ...unmarked, name: '' }));
		expect(getDocumentSize({ ...before, name })).toBeGreaterThan(1024 * 1024);
		await admin.mutation(api.catalog.properties.updateRoom, { roomId, name });
		const after = (await t.run(ctx => ctx.db.get(roomId)))!;
		expect(after.name).toBe(name);
		expect(after.ordinaryTourCertified).toBeUndefined();
		expect(getDocumentSize(after)).toBe(1024 * 1024);
	});

	it('allows the exact legacy byte limit and rejects name and hotspot growth past it', async () => {
		const { admin, t, roomId, propertyId } = await legacyTourWithHeadroom(1);
		const reads = await admin.run(async ctx => {
			const before = await ctx.meta.getTransactionMetrics();
			await ctx.runMutation(api.catalog.properties.updateRoom, { roomId, name: 'Living1' });
			const after = await ctx.meta.getTransactionMetrics();
			return after.documentsRead.used - before.documentsRead.used;
		});
		expect(reads).toBe(1 + 53); // Owner grant + the scene and related rows.
		expect((await admin.query(api.catalog.adminProperties.get, { propertyId }))?.rooms).toHaveLength(51);
		expect(await t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' })).toHaveLength(50);
		await expect(admin.mutation(api.catalog.properties.updateRoom, { roomId, name: 'Living12' }))
			.rejects.toThrow('exceed its safe size limit');
		await expect(admin.mutation(api.catalog.adminProperties.setHotspots, {
			roomId, hotspots: [{ label: 'Next', targetRoomSlug: 'second', position: [1, 2, 3] }]
		})).rejects.toThrow('exceed its safe size limit');
		expect(await t.run(ctx => ctx.db.get(roomId))).toMatchObject({ name: 'Living1', hotspots: [] });
		await admin.mutation(api.catalog.properties.updateRoom, { roomId, name: 'L' });
		expect((await admin.query(api.catalog.adminProperties.get, { propertyId }))?.rooms).toHaveLength(51);
	});

	it.each([100, 101, 102])('preserves %i bytes of shared legacy headroom across distinct edits', async (headroom) => {
		const { admin, t, roomId, secondRoom } = await legacyTourWithHeadroom(headroom);
		const change = (target: typeof roomId) =>
			admin.mutation(api.catalog.properties.updateRoom, { roomId: target, name: 'Edited' + 'x'.repeat(64) });
		const results = await Promise.allSettled([change(roomId), change(secondRoom)]);
		expect(results.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
		expect((await t.run(ctx => ctx.db.get(roomId)))?.ordinaryTourCertified).toBeUndefined();
		expect(results.find(result => result.status === 'rejected')).toMatchObject({
			reason: expect.objectContaining({ message: expect.stringContaining('exceed its safe size limit') })
		});
		expect(await t.query(api.catalog.properties.getTourRooms, { slug: 'pool-villa' })).toHaveLength(50);
	});

});
