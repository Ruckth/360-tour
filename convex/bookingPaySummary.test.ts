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
	expect(summary?.holdExpiresAt).toBeGreaterThan(now);
	expect(JSON.stringify(summary)).not.toMatch(/guest@example\.com|812345678|"Guest"/);
});

it('G30: an invalid or missing token reveals nothing about the stay', async () => {
	const { t, booking } = await booked();
	await expect(t.query(api.bookings.bookings.getById, { id: booking.bookingId, accessToken: 'wrong' })).rejects.toThrow();
	await expect(t.query(api.bookings.bookings.getById, { id: booking.bookingId })).rejects.toThrow();
});

it('G30: a malformed link id is a plain "not found", not a validator failure', async () => {
	const { t } = await booked();
	expect(await t.query(api.bookings.bookings.getById, { id: 'not-a-booking-id', accessToken: 'secret' })).toBeNull();
	expect(await t.query(api.bookings.bookings.getById, { id: '', accessToken: 'secret' })).toBeNull();
});

it('G30: the pay state follows the checkout rules, keeping a positive balance on a paid stay payable', async () => {
	const { t, booking } = await booked();
	const read = () => t.query(api.bookings.bookings.getById, { id: booking.bookingId, accessToken: booking.accessToken });
	const patch = (fields: Record<string, unknown>) => t.run((ctx) => ctx.db.patch(booking.bookingId, fields));
	const total = (await read())!.total;
	expect(await read()).toMatchObject({ payState: 'payable', amountDue: total });
	await patch({ status: 'confirmed', paymentStatus: 'paid', amountPaid: total - 5000 });
	expect(await read()).toMatchObject({ payState: 'payable', amountDue: 5000 });
	expect((await read())?.holdExpiresAt).toBeUndefined();
	await patch({ amountPaid: total });
	expect(await read()).toMatchObject({ payState: 'settled', amountDue: 0 });
	await patch({ status: 'cancelled', paymentStatus: 'refunded', amountPaid: 0 });
	expect((await read())!.payState).toBe('closed');
	await patch({ status: 'cancelled', paymentStatus: 'pending', cancelledBy: 'system:expiry' });
	expect((await read())!.payState).toBe('expired');
	await patch({ status: 'pending', cancelledBy: undefined });
	vi.setSystemTime(now + 2 * 86_400_000);
	expect((await read())!.payState).toBe('expired');
});
