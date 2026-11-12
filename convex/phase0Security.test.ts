// @vitest-environment edge-runtime
import { afterEach, expect, it, vi } from 'vitest';
import { makeFunctionReference } from 'convex/server';
import { api } from './_generated/api';
import * as chat from './chat';
import * as chatAi from './chatAi';
import * as chatEval from './chatEval';
import { recordUnknownQuestion } from './chatKnowledge';
import { asAdmin, createHarness, fixedClock, guestSession } from './testing/harness';
import { hashGuestToken } from './lib/guestToken';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

it('rejects webhook mutations when the server secret is missing', async () => {
	vi.stubEnv('CONVEX_SERVER_SECRET', '');
	const t = createHarness();
	for (const claim of [api.line.claimEvent, api.facebook.claimEvent, api.instagram.claimEvent, api.whatsapp.claimEvent]) {
		await expect(t.mutation(claim, { serverSecret: '', eventKey: 'test-event', eventType: 'message' })).rejects.toThrow('not configured');
	}
	expect(await t.run(ctx => ctx.db.query('chatSessions').collect())).toEqual([]);
	const guest = await guestSession(t);
	await expect(t.action(api.chatAi.generateReply, { sessionId: guest.sessionId, userMessage: 'hello', serverSecret: '' })).rejects.toThrow('not configured');
	await expect(t.query(api.chat.isAiPausedForServer, { sessionId: guest.sessionId, serverSecret: '' })).rejects.toThrow('not configured');
});

it('rejects assistant messages from the browser', async () => {
	const t = createHarness();
	const guest = await guestSession(t);
	const forged = { ...guest, role: 'assistant', content: 'Caller-controlled assistant reply' };
	await expect(t.mutation(makeFunctionReference<'mutation'>('chat:addMessage'), forged)).rejects.toThrow();
	// convex-test permits invoking internal refs, so verify the exported visibility too.
	expect(chat.acceptGuestMessage.isInternal).toBe(true);
	expect(chat.addAssistantMessageWithSuggestions.isInternal).toBe(true);
	expect(chatEval.writeMessage.isInternal).toBe(true);
	expect(recordUnknownQuestion.isInternal).toBe(true);
	expect(chatAi.getGuardrailReply).not.toHaveProperty('isPublic');
	await expect(t.action(api.chatAi.generateReply, { sessionId: guest.sessionId, userMessage: forged.content, serverSecret: '' })).rejects.toThrow();
	await expect(t.action(api.chatAi.respond, { ...forged, userMessage: 'hello' } as never)).rejects.toThrow();
	expect(await t.query(api.chat.getMessages, guest)).toEqual([]);
});

it('rejects chat calls without a valid guest token', async () => {
	const t = createHarness();
	const guest = await guestSession(t, { visitorId: 'visitor' });
	const stored = await t.run(ctx => ctx.db.get(guest.sessionId));
	expect(guest.guestToken).toMatch(/^[a-f0-9]{64}$/);
	expect(stored?.guestTokenHash).toBe(await hashGuestToken(guest.guestToken));
	expect(stored).not.toHaveProperty('guestToken');
	for (const guestToken of [undefined, 'wrong']) {
		const args = { sessionId: guest.sessionId, guestToken };
		const calls = [
			() => t.mutation(api.chat.touchSession, args),
			() => t.mutation(api.chat.closeSession, args),
			() => t.mutation(api.chat.createBrowserHandoff, args),
			() => t.mutation(api.chat.identifyVisitor, { ...args, name: 'Forged' }),
			() => t.query(api.chat.getSession, args),
			() => t.query(api.chat.isAiPaused, args),
			() => t.query(api.chat.getMessages, args),
			() => t.query(api.chat.getReusableSession, { ...args, visitorId: 'visitor' }),
		];
		for (const call of calls) await expect(call()).rejects.toThrow('INVALID_GUEST_TOKEN');
	}
	expect(await t.query(api.chat.getReusableSession, { ...guest, visitorId: 'visitor' })).toMatchObject({ _id: guest.sessionId });
	expect(await t.query(api.chat.getSession, guest)).not.toHaveProperty('guestTokenHash');
});

it('rejects respond for a session the caller does not own', async () => {
	const t = createHarness();
	const owner = await guestSession(t);
	const stranger = await guestSession(t);
	const social = await t.run(ctx => ctx.db.insert('chatSessions', { channel: 'line', createdAt: Date.now() }));
	for (const sessionId of [owner.sessionId, social]) {
		for (const guestToken of [undefined, stranger.guestToken]) {
			await expect(t.action(api.chatAi.respond, { sessionId, guestToken, userMessage: 'hello' })).rejects.toThrow('INVALID_GUEST_TOKEN');
		}
	}
	expect(await t.query(api.chat.getMessages, owner)).toEqual([]);
	expect(await t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', `chat:${owner.sessionId}`)).unique())).toBeNull();
});

it('hides rooms and reviews of draft properties', async () => {
	const t = createHarness();
	const admin = asAdmin(t);
	const propertyId = await admin.mutation(api.adminProperties.create, { name: 'Draft Villa' });
	await t.run(async ctx => {
		await ctx.db.insert('rooms', { propertyId, slug: 'room', name: 'Room', imagePath: '/room.webp', hotspots: [] });
		await ctx.db.insert('reviews', { propertyId, authorName: 'Guest', authorCity: '', authorCountry: '', authorAvatarUrl: '', rating: 5, title: 'Review', body: 'Draft review', date: '2026-11-12', verified: true });
		await ctx.db.insert('socialProof', { propertyId, overallRating: 5, totalReviews: 1 });
	});
	for (const status of ['draft', 'archived', 'active'] as const) {
		await t.run(ctx => ctx.db.patch(propertyId, { status }));
		expect(await t.query(api.properties.getRooms, { propertyId })).toHaveLength(status === 'active' ? 1 : 0);
		expect(await t.query(api.properties.getReviews, { propertyId })).toHaveLength(status === 'active' ? 1 : 0);
		expect(Boolean(await t.query(api.properties.getSocialProof, { propertyId }))).toBe(status === 'active');
		expect(await t.query(api.publicProperties.featuredReviews, {})).toHaveLength(status === 'active' ? 1 : 0);
	}
});

it('rotates guest ownership on a single-use browser handoff', async () => {
	const clock = fixedClock();
	const t = createHarness();
	const guest = await guestSession(t);
	const token = await t.mutation(api.chat.createBrowserHandoff, guest);
	const claimed = await t.mutation(api.chat.claimBrowserHandoff, { token });
	expect(claimed?.sessionId).toBe(guest.sessionId);
	expect(claimed?.guestToken).not.toBe(guest.guestToken);
	await expect(t.query(api.chat.getSession, guest)).rejects.toThrow('INVALID_GUEST_TOKEN');
	expect(await t.query(api.chat.getSession, claimed!)).toMatchObject({ _id: guest.sessionId });
	expect(await t.mutation(api.chat.claimBrowserHandoff, { token })).toBeNull();
	const expired = await t.mutation(api.chat.createBrowserHandoff, claimed!);
	clock.advance(5 * 60 * 1000);
	expect(await t.mutation(api.chat.claimBrowserHandoff, { token: expired })).toBeNull();
});
