// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference } from 'convex/server';
import { afterEach, expect, it, vi } from 'vitest';
import { internal } from './_generated/api';
import { createHarness } from './testing/harness';
import { seedScenario } from './maintenance/scenarios';
import { generateConciergeReply } from './concierge/model';

vi.mock('./concierge/model', async importOriginal => ({
  ...await importOriginal<typeof import('./concierge/model')>(),
  generateConciergeReply: vi.fn(async () => ({ response: 'Fixture reply', model: 'fixture' })),
}));
afterEach(() => vi.clearAllMocks());

it('removes all eight former internal registrations rather than forwarding them', async () => {
  const t = createHarness(convexTest);
  for (const path of ['seed:seedAll', 'aiEval:seed', 'aiEval:cancelTestBookings', 'aiEval:cleanup', 'chatEval:createSession', 'chatEval:writeMessage']) {
    await expect(t.mutation(makeFunctionReference<'mutation'>(path), {})).rejects.toThrow('Could not find module for:');
  }
  for (const path of ['chatEval:comparisonTurn', 'chatEval:messagingTurn']) {
    await expect(t.action(makeFunctionReference<'action'>(path), {})).rejects.toThrow('Could not find module for:');
  }
  expect(generateConciergeReply).not.toHaveBeenCalled();
});

it('keeps scenario fixture writes in the caller transaction and refuses even a non-property record', async () => {
  const t = createHarness(convexTest);
  await expect(t.run(async ctx => { await seedScenario(ctx, 'demo-resort'); throw new Error('caller rollback'); })).rejects.toThrow('caller rollback');
  const empty = await t.mutation(internal.maintenance.seed.seedAll, { scenario: 'empty' });
  expect(Object.keys(empty.counts)).toHaveLength(74);
  expect(Object.values(empty.counts).every(count => count === 0)).toBe(true);
  const sessionId = await t.mutation(internal.maintenance.chatEval.createSession, { channel: 'line' });
  await expect(t.mutation(internal.maintenance.seed.seedAll, { scenario: 'empty' })).rejects.toThrow('conversations is not empty');
  expect(await t.run(ctx => ctx.db.get(sessionId))).toMatchObject({ channel: 'line' });
  expect(await t.run(ctx => ctx.db.query('properties').collect())).toEqual([]);
});

it('requires cleanup confirmation and preserves unrelated fixture data through actual seed and cleanup helpers', async () => {
  const t = createHarness(convexTest);
  const demo = await t.mutation(internal.maintenance.seed.seedAll, {});
  expect(demo.scenario).toBe('demo-resort');
  const [paidId, unpaidId] = demo.bookings.map(stay => stay.bookingId);
  await t.run(async ctx => {
    await ctx.db.patch(paidId, { guestName: 'AI-EVAL paid guest' });
    await ctx.db.patch(unpaidId, { guestName: 'AI-EVAL unpaid guest' });
  });
  const paidBefore = await t.run(ctx => ctx.db.get(paidId));
  const seeded = await t.mutation(internal.maintenance.aiEval.seed, {});
  expect(seeded).toMatchObject({ staff: 5, services: 5, occupiedAppointments: 2, facts: 5, timeOff: 1 });
  expect(await t.mutation(internal.maintenance.aiEval.seed, {})).toMatchObject({ staff: 0, services: 0, occupiedAppointments: 0, facts: 0, timeOff: 0 });
  const unrelated = await t.run(ctx => ctx.db.insert('staff', { name: 'Unrelated staff', role: 'Host', color: '#000000', workingHours: [], breaks: [], status: 'active', createdAt: 1, updatedAt: 1 }));
  const snapshot = await t.run(ctx => ctx.db.query('staff').collect());
  await expect(t.mutation(makeFunctionReference<'mutation'>('maintenance/aiEval:cleanup'), { confirm: 'wrong' })).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.query('staff').collect())).toEqual(snapshot);
  expect(await t.mutation(internal.maintenance.aiEval.cancelTestBookings, {})).toEqual({ bookingsCancelled: 1, appointmentsCancelled: 0 });
  expect(await t.run(ctx => ctx.db.get(paidId))).toEqual(paidBefore);
  expect(await t.run(ctx => ctx.db.get(unpaidId))).toMatchObject({ status: 'cancelled' });
  const cleanup = await t.mutation(internal.maintenance.aiEval.cleanup, { confirm: 'AI-EVAL' });
  expect(cleanup.removed).toMatchObject({ staff: 5, services: 5, appointments: 2, facts: 5, timeOff: 1 });
  expect(await t.run(ctx => ctx.db.get(unrelated))).toMatchObject({ name: 'Unrelated staff' });
  expect(await t.run(ctx => ctx.db.query('staff').collect())).toHaveLength(6);
  expect(await t.run(ctx => ctx.db.get(paidId))).toEqual(paidBefore);
  expect(await t.run(ctx => ctx.db.query('businessFacts').collect())).toEqual([expect.objectContaining({ title: 'Demo resort' })]);
  expect(await t.run(ctx => ctx.db.query('staffTimeOff').collect())).toEqual([]);
});

it('keeps eval writers guarded, bounded, paused and separate from production admission', async () => {
  const t = createHarness(convexTest);
  const sessionId = await t.mutation(internal.maintenance.chatEval.createSession, { channel: 'web', propertySlug: 'pool-villa', visitorPhone: '+66812345678', visitorName: 'Eval guest' });
  const before = await t.run(ctx => ctx.db.get(sessionId));
  expect(before).toMatchObject({ visitorId: expect.stringMatching(/^eval:web:/), propertySlug: 'pool-villa', visitorName: 'Eval guest', visitorPhone: '+66812345678' });
  await expect(t.mutation(internal.maintenance.chatEval.writeMessage, { sessionId, role: 'user', content: 'x'.repeat(2001) })).rejects.toThrow('Message is too long');
  expect(await t.run(ctx => ctx.db.get(sessionId))).toEqual(before);
  await t.run(ctx => ctx.db.patch(sessionId, { aiPaused: true }));
  expect(await t.mutation(internal.maintenance.chatEval.writeMessage, { sessionId, role: 'assistant', content: 'stale' })).toBeNull();
  await t.mutation(internal.maintenance.chatEval.writeMessage, { sessionId, role: 'user', content: 'Please get a human' });
  expect(await t.run(ctx => ctx.db.get(sessionId))).toMatchObject({ messageCount: 1, latestMessageAt: expect.any(Number) });
  expect(await t.run(ctx => ctx.db.query('channelEvents').collect())).toEqual([]);
  const session = await t.run(ctx => ctx.db.get(sessionId));
  expect(session).not.toHaveProperty('lastStaffAlertAt');
  expect(await t.run(ctx => ctx.db.query('rateLimits').collect())).toEqual([]);
  expect(session).not.toHaveProperty('inboxState');
});

it('retains explicit model flags, tool/LLM traces and messaging channel behavior without calling a model', async () => {
  const t = createHarness(convexTest);
  const sessionId = await t.mutation(internal.maintenance.chatEval.createSession, { channel: 'web' });
  const result = await t.action(internal.maintenance.chatEval.comparisonTurn, { sessionId, userMessage: 'quote', model: 'z-ai/glm-5.3-flash', siteUrl: 'https://example.test' });
  expect(generateConciergeReply).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ channel: 'web', bookingFlow: false, evalModel: 'z-ai/glm-5.3-flash', toolTrace: [], llmTrace: [] }), expect.objectContaining({ _id: sessionId }));
  expect(result).toMatchObject({ requestedModel: 'z-ai/glm-5.3-flash', response: 'Fixture reply', toolTrace: [], llmTrace: [] });
  await t.action(internal.maintenance.chatEval.messagingTurn, { sessionId, userMessage: 'book' });
  const calls = vi.mocked(generateConciergeReply).mock.calls;
  const args = calls[calls.length - 1][1];
  expect(args).toMatchObject({ channel: 'whatsapp', bookingFlow: true, toolTrace: [] });
  expect(args).not.toHaveProperty('evalModel');
  expect(await t.run(ctx => ctx.db.query('messages').collect())).toMatchObject([
    { role: 'user', content: 'quote' }, { role: 'assistant', content: 'Fixture reply' },
    { role: 'user', content: 'book' }, { role: 'assistant', content: 'Fixture reply' },
  ]);
});
