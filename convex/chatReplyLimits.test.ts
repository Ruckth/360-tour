// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { HOUR } from '@convex-dev/rate-limiter';
import { api, internal } from './_generated/api';
import { asAdmin, createHarness, guestSession } from './testing/harness';
import { channelLimitConfig, consumeChatAdmission } from './messaging/chatAdmission';
import { CHAT_REPLY_LIMIT_DEFAULTS } from './shared/siteSettings';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T06:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('saves separate web and LINE allowances, enforcing them across chats without sharing with WhatsApp', async () => {
  const t = createHarness(convexTest), admin = await asAdmin(t);
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 1, line: 2 }, expectedRevision: 0 });
  const web = await guestSession(t), otherWeb = await guestSession(t);
  const send = (guest: typeof web) => t.mutation(api.messaging.chat.sendMessage, { ...guest, clientMessageId: crypto.randomUUID(), content: 'Hello' });
  await send(web);
  await expect(send(otherWeb)).rejects.toThrow();
  expect(await t.query(api.messaging.chat.getMessages, otherWeb)).toEqual([]);
  for (const [channel, count] of [['line', 3], ['whatsapp', 1]] as const) {
    for (let i = 0; i < count; i++) {
      const eventKey = `${channel}-${i}`;
      await t.mutation(internal.messaging.ingress.accept, { channel, events: [{ eventKey, recipient: `guest-${i}`, eventType: 'message', messageText: 'Hello', eventTimestamp: Date.now() }] });
      const event = (await t.run(ctx => ctx.db.query('channelEvents').withIndex('by_channel_and_eventKey', q => q.eq('channel', channel).eq('eventKey', eventKey)).unique()))!;
      await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: eventKey });
      const admit = t.mutation(internal.messaging.ingress.admit, { eventId: event._id, claimToken: eventKey });
      if (i === 2) {
        await expect(admit).rejects.toThrow();
        expect(await t.run(ctx => ctx.db.get(event._id))).not.toHaveProperty('admittedAt');
        expect(await t.run(ctx => ctx.db.get(event.userMessageId!))).toMatchObject({ content: 'Hello' });
      } else await admit;
    }
  }
});

it('applies saved per-chat limits independently across conversations', async () => {
  const t = createHarness(convexTest), admin = await asAdmin(t);
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { perChat: 1 } });
  const one = await guestSession(t), two = await guestSession(t);
  await t.run(ctx => consumeChatAdmission(ctx, one.sessionId));
  await expect(t.run(ctx => consumeChatAdmission(ctx, one.sessionId))).rejects.toThrow();
  await t.run(ctx => consumeChatAdmission(ctx, two.sessionId));
});

it('gives each limit its own hourly count, including shard transitions and returning to an earlier value', async () => {
  const t = createHarness(convexTest), admin = await asAdmin(t), guest = await guestSession(t);
  const admit = () => t.run(ctx => consumeChatAdmission(ctx, guest.sessionId));
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 1, perChat: 100 } });
  await admit(); await expect(admit()).rejects.toThrow();
  await admin.mutation(api.settings.settings.update, { ai: { tone: 'concise' }, chatReplyLimits: { web: 1, line: 2 } });
  await expect(admit()).rejects.toThrow(); // Same value and unrelated changes preserve web usage.
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 500 } });
  await admit(); // No stale unsharded balance when sharding begins.
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 1 } });
  await expect(admit()).rejects.toThrow(); // Returning to 1 within the hour resumes that limit's count.
  vi.setSystemTime(Date.now() + HOUR + 1);
  await admit();
  expect(channelLimitConfig(1).shards).toBeUndefined();
  expect(channelLimitConfig(499).shards).toBeUndefined();
  expect(channelLimitConfig(500).shards).toBe(10);
});

it('retains unrelated per-chat usage and refreshes a changed per-chat allowance immediately', async () => {
  const t = createHarness(convexTest), admin = await asAdmin(t), guest = await guestSession(t);
  const admit = () => t.run(ctx => consumeChatAdmission(ctx, guest.sessionId));
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { perChat: 1 } });
  await admit(); await expect(admit()).rejects.toThrow();
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 100 } });
  await expect(admit()).rejects.toThrow();
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { perChat: 2 } });
  await admit(); await admit(); await expect(admit()).rejects.toThrow();
});

it('records and restores reply limits, and restores defaults from older history', async () => {
  const t = createHarness(convexTest), admin = await asAdmin(t);
  expect((await admin.query(api.settings.settings.get, {})).chatReplyLimits).toEqual(CHAT_REPLY_LIMIT_DEFAULTS);
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 2, line: 3 } });
  const entry = (await t.run(ctx => ctx.db.query('recordChanges').first()))!;
  expect(entry.before).toMatchObject({ chatReplyLimits: CHAT_REPLY_LIMIT_DEFAULTS });
  expect(entry.after).toMatchObject({ chatReplyLimits: { ...CHAT_REPLY_LIMIT_DEFAULTS, web: 2, line: 3 } });
  await admin.mutation(api.settings.settings.update, { chatReplyLimits: { web: 1 } });
  await expect(admin.mutation(api.settings.settings.update, { expectedRevision: 1, chatReplyLimits: { web: 4 } })).rejects.toThrow('Settings changed');
  expect(await admin.mutation(api.settings.settings.restore, { historyId: entry._id, side: 'after', expectedRevision: 2 })).toMatchObject({ chatReplyLimits: { web: 2, line: 3 }, revision: 3 });
  await t.run(async ctx => {
    const before = { ...entry.before }; delete before.chatReplyLimits;
    await ctx.db.patch(entry._id, { before });
  });
  expect(await admin.mutation(api.settings.settings.restore, { historyId: entry._id, side: 'before', expectedRevision: 3 })).toMatchObject({ chatReplyLimits: CHAT_REPLY_LIMIT_DEFAULTS });
});

it.each([{ web: 0 }, { line: 10001 }, { perChat: 1001 }, { whatsapp: 1.5 }, { instagram: NaN }])('rejects invalid settings %j before writing', async chatReplyLimits => {
  const t = createHarness(convexTest);
  await expect((await asAdmin(t)).mutation(api.settings.settings.update, { chatReplyLimits })).rejects.toThrow('whole number');
  expect(await t.run(ctx => ctx.db.query('siteSettings').first())).toBeNull();
});
