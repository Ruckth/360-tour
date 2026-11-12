// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { internal } from '../_generated/api';
import { createHarness } from '../testing/harness';
import { chatLimiter, consumeChatAdmission } from '../lib/chatAdmission';
import { HOUR } from '@convex-dev/rate-limiter';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T06:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

async function queue(t: ReturnType<typeof createHarness>, eventKey: string) {
  await t.mutation(internal.messaging.ingress.accept, { channel: 'line', events: [{ eventKey, recipient: 'guest', eventType: 'message', messageText: 'Hello', replyToken: 'test-reply', eventTimestamp: Date.now() }] });
  return (await t.run(ctx => ctx.db.query('channelEvents').withIndex('by_channel_and_eventKey', q => q.eq('channel', 'line').eq('eventKey', eventKey)).unique()))!;
}

it.each(['processing', 'received'] as const)('retires an unfinished pre-Phase 2 %s event without replaying it or blocking the next turn', async status => {
  const t = createHarness(convexTest), old = await queue(t, 'old');
  await t.run(ctx => ctx.db.patch(old._id, { arrivedAt: undefined, status, nextAttemptAt: undefined, replyToken: undefined }));
  vi.setSystemTime(Date.now() + 1);
  const next = await queue(t, 'new');
  const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  await t.action(internal.messaging.worker.run, { eventId: old._id });
  expect(await t.run(ctx => ctx.db.get(old._id))).toMatchObject({ status: 'failed', attempts: 0, error: expect.stringContaining('pre-Phase 2') });
  expect(transport).not.toHaveBeenCalled();
  expect((await t.run(ctx => ctx.db.get(old.sessionId!)))?.aiPaused).not.toBe(true);
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: next._id, token: 'new-claim' })).toMatchObject({ claimToken: 'new-claim' });
});

it('retires pre-Phase 2 events with no conversation instead of repeatedly recovering them', async () => {
  const t = createHarness(convexTest), old = await queue(t, 'old');
  await t.run(ctx => ctx.db.patch(old._id, { arrivedAt: undefined, sessionId: undefined, status: 'processing' }));
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: old._id, token: 'unused' })).toBeNull();
  expect((await t.run(ctx => ctx.db.get(old._id)))?.status).toBe('failed');
});

it('keeps a recent unlinked staff reply in chronological context when the transcript is bounded', async () => {
  const t = createHarness(convexTest), first = await queue(t, 'first');
  vi.setSystemTime(Date.now() + 1);
  await t.run(ctx => ctx.db.insert('messages', { sessionId: first.sessionId!, role: 'assistant', content: 'Staff clarified the arrival time.', timestamp: Date.now() }));
  vi.setSystemTime(Date.now() + 1);
  const current = await queue(t, 'current');
  const history = await t.query(internal.chat.getRecentMessages, { sessionId: first.sessionId!, throughMessageId: current.userMessageId, limit: 2 });
  expect(history.map(row => row.content)).toEqual(['Staff clarified the arrival time.', 'Hello']);
});

it.each(['session', 'global'] as const)('ends %s admission refusal without sticky AI pause and resumes after the limit window', async budget => {
  const t = createHarness(convexTest), event = await queue(t, 'limited');
  if (budget === 'session') {
    for (let i = 0; i < 20; i++) await t.run(ctx => consumeChatAdmission(ctx, event.sessionId!));
  } else {
    let consumed = 0;
    // Exercise the real component's ten shards, without weakening its global budget.
    for (let i = 0; i < 100 && consumed < 500; i++) {
      const result = await t.run(ctx => chatLimiter.limit(ctx, 'global', { count: 50 }));
      if (result.ok) consumed += 50;
    }
    expect(consumed).toBe(500);
  }
  const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  await t.action(internal.messaging.worker.run, { eventId: event._id });
  expect(await t.run(ctx => ctx.db.get(event._id))).toMatchObject({ status: 'failed', attempts: 1, error: expect.stringContaining('rate limit') });
  const session = await t.run(ctx => ctx.db.get(event.sessionId!));
  expect(session).toMatchObject({ inboxState: 'needs_staff', inboxReason: 'send_failed' });
  expect(session?.aiPaused).not.toBe(true);
  await t.mutation(internal.inboxLifecycle.expireAnswer, { sessionId: event.sessionId!, messageId: event.userMessageId! });
  expect((await t.run(ctx => ctx.db.get(event.sessionId!)))?.aiPaused).not.toBe(true);
  expect(transport).not.toHaveBeenCalled();
  if (budget === 'global') {
    // A failed global admission must also roll back the earlier session charge.
    expect((await t.run(ctx => chatLimiter.check(ctx, 'session', { key: event.sessionId!, count: 20 }))).ok).toBe(true);
  }
  vi.setSystemTime(Date.now() + HOUR + 1);
  const next = await queue(t, 'after-reset');
  await t.mutation(internal.messaging.worker.claim, { eventId: next._id, token: 'fresh' });
  await t.mutation(internal.messaging.ingress.admit, { eventId: next._id, claimToken: 'fresh' });
  expect((await t.run(ctx => ctx.db.get(next._id)))?.admittedAt).toBe(Date.now());
  expect((await t.run(ctx => ctx.db.get(event.sessionId!)))?.aiPaused).not.toBe(true);
});
