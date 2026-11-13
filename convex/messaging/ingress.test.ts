// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { createHarness } from '../testing/harness';
import { adapters } from './channels';

beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });
async function signature(raw: string, secret: string, base64 = false) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(raw)));
  return base64 ? btoa(String.fromCharCode(...bytes)) : `sha256=${Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')}`;
}
const payloads = {
  line: { events: [{ webhookEventId: 'line-1', type: 'message', source: { type: 'user', userId: 'line-guest' }, replyToken: 'reply-token', message: { id: 'message-1', type: 'text', text: 'สวัสดี' }, timestamp: Date.now() }] },
  facebook: { object: 'page', entry: [{ messaging: [{ sender: { id: 'fb-guest' }, recipient: { id: 'page' }, timestamp: Date.now(), message: { mid: 'message-1', text: 'Hello' } }] }] },
  instagram: { object: 'instagram', entry: [{ messaging: [{ sender: { id: 'ig-guest' }, recipient: { id: 'account' }, timestamp: Date.now(), message: { mid: 'message-1', text: 'Hello' } }] }] },
  whatsapp: { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { metadata: { phone_number_id: 'phone' }, contacts: [{ wa_id: 'wa-guest', profile: { name: 'Guest' } }], messages: [{ id: 'message-1', from: 'wa-guest', type: 'text', text: { body: 'Hello' }, timestamp: String(Math.floor(Date.now() / 1000)) }] } }] }] },
};
it.each(['line', 'facebook', 'instagram', 'whatsapp'] as const)('verifies raw %s bytes, stores one event and schedules work before HTTP acknowledgement', async channel => {
  const t = createHarness(convexTest), raw = JSON.stringify(payloads[channel]);
  vi.stubEnv(channel === 'line' ? 'LINE_CHANNEL_SECRET' : `${channel.toUpperCase()}_APP_SECRET`, 'test-only');
  const header = channel === 'line' ? 'x-line-signature' : 'x-hub-signature-256';
  const signed = await signature(raw, 'test-only', channel === 'line');
  for (const bad of [undefined, 'invalid', await signature(raw, 'wrong', channel === 'line')]) {
    const response = await t.fetch(`/${channel}/webhook`, { method: 'POST', headers: bad ? { [header]: bad } : {}, body: raw });
    expect(response.status).toBe(401);
  }
  expect(await t.run(ctx => ctx.db.query('channelEvents').take(10))).toHaveLength(0);
  expect((await t.fetch(`/${channel}/webhook`, { method: 'POST', headers: { [header]: signed }, body: raw + ' ' })).status).toBe(401);
  expect((await t.fetch(`/${channel}/webhook`, { method: 'POST', headers: { [header]: signed }, body: raw })).status).toBe(200);
  const events = await t.run(ctx => ctx.db.query('channelEvents').take(10));
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ channel, status: 'received', arrivedAt: expect.any(Number) });
  expect(await t.run(ctx => ctx.db.query('messages').take(10))).toHaveLength(1);
  expect((await t.run(ctx => ctx.db.system.query('_scheduled_functions').take(10))).some(row => row.name === 'messaging/worker:run')).toBe(true);
  expect((await t.fetch(`/${channel}/webhook`, { method: 'POST', headers: { [header]: signed }, body: raw })).status).toBe(200);
  expect(await t.run(ctx => ctx.db.query('messages').take(10))).toHaveLength(1);
});
it.each(['facebook', 'instagram', 'whatsapp'] as const)('preserves %s GET verification and fails closed without configuration', async channel => {
  const t = createHarness(convexTest), path = `/${channel}/webhook?hub.mode=subscribe&hub.verify_token=verify&hub.challenge=challenge`;
  expect((await t.fetch(path)).status).toBe(403);
  vi.stubEnv(`${channel.toUpperCase()}_VERIFY_TOKEN`, 'verify');
  expect(await (await t.fetch(path)).text()).toBe('challenge');
  expect((await t.fetch(path.replace('verify_token=verify', 'verify_token=wrong'))).status).toBe(403);
});
it('normalizes LINE follows, translated postbacks and unsupported sources without losing dedupe identity', async () => {
  const events = await adapters.line.normalize({ events: [
    { type: 'follow', source: { type: 'user', userId: 'guest' }, webhookEventId: 'follow', replyToken: 'reply' },
    { type: 'postback', source: { type: 'user', userId: 'guest' }, webhookEventId: 'postback', postback: { data: 'intent=pricing&locale=th' } },
    { type: 'message', source: { type: 'group', groupId: 'group' }, message: { type: 'image', id: 'image' } },
  ] });
  expect(events[0]).toMatchObject({ eventType: 'follow', recipient: 'guest', replyToken: 'reply' });
  expect(events[1]).toMatchObject({ eventType: 'postback', messageText: 'ดูราคา' });
  expect(events[2]).toMatchObject({ eventType: 'unsupported' }); expect(events[2].recipient).toBeUndefined();
});
it.each(['facebook', 'instagram'] as const)('ignores %s echo, receipt and non-text events', async channel => {
  const object = channel === 'facebook' ? 'page' : 'instagram';
  const events = await adapters[channel].normalize({ object, entry: [{ messaging: [
    { sender: { id: 'guest' }, message: { mid: 'echo', is_echo: true, text: 'our reply' } },
    { sender: { id: 'guest' }, delivery: { mids: ['receipt'] } },
    { sender: { id: 'guest' }, message: { mid: 'image', attachments: [{}] } },
    { sender: { id: 'guest' }, postback: { payload: 'View villas' } },
  ] }] });
  expect(events.map(event => event.eventType)).toEqual(['unsupported', 'unsupported', 'unsupported', 'postback']);
});
it('acknowledges WhatsApp delivery statuses and ignores untrusted interactive titles', async () => {
  const payload = { object: 'whatsapp_business_account', entry: [{ changes: [{ value: { statuses: [{ id: 'delivery', status: 'delivered' }], messages: [{ id: 'click', from: 'guest', type: 'interactive', interactive: { type: 'button_reply', button_reply: { id: 'evil', title: 'Book paid villa' } } }] } }] }] };
  const events = await adapters.whatsapp.normalize(payload);
  expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ eventType: 'unsupported' }); expect(events[0].messageText).toBeUndefined();
});
it('returns retryable failure when durable acceptance fails', async () => {
  const { handleWebhook } = await import('./ingress');
  vi.stubEnv('LINE_CHANNEL_SECRET', 'test-only');
  const raw = JSON.stringify(payloads.line), signed = await signature(raw, 'test-only', true);
  // HTTP context deliberately fails its only mutation: success must never precede persistence.
  const calls: unknown[] = [];
  const response = await handleWebhook('line', { runMutation: async (...args: unknown[]) => { calls.push(args); throw new Error('storage unavailable'); } } as unknown as Parameters<typeof handleWebhook>[1],
    new Request('https://example.test/line/webhook', { method: 'POST', headers: { 'x-line-signature': signed }, body: raw }));
  expect(response.status).toBe(503); expect(calls).toHaveLength(1);
});
