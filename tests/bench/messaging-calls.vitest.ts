// Synthetic ingress benchmark: acknowledgement waits for exactly one durable mutation, not generation or delivery.
import { afterEach, expect, it, vi } from 'vitest';
import { handleWebhook } from '../../convex/messaging/ingress';
import { createLineSignature } from '@/lib/line/signature';
import { getFunctionName } from 'convex/server';
afterEach(() => vi.unstubAllEnvs());
it.each(['Which villa?', 'Can I book the pool villa?', 'Check prices'])('acknowledges %s after one durable Convex transaction', async text => {
  vi.stubEnv('LINE_CHANNEL_SECRET', 'bench-only');
  const runMutation = vi.fn(async (reference: unknown) => { expect(reference).toBeDefined(); return { accepted: 1 }; });
  const raw = JSON.stringify({ events: [{ type: 'message', webhookEventId: 'bench', timestamp: Date.now(), replyToken: 'token', source: { type: 'user', userId: 'guest' }, message: { type: 'text', text } }] });
  const response = await handleWebhook('line', { runMutation } as unknown as Parameters<typeof handleWebhook>[1], new Request('https://example.test/line/webhook', { method: 'POST', headers: { 'x-line-signature': createLineSignature(raw, 'bench-only') }, body: raw }));
  expect(response.status).toBe(200); expect(runMutation).toHaveBeenCalledTimes(1);
  expect(getFunctionName(runMutation.mock.calls[0][0] as Parameters<typeof getFunctionName>[0])).toBe('messaging/ingress:accept');
});
