// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { createHarness, guestSession } from './testing/harness';
afterEach(() => vi.unstubAllEnvs());

it('blocks public reads, writes, actions and webhooks during a cutover while internal seed remains usable', async () => {
  const t = createHarness(convexTest);
  const guest = await guestSession(t);
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  await expect(t.query(api.chat.getMessages, guest)).rejects.toThrow('MAINTENANCE');
  await expect(t.mutation(api.chat.createSession, { channel: 'web' })).rejects.toThrow('MAINTENANCE');
  await expect(t.action(api.chatAi.respond, { ...guest, userMessage: 'Please help' })).rejects.toThrow('MAINTENANCE');
  const response = await t.fetch('/stripe/webhook', { method: 'POST', body: '{}' });
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('60');
  expect(await t.query(api.chat.getMessages, guest).catch(() => null)).toBeNull();
});

it('seeds internally under maintenance and restores public queries only after unpausing', async () => {
  const t = createHarness(convexTest);
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  const seed = await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
  expect(seed.counts.properties).toBe(3);
  await expect(t.query(api.chat.getMessages, seed.conversation!)).rejects.toThrow('MAINTENANCE');
  vi.stubEnv('ARCH_RESET_PAUSED', '0');
  expect(await t.query(api.chat.getMessages, seed.conversation!)).toHaveLength(1);
});
