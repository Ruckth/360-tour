// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { expect, it, vi, beforeEach, afterEach } from 'vitest';
import { api, internal } from './_generated/api';
import { createHarness, guestSession } from './testing/harness';
import { chatLimiter } from './lib/chatAdmission';
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });
it('rejects oversized submissions before charging or refreshing metadata', async () => {
  const t = createHarness(convexTest), guest = await guestSession(t, { marketing: { slug: 'original' } });
  const before = await t.run(ctx => ctx.db.get(guest.sessionId));
  await expect(t.mutation(api.chat.sendMessage, { ...guest, clientMessageId: crypto.randomUUID(), content: 'x'.repeat(2001), marketing: {} })).rejects.toThrow('2000');
  expect(await t.run(ctx => ctx.db.get(guest.sessionId))).toEqual(before);
  expect(await t.run(ctx => chatLimiter.check(ctx, 'session', { key: guest.sessionId }))).toMatchObject({ ok: true });
});
it('charges one turn while accepting guest messages during staff takeover', async () => {
  const t = createHarness(convexTest), guest = await guestSession(t, { marketing: { slug: 'old' } });
  await t.run(ctx => ctx.db.patch(guest.sessionId, { aiPaused: true }));
  const result = await t.mutation(api.chat.sendMessage, { ...guest, clientMessageId: crypto.randomUUID(), content: 'Hello', marketing: {}, actionHint: 'booking' });
  expect(await t.query(api.chat.getMessages, guest)).toMatchObject([{ role: 'user', content: 'Hello' }]);
  expect((await t.run(ctx => ctx.db.get(guest.sessionId)))?.marketingCapture).toBeUndefined();
  expect(await t.run(ctx => ctx.db.get(result.eventId))).toMatchObject({ status: 'ignored' });
  expect(await t.mutation(internal.chat.addAssistantMessageWithSuggestions, { sessionId: guest.sessionId, content: 'Stale' })).toEqual({ stored: false, messageId: null });
});
it.each([['global', 500], ['session', 20]] as const)('retains the %s hourly budget and rolls back rejected admission', async (budget, limit) => {
  const t = createHarness(convexTest), guest = await guestSession(t, { marketing: { slug: 'old' } });
  // Fill every shard rather than depending on the random shard sampled by a request.
  let consumed = 0;
  for (let attempt = 0; consumed < limit && attempt < 100; attempt++) {
    const result = await t.run(ctx => chatLimiter.limit(ctx, budget, { ...(budget === 'session' ? { key: guest.sessionId } : {}), count: budget === 'global' ? 50 : limit }));
    if (result.ok) consumed += budget === 'global' ? 50 : limit;
  }
  expect(consumed).toBe(limit);
  const before = await t.run(ctx => ctx.db.get(guest.sessionId));
  await expect(t.mutation(api.chat.sendMessage, { ...guest, clientMessageId: crypto.randomUUID(), content: 'I need a human agent', marketing: {} })).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.get(guest.sessionId))).toEqual(before);
  expect(await t.query(api.chat.getMessages, guest)).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('channelEvents').take(10))).toEqual([]);
});
it('evaluation writers require an eval session and avoid production admission and alerts', async () => {
  const t = createHarness(convexTest), ordinary = await guestSession(t);
  await expect(t.mutation(internal.chatEval.writeMessage, { sessionId: ordinary.sessionId, role: 'assistant', content: 'No' })).rejects.toThrow('eval session');
  const sessionId = await t.mutation(internal.chatEval.createSession, { channel: 'web' });
  await t.mutation(internal.chatEval.writeMessage, { sessionId, role: 'user', content: 'I need a human agent' });
  await t.mutation(internal.chatEval.writeMessage, { sessionId, role: 'assistant', content: 'Eval reply' });
  const session = await t.run(ctx => ctx.db.get(sessionId));
  expect(session).toMatchObject({ messageCount: 2 }); expect(session).not.toHaveProperty('lastStaffAlertAt'); expect(session).not.toHaveProperty('inboxState');
});
