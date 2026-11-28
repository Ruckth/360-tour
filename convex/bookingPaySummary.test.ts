// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const now = Date.UTC(2026, 10, 3, 5);
const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(now);
});
afterEach(() => vi.useRealTimers());

async function booked() {
	const t = convexTest(schema, modules);
	await t.run((ctx) =>
		ctx.db.insert('properties', {
			slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 4,
			bedrooms: 1, bathrooms: 1, area: 40, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		})
	);
	const booking = await t.mutation(api.bookings.bookings.create, {
		propertySlug: 'villa', checkIn: day(10), checkOut: day(12), guests: 3, guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '+66812345678'
	});
	return { t, booking };
}

it('G30: a valid payment link reads the villa name, stay dates and guest count without guest identifiers', async () => {
	const { t, booking } = await booked();
	const summary = await t.query(api.bookings.bookings.getById, { id: booking.bookingId, accessToken: booking.accessToken });
	expect(summary).toMatchObject({ propertyName: 'Pool Villa', checkIn: day(10), checkOut: day(12), guests: 3, nights: 2 });
	expect(JSON.stringify(summary)).not.toMatch(/guest@example\.com|812345678|"Guest"/);
});

it('G30: an invalid or missing token reveals nothing about the stay', async () => {
	const { t, booking } = await booked();
	await expect(t.query(api.bookings.bookings.getById, { id: booking.bookingId, accessToken: 'wrong' })).rejects.toThrow();
	await expect(t.query(api.bookings.bookings.getById, { id: booking.bookingId })).rejects.toThrow();
});
