// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
import { proposalIdentity } from './lib/chatWriteGuard';

declare global {
	interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; }
}

const modules = import.meta.glob('./**/*.ts');
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

/** Insert a historical approved saved answer + primary question directly (pre-retirement data). */
async function seedHistoricalAnswer(t: ReturnType<typeof convexTest>, args: { title: string; answer: string; question: string }) {
	await t.run(async ctx => {
		const now = Date.now();
		const answerId = await ctx.db.insert('chatAnswers', {
			title: args.title, answer: args.answer, status: 'approved', createdAt: now, updatedAt: now,
			createdByAdminEmail: 'admin@example.com', updatedByAdminEmail: 'admin@example.com'
		});
		await ctx.db.insert('chatQuestions', {
			answerId, questionText: args.question,
			normalizedQuestion: args.question.trim().toLowerCase().replace(/[\s?!.]+/g, ' ').trim(),
			isPrimary: true, isAiTrigger: true, createdBy: 'admin', status: 'approved',
			createdAt: now, updatedAt: now, approvedAt: now,
			createdByAdminEmail: 'admin@example.com', updatedByAdminEmail: 'admin@example.com'
		});
	});
}

async function setup(channel: 'web' | 'line' | 'whatsapp' = 'line') {
	const t = convexTest(schema, modules);
	const fixture = await t.run(async ctx => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'pool-villa', name: 'Pool Villa', tagline: 'Private stay', description: 'Test villa',
			pricePerNight: 8500, directDiscountPercent: 15, currency: 'THB', maxGuests: 4,
			bedrooms: 2, bathrooms: 2, area: 180, amenities: [], images: [], tourRoomIds: [], status: 'active'
		});
		const sessionId = await ctx.db.insert('chatSessions', { channel, visitorId: 'eval:accuracy', visitorPhone: '660099000001', visitorName: 'Test Guest', createdAt: Date.now() });
		return { sessionId, propertyId };
	});
	const checkIn = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
	const checkOut = new Date(Date.now() + 33 * 86400000).toISOString().slice(0, 10);
	return { t, ...fixture, stay: { propertySlug: 'pool-villa', checkIn, checkOut, guests: 2, guestName: 'Test Guest', guestPhone: '660099000001' } };
}

function modelReply(content: string | null, name?: string, argumentsText = '{}', finishReason = 'stop') {
	return new Response(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content, ...(name ? { tool_calls: [{ id: 'call-1', type: 'function', function: { name, arguments: argumentsText } }] } : {}) } }] }));
}

function modelSequence(responses: Response[]) {
	vi.stubEnv('AI_API_KEY', 'test-key');
	vi.stubGlobal('fetch', vi.fn(async () => responses.shift() ?? modelReply('Please clarify the request.')));
}

describe('authoritative facts and capability routing', () => {
	it.each(['What time is check-in?', 'เช็กอินกี่โมงครับ', '체크인 시간은 몇 시인가요?'])('uses effective check-in settings ahead of stale exact FAQ: %s', async message => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const { t, sessionId } = await setup('web');
		// A stale historical saved answer must never resurface; current settings win.
		await seedHistoricalAnswer(t, { title: 'Check-in', answer: 'Check-in is at 15:00.', question: message });
		await t.run(async ctx => { await ctx.db.insert('siteSettings', { key: 'default', checkInTime: '16:00', checkOutTime: '10:00', updatedAt: Date.now(), updatedByEmail: 'admin@example.com' }); });
		const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
		const result = await t.action(api.chatAi.respond, { sessionId, userMessage: message });
		expect(result).toMatchObject({ model: 'guardrail' });
		expect(result.response).toContain('16:00'); expect(result.response).toContain('10:00');
		expect(result.response).not.toContain('15:00'); expect(fetchMock).not.toHaveBeenCalled();
		expect(await t.action(api.chatAi.getGuardrailReply, { userMessage: message })).toBe(result.response);
	});

	it('does not let a historical approved exact price bypass live data', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const { t, sessionId } = await setup('web');
		await seedHistoricalAnswer(t, { title: 'Old villa price', answer: 'Pool Villa is ฿1 per night.', question: 'What is the Pool Villa price?' });
		expect(await t.query(api.chatKnowledge.resolveExact, { sessionId, messageText: 'What is the Pool Villa price?' })).toBeNull();
	});

	it.each(['Reschedule my massage booking to tomorrow.', 'เลื่อนนัดนวดเป็นพรุ่งนี้ครับ', '마사지 예약 시간을 변경해 주세요.'])('does not turn a reschedule into a new preparation: %s', async message => {
		const { t, sessionId } = await setup(); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
		const reply = await t.action(api.chatAi.generateReply, { sessionId, userMessage: message });
		expect(reply.model).toBe('guardrail'); expect(fetchMock).not.toHaveBeenCalled();
		const session = await t.run(ctx => ctx.db.get(sessionId));
		expect(session?.pendingServiceQuote).toBeUndefined(); expect(session?.pendingBookingQuote).toBeUndefined();
	});

	it('redirects off-topic code requests without invoking the provider', async () => {
		const { t, sessionId } = await setup('web'); const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
		const reply = await t.action(api.chatAi.respond, { sessionId, userMessage: 'Write a Python script to sort a list.' });
		expect(reply.response).toContain('villas'); expect(reply.response).not.toContain('sorted('); expect(fetchMock).not.toHaveBeenCalled();
	});
});

describe('tool inputs and honest outcomes', () => {
	it.each([
		['calculate_price', '{"propertySlug":"pool-villa","nights":0}'],
		['calculate_price', '{"propertySlug":"pool-villa","nights":-1}'],
		['calculate_price', '{"propertySlug":"pool-villa","nights":1.5}'],
		['calculate_price', '{"propertySlug":"pool-villa","nights":"3"}'],
		['calculate_price', '{"propertySlug":"pool-villa","nights":366}'],
		['calculate_price', '{"propertySlug":"pool-villa","nights":3,"guests":5}'],
		['prepare_booking', 'null'], ['prepare_booking', '[]'], ['prepare_booking', '{broken'],
		['prepare_booking', '{"propertySlug":"pool-villa"}'],
		['confirm_booking', '{"unexpected":true}'],
		['check_availability', '{"propertySlug":"pool-villa","checkIn":"2026-02-30","checkOut":"2026-03-03"}'],
		['check_availability', '{"propertySlug":"pool-villa","checkIn":"2099-11-16","checkOut":"2099-11-14"}'],
		['check_service_availability', '{"serviceSlug":"massage","date":"2099-11-16","time":"25:00"}']
	])('rejects %s arguments %s without claiming success', async (name, args) => {
		const { t, sessionId } = await setup();
		modelSequence([modelReply(null, name, args, 'tool_calls'), modelReply('Your booking is confirmed!')]);
		const result = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'yes' });
		expect(result.model).toBe('tool_fallback'); expect(result.response).not.toContain('Your booking is confirmed');
		expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});

	it('blocks a model confirmation without explicit guest consent', async () => {
		const { t, sessionId, stay } = await setup();
		await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		modelSequence([modelReply(null, 'confirm_booking', '{}', 'tool_calls'), modelReply('Booked!')]);
		const result = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'How many bedrooms does it have?' });
		expect(result.model).toBe('tool_fallback');
		expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});

	it('invalidates an old proposal when a replacement preparation is malformed', async () => {
		const { t, sessionId, stay } = await setup();
		await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		modelSequence([modelReply(null, 'prepare_booking', '{broken', 'tool_calls'), modelReply('Please clarify the new dates.')]);
		await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'Change the dates of my draft.' });
		expect((await t.run(ctx => ctx.db.get(sessionId)))?.pendingBookingQuote).toBeUndefined();
		await expect(t.mutation(internal.bookings.confirmChatBooking, { sessionId })).rejects.toThrow('No prepared booking');
	});

	it.each([
		{ model: 'openai/gpt-6-luna', truncated: false },
		{ model: 'openai/gpt-6.1-sol', truncated: false },
		{ model: 'openai/gpt-6-luna', truncated: true },
		{ model: 'openai/gpt-6.1-sol', truncated: true }
	])('rejects the $model batch while invalidating the replaced draft (truncated: $truncated)', async ({ model, truncated }) => {
		const { t, sessionId, stay } = await setup();
		await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		vi.stubEnv('AI_API_KEY', 'test-key');
		vi.stubEnv('AI_SIMPLE_MODEL', model);
		const calls = [
			{ id: 'call-1', type: 'function', function: { name: 'confirm_booking', arguments: '{}' } },
			{ id: 'call-2', type: 'function', function: { name: 'prepare_booking', arguments: truncated ? '{}' : '{broken' } }
		];
		const envelope = model === 'openai/gpt-6.1-sol'
			? { status: truncated ? 'incomplete' : 'completed', output: calls.map(call => ({ type: 'function_call', call_id: call.id, ...call.function })) }
			: { choices: [{ finish_reason: truncated ? 'length' : 'tool_calls', message: { content: null, tool_calls: calls } }] };
		const fetchMock = vi.fn(async () => new Response(JSON.stringify(envelope)));
		vi.stubGlobal('fetch', fetchMock);
		const reply = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'yes' });
		expect(reply.model).toBe('tool_fallback');
		expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
		expect((await t.run(ctx => ctx.db.get(sessionId)))?.pendingBookingQuote).toBeUndefined();
		expect(fetchMock).toHaveBeenCalledTimes(1);
		await expect(t.mutation(internal.bookings.confirmChatBooking, { sessionId })).rejects.toThrow('No prepared booking');
	});

	it('does not treat a refusal to cancel as consent when cancellation is already pending', async () => {
		const { t, sessionId, stay } = await setup(); await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		const booked = await t.mutation(internal.bookings.confirmChatBooking, { sessionId });
		await t.mutation(internal.bookings.cancelChatBooking, { sessionId, reference: booked.confirmationCode, turnStartedAt: Date.now() });
		modelSequence([modelReply(null, 'cancel_booking', JSON.stringify({ reference: booked.confirmationCode }), 'tool_calls'), modelReply('Booking cancelled.')]);
		const reply = await t.action(api.chatAi.generateReply, { sessionId, userMessage: "Don't cancel my booking." });
		expect(reply.model).toBe('tool_fallback'); expect((await t.run(ctx => ctx.db.get(booked.bookingId)))?.status).toBe('pending');
	});

	it('renders the committed price even if a later model reply would invent another total', async () => {
		const { t, sessionId, stay } = await setup();
		await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		modelSequence([modelReply(null, 'confirm_booking', '{}', 'tool_calls'), modelReply('Booked for THB 1.')]);
		const result = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'yes' });
		const rows = await t.run(ctx => ctx.db.query('bookings').take(10));
		expect(rows).toHaveLength(1); expect(rows[0].total).toBe(21675);
		expect(result.response).toContain('THB 21,675'); expect(result.response).toContain(rows[0].confirmationCode);
		expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
	});

	it('does not return incomplete final text', async () => {
		const { t, sessionId } = await setup(); modelSequence([modelReply('Your booking has been conf', undefined, '{}', 'length')]);
		const result = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'Tell me about the villa.' });
		expect(result.model).toBe('tool_fallback'); expect(result.response).not.toContain('been conf');
	});

	it('enforces staff takeover inside a write when it happens during model generation', async () => {
		const { t, sessionId, stay } = await setup(); await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		vi.stubEnv('AI_API_KEY', 'test-key'); let calls = 0;
		vi.stubGlobal('fetch', vi.fn(async () => {
			if (++calls === 1) { await t.run(ctx => ctx.db.patch(sessionId, { aiPaused: true })); return modelReply(null, 'confirm_booking', '{}', 'tool_calls'); }
			return modelReply('Your booking is confirmed!');
		}));
		const result = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'yes' });
		expect(result.model).toBe('tool_fallback'); expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});

	it('requires a new confirmation when the live villa price changes after preparation', async () => {
		const { t, sessionId, propertyId, stay } = await setup();
		await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		await t.run(ctx => ctx.db.patch(propertyId, { pricePerNight: 9000 }));
		await expect(t.mutation(internal.bookings.confirmChatBooking, { sessionId })).rejects.toThrow('price changed');
		expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});

	it('prevents writes after the deadline', async () => {
		const { t, sessionId, stay } = await setup();
		await expect(t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay, deadlineAt: Date.now() - 1 })).rejects.toThrow('deadline exceeded');
		expect((await t.run(ctx => ctx.db.get(sessionId)))?.pendingBookingQuote).toBeUndefined();
	});

	it('does not present a cancelled booking as a fresh confirmation', async () => {
		const { t, sessionId, stay } = await setup(); await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		const booked = await t.mutation(internal.bookings.confirmChatBooking, { sessionId });
		await t.run(ctx => ctx.db.patch(booked.bookingId, { status: 'cancelled' }));
		await expect(t.mutation(internal.bookings.confirmChatBooking, { sessionId })).rejects.toThrow('cancelled');
	});
});


describe('review accuracy regressions', () => {
	it('uses current cancellation policy instead of historical stale prose', async () => {
		vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
		const { t, sessionId } = await setup('web');
		await seedHistoricalAnswer(t, { title: 'Cancellation policy', answer: 'Free cancellation anytime.', question: 'What is your cancellation policy?' });
		await t.run(ctx => ctx.db.insert('siteSettings', { key: 'default', cancellationPolicy: 'Cancellation requires 72 hours notice.', updatedAt: Date.now(), updatedByEmail: 'admin@example.com' }));
		const reply = await t.action(api.chatAi.respond, { sessionId, userMessage: 'What is your cancellation policy?' });
		expect(reply.model).toBe('guardrail'); expect(reply.response).toBe('Cancellation requires 72 hours notice.');
	});

	it('a delayed yes cannot commit a replacement proposal from another turn', async () => {
		const { t, sessionId, stay } = await setup();
		await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		vi.stubEnv('AI_API_KEY', 'test-key'); let calls = 0;
		vi.stubGlobal('fetch', vi.fn(async () => {
			if (++calls === 1) {
				await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay, guests: 3 });
				return modelReply(null, 'confirm_booking', '{}', 'tool_calls');
			}
			return modelReply('Your booking is confirmed.');
		}));
		const reply = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'yes' });
		expect(reply.model).toBe('tool_fallback'); expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});

	it('an amended yes does not confirm the previous guest count', async () => {
		const { t, sessionId, stay } = await setup(); await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
		modelSequence([modelReply(null, 'confirm_booking', '{}', 'tool_calls'), modelReply('Your booking is confirmed.')]);
		const reply = await t.action(api.chatAi.generateReply, { sessionId, userMessage: 'Yes, for 3 guests.' });
		expect(reply.model).toBe('tool_fallback'); expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(0);
	});
});


it('recovers the same committed booking for a second yes using the original proposal snapshot', async () => {
	const { t, sessionId, stay } = await setup(); await t.mutation(internal.bookings.prepareChatBooking, { sessionId, ...stay });
	const expectedProposal = proposalIdentity((await t.run(ctx => ctx.db.get(sessionId)))?.pendingBookingQuote);
	const first = await t.mutation(internal.bookings.confirmChatBooking, { sessionId, expectedProposal });
	const repeated = await t.mutation(internal.bookings.confirmChatBooking, { sessionId, expectedProposal });
	expect(repeated.confirmationCode).toBe(first.confirmationCode); expect(repeated.alreadyConfirmed).toBe(true); expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toHaveLength(1);
});
