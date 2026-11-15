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
  await expect(t.query(api.messaging.chat.getMessages, guest)).rejects.toThrow('MAINTENANCE');
  await expect(t.mutation(api.messaging.chat.createSession, { channel: 'web' })).rejects.toThrow('MAINTENANCE');
  await expect(t.mutation(api.messaging.chat.sendMessage, { ...guest, clientMessageId: crypto.randomUUID(), content: 'Please help' })).rejects.toThrow('MAINTENANCE');
  const response = await t.fetch('/stripe/webhook', { method: 'POST', body: '{}' });
  expect(response.status).toBe(503);
  expect(response.headers.get('Retry-After')).toBe('60');
  expect(await t.query(api.messaging.chat.getMessages, guest).catch(() => null)).toBeNull();
});

it('seeds internally under maintenance and restores public queries only after unpausing', async () => {
  const t = createHarness(convexTest);
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  const seed = await t.mutation(internal.maintenance.seed.seedAll, { scenario: 'demo-resort' });
  expect(seed.counts.properties).toBe(3);
  await expect(t.query(api.messaging.chat.getMessages, seed.conversation!)).rejects.toThrow('MAINTENANCE');
  vi.stubEnv('ARCH_RESET_PAUSED', '0');
  expect(await t.query(api.messaging.chat.getMessages, seed.conversation!)).toHaveLength(1);
});

it('keeps cron cleanup from changing data while maintenance remains active', async () => {
  const t = createHarness(convexTest);
  const id = await t.run(ctx => ctx.db.insert('rateLimits', { key: 'maintenance-probe', count: 1, expiresAt: Date.now() - 1000 }));
  vi.stubEnv('ARCH_RESET_PAUSED', '1');
  await t.mutation(internal.messaging.maintenance.cleanRateLimits, {});
  expect(await t.run(ctx => ctx.db.get(id))).not.toBeNull();
  vi.stubEnv('ARCH_RESET_PAUSED', '0');
  await t.mutation(internal.messaging.maintenance.cleanRateLimits, {});
  expect(await t.run(ctx => ctx.db.get(id))).toBeNull();
});
