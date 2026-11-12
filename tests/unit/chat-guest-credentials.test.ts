// @vitest-environment happy-dom
import { beforeEach, expect, it, vi } from 'vitest';
import type { ConvexReactClient } from 'convex/react';
import { getFunctionName, type FunctionReference } from 'convex/server';
import { api } from 'convex/_generated/api';
import { askConcierge, claimChatBrowserHandoff, closeChatSession, createChatBrowserHandoff, createChatSession, getChatMessages, getReusableChatSession, identifyChatVisitor, touchChatSession } from '@/lib/react/convex-api';
import { getStoredGuestToken, getStoredSessionId, setStoredSessionId } from '@/components/chat/session/message-cache';

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
	await getReusableChatSession(client, { visitorId: 'visitor' });
	await createChatBrowserHandoff(client, { sessionId });
	await askConcierge(client, { sessionId, userMessage: 'hello' });
	await closeChatSession(client, { sessionId });
	for (const [, args] of mutation.mock.calls.slice(1)) expect(args).toMatchObject({ sessionId, guestToken: 'original-token' });
	for (const [, args] of query.mock.calls) expect(args).toMatchObject({ sessionId, guestToken: 'original-token' });
	expect(action).toHaveBeenCalledWith(api.chatAi.respond, expect.objectContaining({ sessionId, guestToken: 'original-token' }));
	await claimChatBrowserHandoff(client, { token: 'handoff' });
	await getChatMessages(client, { sessionId });
	expect(query).toHaveBeenLastCalledWith(api.chat.getMessages, { sessionId, guestToken: 'rotated-token' });
});

it('does not look up another visitor session when the stored credential is missing', async () => {
	const query = vi.fn();
	const client = { query } as unknown as ConvexReactClient;
	setStoredSessionId('old-session-without-token');
	expect(await getReusableChatSession(client, { visitorId: 'known-visitor-id' })).toBeNull();
	expect(query).not.toHaveBeenCalled();
});
