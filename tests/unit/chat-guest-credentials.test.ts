// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import type { ConvexReactClient } from 'convex/react';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { api } from 'convex/_generated/api';
import { claimChatBrowserHandoff, closeChatSession, createChatBrowserHandoff, createChatSession, getChatMessages, getNextChatSuggestions, markChatSuggestionsShown, markChatSuggestionClicked, identifyChatVisitor, touchChatSession } from '@/lib/react/convex-api';
import { clearStoredSessionId, getStoredGuestToken, getStoredSessionId, setStoredSessionId, storeGuestToken } from '@/components/chat/session/credentials';

beforeEach(() => localStorage.clear());

it('persists guest credentials through creation, reload, and handoff and sends them on every session request', async () => {
	const mutation = vi.fn(async (ref: FunctionReference<"mutation">, args: Record<string, unknown>) => {
		if (getFunctionName(ref) === 'chat:createSession') return { sessionId: 'session-one', guestToken: 'original-token' };
		if (getFunctionName(ref) === 'chat:claimBrowserHandoff') return { sessionId: 'session-one', guestToken: 'rotated-token' };
		return args;
	});
	const query = vi.fn<(ref: unknown, args: unknown) => Promise<unknown[]>>().mockResolvedValue([]);
	const action = vi.fn<(ref: unknown, args: unknown) => Promise<{ response: string }>>().mockResolvedValue({ response: 'hello' });
	const client = { mutation, query, action } as unknown as ConvexReactClient;
	const sessionId = await createChatSession(client, { channel: 'web', visitorId: 'visitor' });
	setStoredSessionId(sessionId);
	// Read from persistent storage as a freshly mounted chat does.
	expect(getStoredSessionId()).toBe('session-one');
	expect(getStoredGuestToken(sessionId)).toBe('original-token');
	await touchChatSession(client, { sessionId });
	await identifyChatVisitor(client, { sessionId, email: 'guest@example.com' });
	await getChatMessages(client, { sessionId });
	await getNextChatSuggestions(client, { sessionId, candidateSuggestionIds: ['availability'] });
	await markChatSuggestionsShown(client, { sessionId, suggestions: [{ source: 'static', suggestionId: 'availability' }] });
	await markChatSuggestionClicked(client, { sessionId, suggestion: { source: 'static', suggestionId: 'availability' } });
	await createChatBrowserHandoff(client, { sessionId });
	await client.mutation(api.chat.sendMessage, { sessionId: sessionId as never, guestToken: getStoredGuestToken(sessionId)!, clientMessageId: crypto.randomUUID(), content: 'hello' });
	await closeChatSession(client, { sessionId });
	for (const [, args] of mutation.mock.calls.slice(1)) expect(args).toMatchObject({ sessionId, guestToken: 'original-token' });
	for (const [, args] of query.mock.calls) expect(args).toMatchObject({ sessionId, guestToken: 'original-token' });
	expect(action).not.toHaveBeenCalled();
	await claimChatBrowserHandoff(client, { token: 'handoff' });
	await getChatMessages(client, { sessionId });
	expect(query).toHaveBeenLastCalledWith(api.chat.getMessages, { sessionId, guestToken: 'rotated-token' });
});

it('removes the session token when clearing the stored session id', () => {
	setStoredSessionId('old-session');
	storeGuestToken('old-session', 'old-token');
	clearStoredSessionId();
	expect(getStoredSessionId()).toBeNull();
	expect(getStoredGuestToken('old-session')).toBeUndefined();
	clearStoredSessionId();
});

it('bounds suggestion lookup batches while preserving the remaining candidate order', async () => {
	storeGuestToken('session', 'token');
	const query = vi.fn()
		.mockResolvedValueOnce([])
		.mockResolvedValueOnce([{ source: 'static', suggestionId: 'contact' }]);
	const client = { query } as unknown as ConvexReactClient;
	const selected = await getNextChatSuggestions(client, {
		sessionId: 'session',
		candidateSuggestionIds: ['availability', 'totalPrice', 'direct', 'tour', 'guests', 'contact'],
		limit: 2,
	});
	expect(query.mock.calls.map(([, args]) => args.candidateSuggestionIds)).toEqual([
		['availability', 'totalPrice', 'direct', 'tour', 'guests'], ['contact'],
	]);
	for (const [, args] of query.mock.calls) expect(args).toMatchObject({ guestToken: 'token', limit: 2 });
	expect(selected).toEqual([{ source: 'static', suggestionId: 'contact' }]);
});
