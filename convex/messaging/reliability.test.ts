// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { api, internal } from '../_generated/api';
import { createHarness, guestSession } from '../testing/harness';
import { LEASE_MS, withDurableTool } from './model';
import { line } from './channels/line';
import { adapters } from './channels';

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-13T06:00:00Z')); });
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
async function queued(channel: 'line' | 'facebook' | 'instagram' | 'whatsapp' = 'line') {
  const t = createHarness(convexTest);
  await t.mutation(internal.messaging.ingress.accept, { channel, events: [{ eventKey: 'evt-one', recipient: 'guest', eventType: 'message', messageText: 'Which villa?', replyToken: 'reply-capability', eventTimestamp: Date.now() }] });
  const event = (await t.run(ctx => ctx.db.query('channelEvents').take(1)))[0];
  return { t, event };
}
async function claimed() {
  const { t, event } = await queued();
  await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: 'first' });
  return { t, event };
}
it('ignores a duplicate webhook delivery', async () => {
  const { t, event } = await queued();
  const result = await t.mutation(internal.messaging.ingress.accept, { channel: 'line', events: [{ eventKey: event.eventKey, recipient: 'guest', eventType: 'message', messageText: 'Which villa?', replyToken: 'new-token' }] });
  expect(result.accepted).toBe(0);
  expect(await t.run(ctx => ctx.db.query('channelEvents').take(10))).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('messages').take(10))).toHaveLength(1);
  expect((await t.run(ctx => ctx.db.get(event._id)))?.replyToken).toBe('reply-capability');
  expect(await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).toHaveLength(2); // turn + inbox expiry, atomically durable
});
it('takes over a stale event lease', async () => {
  const { t, event } = await claimed();
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: 'second' })).toBeNull();
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: 'second' })).toMatchObject({ claimToken: 'second', attempts: 2 });
  await expect(t.mutation(internal.messaging.worker.prepareDispatch, { eventId: event._id, claimToken: 'first', text: 'stale', model: 'test' })).rejects.toThrow('STALE_TURN');
  await expect(t.mutation(internal.messaging.worker.commitTurn, { eventId: event._id, claimToken: 'first' })).rejects.toThrow('STALE_TURN');
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: event._id, claimToken: 'second', text: 'fresh', model: 'test' });
  await t.mutation(internal.messaging.worker.commitTurn, { eventId: event._id, claimToken: 'second' });
  expect(await t.run(ctx => ctx.db.query('messages').take(10))).toHaveLength(2);
});
it('does not resend after a crash following send', async () => {
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'test-only');
  const { t, event } = await claimed();
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: event._id, claimToken: 'first', text: 'A reply', model: 'test' });
  expect(await t.mutation(internal.messaging.worker.beginDispatch, { eventId: event._id, claimToken: 'first' })).toBe(true);
  const transport = vi.fn(async () => new Response('{}', { status: 200 }));
  await line.send({ event, text: 'A reply', siteUrl: 'https://example.test', transport });
  // Process dies after provider acceptance, before commitTurn. Recovery must never dispatch again.
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  vi.stubGlobal('fetch', transport);
  await t.action(internal.messaging.worker.run, { eventId: event._id });
  expect(transport).toHaveBeenCalledTimes(1);
  const stored = await t.run(ctx => ctx.db.get(event._id));
  expect(stored).toMatchObject({ status: 'reconciliation', dispatchState: 'uncertain' });
  expect((await t.run(ctx => ctx.db.get(event.sessionId!)))?.inboxSendError).toContain('Check provider history');
  expect(await t.run(ctx => ctx.db.query('messages').take(10))).toHaveLength(1);
});
it('pushes after an expired LINE reply token', async () => {
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'test-only');
  const { event } = await queued();
  const transport = vi.fn().mockResolvedValueOnce(new Response('{"message":"Reply token has expired"}', { status: 400 })).mockResolvedValueOnce(new Response('{}'));
  expect(await line.send({ event, text: 'Reply', siteUrl: 'https://example.test', transport })).toMatchObject({ state: 'sent' });
  expect(transport.mock.calls.map(call => call[0])).toEqual(['https://api.line.me/v2/bot/message/reply', 'https://api.line.me/v2/bot/message/push']);
  expect(JSON.parse(transport.mock.calls[0][1].body).replyToken).toBe('reply-capability');
});
it('does not push after an ambiguous LINE timeout', async () => {
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'test-only');
  const { event } = await queued();
  const transport = vi.fn().mockRejectedValue(new DOMException('Timed out', 'TimeoutError'));
  expect(await line.send({ event, text: 'Reply', siteUrl: 'https://example.test', transport })).toMatchObject({ state: 'uncertain' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('never pushes after an invalid or possibly used LINE token', async () => {
  vi.stubEnv('LINE_CHANNEL_ACCESS_TOKEN', 'test-only');
  const { event } = await queued();
  const transport = vi.fn(async () => new Response('{"message":"Invalid reply token"}', { status: 400 }));
  expect(await line.send({ event, text: 'Reply', siteUrl: 'https://example.test', transport })).toMatchObject({ state: 'uncertain' });
  expect(transport).toHaveBeenCalledTimes(1);
});
it('serializes conversation turns and excludes newer queued questions from context', async () => {
  const { t, event } = await claimed();
  vi.setSystemTime(Date.now() + 1);
  await t.mutation(internal.messaging.ingress.accept, { channel: 'line', events: [{ eventKey: 'evt-two', recipient: 'guest', eventType: 'message', messageText: 'Second question' }] });
  const second = (await t.run(ctx => ctx.db.query('channelEvents').take(10))).find(row => row.eventKey === 'evt-two')!;
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: second._id, token: 'second' })).toBeNull();
  const history = await t.query(internal.chat.getRecentMessages, { sessionId: event.sessionId!, limit: 10, throughMessageId: event.userMessageId });
  expect(history.map(row => row.content)).toEqual(['Which villa?']);
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: event._id, claimToken: 'first', text: 'First answer', model: 'test' });
  await t.mutation(internal.messaging.worker.commitTurn, { eventId: event._id, claimToken: 'first' });
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: second._id, token: 'second' })).toMatchObject({ claimToken: 'second' });
});
it('reuses an atomically committed tool result and fences stale tool writes', async () => {
  const { t, event } = await claimed();
  const effect = vi.fn(async () => ({ bookingId: 'recorded-booking', total: 10050 }));
  const args = { eventId: event._id, claimToken: 'first', key: 'confirm_booking', name: 'confirm_booking' };
  const first = await t.run(ctx => withDurableTool(ctx, event.sessionId!, args, effect));
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: 'second' });
  const repeated = await t.run(ctx => withDurableTool(ctx, event.sessionId!, { ...args, claimToken: 'second' }, effect));
  expect(first).toEqual(repeated); expect(effect).toHaveBeenCalledTimes(1);
  await expect(t.run(ctx => withDurableTool(ctx, event.sessionId!, args, effect))).rejects.toThrow('STALE_TURN');
});
it('pauses ingress, scheduled workers, recovery and tool effects during maintenance', async () => {
  const { t, event } = await claimed();
  const before = await t.run(ctx => ctx.db.get(event._id));
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  await t.action(internal.messaging.worker.run, { eventId: event._id }); await t.mutation(internal.messaging.worker.recover, {});
  await expect(t.run(ctx => withDurableTool(ctx, event.sessionId!, { eventId: event._id, claimToken: 'first', key: 'write', name: 'write' }, async () => 'bad'))).rejects.toThrow();
  expect(await t.run(ctx => ctx.db.get(event._id))).toEqual(before);
  expect((await t.fetch('/line/webhook', { method: 'POST', body: '{}' })).status).toBe(503);
});
it.each(['facebook', 'instagram'] as const)('uses the correct %s graph host', async channel => {
  vi.stubEnv(`${channel.toUpperCase()}_ACCESS_TOKEN`, 'test-only');
  const { event } = await queued(channel);
  const transport = vi.fn(async (url: string | URL | Request) => { expect(String(url)).toMatch(/^https:/); return new Response('{}'); });
  await adapters[channel].send({ event, text: 'Hello', siteUrl: 'https://example.test', transport });
  expect(transport.mock.calls[0][0]).toContain(channel === 'facebook' ? 'graph.facebook.com' : 'graph.instagram.com');
});
it('keeps uncertain or partially accepted WhatsApp sends for reconciliation', async () => {
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-only'); vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone'); vi.stubEnv('MESSAGING_RICH_CARDS', 'whatsapp');
  const { event } = await queued('whatsapp');
  const transport = vi.fn().mockResolvedValueOnce(new Response('{}')).mockRejectedValueOnce(new Error('timeout'));
  expect(await adapters.whatsapp.send({ event, text: 'Hello', siteUrl: 'https://example.test', transport, card: { kind: 'services', items: [], catalog: { label: 'Browse', url: 'https://example.test/services' } } })).toMatchObject({ state: 'uncertain' });
  expect(transport).toHaveBeenCalledTimes(2);
});
it('deduplicates web sends before charging admission and rejects altered replay content', async () => {
  const t = createHarness(convexTest), guest = await guestSession(t);
  const args = { ...guest, clientMessageId: crypto.randomUUID(), content: 'Please help' };
  const first = await t.mutation(api.chat.sendMessage, args);
  expect(await t.mutation(api.chat.sendMessage, args)).toMatchObject({ ...first, duplicate: true });
  await expect(t.mutation(api.chat.sendMessage, { ...args, content: 'Different' })).rejects.toThrow('different content');
  expect(await t.query(api.chat.getMessages, guest)).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('channelEvents').take(10))).toHaveLength(1);
});
it('recovers a real committed booking without replaying the model or booking mutation', async () => {
  const t = createHarness(convexTest);
  await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  const property = (await t.run(ctx => ctx.db.query('properties').take(10))).find(row => row.status === 'active')!;
  await t.mutation(internal.messaging.ingress.accept, { channel: 'whatsapp', events: [{ eventKey: 'prepare', eventType: 'message', recipient: '66912345678', messageText: 'Book a villa', eventTimestamp: Date.now() }] });
  const prep = (await t.run(ctx => ctx.db.query('channelEvents').take(10)))[0];
  await t.mutation(internal.messaging.worker.claim, { eventId: prep._id, token: 'prepare-claim' });
  const proposal = await t.mutation(internal.bookings.prepareChatBooking, { sessionId: prep.sessionId!, propertySlug: property.slug, checkIn: '2027-02-01', checkOut: '2027-02-03', guests: 2, guestName: 'Test Guest', durableTool: { eventId: prep._id, claimToken: 'prepare-claim', key: 'prepare_booking', name: 'prepare_booking' } });
  expect(proposal.total).toBeGreaterThan(0);
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: prep._id, claimToken: 'prepare-claim', text: 'Reply yes to confirm', model: 'test' });
  await t.mutation(internal.messaging.worker.commitTurn, { eventId: prep._id, claimToken: 'prepare-claim' });
  vi.setSystemTime(Date.now() + 1);
  await t.mutation(internal.messaging.ingress.accept, { channel: 'whatsapp', events: [{ eventKey: 'confirm', eventType: 'message', recipient: '66912345678', messageText: 'yes', eventTimestamp: Date.now() }] });
  const confirmation = (await t.run(ctx => ctx.db.query('channelEvents').take(10))).find(row => row.eventKey === 'confirm')!;
  await t.mutation(internal.messaging.worker.claim, { eventId: confirmation._id, token: 'confirm-claim' });
  const committed = await t.mutation(internal.bookings.confirmChatBooking, { sessionId: confirmation.sessionId!, durableTool: { eventId: confirmation._id, claimToken: 'confirm-claim', key: 'confirm_booking', name: 'confirm_booking' } });
  expect('bookingId' in committed).toBe(true);
  const before = await t.run(ctx => ctx.db.query('bookings').take(10));
  vi.setSystemTime(Date.now() + LEASE_MS + 1);
  await t.mutation(internal.messaging.worker.claim, { eventId: confirmation._id, token: 'recovery-claim' });
  const transport = vi.fn(); vi.stubGlobal('fetch', transport);
  const recovered = await t.action(internal.concierge.runTurn.runTurn, { eventId: confirmation._id, claimToken: 'recovery-claim' });
  expect(recovered).toMatchObject({ model: 'tool_recovery', outcome: 'answered' });
  expect(recovered.response).toContain('payment is pending');
  expect(recovered.response).toContain((proposal.total / 100).toLocaleString('en-US'));
  expect(await t.run(ctx => ctx.db.query('bookings').take(10))).toEqual(before);
  expect(transport).not.toHaveBeenCalled();
});
it('retries explicit provider rejection using the persisted reply and charges admission once', async () => {
  const { t, event } = await claimed();
  await t.mutation(internal.messaging.ingress.admit, { eventId: event._id, claimToken: 'first' });
  const admittedAt = (await t.run(ctx => ctx.db.get(event._id)))?.admittedAt;
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: event._id, claimToken: 'first', text: 'Saved reply', model: 'test' });
  await t.mutation(internal.messaging.worker.beginDispatch, { eventId: event._id, claimToken: 'first' });
  await t.mutation(internal.messaging.worker.fail, { eventId: event._id, claimToken: 'first', rejected: true });
  expect(await t.run(ctx => ctx.db.get(event._id))).toMatchObject({ status: 'received', dispatchState: 'prepared', responseText: 'Saved reply' });
  vi.setSystemTime(Date.now() + 2001);
  expect(await t.mutation(internal.messaging.worker.claim, { eventId: event._id, token: 'second' })).toMatchObject({ responseText: 'Saved reply' });
  await t.mutation(internal.messaging.ingress.admit, { eventId: event._id, claimToken: 'second' });
  expect((await t.run(ctx => ctx.db.get(event._id)))?.admittedAt).toBe(admittedAt);
});
it('rechecks staff takeover before each multipart provider request', async () => {
  const { t, event } = await claimed();
  await t.mutation(internal.messaging.worker.prepareDispatch, { eventId: event._id, claimToken: 'first', text: 'Saved reply', model: 'test' });
  await t.mutation(internal.messaging.worker.beginDispatch, { eventId: event._id, claimToken: 'first' });
  expect(await t.mutation(internal.messaging.worker.authorizeDispatch, { eventId: event._id, claimToken: 'first' })).toBe(true);
  await t.run(ctx => ctx.db.patch(event.sessionId!, { aiPaused: true }));
  expect(await t.mutation(internal.messaging.worker.authorizeDispatch, { eventId: event._id, claimToken: 'first' })).toBe(false);
});
it.each([{ code: 100, calls: 2 }, { code: 131009, calls: 2 }, { code: 131047, calls: 1 }])('falls back from a rejected WhatsApp card only for known payload errors ($code)', async ({ code, calls }) => {
  vi.stubEnv('WHATSAPP_ACCESS_TOKEN', 'test-only'); vi.stubEnv('WHATSAPP_PHONE_NUMBER_ID', 'phone'); vi.stubEnv('MESSAGING_RICH_CARDS', 'whatsapp');
  const { event } = await queued('whatsapp');
  const transport = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ error: { code } }), { status: 400 })).mockResolvedValueOnce(new Response('{}'));
  const result = await adapters.whatsapp.send({ event, text: 'Hello', siteUrl: 'https://example.test', transport,
    card: { kind: 'property', items: [{ title: 'Villa', lines: [], actions: [{ type: 'uri', label: 'Details', url: 'https://example.test/villa' }] }] } });
  expect(transport).toHaveBeenCalledTimes(calls);
  expect(result.state).toBe(calls === 2 ? 'sent' : 'rejected');
});
