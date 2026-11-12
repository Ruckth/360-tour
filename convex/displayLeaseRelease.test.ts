// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const clientId = 'checkout-release-review';
const leaseId = 'lease-release-review';

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-01T03:00:00Z'));
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it.each(['release', 'new-sale'] as const)('a delayed renewal cannot resurrect an order after %s', async (exit) => {
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const { secret } = await admin.mutation(api.pos.displays.createPairLink, { clientId });
	const claim = await t.mutation(api.pos.displays.claimLink, { secret });
	if (!claim.ok) throw new Error('Pairing failed');
	const { orderId } = await admin.mutation(api.pos.commands.addItem.addItem, { item: { kind: 'extra', name: 'Previous guest massage', price: 120000 } });
	await admin.mutation(api.pos.displays.showOrder, { clientId, leaseId, orderId });
	expect(await t.query(api.pos.displays.current, { token: claim.token })).toMatchObject({ state: 'order' });
	if (exit === 'release') await t.mutation(api.pos.displays.releaseDisplay, { clientId, leaseId });
	else await admin.mutation(api.pos.displays.showOrder, { clientId, leaseId, orderId: null });
	expect(await t.query(api.pos.displays.current, { token: claim.token })).toMatchObject({ state: 'idle' });
	// An already-created callback/request still carries the preceding order and mount's lease.
	expect(await admin.mutation(api.pos.displays.renewDriverLease, { clientId, leaseId, orderId })).toEqual({ renewed: false });
	expect(await t.query(api.pos.displays.current, { token: claim.token })).toMatchObject({ state: 'idle' });
});
