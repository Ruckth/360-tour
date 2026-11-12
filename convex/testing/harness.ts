import { convexTest } from 'convex-test';
import { vi } from 'vitest';
import schema from '../schema';
import { api } from '../_generated/api';
import type { FunctionArgs } from 'convex/server';

// Match the existing suites' ImportMeta declaration without loading Vite globals.
declare global {
	interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; }
}

const modules = import.meta.glob('../**/*.ts');
export function createHarness() { return convexTest(schema, modules); }
export const adminIdentity = { email: 'admin@example.com', tokenIdentifier: 'https://test.clerk.dev|admin' };
export function asAdmin(t: ReturnType<typeof createHarness>) {
	vi.stubEnv('ADMIN_EMAILS', adminIdentity.email);
	return t.withIdentity(adminIdentity);
}
export function guestSession(t: ReturnType<typeof createHarness>, args: Omit<FunctionArgs<typeof api.chat.createSession>, 'channel'> = {}) {
	return t.mutation(api.chat.createSession, { ...args, channel: 'web' });
}
export function fixedClock(now = Date.UTC(2026, 10, 12, 12)) {
	const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
	return { now, advance: (ms: number) => { now += ms; clock.mockReturnValue(now); }, restore: () => clock.mockRestore() };
}
