// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { sha256 } from './lib/displayTokens';
import schema from './schema';

/**
 * Bug-hunt 2026-11 POS area 1, PR2: the customer display shows an open order only while the
 * checkout that published it is live (H1-03), and pairing links stop working once staff pair or
 * disconnect a display or make a newer link (H1-07).
 */

const modules = import.meta.glob('./**/*.ts');
const HERE = 'checkout-here-0001';
const OTHER = 'checkout-other-0002';
const LEASE_A = 'lease-aaaa-0001';
const LEASE_B = 'lease-bbbb-0002';
const IDLE = { state: 'idle', businessName: 'Auralis Cove Retreat' };
const LINK_INVALID = { ok: false, code: 'LINK_INVALID' };
const SECOND = 1000;
const MINUTE = 60 * SECOND;

const tokenOf = (result: { ok: true; token: string } | { ok: false }) => {
	if (!result.ok) throw new Error('claim failed');
	return result.token;
};

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
	const link = (clientId = HERE) => admin.mutation(api.displays.createPairLink, { clientId });
	const claim = (secret: string, deviceName?: string) => t.mutation(api.displays.claimLink, { secret, deviceName });
	const pairByLink = async (clientId = HERE) => tokenOf(await claim((await link(clientId)).secret));
	const list = (clientId = HERE) => admin.query(api.displays.listDisplays, { clientId });
	const till = () => t.run(async (ctx) => (await ctx.db.query('tills').first())!);
	/** Lets time pass with no client writes at all; only what the server scheduled runs. */
	const wait = async (ms: number) => {
		vi.advanceTimersByTime(ms);
		await t.finishInProgressScheduledFunctions();
	};
	const order = async (name: string, customer?: string) => {
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name, price: 1200 } });
		if (customer) await admin.mutation(api.pos.linkCustomer, { orderId, customerId: await admin.mutation(api.customers.createCustomer, { name: customer }) });
		return orderId;
	};
	return { t, admin, stranger, link, claim, pairByLink, list, till, wait, order };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-01T03:00:00.000Z'));
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('H1-03: the display shows an open order only while its checkout is live', () => {
	async function driving() {
		const context = await setup();
		const { t, admin, pairByLink, order } = context;
		const token = await pairByLink();
		const current = () => t.query(api.displays.current, { token });
		const orderId = await order('Massage', 'Anna Lee');
		const show = (leaseId: string, id: string | null = orderId, clientId = HERE) => admin.mutation(api.displays.showOrder, { orderId: id, clientId, leaseId });
		const renew = (leaseId: string, id: string | null = orderId, clientId = HERE) => admin.mutation(api.displays.renewDriverLease, { clientId, leaseId, orderId: id });
		// No identity: a checkout that signs out still clears its order on the way out.
		const release = (leaseId: string, clientId = HERE) => t.mutation(api.displays.releaseDisplay, { clientId, leaseId });
		return { ...context, token, current, orderId, show, renew, release };
	}

	it('hides an order once its checkout stops checking in, with no other write (crash, closed tab)', async () => {
		const { admin, current, orderId, till, wait } = await driving();
		// Published the way the current checkout does, then the tab is gone: no release, no renewal.
		await admin.mutation(api.displays.showOrder, { orderId, clientId: HERE });
		expect(await current()).toMatchObject({ state: 'order', customerFirstName: 'Anna' });
		await wait(MINUTE);
		expect(await current()).toMatchObject({ state: 'order' });
		await wait(MINUTE);
		expect(await current()).toEqual(IDLE);
		// The server cleared it itself, so a display's live subscription is told, not just a fresh read.
		expect((await till()).orderId).toBeUndefined();
		expect((await admin.query(api.displays.listDisplays, { clientId: HERE })).driver).toBe('here');
	});

	it('clears the order when the checkout leaves, but only under the lease that published it', async () => {
		const { current, show, release, list } = await driving();
		await show(LEASE_A);
		await release(LEASE_B);
		await release(LEASE_A, OTHER);
		expect(await current()).toMatchObject({ state: 'order' });
		await release(LEASE_A);
		expect(await current()).toEqual(IDLE);
		// The tab still drives the display, so coming back to checkout shows its order again.
		expect((await list()).driver).toBe('here');
		await show(LEASE_B);
		expect(await current()).toMatchObject({ state: 'order' });
	});

	it('never lets an earlier mount\'s cleanup clear what a remount (or StrictMode) published', async () => {
		const { current, show, release } = await driving();
		await show(LEASE_A);
		await show(LEASE_B);
		await release(LEASE_A);
		expect(await current()).toMatchObject({ state: 'order' });
		// Even out of order: the later mount's publish lands before the first mount's cleanup.
		await release(LEASE_B);
		await show(LEASE_A);
		await show(LEASE_B);
		await release(LEASE_A);
		expect(await current()).toMatchObject({ state: 'order' });
	});

	it('keeps an order up while renewed, without counting renewals as customer activity', async () => {
		const { current, show, renew, wait } = await driving();
		await show(LEASE_A);
		const publishedAt = Date.now();
		for (let i = 0; i < 10; i++) {
			await wait(30 * SECOND);
			expect(await renew(LEASE_A)).toEqual({ renewed: true });
		}
		expect(await current()).toMatchObject({ state: 'order', activeAt: publishedAt });
		await wait(2 * MINUTE);
		expect(await current()).toEqual(IDLE);

		// The tab wakes (sleep, lost network): its next renewal brings the order back, still idle-timed from the last real activity.
		expect(await renew(LEASE_A)).toEqual({ renewed: true });
		expect(await current()).toMatchObject({ state: 'order', activeAt: publishedAt });
	});

	it('does not let a lease outlive a newer publish, and an old expiry never clears a newer lease', async () => {
		const { current, show, wait } = await driving();
		await show(LEASE_A);
		await wait(MINUTE);
		await show(LEASE_B);
		await wait(MINUTE);
		// A's expiry is due by now; B was published a minute ago.
		expect(await current()).toMatchObject({ state: 'order' });
		await wait(MINUTE);
		expect(await current()).toEqual(IDLE);
	});

	it('ignores a previous driver\'s renewals and cleanup once another checkout takes over', async () => {
		const { admin, current, order, show, renew, release, wait } = await driving();
		await show(LEASE_A);
		const bob = await order('Juice', 'Bob Smith');
		await admin.mutation(api.displays.takeDisplay, { clientId: OTHER, orderId: bob });
		await admin.mutation(api.displays.showOrder, { orderId: bob, clientId: OTHER, leaseId: LEASE_B });
		expect(await renew(LEASE_A)).toEqual({ renewed: false });
		await release(LEASE_A);
		expect(await current()).toMatchObject({ state: 'order', customerFirstName: 'Bob' });
		await wait(30 * SECOND);
		expect(await renew(LEASE_B, bob, OTHER)).toEqual({ renewed: true });
		await wait(MINUTE);
		expect(await current()).toMatchObject({ state: 'order', customerFirstName: 'Bob' });
	});

	it('hides a taken-over order if the new driver never publishes under its own lease', async () => {
		const { admin, current, orderId, wait } = await driving();
		await admin.mutation(api.displays.takeDisplay, { clientId: OTHER, orderId });
		expect(await current()).toMatchObject({ state: 'order' });
		await wait(2 * MINUTE);
		expect(await current()).toEqual(IDLE);
	});

	it('keeps the thank-you after payment when the checkout moves on to the receipt or its lease ends', async () => {
		const { admin, current, orderId, show, release, wait } = await driving();
		await show(LEASE_A);
		const { order, totals, customer } = (await admin.query(api.pos.getOrder, { orderId }))!;
		await admin.mutation(api.pos.settleOrder, {
			orderId, expectedRevision: order.revision, expectedDue: totals.due, idempotencyKey: 'lease-paid-0001', tenders: [{ method: 'cash', amount: totals.due }],
			...(customer && 'revision' in customer && typeof customer.revision === 'number' ? { expectedCustomerRevision: customer.revision } : {})
		});
		const paid = { state: 'paid', customerFirstName: 'Anna', amountPaid: 1200 };
		expect(await current()).toMatchObject(paid);
		await release(LEASE_A);
		expect(await current()).toMatchObject(paid);
		await show(LEASE_B);
		await wait(2 * MINUTE);
		expect(await current()).toMatchObject(paid);
	});

	it('hides an expired order from a fresh read even before the scheduled expiry has run', async () => {
		const { admin, current, orderId } = await driving();
		await admin.mutation(api.displays.showOrder, { orderId, clientId: HERE });
		const publishedAt = Date.now();
		// The clock moves on, but no timer fires: nothing is written.
		vi.setSystemTime(publishedAt + 30 * MINUTE - 1);
		expect(await current()).toEqual(IDLE);
	});

	it('shows nothing for an order published before leases existed', async () => {
		const { t, current, orderId, till } = await driving();
		const { _id } = await till();
		await t.run((ctx) => ctx.db.patch(_id, { orderId: orderId as Id<'bills'>, leaseId: undefined }));
		expect(await current()).toEqual(IDLE);
	});

	it('renews only for an admin; release needs only the tab and lease ids', async () => {
		const { t, stranger, current, show } = await driving();
		await show(LEASE_A);
		await expect(t.mutation(api.displays.renewDriverLease, { clientId: HERE, leaseId: LEASE_A, orderId: null })).rejects.toThrow('Not authenticated');
		await expect(stranger.mutation(api.displays.renewDriverLease, { clientId: HERE, leaseId: LEASE_A, orderId: null })).rejects.toThrow('Not authorized');
		expect(await stranger.mutation(api.displays.releaseDisplay, { clientId: HERE, leaseId: 'x'.repeat(200) })).toBeNull();
		expect(await current()).toMatchObject({ state: 'order' });
	});
});

describe('H1-07: only the newest link works, and only until a display pairs or is disconnected', () => {
	it('cancels an outstanding link once a newer one is made', async () => {
		const { link, claim } = await setup();
		const stale = await link();
		const fresh = await link();
		expect(await claim(stale.secret)).toEqual(LINK_INVALID);
		expect((await claim(fresh.secret)).ok).toBe(true);
	});

	it('cancels an outstanding link when the display is disconnected', async () => {
		const { admin, link, claim, pairByLink, list } = await setup();
		await pairByLink();
		const stale = await link();
		await admin.mutation(api.displays.revoke, { displayId: (await list()).displays[0]._id });
		expect(await claim(stale.secret)).toEqual(LINK_INVALID);
	});

	it('cancels an outstanding link when a display pairs by code or by another tab\'s link', async () => {
		const { t, admin, link, claim } = await setup();
		const stale = await link();
		const pending = await t.mutation(api.displays.startPairing, {});
		if (pending.status !== 'pending') throw new Error('expected a code');
		await admin.mutation(api.displays.approveCode, { code: pending.code, clientId: HERE });
		expect(await claim(stale.secret)).toEqual(LINK_INVALID);

		// Two links outstanding at once (a twin of the newest, as any number could be before this fix): pairing with one cancels the other.
		const used = await link(OTHER);
		const twin = 'twin-secret-0001';
		const twinHash = await sha256(twin);
		await t.run(async (ctx) => {
			const row = (await ctx.db.query('displayPairLinks').order('desc').first())!;
			await ctx.db.insert('displayPairLinks', { ...omitSystem(row), secretHash: twinHash });
		});
		expect((await claim(used.secret)).ok).toBe(true);
		expect(await claim(twin)).toEqual(LINK_INVALID);
	});

	it('refuses a link stored before links had a generation', async () => {
		const { t, claim } = await setup();
		const secret = 'legacy-secret-0001';
		const secretHash = await sha256(secret);
		await t.run(async (ctx) => {
			const tillId = (await ctx.db.query('tills').first())?._id ?? (await ctx.db.insert('tills', { key: 'default' }));
			await ctx.db.insert('displayPairLinks', { tillId, secretHash, expiresAt: Date.now() + 5 * MINUTE, createdByEmail: 'admin@example.com', driverId: HERE });
		});
		expect(await claim(secret)).toEqual(LINK_INVALID);
	});

	it('never lets a stale QR take over the display and receive later customers\' orders', async () => {
		const { t, admin, link, claim, pairByLink, list, order } = await setup();
		await pairByLink();
		const stale = await link();
		await admin.mutation(api.displays.revoke, { displayId: (await list()).displays[0]._id });
		const replacement = await pairByLink();
		expect(await claim(stale.secret, 'Scanner phone')).toEqual(LINK_INVALID);
		expect(await list()).toMatchObject({ driver: 'here', displays: [{ name: 'Customer display' }] });
		const anna = await order('Massage', 'Anna Lee');
		await admin.mutation(api.displays.showOrder, { clientId: HERE, orderId: anna });
		expect(await t.query(api.displays.current, { token: replacement })).toMatchObject({ state: 'order', customerFirstName: 'Anna' });
	});
});

function omitSystem<T extends { _id: unknown; _creationTime: unknown }>(row: T): Omit<T, '_id' | '_creationTime'> {
	const { _id, _creationTime, ...rest } = row;
	void _id;
	void _creationTime;
	return rest;
}
