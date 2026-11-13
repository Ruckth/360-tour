// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { inboxProjectionReady, insertChannelEvent, patchChannelEvent } from './messaging/inboxProjection';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
beforeEach(() => { vi.stubEnv('ADMIN_EMAILS', 'admin@example.com'); vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it('keeps internal inbox snapshots and web tool capabilities out of list, search and detail responses', async () => {
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const { sessionId } = await t.mutation(api.messaging.chat.createSession, { channel: 'web', visitorId: 'audit-searchable' });
  const secrets = { accessToken: 'audit-booking-capability', confirmToken: 'audit-confirm-capability', guestPhone: 'audit-private-phone' };
  await t.run(async ctx => {
    const messageId = await ctx.db.insert('messages', { sessionId, role: 'user', content: 'A booking question', timestamp: Date.now() });
    const eventId = await ctx.db.insert('channelEvents', { channel: 'web', sessionId, eventKey: 'private-result', eventType: 'message', status: 'processing', processingStartedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now(), toolResults: [{ key: '1:tool', name: 'prepare_booking', resultJson: JSON.stringify(secrets) }] });
    // Simulate a populated projection written by the prior revision as well as fresh writers.
    await ctx.db.patch(sessionId, { lastDeliveryStatus: await ctx.db.get(eventId), lastMessagePreview: await ctx.db.get(messageId), messageCount: 1, latestMessageAt: Date.now() });
  });
  const list = await admin.query(api.messaging.adminChat.listSessions, { status: 'all', empty: 'all' });
  const search = await admin.query(api.messaging.adminChat.listSessions, { status: 'all', empty: 'all', searchQuery: 'audit-searchable' });
  const detail = await admin.query(api.messaging.adminChat.getSessionDetail, { sessionId });
  const transcript = await admin.query(api.messaging.adminChat.getTranscript, { sessionId });
  expect(list.sessions).toHaveLength(1); expect(search.sessions).toHaveLength(1); expect(detail).not.toBeNull();
  for (const row of [list.sessions[0], search.sessions[0], detail!.session, transcript.session]) {
    for (const field of ['lastDeliveryStatus', 'lastMessagePreview', 'inboxProjectionVersion', 'lastActivityAt']) expect(row).not.toHaveProperty(field);
    for (const secret of Object.values(secrets)) expect(JSON.stringify(row)).not.toContain(secret);
  }
  for (const row of [list.sessions[0], search.sessions[0], detail!.session]) expect(row.latestMessage?.content).toBe('A booking question');
});

it('keeps the initialization gate clean after message-less heartbeats, close and browser handoff', async () => {
  const t = convexTest(schema, modules);
  const credentials = await t.mutation(api.messaging.chat.createSession, { channel: 'web' });
  const clean = async () => expect(await t.mutation(internal.messaging.projectionMaintenance.initializeInbox, { dryRun: true })).toEqual({ checked: 1, changed: 0, complete: true });
  await clean();
  vi.advanceTimersByTime(60_000);
  await t.mutation(api.messaging.chat.touchSession, { ...credentials, isOpen: true }); await clean();
  vi.advanceTimersByTime(60_000);
  await t.mutation(api.messaging.chat.closeSession, credentials); await clean();
  const token = await t.mutation(api.messaging.chat.createBrowserHandoff, credentials);
  vi.advanceTimersByTime(60_000);
  expect(await t.mutation(api.messaging.chat.claimBrowserHandoff, { token })).not.toBeNull(); await clean();
});

it('persists web tool results only on their event without rewriting the conversation head', async () => {
  const t = convexTest(schema, modules);
  const { sessionId } = await t.mutation(api.messaging.chat.createSession, { channel: 'web' });
  const eventId = await t.run(ctx => insertChannelEvent(ctx, { channel: 'web', sessionId, eventKey: 'web-write-budget', eventType: 'message', status: 'processing', processingStartedAt: Date.now(), createdAt: Date.now(), updatedAt: Date.now() }));
  const before = await t.run(ctx => ctx.db.get(sessionId));
  expect(before?.lastDeliveryStatus).toBeNull();
  const writes = await t.run(async ctx => {
    const start = await ctx.meta.getTransactionMetrics();
    await patchChannelEvent(ctx, eventId, { toolResults: [{ key: '1:tool', name: 'prepare_booking', resultJson: '{"accessToken":"event-only-capability"}' }] });
    return (await ctx.meta.getTransactionMetrics()).documentsWritten.used - start.documentsWritten.used;
  });
  expect(writes).toBe(1);
  expect(await t.run(ctx => ctx.db.get(sessionId))).toEqual(before);
  expect((await t.run(ctx => ctx.db.get(eventId)))?.toolResults).toHaveLength(1);
});

it('keeps projection readiness after eval creation and seeded scenario creation', async () => {
  const t = convexTest(schema, modules);
  await t.mutation(internal.maintenance.seed.seedAll, { scenario: 'demo-resort' });
  expect(await t.run(inboxProjectionReady)).toBe(true);
  for (const channel of ['web', 'line', 'facebook', 'instagram', 'whatsapp'] as const) {
    const sessionId = await t.mutation(internal.maintenance.chatEval.createSession, { channel });
    expect(await t.run(inboxProjectionReady)).toBe(true);
    await t.mutation(internal.maintenance.chatEval.writeMessage, { sessionId, role: 'user', content: 'Eval question' });
    await t.mutation(internal.maintenance.chatEval.writeMessage, { sessionId, role: 'assistant', content: 'Eval answer' });
    expect(await t.run(inboxProjectionReady)).toBe(true);
  }
  expect(await t.mutation(internal.messaging.projectionMaintenance.initializeInbox, { dryRun: true })).toMatchObject({ changed: 0, complete: true });
});

it('preserves absent historical inbox state for empty or already-answered chats during initialization', async () => {
  const t = convexTest(schema, modules), admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
  const ids = await t.run(async ctx => {
    const ids = [];
    for (const kind of ['empty', 'answered']) {
      const id = await ctx.db.insert('conversations', { channel: 'web', visitorId: kind, createdAt: Date.now(), adminSortAt: Date.now() });
      if (kind === 'answered') await ctx.db.insert('messages', { sessionId: id, role: 'assistant', content: 'Already answered', timestamp: Date.now() });
      ids.push(id);
    }
    return ids;
  });
  const before = await Promise.all(ids.map(sessionId => admin.query(api.messaging.adminChat.getSessionDetail, { sessionId })));
  await t.mutation(internal.messaging.projectionMaintenance.initializeInbox, { dryRun: false });
  const after = await Promise.all(ids.map(sessionId => admin.query(api.messaging.adminChat.getSessionDetail, { sessionId })));
  for (let i = 0; i < ids.length; i++) {
    expect(before[i]!.session).not.toHaveProperty('inboxState');
    expect(after[i]!.session).not.toHaveProperty('inboxState');
    expect(after[i]!.session.needsReply).toBe(before[i]!.session.needsReply);
  }
  expect(await t.mutation(internal.messaging.projectionMaintenance.initializeInbox, { dryRun: true })).toEqual({ checked: 2, changed: 0, complete: true });
});
