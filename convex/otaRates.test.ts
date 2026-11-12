// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

declare global { interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; } }
const modules = import.meta.glob('./**/*.ts');
afterEach(() => vi.unstubAllEnvs());

async function setup(status: 'active' | 'draft' = 'active') {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const propertyId = await t.run(async (ctx) => await ctx.db.insert('properties', {
		slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 1000000, currency: 'THB', maxGuests: 2,
		bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 1500, status
	}));
	return { t, admin, propertyId };
}

describe('OTA reference rates', () => {
	it('requires an admin to read or write rates', async () => {
		const { t, propertyId } = await setup();
		await expect(t.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'agoda', nightlyRate: 900000 })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		await expect(stranger.query(api.properties.listOtaRates, { propertyId })).rejects.toThrow('Not authorized');
		const rateId = await t.run(async (ctx) => await ctx.db.insert('otaRates', { propertyId, platform: 'agoda', nightlyRate: 900000, updatedAt: 0 }));
		await expect(t.mutation(api.properties.removeOtaRate, { rateId })).rejects.toThrow('Not authenticated');
	});

	it('upserts one rate per platform and exposes it with direct pricing', async () => {
		const { t, admin, propertyId } = await setup();
		expect(await t.query(api.properties.getOtaComparison, { slug: 'villa' })).toEqual({
			currency: 'THB', pricePerNight: 1000000, directDiscountPercent: 1500, rates: []
		});

		const first = await admin.mutation(api.properties.upsertOtaRate, {
			propertyId, platform: 'booking_com', nightlyRate: 1199960, url: ' https://www.booking.com/hotel/th/villa.html '
		});
		const second = await admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'booking_com', nightlyRate: 1250000 });
		await admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'airbnb', nightlyRate: 1100000 });
		expect(second).toBe(first);

		const comparison = await t.query(api.properties.getOtaComparison, { slug: 'villa' });
		const bookingCom = comparison?.rates.find((rate) => rate.platform === 'booking_com');
		expect(comparison?.rates).toHaveLength(2);
		expect(bookingCom).toMatchObject({ nightlyRate: 1250000 });
		expect(bookingCom?.url).toBeUndefined();
		expect(bookingCom?.updatedAt).toEqual(expect.any(Number));

		await admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'agoda', nightlyRate: 980040, url: 'https://www.agoda.com/villa' });
		const rates = await admin.query(api.properties.listOtaRates, { propertyId });
		expect(rates.find((rate) => rate.platform === 'agoda')).toMatchObject({ nightlyRate: 980040, url: 'https://www.agoda.com/villa' });
	});

	it('rejects invalid rates and non-HTTPS links', async () => {
		const { admin, propertyId } = await setup();
		await expect(admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'expedia', nightlyRate: 0 })).rejects.toThrow('positive');
		await expect(admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'expedia', nightlyRate: Number.NaN })).rejects.toThrow('positive');
		await expect(admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'expedia', nightlyRate: 1000000100 })).rejects.toThrow('positive');
		await expect(admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'expedia', nightlyRate: 900000, url: `https://expedia.com/${'x'.repeat(481)}` })).rejects.toThrow('HTTPS');
		await expect(admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'expedia', nightlyRate: 900000, url: 'http://expedia.com/x' })).rejects.toThrow('HTTPS');
		await expect(admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'expedia', nightlyRate: 900000, url: 'javascript:alert(1)' })).rejects.toThrow('HTTPS');
		expect(await admin.query(api.properties.listOtaRates, { propertyId })).toEqual([]);
	});

	it('removes rates and hides comparisons for inactive villas', async () => {
		const { t, admin, propertyId } = await setup('draft');
		const rateId = await admin.mutation(api.properties.upsertOtaRate, { propertyId, platform: 'agoda', nightlyRate: 900000 });
		expect(await t.query(api.properties.getOtaComparison, { slug: 'villa' })).toBeNull();
		expect(await t.query(api.properties.getOtaComparison, { slug: 'missing' })).toBeNull();
		await admin.mutation(api.properties.removeOtaRate, { rateId });
		await admin.mutation(api.properties.removeOtaRate, { rateId });
		expect(await admin.query(api.properties.listOtaRates, { propertyId })).toEqual([]);
	});
});
