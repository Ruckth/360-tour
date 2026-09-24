// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { localDateTimeUtc } from './lib/serviceSlots';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const date = '2026-09-25';
const at = (time: string) => localDateTimeUtc(date, time);
const days = [0, 1, 2, 3, 4, 5, 6];

async function setup(channel: 'whatsapp' | 'facebook' = 'whatsapp', secondStaff = false) {
	const t = convexTest(schema, modules);
	const { sessionId, staffId, serviceId } = await t.run(async (ctx) => {
		const staffId = await ctx.db.insert('staff', {
			name: 'Mali Chen', role: 'Therapist', color: '#abc', status: 'active',
			workingHours: days.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
			breaks: days.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' })),
			createdAt: Date.now(), updatedAt: Date.now()
		});
		const otherId = secondStaff ? await ctx.db.insert('staff', {
			name: 'Nok Chan', role: 'Therapist', color: '#def', status: 'active',
			workingHours: days.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
			breaks: [], createdAt: Date.now(), updatedAt: Date.now()
		}) : undefined;
		const serviceId = await ctx.db.insert('services', {
			slug: 'thai-massage', name: 'Thai massage', description: 'One hour massage', category: 'Wellness',
			durationMin: 60, bufferMin: 15, price: 2000, currency: 'THB', staffIds: otherId ? [staffId, otherId] : [staffId],
			status: 'active', createdAt: Date.now(), updatedAt: Date.now()
		});
		const sessionId = await ctx.db.insert('chatSessions', {
			channel, visitorId: 'guest', ...(channel === 'whatsapp' ? { visitorPhone: '66956823432', visitorName: 'Rugby' } : {}),
			createdAt: Date.now()
		});
		return { sessionId, staffId, serviceId };
	});
	return { t, sessionId, staffId, serviceId };
}

const request = { serviceSlug: 'thai-massage', date, time: '14:00', guestName: 'Rugby' };
type Fixture = Awaited<ReturnType<typeof setup>>;
const prepare = (fixture: Fixture, extra = {}) =>
	fixture.t.mutation(internal.serviceBookings.prepareChatServiceBooking, { sessionId: fixture.sessionId, ...request, ...extra });
const appointments = (t: Awaited<ReturnType<typeof setup>>['t']) =>
	t.run(async (ctx) => await ctx.db.query('serviceAppointments').take(20));

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function mockAi(calls: Array<{ name: string; args?: Record<string, unknown> }>, results: string[]) {
	vi.stubEnv('AI_API_KEY', 'test-key');
	vi.stubEnv('AI_API_BASE_URL', 'https://ai.example.test/v1');
	let round = 0;
	vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
		const body = JSON.parse(String(init?.body ?? '{}')) as { messages: Array<{ role: string; content: string }> };
		const last = body.messages[body.messages.length - 1];
		if (last?.role === 'tool') results.push(last.content);
		return new Response(JSON.stringify({ choices: [{ message: round++ === 0
			? { content: null, tool_calls: calls.map((call, index) => ({ id: `call-${index}`, type: 'function', function: { name: call.name, arguments: JSON.stringify(call.args ?? {}) } })) }
			: { content: 'Done' } }] }), { status: 200, headers: { 'Content-Type': 'application/json' } });
	}));
}

describe('AI service booking', () => {
	it('lists active services and open local times, then prepares without creating an appointment', async () => {
		const s = await setup();
		expect(await s.t.query(internal.serviceBookings.listActiveServices, {})).toMatchObject([
			{ slug: 'thai-massage', durationMin: 60, price: 2000, staff: ['Mali'] }
		]);
		const open = await s.t.query(internal.serviceBookings.checkServiceAvailability, { serviceSlug: request.serviceSlug, date, time: '14:00' });
		expect(open).toMatchObject({ available: true });
		const summary = await prepare(s);
		expect(summary).toMatchObject({ service: 'Thai massage', date, time: '14:00', price: 2000, staff: 'any available therapist/staff' });
		expect((await s.t.run(async (ctx) => ctx.db.get(s.sessionId)))?.pendingServiceQuote).toMatchObject({ start: at('14:00'), guestPhone: '66956823432' });
		expect(await appointments(s.t)).toHaveLength(0);
	});

	it('requires a fresh quote and confirms idempotently', async () => {
		const s = await setup();
		await expect(s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId })).rejects.toThrow('No prepared service booking');
		await prepare(s);
		await s.t.run(async (ctx) => {
			const session = await ctx.db.get(s.sessionId);
			await ctx.db.patch(s.sessionId, { pendingServiceQuote: { ...session!.pendingServiceQuote!, createdAt: Date.now() - 16 * 60_000 } });
		});
		await expect(s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId })).rejects.toThrow('expired');
		expect(await appointments(s.t)).toHaveLength(0);
		await prepare(s);
		const first = await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		const second = await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		if (!('appointmentId' in first) || !('appointmentId' in second)) throw new Error('Expected confirmation');
		expect(second).toMatchObject({ appointmentId: first.appointmentId, alreadyConfirmed: true });
		expect(first.confirmationCode).toMatch(/^SVC-/);
		expect(await appointments(s.t)).toMatchObject([{ status: 'booked', paymentStatus: 'unpaid', source: 'whatsapp', staffId: s.staffId }]);
	});

	it('returns alternatives if a prepared slot was taken and creates nothing else', async () => {
		const s = await setup();
		await prepare(s);
		await s.t.run(async (ctx) => {
			await ctx.db.insert('serviceAppointments', {
				serviceId: s.serviceId, staffId: s.staffId, start: at('14:00'), end: at('15:00'), blockedUntil: at('15:15'),
				guestName: 'Other', guestPhone: '000', source: 'admin', status: 'booked', paymentStatus: 'unpaid',
				price: 2000, currency: 'THB', confirmationCode: 'SVC-OTHER', accessToken: 'token', createdAt: Date.now()
			});
		});
		const result = await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		expect(result).toMatchObject({ error: expect.stringContaining('just taken'), alternatives: expect.any(Array) });
		expect(result.alternatives).toHaveLength(3);
		expect(await appointments(s.t)).toHaveLength(1);
	});

	it('blocks the staff member on a second booking', async () => {
		const s = await setup();
		await prepare(s);
		await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		const secondSession = await s.t.run(async (ctx) => ctx.db.insert('chatSessions', {
			channel: 'whatsapp', visitorPhone: '66999999999', visitorId: 'second', createdAt: Date.now()
		}));
		const result = await s.t.mutation(internal.serviceBookings.prepareChatServiceBooking, { sessionId: secondSession, ...request });
		expect(result).toMatchObject({ error: expect.stringContaining('just taken') });
		expect(await appointments(s.t)).toHaveLength(1);
	});

	it('takes WhatsApp phone from the session and links an upcoming villa stay', async () => {
		const s = await setup();
		const bookingId = await s.t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', {
				slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 1000, currency: 'THB', maxGuests: 2,
				bedrooms: 1, bathrooms: 1, area: 80, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
			});
			return await ctx.db.insert('bookings', {
				propertyId, guestName: 'Rugby', guestPhone: '66956823432', checkIn: date, checkOut: '2026-09-27',
				guests: 1, nights: 2, subtotal: 2000, discountAmount: 0, total: 2000, currency: 'THB',
				paymentStatus: 'paid', status: 'confirmed', createdAt: Date.now()
			});
		});
		const summary = await prepare(s, { guestPhone: 'FAKE' });
		expect(summary).toMatchObject({ guestPhone: '66956823432' });
		await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		expect(await appointments(s.t)).toMatchObject([{ guestPhone: '66956823432', bookingId }]);
	});

	it('lists upcoming service appointments and cancels only after a later turn, freeing the slot', async () => {
		const s = await setup();
		await prepare(s);
		const booked = await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		if (!('confirmationCode' in booked)) throw new Error('Expected confirmation');
		const listed = await s.t.query(internal.serviceBookings.listChatGuestServiceBookings, { sessionId: s.sessionId });
		expect(listed).toMatchObject([{ reference: booked.confirmationCode, service: 'Thai massage', date, time: '14:00', status: 'booked' }]);
		const args = { sessionId: s.sessionId, reference: booked.confirmationCode!, turnStartedAt: Date.now() };
		expect(await s.t.mutation(internal.serviceBookings.cancelChatServiceBooking, args)).toMatchObject({ state: 'needs_confirmation' });
		expect(await s.t.mutation(internal.serviceBookings.cancelChatServiceBooking, args)).toMatchObject({ state: 'needs_confirmation' });
		vi.advanceTimersByTime(1000);
		expect(await s.t.mutation(internal.serviceBookings.cancelChatServiceBooking, { ...args, turnStartedAt: Date.now() })).toMatchObject({ state: 'cancelled' });
		expect((await appointments(s.t))[0].status).toBe('cancelled');
		expect(await s.t.query(internal.serviceBookings.checkServiceAvailability, { serviceSlug: request.serviceSlug, date, time: '14:00' })).toMatchObject({ available: true });
	});

	it('honours an active first-name preference and reports an unknown one', async () => {
		const s = await setup('facebook', true);
		const preferred = await prepare(s, { guestPhone: '0812345678', staffPreference: 'nOk' });
		expect(preferred).toMatchObject({ staff: 'Nok' });
		const confirmed = await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		expect(confirmed).toMatchObject({ staff: 'Nok' });
		expect((await appointments(s.t))[0].source).toBe('messenger');
		const ignored = await prepare(s, { guestPhone: '0812345678', time: '16:00', staffPreference: 'Unknown' });
		expect(ignored).toMatchObject({ staff: 'any available therapist/staff', staffPreferenceIgnored: expect.stringContaining('Unknown') });
	});

	it('prevents prepare and confirm in one AI turn, and get_my_bookings shows the service', async () => {
		const s = await setup();
		const results: string[] = [];
		mockAi([{ name: 'prepare_service_booking', args: request }, { name: 'confirm_service_booking' }], results);
		await s.t.action(api.chatAi.generateReply, { sessionId: s.sessionId, userMessage: 'Book Thai massage', channel: 'whatsapp', bookingFlow: true });
		expect(results.join('\n')).toContain('Ask the guest to confirm the service summary first');
		expect(await appointments(s.t)).toHaveLength(0);
		await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		vi.unstubAllGlobals();
		const listing: string[] = [];
		mockAi([{ name: 'get_my_bookings' }], listing);
		await s.t.action(api.chatAi.generateReply, { sessionId: s.sessionId, userMessage: 'What are my bookings?', channel: 'whatsapp', bookingFlow: true });
		expect(listing.join('\n')).toContain('"services"');
		expect(listing.join('\n')).toContain('SVC-');
		const reference = (await appointments(s.t))[0].confirmationCode;
		vi.unstubAllGlobals();
		const firstCancel: string[] = [];
		mockAi([{ name: 'cancel_booking', args: { reference } }], firstCancel);
		await s.t.action(api.chatAi.generateReply, { sessionId: s.sessionId, userMessage: `Cancel ${reference}`, channel: 'whatsapp', bookingFlow: true });
		expect(firstCancel.join('\n')).toContain('needs_confirmation');
		vi.advanceTimersByTime(1000);
		vi.unstubAllGlobals();
		const confirmedCancel: string[] = [];
		mockAi([{ name: 'cancel_booking', args: { reference } }], confirmedCancel);
		await s.t.action(api.chatAi.generateReply, { sessionId: s.sessionId, userMessage: 'Yes, cancel it', channel: 'whatsapp', bookingFlow: true });
		expect(confirmedCancel.join('\n')).toContain('"cancelled"');
		expect((await appointments(s.t))[0].status).toBe('cancelled');
	});

	it('clears the previous quote when a changed request fails', async () => {
		const s = await setup();
		await prepare(s);
		expect(await prepare(s, { time: '12:00' })).toMatchObject({ error: expect.any(String) });
		expect((await s.t.run(async (ctx) => ctx.db.get(s.sessionId)))?.pendingServiceQuote).toBeUndefined();
		await expect(s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId })).rejects.toThrow(/No prepared/);
	});

	it('only links a villa stay that covers the service date', async () => {
		const s = await setup();
		await s.t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', {
				slug: 'pool-villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 1, currency: 'THB', maxGuests: 2,
				bedrooms: 1, bathrooms: 1, area: 1, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
			});
			await ctx.db.insert('bookings', {
				propertyId, guestName: 'Rugby', guestPhone: '66956823432', checkIn: '2026-10-01', checkOut: '2026-10-05', guests: 2, nights: 4,
				subtotal: 1, discountAmount: 0, total: 1, currency: 'THB', paymentStatus: 'paid', status: 'confirmed', createdAt: Date.now()
			});
		});
		await prepare(s);
		await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		expect((await appointments(s.t))[0].bookingId).toBeUndefined();
	});

	it('refuses to cancel a paid service in chat', async () => {
		const s = await setup();
		await prepare(s);
		const confirmed = await s.t.mutation(internal.serviceBookings.confirmChatServiceBooking, { sessionId: s.sessionId });
		if (!('confirmationCode' in confirmed) || !confirmed.appointmentId) throw new Error('Expected a confirmed appointment');
		const { confirmationCode, appointmentId } = confirmed;
		await s.t.run(async (ctx) => ctx.db.patch(appointmentId, { paymentStatus: 'paid' }));
		await expect(s.t.mutation(internal.serviceBookings.cancelChatServiceBooking, {
			sessionId: s.sessionId, reference: confirmationCode, turnStartedAt: Date.now()
		})).rejects.toThrow(/Paid services/);
	});

	it('does not let public callers mint or relabel messaging sessions', async () => {
		const s = await setup();
		await expect(s.t.mutation(api.chat.createSession, { channel: 'whatsapp' } as never)).rejects.toThrow();
		await expect(s.t.mutation(api.chat.identifyVisitor, { sessionId: s.sessionId, phone: '66000000000', contactApp: 'whatsapp' })).rejects.toThrow(/web chat/);
	});
});
