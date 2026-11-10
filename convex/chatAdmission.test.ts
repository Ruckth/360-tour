// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
const oldWriter = makeFunctionReference<'mutation'>('chat:addMessage');
it.each(['user', 'assistant'])('retires the public transcript writer (%s)', async role => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.chat.createSession, { channel: 'web' });
  await expect(t.mutation(oldWriter, { sessionId, role, content: 'Forged', action: 'booking' })).rejects.toThrow();
  expect(await t.query(api.chat.getMessages, { sessionId })).toEqual([]);
});
it('rejects oversized submissions before charging or refreshing metadata', async () => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.chat.createSession, { channel: 'web', marketing: { slug: 'original' } });
  const before = await t.run(ctx => ctx.db.get(sessionId));
  await expect(t.action(api.chatAi.respond, { sessionId, userMessage: 'x'.repeat(2001), marketing: {} })).rejects.toThrow('too long');
  expect(await t.run(ctx => ctx.db.get(sessionId))).toEqual(before);
  expect(await t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', `chat:${sessionId}`)).unique())).toBeNull();
});
it('charges one turn while accepting guest messages during staff takeover', async () => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.chat.createSession, { channel: 'web', marketing: { slug: 'old' } });
  await t.run(ctx => ctx.db.patch(sessionId, { aiPaused: true }));
  expect(await t.action(api.chatAi.respond, { sessionId, userMessage: 'Hello', marketing: {}, actionHint: 'booking' })).toMatchObject({ aiPaused: true });
  expect(await t.query(api.chat.getMessages, { sessionId })).toMatchObject([{ role: 'user', content: 'Hello' }]);
  expect(await t.run(ctx => ctx.db.get(sessionId))).toMatchObject({ messageCount: 1 });
  expect((await t.run(ctx => ctx.db.get(sessionId)))?.marketingCapture).toBeUndefined();
  for (const key of [`chat:${sessionId}`, 'chat:global']) {
    expect(await t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', key)).unique())).toMatchObject({ count: 1 });
  }
  expect(await t.mutation(internal.chat.addAssistantMessageWithSuggestions, { sessionId, content: 'Stale' })).toEqual({ stored: false, messageId: null });
});
it.each([['chat:global', 500], ['session', 20]] as const)('rolls back all admission effects when %s is exhausted', async (budget, limit) => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.chat.createSession, { channel: 'web', marketing: { slug: 'old' } });
  const key = budget === 'session' ? `chat:${sessionId}` : budget;
  await t.run(ctx => ctx.db.insert('rateLimits', { key, count: limit, expiresAt: Date.now() + 60000 }));
  const before = await t.run(ctx => ctx.db.get(sessionId));
  const counts = await t.run(ctx => ctx.db.query('rateLimits').collect());
  await expect(t.action(api.chatAi.respond, { sessionId, userMessage: 'I need a human agent', marketing: {} })).rejects.toThrow('Too many');
  expect(await t.run(ctx => ctx.db.get(sessionId))).toEqual(before);
  expect(await t.query(api.chat.getMessages, { sessionId })).toEqual([]);
  expect(await t.run(ctx => ctx.db.query('rateLimits').collect())).toEqual(counts);
});
it('standalone generation retains its admission limiter', async () => {
  const t = convexTest(schema, modules);
  const sessionId = await t.mutation(api.chat.createSession, { channel: 'web' });
  await t.run(ctx => ctx.db.insert('rateLimits', { key: `chat:${sessionId}`, count: 20, expiresAt: Date.now() + 60000 }));
  await expect(t.action(api.chatAi.generateReply, { sessionId, userMessage: 'hello' })).rejects.toThrow('Too many');
});
it('evaluation writers require an eval session and avoid production admission and alerts', async () => {
  const t = convexTest(schema, modules);
  const ordinary = await t.mutation(api.chat.createSession, { channel: 'web' });
  await expect(t.mutation(internal.chatEval.writeMessage, { sessionId: ordinary, role: 'assistant', content: 'No' })).rejects.toThrow('eval session');
  const sessionId = await t.mutation(internal.chatEval.createSession, { channel: 'web' });
  await t.mutation(internal.chatEval.writeMessage, { sessionId, role: 'user', content: 'I need a human agent' });
  await t.mutation(internal.chatEval.writeMessage, { sessionId, role: 'assistant', content: 'Eval reply' });
  const session = await t.run(ctx => ctx.db.get(sessionId));
  expect(session).toMatchObject({ messageCount: 2 });
  expect(session).not.toHaveProperty('lastStaffAlertAt');
  expect(session).not.toHaveProperty('inboxState');
  expect(await t.run(ctx => ctx.db.query('rateLimits').withIndex('by_key', q => q.eq('key', `chat:${sessionId}`)).unique())).toBeNull();
});
