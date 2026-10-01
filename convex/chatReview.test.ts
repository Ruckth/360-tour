// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { expect, it } from 'vitest';
import { api, internal } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');

it('returns a public session projection and the newest 100 messages', async () => {
	const t = convexTest(schema, modules);
	const sessionId = await t.mutation(api.chat.createSession, { channel: 'web', visitorId: 'guest' });
	await t.run(async (ctx) => {
		await ctx.db.patch(sessionId, {
			assignedAdminEmail: 'staff@example.com', adminSearchText: 'private search',
			adminStatus: 'resolved', adminSortAt: 12, lastStaffAlertAt: 42
		});
		for (let i = 0; i < 105; i++) {
			await ctx.db.insert('chatMessages', { sessionId, role: 'user', content: `message ${i}`, timestamp: i });
		}
	});
	const session = await t.query(api.chat.getSession, { sessionId });
	expect(session).toMatchObject({ channel: 'web', aiPaused: false });
	expect(session).not.toHaveProperty('visitorId');
	expect(session).not.toHaveProperty('assignedAdminEmail');
	expect(session).not.toHaveProperty('adminSearchText');
	expect(session).not.toHaveProperty('adminStatus');
	expect(session).not.toHaveProperty('lastStaffAlertAt');
	const messages = await t.query(api.chat.getMessages, { sessionId });
	expect(messages).toHaveLength(100);
	expect(messages[0].content).toBe('message 5');
	expect(messages[99].content).toBe('message 104');
});

it('does not store an automatic assistant reply when staff pauses during generation', async () => {
	const t = convexTest(schema, modules);
	const sessionId = await t.mutation(api.chat.createSession, { channel: 'web' });
	await t.run((ctx) => ctx.db.patch(sessionId, { aiPaused: true }));
	expect(await t.mutation(internal.chat.addAssistantMessageWithSuggestions, {
		sessionId, content: 'Stale AI reply'
	})).toEqual({ stored: false, messageId: null });
	expect(await t.query(api.chat.getMessages, { sessionId })).toEqual([]);
	expect((await t.query(api.chat.getSession, { sessionId }))?.aiPaused).toBe(true);
});
