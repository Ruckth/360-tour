// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { expect, it, vi } from 'vitest';
import { createHarness } from '../testing/harness';
import { internal } from '../_generated/api';
import { buildPrompt } from './prompt';
it('builds the concierge prompt', async () => {
  const now = Date.UTC(2026, 10, 13, 1);
  const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
  try {
    const t = createHarness(convexTest);
    await t.mutation(internal.seed.seedAll, { scenario: 'demo-resort' });
    const properties = await t.run(ctx => ctx.db.query('properties').take(10));
    const settings = await t.query(internal.settings.effective, {});
    const session = (await t.run(ctx => ctx.db.query('conversations').take(1)))[0];
    for (const channel of ['web', 'line', 'facebook', 'instagram', 'whatsapp'] as const) {
      const prompt = buildPrompt({ userMessage: 'What is available?', channel, locale: 'en', siteUrl: 'https://resort.example', propertySlug: properties[0].slug }, { ...session, channel }, properties, settings, [{ role: 'user', content: 'What is available?' }], now);
      expect(prompt).toMatchSnapshot(channel);
      expect(prompt.filter(message => message.role === 'user')).toHaveLength(1);
      expect(String(prompt[0].content)).toContain('Never calculate a stay total yourself');
    }
  } finally { clock.mockRestore(); }
});
