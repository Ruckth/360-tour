import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { BOOKING_RULE_DEFAULTS, type BookingRules } from './lib/siteSettings';

const modules = import.meta.glob('./**/*.ts');
const now = Date.UTC(2026, 10, 3, 5); // Noon in Bangkok.
const minute = 60_000;
const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
const stay = {
	propertySlug: 'villa',
	checkIn: day(10),
	checkOut: day(12),
	guests: 2,
	guestName: 'Guest',
	guestPhone: '+66812345678'
};
const webStay = { ...stay, guestEmail: 'guest@example.com' };
beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(now);
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
	vi.unstubAllGlobals();
});

async function setup(rules?: Partial<BookingRules>) {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const { propertyId, sessionId } = await t.run(async (ctx) => ({
		propertyId: await ctx.db.insert('properties', {
			slug: 'villa',
			name: 'Pool Villa',
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
			status: 'active'
		}),
		sessionId: await ctx.db.insert('conversations', { channel: 'web', visitorId: 'guest', createdAt: now })
	}));
	if (rules) await admin.mutation(api.settings.update, { bookingRules: rules });
	const prepare = () => t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...stay });
	return { t, admin, propertyId, sessionId, prepare };
}

async function startCheckout(
	t: ReturnType<typeof convexTest>,
	booking: { bookingId: import('./_generated/dataModel').Id<'bookings'>; accessToken: string },
	save = true
) {
	const { request } = await t.mutation(internal.bookings.payments.stripe.beginCheckout, { ...booking, siteUrl: 'https://example.com' });
	if (!request) throw new Error('Missing checkout request');
	if (save)
		await t.mutation(internal.bookings.payments.stripe.saveCheckoutSession, {
			...booking,
			sessionId: 'cs_test',
			url: 'https://checkout.stripe.com/test',
			expiresAt: request.expiresAt,
			attempt: request.attempt,
			total: request.total,
			currency: request.currency,
			checkIn: request.checkIn,
			checkOut: request.checkOut
		});
	return request;
}

const complete = (t: ReturnType<typeof convexTest>, bookingId: import('./_generated/dataModel').Id<'bookings'>) =>
	t.mutation(internal.bookings.payments.stripe.completeCheckout, {
		bookingId,
		sessionId: 'cs_test',
		amountTotal: 20000,
		currency: 'thb',
		paymentIntentId: 'pi_test'
	});

describe('booking rule settings', () => {
	it('resolves defaults for missing settings and partially saved rules', async () => {
		const { t, admin } = await setup();
		expect((await admin.query(api.settings.get, {})).bookingRules).toEqual(BOOKING_RULE_DEFAULTS);
		await admin.mutation(api.settings.update, { bookingRules: { minNights: 2 } });
		expect((await t.query(api.settings.publicProfile, {})).bookingRules).toEqual({
			...BOOKING_RULE_DEFAULTS,
			minNights: 2
		});
	});
	it.each([
		{ unpaidHoldMinutes: 9 },
		{ unpaidHoldMinutes: 1441 },
		{ unpaidHoldMinutes: 10.5 },
		{ chatQuoteValidityMinutes: 0 },
		{ chatQuoteValidityMinutes: 1441 },
		{ preArrivalDaysBefore: 0 },
		{ preArrivalDaysBefore: 31 },
		{ reviewDaysAfter: 0 },
		{ reviewDaysAfter: 8 },
		{ minNights: 0 },
		{ minNights: 366 },
		{ maxAdvanceDays: -1 },
		{ maxAdvanceDays: 731 },
		{ sameDayCutoff: '24:00' },
		{ sameDayCutoff: '9:00' },
		{ sameDayCutoff: '12:60' },
		{ minNights: NaN },
		{ unpaidHoldMinutes: Infinity }
	])('rejects invalid values %j on the server without writing settings', async (bookingRules) => {
		const { t, admin } = await setup();
		await expect(admin.mutation(api.settings.update, { bookingRules })).rejects.toThrow();
		expect(await t.run((ctx) => ctx.db.query('siteSettings').first())).toBeNull();
	});
	it('revisions and restores booking rules through configuration history', async () => {
		const { t, admin } = await setup({ minNights: 3, sameDayCutoff: '18:00' });
		const entry = (await t.run((ctx) =>
			ctx.db
				.query('recordChanges')
				.withIndex('by_entityType_and_entityId_and_recordedAt', (q) =>
					q.eq('entityType', 'settings').eq('entityId', 'default')
				)
				.first()
		))!;
		await admin.mutation(api.settings.update, {
			bookingRules: { minNights: 4, sameDayCutoff: '' },
			expectedRevision: 1
		});
		await expect(
			admin.mutation(api.settings.update, { bookingRules: { minNights: 5 }, expectedRevision: 1 })
		).rejects.toThrow('Settings changed');
		const restored = await admin.mutation(api.settings.restore, {
			historyId: entry._id,
			side: 'after',
			expectedRevision: 2
		});
		expect(restored).toMatchObject({ revision: 3, bookingRules: { minNights: 3, sameDayCutoff: '18:00' } });
	});
});

const cases = [
	{ rule: { minNights: 3 }, dates: {}, error: 'Minimum stay is 3 nights' },
	{ rule: { maxAdvanceDays: 5 }, dates: {}, error: 'within 5 days' },
	{
		rule: { sameDayCutoff: '12:00' },
		dates: { checkIn: day(0), checkOut: day(2) },
		error: 'Same-day check-in closes at 12:00'
	}
];
for (const path of ['web', 'chatPrepare', 'chatConfirm', 'link'] as const) {
	describe(`guest rules on ${path}`, () => {
		it.each(cases)('enforces $error and exempts staff-created bookings', async ({ rule, dates, error }) => {
			const { t, admin, sessionId } = await setup();
			const input = { ...stay, ...dates };
			let token = '';
			if (path === 'chatConfirm' || path === 'link')
				token = (await t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...input })).confirmToken;
			await admin.mutation(api.settings.update, { bookingRules: rule });
			const attempt =
				path === 'web'
					? t.mutation(api.bookings.bookings.create, { ...input, guestEmail: 'guest@example.com' })
					: path === 'chatPrepare'
						? t.mutation(internal.bookings.bookings.prepareChatBooking, { sessionId, ...input })
						: path === 'chatConfirm'
							? t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId })
							: t.mutation(api.bookings.bookings.confirmProposal, { token });
			await expect(attempt).rejects.toThrow(error);
			expect(await t.run((ctx) => ctx.db.query('bookings').take(10))).toHaveLength(0);
			await expect(admin.mutation(api.bookings.commands.createBooking.createBooking, input)).resolves.toBeTruthy();
		});
	});
}
it('uses Bangkok calendar days across UTC midnight and permits dates before cutoff', async () => {
	const { t } = await setup({ sameDayCutoff: '03:00', maxAdvanceDays: 0 });
	vi.setSystemTime(Date.UTC(2026, 10, 3, 19)); // Nov 4, 02:00 locally.
	await expect(
		t.mutation(api.bookings.bookings.create, { ...webStay, checkIn: day(1), checkOut: day(3) })
	).resolves.toBeTruthy();
});

describe('precise unpaid holds', () => {
	it('holds guest dates immediately and schedules the configured deadline', async () => {
		const { t } = await setup({ unpaidHoldMinutes: 20 });
		const { bookingId } = await t.mutation(api.bookings.bookings.create, webStay);
		const jobs = await t.run((ctx) => ctx.db.system.query('_scheduled_functions').collect());
		expect(jobs.some((job) => job.name === 'crons:expireBookingHold' && job.scheduledTime === now + 20 * minute)).toBe(
			true
		);
		await expect(t.mutation(api.bookings.bookings.create, { ...webStay, guestEmail: 'other@example.com' })).rejects.toThrow(
			/no longer available|blocked/
		);
		vi.setSystemTime(now + 20 * minute - 1);
		await t.mutation(internal.crons.expireBookingHold, { bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('pending');
		vi.setSystemTime(now + 20 * minute);
		await t.mutation(internal.crons.expireBookingHold, { bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('cancelled');
		expect(await t.run((ctx) => ctx.db.query('availability').take(10))).toHaveLength(0);
	});
	it('executes the scheduled expiry without an hourly cron', async () => {
		const { t } = await setup({ unpaidHoldMinutes: 10 });
		const { bookingId } = await t.mutation(api.bookings.bookings.create, webStay);
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('cancelled');
	});
	it.each([false, true])(
		'protects an in-progress checkout (saved session: %s) and ends at its expiry',
		async (saved) => {
			const { t } = await setup({ unpaidHoldMinutes: 10 });
			const booking = await t.mutation(api.bookings.bookings.create, webStay);
			vi.setSystemTime(now + 9 * minute);
			const request = await startCheckout(t, booking, saved);
			vi.setSystemTime(now + 10 * minute);
			await t.mutation(internal.crons.expireBookingHold, { bookingId: booking.bookingId, expectedRevision: 0 });
			expect(await t.mutation(internal.crons.expirePending, {})).toBe(0);
			expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('pending');
			vi.setSystemTime(request.expiresAt);
			await t.mutation(internal.crons.expireBookingHold, { bookingId: booking.bookingId, expectedRevision: 0 });
			expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('cancelled');
		}
	);
	it('does not cancel paid or host-created bookings with an old scheduled job', async () => {
		const { t, admin } = await setup({ unpaidHoldMinutes: 10 });
		const booking = await t.mutation(api.bookings.bookings.create, webStay);
		await startCheckout(t, booking);
		await complete(t, booking.bookingId);
		const hostId = await admin.mutation(api.bookings.commands.createBooking.createBooking, {
			...stay,
			checkIn: day(20),
			checkOut: day(22)
		});
		const changed = await t.mutation(api.bookings.bookings.create, { ...webStay, checkIn: day(30), checkOut: day(32) });
		await t.run((ctx) => ctx.db.patch(changed.bookingId, { revision: 1 }));
		vi.setSystemTime(now + 120 * minute);
		for (const bookingId of [booking.bookingId, hostId, changed.bookingId])
			await t.mutation(internal.crons.expireBookingHold, { bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('confirmed');
		expect((await t.run((ctx) => ctx.db.get(hostId)))?.status).toBe('pending');
		expect((await t.run((ctx) => ctx.db.get(changed.bookingId)))?.status).toBe('cancelled');
	});
	it('uses settings in the hourly backstop and rejects starting checkout after the hold', async () => {
		const { t, admin } = await setup({ unpaidHoldMinutes: 20 });
		const booking = await t.mutation(api.bookings.bookings.create, webStay);
		const hostId = await admin.mutation(api.bookings.commands.createBooking.createBooking, {
			...stay,
			checkIn: day(20),
			checkOut: day(22)
		});
		vi.setSystemTime(now + 21 * minute);
		await expect(startCheckout(t, booking)).rejects.toThrow('Booking expired');
		expect(await t.mutation(internal.crons.expirePending, {})).toBe(1);
		expect((await t.run((ctx) => ctx.db.get(hostId)))?.status).toBe('pending');
	});
	it.each(['hold', 'checkout'] as const)('recovers a delayed paid webhook after %s expiry once', async (kind) => {
		const { t } = await setup({ unpaidHoldMinutes: 10 });
		const booking = await t.mutation(api.bookings.bookings.create, webStay);
		const request = await startCheckout(t, booking);
		vi.setSystemTime(request.expiresAt + 1);
		if (kind === 'hold')
			await t.mutation(internal.crons.expireBookingHold, { bookingId: booking.bookingId, expectedRevision: 0 });
		else await t.mutation(internal.bookings.payments.stripe.expireCheckout, { bookingId: booking.bookingId, sessionId: 'cs_test' });
		await complete(t, booking.bookingId);
		await complete(t, booking.bookingId);
		expect(await t.run((ctx) => ctx.db.get(booking.bookingId))).toMatchObject({
			status: 'confirmed',
			paymentStatus: 'paid'
		});
		expect(await t.run((ctx) => ctx.db.query('bookingPayments').take(10))).toHaveLength(1);
	});
	it('refuses delayed payment recovery if another stay took the dates', async () => {
		const { t, admin } = await setup();
		const booking = await t.mutation(api.bookings.bookings.create, webStay);
		const request = await startCheckout(t, booking);
		vi.setSystemTime(request.expiresAt + 1);
		await t.mutation(internal.bookings.payments.stripe.expireCheckout, { bookingId: booking.bookingId, sessionId: 'cs_test' });
		await admin.mutation(api.bookings.commands.createBooking.createBooking, { ...stay, confirmed: true });
		await expect(complete(t, booking.bookingId)).rejects.toThrow('no longer available');
		expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('cancelled');
		expect(await t.run((ctx) => ctx.db.query('bookingPayments').take(10))).toHaveLength(0);
	});
	it('keeps a longer base hold when Stripe expires before it', async () => {
		const { t } = await setup({ unpaidHoldMinutes: 120 });
		const booking = await t.mutation(api.bookings.bookings.create, webStay);
		const request = await startCheckout(t, booking);
		vi.setSystemTime(request.expiresAt + 1);
		await t.mutation(internal.bookings.payments.stripe.expireCheckout, { bookingId: booking.bookingId, sessionId: 'cs_test' });
		expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('pending');
	});
});

describe('hold rollout and staff edits', () => {
	it.each([
		{ initial: 120, updated: 10 },
		{ initial: 10, updated: 120 }
	])('preserves the promised $initial minute hold after changing settings to $updated', async ({ initial, updated }) => {
		const { t, admin } = await setup({ unpaidHoldMinutes: initial });
		const { bookingId } = await t.mutation(api.bookings.bookings.create, webStay);
		await admin.mutation(api.settings.update, { bookingRules: { unpaidHoldMinutes: updated } });
		vi.setSystemTime(now + initial * minute - 1);
		await t.mutation(internal.crons.expireBookingHold, { bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('pending');
		vi.setSystemTime(now + initial * minute);
		await t.mutation(internal.crons.expireBookingHold, { bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('cancelled');
	});
	it('keeps a legacy booking for its original 24 hours after rollout', async () => {
		const { t, propertyId } = await setup({ unpaidHoldMinutes: 10 });
		const bookingId = await t.run((ctx) => insertFixture(ctx, 'bookings', {
			propertyId, guestName: 'Legacy guest', guestPhone: '+66812345678',
			checkIn: stay.checkIn, checkOut: stay.checkOut, guests: 2, nights: 2,
			subtotal: 20000, discountAmount: 0, total: 20000, currency: 'THB',
			paymentStatus: 'pending', status: 'pending', source: 'web', createdAt: now
		}));
		vi.setSystemTime(now + 60 * minute);
		expect(await t.mutation(internal.crons.expirePending, {})).toBe(0);
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('pending');
		vi.setSystemTime(now + 24 * 60 * minute + 1);
		expect(await t.mutation(internal.crons.expirePending, {})).toBe(1);
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('cancelled');
	});
	it('allows a legacy booking to start checkout inside its original 24 hour window', async () => {
		const { t, propertyId } = await setup();
		const accessToken = 'legacy-access-token';
		const bookingId = await t.run((ctx) => insertFixture(ctx, 'bookings', {
			propertyId, guestName: 'Legacy guest', guestPhone: '+66812345678',
			checkIn: stay.checkIn, checkOut: stay.checkOut, guests: 2, nights: 2,
			subtotal: 20000, discountAmount: 0, total: 20000, currency: 'THB', accessToken,
			paymentStatus: 'pending', status: 'pending', source: 'web', createdAt: now
		}));
		vi.setSystemTime(now + 60 * minute);
		await expect(startCheckout(t, { bookingId, accessToken })).resolves.toMatchObject({ total: 20000 });
	});
	it('preserves an active Stripe extension after the hold setting changes', async () => {
		const { t, admin } = await setup({ unpaidHoldMinutes: 10 });
		const booking = await t.mutation(api.bookings.bookings.create, webStay);
		const request = await startCheckout(t, booking);
		await admin.mutation(api.settings.update, { bookingRules: { unpaidHoldMinutes: 120 } });
		vi.setSystemTime(request.expiresAt - 1);
		await t.mutation(internal.crons.expireBookingHold, { bookingId: booking.bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('pending');
		vi.setSystemTime(request.expiresAt);
		await t.mutation(internal.crons.expireBookingHold, { bookingId: booking.bookingId, expectedRevision: 0 });
		expect((await t.run((ctx) => ctx.db.get(booking.bookingId)))?.status).toBe('cancelled');
	});
	it('keeps a pending guest hold when staff correct contact details', async () => {
		const { t, admin, propertyId } = await setup();
		const { bookingId } = await t.mutation(api.bookings.bookings.create, webStay);
		await admin.mutation(api.bookings.commands.editBooking.editBooking, {
			bookingId, propertyId, checkIn: stay.checkIn, checkOut: stay.checkOut,
			guests: 2, guestName: 'Corrected guest', guestPhone: stay.guestPhone,
			expectedRevision: 0, notifyGuest: false
		});
		expect(await t.run((ctx) => ctx.db.query('availability').take(10))).toHaveLength(2);
		await expect(t.mutation(api.bookings.bookings.create, { ...webStay, guestEmail: 'other@example.com' }))
			.rejects.toThrow(/no longer available|blocked/);
	});
	it('still expires at the promised time after staff add a note', async () => {
		const { t, admin } = await setup({ unpaidHoldMinutes: 10 });
		const { bookingId } = await t.mutation(api.bookings.bookings.create, webStay);
		await admin.mutation(api.bookings.commands.updateNotes.updateNotes, { bookingId, notes: 'Guest called reception', expectedRevision: 0 });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect((await t.run((ctx) => ctx.db.get(bookingId)))?.status).toBe('cancelled');
		expect(await t.run((ctx) => ctx.db.query('availability').take(10))).toHaveLength(0);
	});
});

describe('proposal confirm links', () => {
	it('GET preview reads have no booking, availability, order, session or scheduler side effects', async () => {
		const { t, sessionId, prepare } = await setup();
		const { confirmToken } = await prepare();
		const snapshot = () =>
			t.run(async (ctx) => ({
				bookings: await ctx.db.query('bookings').take(10),
				availability: await ctx.db.query('availability').take(10),
				orders: await ctx.db.query('orders').take(10),
				session: await ctx.db.get(sessionId),
				jobs: await ctx.db.system.query('_scheduled_functions').collect()
			}));
		const before = await snapshot();
		expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken })).toMatchObject({
			property: 'Pool Villa',
			total: 20000,
			guests: 2,
			unpaidHoldMinutes: 30,
			cancellationPolicy: expect.any(String)
		});
		await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken });
		expect(await snapshot()).toEqual(before);
		expect(before.bookings).toHaveLength(0);
	});
	it.each([false, true])(
		'shares exactly one booking with repeated chat yes and link confirmation (chat first: %s)',
		async (chatFirst) => {
			const { t, sessionId, prepare } = await setup();
			const { confirmToken } = await prepare();
			const chat = () => t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId });
			const link = () => t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
			const first = await (chatFirst ? chat() : link());
			if (first.needsReview) throw new Error("Expected a confirmed booking");
			const repeats = await Promise.all([link(), chat(), link()]);
			expect(
				repeats.every((result) => !result.needsReview && result.bookingId === first.bookingId && result.accessToken === first.accessToken)
			).toBe(true);
			expect(await t.run((ctx) => ctx.db.query('bookings').take(10))).toHaveLength(1);
			expect(await t.run((ctx) => ctx.db.query('orders').take(10))).toHaveLength(1);
		}
	);
	it('expires exactly with the configurable chat validity, for query and mutation', async () => {
		const { t, sessionId, prepare } = await setup({ chatQuoteValidityMinutes: 2 });
		const { confirmToken, expiresAt } = await prepare();
		expect(expiresAt).toBe(now + 2 * minute);
		vi.setSystemTime(expiresAt);
		expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken })).toBeNull();
		await expect(t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken })).rejects.toThrow(
			'summary has expired'
		);
		await expect(t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId })).rejects.toThrow('expired');
		expect(await t.run((ctx) => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});
	it('rejects malformed, forged, altered-expiry and replaced-proposal links', async () => {
		const { t, prepare } = await setup();
		const { confirmToken } = await prepare();
		const parts = confirmToken.split('.');
		parts[2] = String(Number(parts[2]) + minute);
		const forged = confirmToken.slice(0, -1) + (confirmToken.endsWith('a') ? 'b' : 'a');
		for (const token of ['', 'bad.token', parts.join('.'), forged]) {
			expect(await t.query(api.bookings.bookings.getConfirmProposal, { token })).toBeNull();
			await expect(t.mutation(api.bookings.bookings.confirmProposal, { token })).rejects.toThrow('summary has expired');
		}
		await prepare();
		expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken })).toBeNull();
	});
	it('keeps a confirmed link usable for payment after the summary window', async () => {
		const { t, prepare } = await setup({ chatQuoteValidityMinutes: 2 });
		const { confirmToken, expiresAt } = await prepare();
		const first = await t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
		if (first.needsReview) throw new Error("Expected a confirmed booking");
		vi.setSystemTime(expiresAt + minute);
		expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken })).not.toBeNull();
		const again = await t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
		if (again.needsReview) throw new Error("Expected a confirmed booking");
		expect(again.bookingId).toBe(first.bookingId);
		expect(await t.run((ctx) => ctx.db.query('bookings').take(10))).toHaveLength(1);
	});
	it('lets the guest confirm by link after staff took over, while AI confirmation stays blocked', async () => {
		const { t, sessionId, prepare } = await setup();
		const { confirmToken } = await prepare();
		await t.run((ctx) => ctx.db.patch(sessionId, { aiPaused: true }));
		await expect(t.mutation(internal.bookings.bookings.confirmChatBooking, { sessionId })).rejects.toThrow('paused');
		const booking = await t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
		if (booking.needsReview) throw new Error("Expected a confirmed booking");
		expect(booking.alreadyConfirmed).toBe(false);
	});
	it.each(['cancelled', 'expired', 'paid'] as const)('does not offer a payable proposal after the booking is %s', async (state) => {
		const { t, admin, prepare } = await setup({ unpaidHoldMinutes: 10 });
		const { confirmToken } = await prepare();
		const booking = await t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
		if (booking.needsReview) throw new Error("Expected a confirmed booking");
		if (state === 'cancelled') {
			await admin.mutation(api.bookings.commands.updateBooking.updateBooking, {
				bookingId: booking.bookingId, action: 'cancel', expectedRevision: 0, notifyGuest: false, reason: 'Guest requested cancellation'
			});
		} else if (state === 'paid') {
			await startCheckout(t, { bookingId: booking.bookingId, accessToken: booking.accessToken });
			await complete(t, booking.bookingId);
		} else {
			// The deadline itself must be enforced even when the scheduled job has not run yet.
			vi.setSystemTime(now + 10 * minute);
		}
		expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken })).toBeNull();
		await expect(t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken })).rejects.toThrow();
	});
	it('shows the current held booking after staff correct its stay and price', async () => {
		const { t, admin, prepare, propertyId } = await setup();
		const { confirmToken } = await prepare();
		const confirmed = await t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
		if (confirmed.needsReview) throw new Error("Expected a confirmed booking");
		const { bookingId } = confirmed;
		await admin.mutation(api.bookings.commands.editBooking.editBooking, {
			bookingId, propertyId, checkIn: day(15), checkOut: day(18), guests: 3,
			guestName: stay.guestName, guestPhone: stay.guestPhone, expectedRevision: 0, notifyGuest: false
		});
		expect(await t.query(api.bookings.bookings.getConfirmProposal, { token: confirmToken })).toMatchObject({
			checkIn: day(15), checkOut: day(18), nights: 3, guests: 3, total: 30000, currency: 'THB'
		});
	});
	it('rejects a changed price without creating anything', async () => {
		const { t, prepare, propertyId } = await setup();
		const { confirmToken } = await prepare();
		await t.run((ctx) => ctx.db.patch(propertyId, { pricePerNight: 15000 }));
		await expect(t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken })).resolves.toMatchObject({ needsReview: true });
		expect(await t.run((ctx) => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});
	it('continues from link confirmation into the existing Stripe action', async () => {
		const { t, prepare } = await setup();
		const { confirmToken } = await prepare();
		vi.stubEnv('STRIPE_SECRET_KEY', 'test');
		vi.stubEnv('SITE_URL', 'https://example.com');
		vi.stubGlobal(
			'fetch',
			vi.fn(
				async () =>
					new Response(
						JSON.stringify({ id: 'cs_test', url: 'https://checkout.stripe.com/test', expires_at: now / 1000 + 3600 })
					)
			)
		);
		const confirmed = await t.mutation(api.bookings.bookings.confirmProposal, { token: confirmToken });
		if (confirmed.needsReview) throw new Error("Expected a confirmed booking");
		const { bookingId, accessToken } = confirmed;
		expect(await t.action(api.bookings.payments.stripe.createCheckout, { bookingId, accessToken })).toEqual({
			url: 'https://checkout.stripe.com/test'
		});
	});
});

it('follows configured pre-arrival and review windows, with catch-up and one-time claims', async () => {
	const { t, propertyId } = await setup({ preArrivalDaysBefore: 5, reviewDaysAfter: 3 });
	vi.stubEnv('RESEND_API_KEY', 'test');
	vi.stubEnv('EMAIL_FROM', 'test@example.com');
	const ids = await t.run(async (ctx) => {
		const base = {
			propertyId,
			guestName: 'Guest',
			guestPhone: '123',
			guestEmail: 'guest@example.com',
			guests: 1,
			nights: 1,
			subtotal: 10000,
			discountAmount: 0,
			total: 10000,
			currency: 'THB',
			paymentStatus: 'paid' as const,
			status: 'confirmed' as const,
			createdAt: now
		};
		const result = [];
		for (const offset of [-8, -7, -4, -3, -2, -1, 0, 1, 2, 5, 6])
			result.push(await insertFixture(ctx, 'bookings', { ...base, checkIn: day(offset), checkOut: day(offset) }));
		return result;
	});
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'preArrival', today: day(0) })).toBe(3);
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'review', today: day(0) })).toBe(3);
	const rows = await t.run(async (ctx) => Promise.all(ids.map((id) => ctx.db.get(id))));
	expect(rows.filter((row) => row?.preArrivalEmailQueuedAt).map((row) => row!.checkIn)).toEqual([
		day(1),
		day(2),
		day(5)
	]);
	expect(rows.filter((row) => row?.reviewEmailQueuedAt).map((row) => row!.checkOut)).toEqual([
		day(-7),
		day(-4),
		day(-3)
	]);
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'review', today: day(0) })).toBe(0);
});
