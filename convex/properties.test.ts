// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const { propertyId, roomId } = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'pool-villa', name: 'Pool Villa', tagline: 'Sea views', description: 'Villa', pricePerNight: 8500,
			currency: 'THB', maxGuests: 4, bedrooms: 2, bathrooms: 2, area: 145, images: [], amenities: [],
			tourRoomIds: [], directDiscountPercent: 10, status: 'active'
		});
		const roomId = await ctx.db.insert('rooms', { propertyId, slug: 'living', name: 'Living', imagePath: '/living.webp', hotspots: [] });
		return { propertyId, roomId };
	});
	return { t, admin, propertyId, roomId };
}

afterEach(() => vi.unstubAllEnvs());

describe('admin property editing', () => {
	it('requires an admin for reads and writes', async () => {
		const { t, propertyId, roomId } = await setup();
		await expect(t.query(api.properties.adminList, {})).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.properties.update, { propertyId, name: 'X' })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other' });
		await expect(stranger.query(api.properties.adminGet, { propertyId })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.properties.updateRoom, { roomId, name: 'X' })).rejects.toThrow('Not authorized');
	});

	it('updates property fields and excludes inactive villas from the public list', async () => {
		const { t, admin, propertyId } = await setup();
		await admin.mutation(api.properties.update, {
			propertyId, name: '  Tideglass Residence ', currency: 'usd', pricePerNight: 300, directDiscountPercent: 15,
			amenities: ['Pool', ' ', 'Wi-Fi'], images: ['https://example.com/a.jpg', '/b.webp'], status: 'draft'
		});
		expect(await t.run((ctx) => ctx.db.get(propertyId))).toMatchObject({
			name: 'Tideglass Residence', currency: 'USD', pricePerNight: 300, directDiscountPercent: 15,
			amenities: ['Pool', 'Wi-Fi'], images: ['https://example.com/a.jpg', '/b.webp'], status: 'draft', tagline: 'Sea views'
		});
		expect(await t.query(api.properties.list, {})).toHaveLength(0);
		expect(await admin.query(api.properties.adminList, {})).toHaveLength(1);
	});

	it('validates property input', async () => {
		const { admin, propertyId } = await setup();
		await expect(admin.mutation(api.properties.update, { propertyId, name: ' ' })).rejects.toThrow('Name is required');
		await expect(admin.mutation(api.properties.update, { propertyId, pricePerNight: -1 })).rejects.toThrow('Price per night');
		await expect(admin.mutation(api.properties.update, { propertyId, directDiscountPercent: 101 })).rejects.toThrow('between 0 and 100');
		await expect(admin.mutation(api.properties.update, { propertyId, maxGuests: 0 })).rejects.toThrow('Max guests');
		await expect(admin.mutation(api.properties.update, { propertyId, bedrooms: 1.5 })).rejects.toThrow('whole number');
		await expect(admin.mutation(api.properties.update, { propertyId, currency: 'baht' })).rejects.toThrow('3-letter');
		await expect(admin.mutation(api.properties.update, { propertyId, images: ['javascript:alert(1)'] })).rejects.toThrow('Images must be');
		await expect(admin.mutation(api.properties.update, { propertyId, images: ['//evil.com/x.jpg'] })).rejects.toThrow('Images must be');
	});

	it('updates rooms', async () => {
		const { t, admin, propertyId, roomId } = await setup();
		await admin.mutation(api.properties.updateRoom, { roomId, name: 'Living room', imagePath: '/new-living.webp' });
		expect(await t.query(api.properties.getTourRooms, { slug: 'pool-villa' })).toEqual([
			{ slug: 'living', name: 'Living room', imagePath: '/new-living.webp' }
		]);
		await admin.mutation(api.properties.update, { propertyId, status: 'draft' });
		expect(await t.query(api.properties.getTourRooms, { slug: 'pool-villa' })).toBeNull();
		await expect(admin.mutation(api.properties.updateRoom, { roomId, name: '' })).rejects.toThrow('Room name is required');
	});

});
