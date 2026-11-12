import { respondTest } from './testing/turn.test-support';
// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import { createHarness, adminIdentity, asAdmin } from './testing/harness';

beforeEach(() => vi.stubEnv('ADMIN_EMAILS', adminIdentity.email));
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('unknown-question loop is preserved', () => {
  it('records unknown questions and returns the safe fallback from the concierge engine', async () => {
    vi.stubEnv('AI_API_KEY', 'test-key');
    vi.stubEnv('AI_API_BASE_URL', 'https://ai.example.test/v1');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: '[[UNKNOWN]]' } }] }), { status: 200 })));
    const t = createHarness(convexTest);
    const { sessionId, guestToken } = await t.mutation(api.messaging.chat.createSession, { channel: 'web' });
    const result = await respondTest(t, { sessionId, guestToken, userMessage: 'Can I bring two cats?' });
    expect(result).toMatchObject({ model: 'unknown_fallback', response: 'I do not have verified information about that yet. Please contact the host here for help.' });
    const reports = await asAdmin(t).query(api.concierge.knowledge.adminListUnknownQuestions, { status: 'new', paginationOpts: { numItems: 50, cursor: null } });
    expect(reports.page).toMatchObject([{ sessionId, userQuestion: 'Can I bring two cats?', status: 'new' }]);
  });

  it('ignores and reopens unknown-question groups', async () => {
    const t = createHarness(convexTest);
    const { sessionId } = await t.mutation(api.messaging.chat.createSession, { channel: 'web' });
    await t.mutation(internal.concierge.knowledge.recordUnknownQuestion, { sessionId, userQuestion: 'Can I bring my dog?' });
    const admin = asAdmin(t);
    const args = { normalizedQuestions: ['can i bring my dog'] };
    expect(await admin.mutation(api.concierge.knowledge.adminIgnoreUnknownGroups, args)).toMatchObject({ ignored: 1 });
    expect((await admin.query(api.concierge.knowledge.adminListUnknownQuestions, { status: 'new', paginationOpts: { numItems: 50, cursor: null } })).page).toEqual([]);
    expect(await admin.mutation(api.concierge.knowledge.adminReopenUnknownGroups, args)).toMatchObject({ reopened: 1 });
    expect((await admin.query(api.concierge.knowledge.adminListUnknownQuestions, { status: 'new', paginationOpts: { numItems: 50, cursor: null } })).page).toMatchObject([{ userQuestion: 'Can I bring my dog?', status: 'new' }]);
  });
});
