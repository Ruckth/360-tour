import { respondTest } from './testing/turn.test-support';
import * as ingress from './messaging/ingress';
import * as worker from './messaging/worker';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
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
  // The shared secret bridge is retired. No public event mutation exists; ingress requires a provider signature.
  const t = createHarness(convexTest);
  expect(ingress.accept.isInternal).toBe(true);
  expect(worker.claim.isInternal).toBe(true);
  expect(worker.commitTurn.isInternal).toBe(true);
  for (const channel of ['line','facebook','instagram','whatsapp']) {
    expect((await t.fetch(`/${channel}/webhook`, { method: 'POST', body: '{}' })).status).toBe(401);
    await expect(t.mutation(makeFunctionReference<'mutation'>(`${channel}:claimEvent`), {})).rejects.toThrow();
  }
  expect(await t.run(ctx => ctx.db.query('conversations').collect())).toEqual([]);
});

it('rejects assistant messages from the browser', async () => {
	const t = createHarness(convexTest);
	const guest = await guestSession(t);
	const forged = { ...guest, role: 'assistant', content: 'Caller-controlled assistant reply' };
	await expect(t.mutation(makeFunctionReference<'mutation'>('chat:addMessage'), forged)).rejects.toThrow();
	// convex-test permits invoking internal refs, so verify the exported visibility too.
	expect(chat.acceptGuestMessage.isInternal).toBe(true);
	expect(chat.addAssistantMessageWithSuggestions.isInternal).toBe(true);
	expect(chatEval.writeMessage.isInternal).toBe(true);
	expect(recordUnknownQuestion.isInternal).toBe(true);
	expect(chatAi.getGuardrailReply).not.toHaveProperty('isPublic');
	await expect(t.action(makeFunctionReference<'action'>('chatAi:generateReply'), {})).rejects.toThrow();
	await expect(t.mutation(api.chat.sendMessage, { ...forged, clientMessageId: crypto.randomUUID() } as never)).rejects.toThrow();
	expect(await t.query(api.chat.getMessages, guest)).toEqual([]);
});

it('rejects chat calls without a valid guest token', async () => {
	const t = createHarness(convexTest);
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
		];
		for (const call of calls) await expect(call()).rejects.toThrow('INVALID_GUEST_TOKEN');
	}
	expect(await t.query(api.chat.getSession, guest)).not.toHaveProperty('guestTokenHash');
});

it('rejects respond for a session the caller does not own', async () => {
	const t = createHarness(convexTest);
	const owner = await guestSession(t);
	const stranger = await guestSession(t);
	const social = await t.run(ctx => ctx.db.insert('conversations', { channel: 'line', createdAt: Date.now() }));
	for (const sessionId of [owner.sessionId, social]) {
		for (const guestToken of [undefined, stranger.guestToken]) {
			await expect(respondTest(t, { sessionId, guestToken, userMessage: 'hello' })).rejects.toThrow('INVALID_GUEST_TOKEN');
		}
	}
	expect(await t.query(api.chat.getMessages, owner)).toEqual([]);
	expect(await t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', `chat:${owner.sessionId}`)).unique())).toBeNull();
});

it('hides rooms and reviews of draft properties', async () => {
	const t = createHarness(convexTest);
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const admin = asAdmin(t);
	const propertyId = await admin.mutation(api.adminProperties.create, { name: 'Draft Villa' });
	await t.run(async ctx => {
		await ctx.db.insert('tourScenes', { propertyId, slug: 'room', name: 'Room', imagePath: '/room.webp', hotspots: [] });
		await ctx.db.insert('reviews', { propertyId, authorName: 'Guest', authorCity: '', authorCountry: '', authorAvatarUrl: '', rating: 5, title: 'Review', body: 'Draft review', date: '2026-11-12', verified: true });
		await ctx.db.insert('reviewStats', { propertyId, overallRating: 5, totalReviews: 1 });
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
	const clock = fixedClock(vi);
	const t = createHarness(convexTest);
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


it('rejects suggestion tracking without a valid guest token', async () => {
	const t = createHarness(convexTest);
	const guest = await guestSession(t);
	const stranger = await guestSession(t);
	const socialId = await t.run(ctx => ctx.db.insert('conversations', { channel: 'line', guestTokenHash: 'unused', createdAt: Date.now() }));
	const deleted = await guestSession(t);
	await t.run(ctx => ctx.db.delete(deleted.sessionId));
	for (const args of [
		{ sessionId: guest.sessionId },
		{ ...guest, guestToken: 'wrong' },
		{ ...guest, guestToken: stranger.guestToken },
		{ ...guest, sessionId: socialId },
		deleted,
	]) {
		await expect(t.query(api.chatSuggestions.nextForSession, { ...args, candidateSuggestionIds: ['availability'] })).rejects.toThrow('INVALID_GUEST_TOKEN');
		await expect(t.mutation(api.chatSuggestions.markShown, { ...args, suggestions: [{ source: 'static', suggestionId: 'availability' }] })).rejects.toThrow('INVALID_GUEST_TOKEN');
		await expect(t.mutation(api.chatSuggestions.markClicked, { ...args, suggestion: { source: 'static', suggestionId: 'availability' } })).rejects.toThrow('INVALID_GUEST_TOKEN');
	}
	expect(await t.run(ctx => ctx.db.query('chatStaticSuggestionInteractions').collect())).toEqual([]);
	await expect(t.mutation(api.chatSuggestions.markClicked, { ...guest, suggestion: { source: 'static', suggestionId: 'availability' } })).resolves.toEqual({ clicked: true });
});

it('retires the public booking-flow and AI-pause server bridges', async () => {
 const t = createHarness(convexTest);
 for (const path of ['bookings:isChatBookingFlowActive','chat:isAiPausedForServer']) {
   await expect(t.query(makeFunctionReference<'query'>(path), {})).rejects.toThrow();
 }
});


it('bounds suggestion tracking to known keys and five items per call', async () => {
	const t = createHarness(convexTest);
	const guest = await guestSession(t);
	for (const suggestionId of ['invented-key', 'x'.repeat(10000)]) {
		await expect(t.query(api.chatSuggestions.nextForSession, { ...guest, candidateSuggestionIds: [suggestionId] } as never)).rejects.toThrow();
		await expect(t.mutation(api.chatSuggestions.markShown, { ...guest, suggestions: [{ source: 'static', suggestionId }] } as never)).rejects.toThrow();
		await expect(t.mutation(api.chatSuggestions.markClicked, { ...guest, suggestion: { source: 'static', suggestionId } } as never)).rejects.toThrow();
	}
	const keys = ['availability', 'totalPrice', 'direct', 'tour', 'guests', 'contact'] as const;
	await expect(t.query(api.chatSuggestions.nextForSession, { ...guest, candidateSuggestionIds: [...keys] })).rejects.toThrow('At most 5');
	await expect(t.mutation(api.chatSuggestions.markShown, { ...guest, suggestions: keys.map(suggestionId => ({ source: 'static' as const, suggestionId })) })).rejects.toThrow('At most 5');
	expect(await t.run(ctx => ctx.db.query('chatStaticSuggestionInteractions').collect())).toEqual([]);
	const suggestions = await t.query(api.chatSuggestions.nextForSession, { ...guest, candidateSuggestionIds: keys.slice(0, 5), limit: 100 });
	expect(suggestions).toHaveLength(5);
	expect(await t.mutation(api.chatSuggestions.markShown, { ...guest, suggestions })).toEqual({ updated: 5 });
});
