// @vitest-environment happy-dom
import { beforeEach, expect, it } from 'vitest';
import { convexTest } from 'convex-test';
import { createHarness } from '../../convex/testing/harness';
import { api } from 'convex/_generated/api';
import { clearStoredSessionId, getStoredGuestToken, getStoredSessionId, setStoredSessionId, storeGuestToken } from '@/components/chat/session/credentials';

beforeEach(() => localStorage.clear());
it('persists actual guest credentials and rotates them through a real browser handoff', async () => {
  const t = createHarness(convexTest);
  const session = await t.mutation(api.messaging.chat.createSession, { channel: 'web', visitorId: 'credential-test' });
  setStoredSessionId(session.sessionId); storeGuestToken(session.sessionId, session.guestToken);
  expect(getStoredSessionId()).toBe(session.sessionId);
  expect(getStoredGuestToken(session.sessionId)).toBe(session.guestToken);
  await t.mutation(api.messaging.chat.touchSession, session);
  await t.mutation(api.messaging.chat.identifyVisitor, { ...session, email: 'guest@example.test' });
  await expect(t.query(api.messaging.chat.getMessages, { sessionId: session.sessionId })).rejects.toThrow();
  const token = await t.mutation(api.messaging.chat.createBrowserHandoff, session);
  const claimed = await t.mutation(api.messaging.chat.claimBrowserHandoff, { token });
  expect(claimed?.guestToken).not.toBe(session.guestToken);
  storeGuestToken(claimed!.sessionId, claimed!.guestToken);
  await expect(t.query(api.messaging.chat.getMessages, session)).rejects.toThrow();
  expect(await t.query(api.messaging.chat.getMessages, { sessionId: session.sessionId, guestToken: getStoredGuestToken(session.sessionId) })).toEqual([]);
  await t.mutation(api.messaging.chat.closeSession, claimed!);
});
it('removes the session token when clearing the stored session id', () => {
  setStoredSessionId('old-session'); storeGuestToken('old-session', 'old-token');
  clearStoredSessionId();
  expect(getStoredSessionId()).toBeNull(); expect(getStoredGuestToken('old-session')).toBeUndefined();
  clearStoredSessionId();
});
it('requires the real session credential for suggestion reads and writes', async () => {
  const t = createHarness(convexTest);
  const session = await t.mutation(api.messaging.chat.createSession, { channel: 'web' });
  const suggestions = await t.query(api.messaging.chatSuggestions.nextForSession, { ...session, candidateSuggestionIds: ['availability', 'totalPrice', 'direct', 'tour', 'guests'], limit: 2 });
  expect(suggestions.length).toBeLessThanOrEqual(2);
  await t.mutation(api.messaging.chatSuggestions.markShown, { ...session, suggestions });
  if (suggestions[0]) await t.mutation(api.messaging.chatSuggestions.markClicked, { ...session, suggestion: suggestions[0] });
  await expect(t.mutation(api.messaging.chatSuggestions.markShown, { sessionId: session.sessionId, suggestions })).rejects.toThrow();
});
