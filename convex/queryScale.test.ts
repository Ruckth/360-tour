import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
// Regressions for reads that used to stop at a fixed row count (see docs/plans/convex-query-optimization-audit.md).

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { markBookingPaid } from './bookings';
import { READ_BUDGET_ERROR, readBudget, ReadBudget, ReadBudgetExceeded, reserveWrites } from './lib/readBudget';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const adminEmail = 'admin@example.com';
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(Date.UTC(2030, 0, 1)); });
afterEach(() => vi.useRealTimers());

type Tester = ReturnType<typeof convexTest>;

const villa = {
	tagline: '',
	description: '',
	pricePerNight: 10000,
	currency: 'THB',
	maxGuests: 4,
	bedrooms: 1,
	bathrooms: 1,
	area: 40,
	images: [],
	amenities: [],
	tourRoomIds: [],
	directDiscountPercent: 0,
	status: 'active' as const
};

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', adminEmail);
	const t = convexTest(schema, modules);
	const propertyId = await t.run((ctx) => ctx.db.insert('properties', { ...villa, slug: 'villa', name: 'Villa' }));
	const admin = t.withIdentity({ email: adminEmail, tokenIdentifier: 'admin' });
	return { t, admin, propertyId };
}

function booking(
	propertyId: Id<'properties'>,
	checkIn: string,
	checkOut: string,
	status: Doc<'bookings'>['status'] = 'confirmed'
) {
	return {
		propertyId,
		guestName: 'Guest',
		guestPhone: '0800000000',
		checkIn,
		checkOut,
		guests: 2,
		nights: 1,
		subtotal: 10000,
		discountAmount: 0,
		total: 10000,
		currency: 'THB',
		paymentStatus: status === 'confirmed' ? ('paid' as const) : ('pending' as const),
		status,
		createdAt: Date.now()
	};
}

async function insertMany(t: Tester, count: number, row: (index: number) => Parameters<typeof booking>) {
	await t.run(async (ctx) => {
		for (let i = 0; i < count; i++) await insertFixture(ctx, 'bookings', booking(...row(i)));
	});
}

/** Starts a sync (takes its ticket) and applies `dates`, as the sync action does after fetching. */
async function applyFeed(t: Tester, sourceId: Id<'icalSources'>, dates: string[]) {
	const started = await t.mutation(internal.ical.beginSync, { sourceId });
	if (!started) throw new Error('Calendar not found');
	return await t.mutation(internal.ical.applySource, { sourceId, ticket: started.ticket, dates });
}

const guest = { guestName: 'New Guest', guestEmail: 'new@example.com', guestPhone: '0811111111', guests: 2 };

afterEach(() => {
	vi.unstubAllEnvs();
	vi.useRealTimers();
});

describe('booking overlap reads every relevant booking', () => {
	it('rejects a stay that conflicts with a mirror-less confirmed booking behind 500 old ones', async () => {
		const { t, admin, propertyId } = await setup();
		await insertMany(t, 500, () => [propertyId, '2020-01-01', '2020-01-03']);
		// Legacy booking: confirmed, but its nights were never mirrored into availability.
		await t.run((ctx) => insertFixture(ctx, 'bookings', booking(propertyId, '2030-01-01', '2030-01-05')));

		expect(await t.query(api.availability.isAvailable, { propertyId, checkIn: '2030-01-02', checkOut: '2030-01-03' })).toBe(false);
		await expect(
			t.mutation(api.bookings.create, { ...guest, propertySlug: 'villa', checkIn: '2030-01-02', checkOut: '2030-01-03' })
		).rejects.toThrow('no longer available');
		await expect(
			admin.mutation(api.adminBookings.createBooking, { ...guest, propertySlug: 'villa', checkIn: '2030-01-04', checkOut: '2030-01-06' })
		).rejects.toThrow('no longer available');

		// Checkout day is free, and the old history does not block unrelated nights.
		expect(await t.query(api.availability.isAvailable, { propertyId, checkIn: '2030-01-05', checkOut: '2030-01-07' })).toBe(true);
		await t.mutation(api.bookings.create, { ...guest, propertySlug: 'villa', checkIn: '2030-01-05', checkOut: '2030-01-07' });
	});

	it('does not let admin confirm or payment hold nights of a mirror-less confirmed booking', async () => {
		const { t, admin, propertyId } = await setup();
		const pending = await t.mutation(api.bookings.create, { ...guest, propertySlug: 'villa', checkIn: '2030-03-01', checkOut: '2030-03-04' });
		await t.run((ctx) => insertFixture(ctx, 'bookings', booking(propertyId, '2030-03-02', '2030-03-03')));

		await expect(
			admin.mutation(api.adminBookings.updateBooking, { bookingId: pending.bookingId, action: 'confirm' })
		).rejects.toThrow('no longer available');
		await expect(
			t.mutation(internal.bookings.markPaidFromTrustedWebhook, { bookingId: pending.bookingId })
		).rejects.toThrow('no longer available');
		const after = await t.run((ctx) => ctx.db.get(pending.bookingId));
		expect(after).toMatchObject({ status: 'pending', paymentStatus: 'pending' });
	});

	it('checks every availability row of a night, not only the first', async () => {
		const { t, propertyId } = await setup();
		const pending = await t.mutation(api.bookings.create, { ...guest, propertySlug: 'villa', checkIn: '2030-05-01', checkOut: '2030-05-02' });
		const sourceId = await t.run((ctx) =>
			ctx.db.insert('icalSources', { propertyId, platform: 'airbnb', icalUrl: 'https://example.com/a.ics' })
		);
		await t.run(async (ctx) => {
			// Model a legacy pending booking without a hold; an existing hold may keep an OTA overlap.
			for (const row of await ctx.db.query('availability').withIndex('by_property_date', q => q.eq('propertyId', propertyId).eq('date', '2030-05-01')).take(10)) {
				if (row.bookingId === pending.bookingId) await ctx.db.delete(row._id);
			}
			// A free row first, then an OTA block on the same night.
			await ctx.db.insert('availability', { propertyId, date: '2030-05-01', status: 'available', source: 'direct' });
			await ctx.db.insert('availability', { propertyId, date: '2030-05-01', status: 'blocked', source: 'airbnb', icalSourceId: sourceId });
		});

		expect(await t.query(api.availability.isAvailable, { propertyId, checkIn: '2030-05-01', checkOut: '2030-05-02' })).toBe(false);
		expect(await t.query(api.availability.getBlockedDates, { propertyId, startDate: '2030-05-01', endDate: '2030-05-01' })).toEqual(['2030-05-01']);
		// Payment validates through the hold itself: an OTA night is reported as blocked.
		await expect(
			t.mutation(internal.bookings.markPaidFromTrustedWebhook, { bookingId: pending.bookingId })
		).rejects.toThrow('blocked');
	});

	it('refuses to answer when neither side of the scan ends within the limit', async () => {
		const { t, propertyId } = await setup();
		await insertMany(t, 2001, () => [propertyId, '2020-01-01', '2020-01-02', 'cancelled']);
		await insertMany(t, 2001, () => [propertyId, '2035-01-01', '2035-01-02', 'cancelled']);
		await expect(
			t.query(api.availability.isAvailable, { propertyId, checkIn: '2030-01-01', checkOut: '2030-01-02' })
		).rejects.toThrow('Too many bookings');
	});
});

describe('admin calendar', () => {
	it('shows a long stay that started before 500 cancelled check-ins', async () => {
		const { t, admin, propertyId } = await setup();
		const longStay = await t.run((ctx) => insertFixture(ctx, 'bookings', booking(propertyId, '2030-01-01', '2030-04-01')));
		await insertMany(t, 500, () => [propertyId, '2030-02-01', '2030-02-03', 'cancelled']);

		const data = await admin.query(api.adminBookings.listForAdmin, { from: '2030-03-01', to: '2030-03-08' });
		expect(data.complete).toBe(true);
		expect(data.bookings.map((b) => b._id)).toEqual([longStay]);
	});

	it('lists every OTA row of a night and host blocks that began before the range', async () => {
		const { t, admin, propertyId } = await setup();
		await admin.mutation(api.adminBookings.addDateBlock, { propertyId, start: '2030-06-01', end: '2030-06-20', reason: 'Repairs' });
		const [a, b] = await t.run(async (ctx) => [
			await ctx.db.insert('icalSources', { propertyId, platform: 'airbnb', icalUrl: 'https://example.com/a.ics' }),
			await ctx.db.insert('icalSources', { propertyId, platform: 'agoda', icalUrl: 'https://example.com/b.ics' })
		]);
		await applyFeed(t, a, ['2030-06-25']);
		await applyFeed(t, b, ['2030-06-25']);

		const data = await admin.query(api.adminBookings.listForAdmin, { from: '2030-06-15', to: '2030-06-30' });
		expect(data.dateBlocks.map((block) => block.start)).toEqual(['2030-06-01']);
		expect(data.blocks.map((block) => block.source).sort()).toEqual(['agoda', 'airbnb']);
	});

	it('validates the requested range', async () => {
		const { admin } = await setup();
		await expect(admin.query(api.adminBookings.listForAdmin, { from: '2030-03-08', to: '2030-03-01' })).rejects.toThrow();
		await expect(admin.query(api.adminBookings.listForAdmin, { from: '2030-01-01', to: '2030-12-31' })).rejects.toThrow('at most');
	});
});

describe('iCal feeds larger than one batch', () => {
	async function feedWithRows(count: number) {
		const ctx = await setup();
		const sourceId = await ctx.admin.mutation(api.ical.addSource, {
			propertyId: ctx.propertyId,
			platform: 'airbnb',
			icalUrl: 'https://example.com/a.ics'
		});
		await ctx.t.run(async (db) => {
			const start = Date.UTC(2031, 0, 1);
			for (let i = 0; i < count; i++) {
				const date = new Date(start + i * 86_400_000).toISOString().slice(0, 10);
				await db.db.insert('availability', { propertyId: ctx.propertyId, date, status: 'blocked', source: 'airbnb', icalSourceId: sourceId });
			}
		});
		return { ...ctx, sourceId };
	}

	const rowsOf = async (t: Tester, sourceId: Id<'icalSources'>) =>
		(await t.run((ctx) => ctx.db.query('availability').collect())).filter((row) => row.icalSourceId === sourceId);

	it('removes every night of a 501-row feed, then the feed, and ignores syncs meanwhile', async () => {
		vi.useFakeTimers();
		const { t, admin, sourceId, propertyId } = await feedWithRows(501);
		const inFlight = (await t.mutation(internal.ical.beginSync, { sourceId }))!;
		await admin.mutation(api.ical.removeSource, { sourceId });

		// Hidden at once, and a sync that lands mid-removal writes nothing.
		expect(await admin.query(api.ical.listSources, { propertyId })).toEqual([]);
		expect(await t.mutation(internal.ical.applySource, { sourceId, ticket: inFlight.ticket, dates: ['2032-01-01'] })).toBeNull();
		await expect(admin.mutation(api.ical.updateSource, { sourceId, platform: 'agoda', icalUrl: 'https://example.com/a.ics' })).rejects.toThrow('not found');

		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await rowsOf(t, sourceId)).toHaveLength(0);
		expect(await t.run((ctx) => ctx.db.get(sourceId))).toBeNull();
	});

	it('relabels every night of a 501-row feed when its platform changes', async () => {
		vi.useFakeTimers();
		const { t, admin, sourceId } = await feedWithRows(501);
		await admin.mutation(api.ical.updateSource, { sourceId, platform: 'agoda', icalUrl: 'https://example.com/a.ics' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const rows = await rowsOf(t, sourceId);
		expect(rows).toHaveLength(501);
		expect(rows.every((row) => row.source === 'agoda')).toBe(true);
	});

	it('prunes every stale night of a 501-row feed in one sync', async () => {
		vi.useFakeTimers();
		const { t, sourceId } = await feedWithRows(501);
		await applyFeed(t, sourceId, ['2031-01-01']);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect((await rowsOf(t, sourceId)).map((row) => row.date)).toEqual(['2031-01-01']);
	});

	it('stops an older prune once a newer sync has run', async () => {
		vi.useFakeTimers();
		const { t, sourceId } = await feedWithRows(501);
		await applyFeed(t, sourceId, ['2031-01-01', '2033-01-01']);
		// Before the first prune finishes, the next sync wants a different night.
		await applyFeed(t, sourceId, ['2033-01-01', '2033-02-01']);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect((await rowsOf(t, sourceId)).map((row) => row.date).sort()).toEqual(['2033-01-01', '2033-02-01']);
	});

	it('rejects a feed far larger than the sync window', async () => {
		const { t, sourceId } = await feedWithRows(0);
		const dates = Array.from({ length: 401 }, (_, i) => new Date(Date.UTC(2031, 0, 1) + i * 86_400_000).toISOString().slice(0, 10));
		await expect(applyFeed(t, sourceId, dates)).rejects.toThrow('at most');
	});
});

describe('availability for the booking UI', () => {
	it('returns each blocked night once, for just the villas asked for', async () => {
		const { t, propertyId } = await setup();
		const other = await t.run((ctx) => ctx.db.insert('properties', { ...villa, slug: 'other', name: 'Other' }));
		const draft = await t.run((ctx) => ctx.db.insert('properties', { ...villa, slug: 'draft', name: 'Draft', status: 'draft' }));
		await t.run(async (ctx) => {
			for (const id of [propertyId, other, draft]) {
				await ctx.db.insert('availability', { propertyId: id, date: '2030-07-02', status: 'blocked', source: 'airbnb' });
				await ctx.db.insert('availability', { propertyId: id, date: '2030-07-02', status: 'blocked', source: 'agoda' });
			}
		});

		const blocked = await t.query(api.availability.getBlockedDatesByProperty, {
			startDate: '2030-07-01',
			endDate: '2030-07-31',
			propertyIds: [propertyId, draft]
		});
		expect(blocked).toEqual({ [propertyId]: ['2030-07-02'] });
		// A year for many villas at once is refused; the UI asks for the chosen stay only.
		const many = await t.run(async (ctx) =>
			Promise.all(Array.from({ length: 9 }, (_, i) => ctx.db.insert('properties', { ...villa, slug: `v${i}`, name: `V${i}` })))
		);
		await expect(
			t.query(api.availability.getBlockedDatesByProperty, { startDate: '2030-01-01', endDate: '2030-12-31', propertyIds: many })
		).rejects.toThrow('Too many villa nights');
		await expect(
			t.query(api.availability.getBlockedDates, { propertyId, startDate: '2030-01-01', endDate: '2031-06-01' })
		).rejects.toThrow('at most');
	});

	it('keeps booking ids and feed ids out of the public calendar rows', async () => {
		const { t, propertyId } = await setup();
		await t.run((ctx) => ctx.db.insert('availability', { propertyId, date: '2030-07-02', status: 'booked', source: 'direct' }));
		const rows = await t.query(api.availability.getForProperty, { propertyId, startDate: '2030-07-01', endDate: '2030-07-03' });
		expect(rows).toEqual([{ date: '2030-07-02', status: 'booked', source: 'direct' }]);
	});
});

describe('booking search and guest lookup', () => {
	it('finds an old booking by exact phone, email or code behind 1,000 newer ones', async () => {
		const { t, admin, propertyId } = await setup();
		const old = await t.mutation(api.bookings.create, {
			...guest,
			guestName: 'Old Guest',
			guestEmail: 'Old.Guest@Example.com',
			guestPhone: '+66 81 234 5678',
			propertySlug: 'villa',
			checkIn: '2030-01-01',
			checkOut: '2030-01-02'
		});
		await t.run((ctx) => ctx.db.patch(old.bookingId, { confirmationCode: 'CONF-2026-OLD123' }));
		await insertMany(t, 1000, () => [propertyId, '2029-01-01', '2029-01-02', 'cancelled']);

		for (const query of ['66812345678', 'old.guest@example.com', 'conf-2026-old123', 'Old']) {
			const results = await admin.query(api.adminBookings.searchBookings, { query });
			expect(results.map((b) => b._id), query).toContain(old.bookingId);
		}
		// Typed differently from how it was stored: only the digits index can match it.
		const guests = await admin.query(api.adminBookings.findGuests, { phone: '66-81-234-5678' });
		expect(guests.map((g) => g.guestName)).toContain('Old Guest');
	});
});

describe('lead dedup', () => {
	it('recognises a repeat sign-up behind more than 50 rows for the same email', async () => {
		const { t, propertyId } = await setup();
		await t.run(async (ctx) => {
			for (let i = 0; i < 60; i++) await ctx.db.insert('leads', { email: 'fan@example.com', source: 'tour_completion', createdAt: i });
		});
		const first = await t.mutation(api.leads.save, { email: 'fan@example.com', source: 'chat', propertyId });
		const again = await t.mutation(api.leads.save, { email: 'fan@example.com', source: 'chat', propertyId });
		expect(again).toBe(first);
		const chatLeads = (await t.run((ctx) => ctx.db.query('leads').collect())).filter((lead) => lead.source === 'chat');
		expect(chatLeads).toHaveLength(1);
	});
});


describe('calendar host blocks and villa count', () => {
	it('shows a mirror-less long host block behind 101 expired blocks', async () => {
		const { t, admin, propertyId } = await setup();
		const long = await t.run(async (ctx) => {
			const id = await ctx.db.insert('dateBlocks', { propertyId, start: '2020-01-01', end: '2031-01-01', reason: 'Renovation', createdAt: 1 });
			for (let i = 0; i < 101; i++) {
				await ctx.db.insert('dateBlocks', { propertyId, start: '2029-01-01', end: '2029-01-02', reason: `Old ${i}`, createdAt: 2 });
			}
			return id;
		});
		const data = await admin.query(api.adminBookings.listForAdmin, { from: '2030-03-01', to: '2030-03-08' });
		expect(data.dateBlocks.map((block) => block._id)).toEqual([long]);
		expect(data.complete).toBe(true);
	});

	it('says the view is incomplete when there are more villas than it shows', async () => {
		const { t, admin } = await setup();
		await t.run(async (ctx) => {
			for (let i = 0; i < 100; i++) await ctx.db.insert('properties', { ...villa, slug: `extra-${i}`, name: `Extra ${i}` });
		});
		const data = await admin.query(api.adminBookings.listForAdmin, { from: '2030-03-01', to: '2030-03-08' });
		expect(data.properties).toHaveLength(100);
		expect(data.complete).toBe(false);
	});
});

describe('shared read budget', () => {
	it('counts documents, bytes and ranges, and is shared by everything one invocation reads', async () => {
		const budget = new ReadBudget(3, 2, 1000);
		expect(budget.range()).toBe(true);
		expect(budget.document({ a: 'x'.repeat(10) })).toBe(true);
		expect(budget.document({ b: 'ไ'.repeat(100) })).toBe(true); // 300 UTF-8 bytes
		expect(budget.bytes).toBeGreaterThan(300);
		expect(budget.document({})).toBe(true);
		expect(budget.document({})).toBe(false);
		expect(() => budget.assert()).toThrow(ReadBudgetExceeded);
		expect(new ReadBudget(10, 10, 100).document({ big: 'x'.repeat(200) })).toBe(false);

		const ctxA = {};
		readBudget(ctxA).range();
		expect(readBudget(ctxA).ranges).toBe(1);
		expect(readBudget({}).ranges).toBe(0);
		reserveWrites(ctxA, 11_000);
		expect(() => reserveWrites(ctxA, 1_001)).toThrow('too many documents');
	});

	it('refuses availability and marks the calendar incomplete once reads pass the byte budget', async () => {
		const { t, admin, propertyId } = await setup();
		// 20 bookings of ~500 KB: one overlap scan alone would read more than the 8 MiB budget.
		await t.run(async (ctx) => {
			for (let i = 0; i < 20; i++) {
				await insertFixture(ctx, 'bookings', { ...booking(propertyId, '2029-01-01', '2029-01-02', 'cancelled'), adminNotes: 'x'.repeat(500_000) });
				await insertFixture(ctx, 'bookings', { ...booking(propertyId, '2031-01-01', '2031-01-02', 'cancelled'), adminNotes: 'x'.repeat(500_000) });
			}
		});
		await expect(
			t.query(api.availability.isAvailable, { propertyId, checkIn: '2030-01-01', checkOut: '2030-01-02' })
		).rejects.toThrow(READ_BUDGET_ERROR);
		await expect(
			t.mutation(api.bookings.create, { ...guest, propertySlug: 'villa', checkIn: '2030-01-01', checkOut: '2030-01-02' })
		).rejects.toThrow(READ_BUDGET_ERROR);
		const data = await admin.query(api.adminBookings.listForAdmin, { from: '2030-01-01', to: '2030-01-08' });
		expect(data.complete).toBe(false);
	});

	it('bounds the legacy whole-catalog availability call', async () => {
		const { t } = await setup();
		await t.run(async (ctx) => {
			for (let i = 0; i < 90; i++) {
				await ctx.db.insert('properties', { ...villa, slug: `big-${i}`, name: `Big ${i}`, description: 'x'.repeat(100_000) });
			}
		});
		await expect(
			t.query(api.availability.getBlockedDatesByProperty, { startDate: '2030-01-01', endDate: '2030-01-31' })
		).rejects.toThrow(READ_BUDGET_ERROR);
		await t.run(async (ctx) => {
			for (let i = 0; i < 20; i++) await ctx.db.insert('properties', { ...villa, slug: `more-${i}`, name: `More ${i}` });
		});
		await expect(
			t.query(api.availability.getBlockedDatesByProperty, { startDate: '2030-01-01', endDate: '2030-01-31' })
		).rejects.toThrow();
	});

	it('checks a payment with one overlap scan and one read per night', async () => {
		const { t } = await setup();
		const pending = await t.mutation(api.bookings.create, { ...guest, propertySlug: 'villa', checkIn: '2030-08-01', checkOut: '2030-08-04' });
		const ranges = await t.run(async (ctx) => {
			await markBookingPaid(ctx, pending.bookingId, 'test');
			return readBudget(ctx).ranges;
		});
		// Two overlap ranges (starts before / ends after) plus one per night; nothing checked twice.
		expect(ranges).toBe(2 + 3);
		expect(await t.run((ctx) => ctx.db.get(pending.bookingId))).toMatchObject({ status: 'confirmed', paymentStatus: 'paid' });
	});
});
