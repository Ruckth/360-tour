// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

declare global { interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; } }
const modules = import.meta.glob('./**/*.ts');
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

afterEach(() => vi.unstubAllEnvs());

async function bookingTest(checkInOffset = 2, checkOutOffset = 5) {
	const t = convexTest(schema, modules);
	const bookingId = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 100,
			currency: 'THB', maxGuests: 2, bedrooms: 1, bathrooms: 1, area: 40,
			images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		});
		return await ctx.db.insert('bookings', {
			propertyId, guestName: 'Guest', guestEmail: 'guest@example.com', guestPhone: '123',
			checkIn: day(checkInOffset), checkOut: day(checkOutOffset), guests: 1, nights: 3, subtotal: 300,
			discountAmount: 0, total: 300, currency: 'THB', paymentStatus: 'paid',
			status: 'confirmed', createdAt: Date.now()
		});
	});
	return { t, bookingId };
}

it('throttles staff alerts for a session to one per 30 minutes', async () => {
	const t = convexTest(schema, modules);
	const sessionId = await t.run(async ctx => await ctx.db.insert('chatSessions', {
		channel: 'web', visitorName: 'Guest', createdAt: Date.now()
	}));
	await t.mutation(api.chat.addMessage, { sessionId, role: 'user', content: 'I need a human agent' });
	const first = await t.run(async ctx => (await ctx.db.get(sessionId))?.lastStaffAlertAt);
	expect(first).toBeTruthy();
	await t.mutation(api.chat.addMessage, { sessionId, role: 'user', content: 'Please connect me to someone' });
	await t.mutation(api.chatKnowledge.recordUnknownQuestion, { sessionId, userQuestion: 'What is the answer?' });
	expect(await t.run(async ctx => (await ctx.db.get(sessionId))?.lastStaffAlertAt)).toBe(first);
	const stale = Date.now() - 31 * 60 * 1000;
	await t.run(async ctx => await ctx.db.patch(sessionId, { lastStaffAlertAt: stale }));
	await t.mutation(api.chat.addMessage, { sessionId, role: 'user', content: 'I need a human agent' });
	expect(await t.run(async ctx => (await ctx.db.get(sessionId))?.lastStaffAlertAt)).toBeGreaterThan(stale);
});

it('claims each lifecycle email once across repeated cron runs', async () => {
	vi.stubEnv('RESEND_API_KEY', 'test');
	vi.stubEnv('EMAIL_FROM', 'test@example.com');
	const { t, bookingId } = await bookingTest();
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'preArrival' })).toBe(1);
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'preArrival' })).toBe(0);
	expect((await t.run(async ctx => await ctx.db.get(bookingId)))?.preArrivalEmailQueuedAt).toBeTruthy();
	const past = await bookingTest(-4, -1);
	expect(await past.t.mutation(internal.crons.queueLifecycleEmails, { kind: 'review' })).toBe(1);
	expect(await past.t.mutation(internal.crons.queueLifecycleEmails, { kind: 'review' })).toBe(0);
	expect((await past.t.run(async ctx => await ctx.db.get(past.bookingId)))?.reviewEmailQueuedAt).toBeTruthy();
});

it('skips pre-arrival mail when the booking is cancelled before the cron', async () => {
	vi.stubEnv('RESEND_API_KEY', 'test');
	vi.stubEnv('EMAIL_FROM', 'test@example.com');
	const { t, bookingId } = await bookingTest();
	await t.run(async ctx => await ctx.db.patch(bookingId, { status: 'cancelled' }));
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'preArrival' })).toBe(0);
	expect(await t.action(internal.emails.sendPreArrival, { bookingId })).toEqual({ sent: false, reason: 'booking_not_eligible' });
	const claimed = await bookingTest();
	expect(await claimed.t.mutation(internal.crons.queueLifecycleEmails, { kind: 'preArrival' })).toBe(1);
	await claimed.t.run(async ctx => await ctx.db.patch(claimed.bookingId, { status: 'cancelled' }));
	expect(await claimed.t.action(internal.emails.sendPreArrival, { bookingId: claimed.bookingId })).toEqual({ sent: false, reason: 'booking_not_eligible' });
});

it('detects staff requests without flagging booking questions', async () => {
	const { asksForStaff } = await import('./chatKnowledge');
	expect(asksForStaff('Can I talk to the host?')).toBe(true);
	expect(asksForStaff('ขอคุยกับพนักงาน')).toBe(true);
	expect(asksForStaff('How much do I need to pay per person?')).toBe(false);
	expect(asksForStaff('We want a villa for 4 people')).toBe(false);
});

it('treats missing email configuration as a non-fatal skip', async () => {
	vi.stubEnv('RESEND_API_KEY', '');
	vi.stubEnv('EMAIL_FROM', '');
	const { t, bookingId } = await bookingTest();
	await t.run(async ctx => await ctx.db.patch(bookingId, { cancellationEmailQueuedAt: Date.now(), status: 'cancelled' }));
	expect(await t.action(internal.emails.sendCancellation, { bookingId })).toEqual({ sent: false, reason: 'missing_config' });
	expect(await t.mutation(internal.crons.queueLifecycleEmails, { kind: 'review' })).toBe(0);
	const sessionId = await t.run(async ctx => await ctx.db.insert('chatSessions', { channel: 'line', createdAt: Date.now() }));
	await expect(t.action(internal.emails.sendStaffAlert, { sessionId, channel: 'line', guestName: 'Guest', lastMessage: 'Help' })).resolves.toBeNull();
});
