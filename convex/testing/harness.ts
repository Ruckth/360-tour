import type { convexTest } from 'convex-test';
import type { vi } from 'vitest';
import schema from '../schema';
import { api } from '../_generated/api';
import type { FunctionArgs } from 'convex/server';

// Match the existing suites' ImportMeta declaration without loading Vite globals.
declare global {
	interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>>; }
}

// Convex discovers every ordinary .ts file as an entry point. Keep test runners
// injected and the Vite-only glob inside the helper, so loading this module in
// Convex never loads Vitest or evaluates import.meta.glob.
export function createHarness(test: typeof convexTest) {
	return test(schema, import.meta.glob('../**/*.ts'));
}
export const adminIdentity = { email: 'admin@example.com', tokenIdentifier: 'https://test.clerk.dev|admin' };
export function asAdmin(t: ReturnType<typeof createHarness>) {
	return t.withIdentity(adminIdentity);
}
export function guestSession(t: ReturnType<typeof createHarness>, args: Omit<FunctionArgs<typeof api.chat.createSession>, 'channel'> = {}) {
	return t.mutation(api.chat.createSession, { ...args, channel: 'web' });
}
export function fixedClock(clockTools: Pick<typeof vi, 'spyOn'>, now = Date.UTC(2026, 10, 12, 12)) {
	const clock = clockTools.spyOn(Date, 'now').mockReturnValue(now);
	return { now, advance: (ms: number) => { now += ms; clock.mockReturnValue(now); }, restore: () => clock.mockRestore() };
}
