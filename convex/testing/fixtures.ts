import { vi } from 'vitest';
// Fixed credentials for historical fixtures inserted directly by older suites.
export const fixtureGuestToken = 'phase0-test-guest-token';
export const fixtureGuestTokenHash = '530b74dc2ad39da99c9c0d5437765c0352a629a3e332c36d241fd3eee211c6f4';
export function testServerSecret() {
	vi.stubEnv('CONVEX_SERVER_SECRET', 'phase0-test-server-secret');
	return 'phase0-test-server-secret';
}
