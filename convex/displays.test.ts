import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { PAIRING_TTL_MS } from './displays';
import { sha256 } from './lib/displayTokens';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const code_ = (value: string) => ({ data: expect.objectContaining({ code: value }) });
const LINK_INVALID = { ok: false, code: 'LINK_INVALID' };
const IDLE = { state: 'idle', businessName: 'Auralis Cove Retreat' };
/** Two checkout browsers. */
const HERE = 'checkout-here-0001';
const OTHER = 'checkout-other-0002';
const tokenOf = (result: { ok: true; token: string } | { ok: false }) => {
	if (!result.ok) throw new Error('claim failed');
	return result.token;
};
const pendingOf = <T extends { status: string }>(result: T) => {
	if (result.status !== 'pending') throw new Error('expected a pending code');
	return result as Extract<T, { status: 'pending' }>;
};

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const stranger = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
	const displays = () => t.run((ctx) => ctx.db.query('displays').collect());
	const list = (clientId = HERE) => admin.query(api.displays.listDisplays, { clientId });
	const link = (clientId = HERE) => admin.mutation(api.displays.createPairLink, { clientId });
	const pairByLink = async (clientId = HERE) => tokenOf(await t.mutation(api.displays.claimLink, { secret: (await link(clientId)).secret }));
	const startCode = async (args: { deviceName?: string; previousToken?: string } = {}) => pendingOf(await t.mutation(api.displays.startPairing, args));
	return { t, admin, stranger, displays, list, link, pairByLink, startCode };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-11-01T03:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('display pairing links', () => {
	it('works once, stores only a hash of the secret, and expires', async () => {
		const { t, displays, link } = await setup();
		const { secret } = await link();
		expect(secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
		const [row] = await t.run((ctx) => ctx.db.query('displayPairLinks').collect());
		expect(row.secretHash).toBe(await sha256(secret));
		expect(JSON.stringify(row)).not.toContain(secret);

		const token = tokenOf(await t.mutation(api.displays.claimLink, { secret, deviceName: 'Front iPad' }));
		expect(await t.query(api.displays.current, { token })).toEqual(IDLE);
		const [display] = await displays();
		expect(display).toMatchObject({ name: 'Front iPad', status: 'active', tokenHash: await sha256(token) });
		expect(JSON.stringify(display)).not.toContain(token);
		expect(await t.mutation(api.displays.claimLink, { secret })).toEqual(LINK_INVALID);

		const late = await link();
		vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1);
		expect(await t.mutation(api.displays.claimLink, { secret: late.secret })).toEqual(LINK_INVALID);
		expect(await t.mutation(api.displays.claimLink, { secret: 'guess' })).toEqual(LINK_INVALID);
	});

	it('lets only one of two concurrent claims through', async () => {
		const { t, displays, link } = await setup();
		const { secret } = await link();
		const results = await Promise.allSettled([
			t.mutation(api.displays.claimLink, { secret, deviceName: 'A' }),
			t.mutation(api.displays.claimLink, { secret, deviceName: 'B' }),
		]);
		expect(results.filter((result) => result.status === 'fulfilled' && result.value.ok)).toHaveLength(1);
		expect(await displays()).toHaveLength(1);
	});

	it('revokes the previous display when a new one is claimed', async () => {
		const { t, list, pairByLink } = await setup();
		const first = await pairByLink();
		const second = await pairByLink();
		expect(await t.query(api.displays.current, { token: first })).toEqual({ state: 'unpaired' });
		expect(await t.query(api.displays.current, { token: second })).toEqual(IDLE);
		expect((await list()).displays).toHaveLength(1);
	});

	it('requires an admin to create a link', async () => {
		const { t } = await setup();
		await expect(t.mutation(api.displays.createPairLink, { clientId: HERE })).rejects.toThrow('Not authenticated');
	});
});

describe('display pairing codes', () => {
	it('approves a code only for an admin, only while pending and before expiry', async () => {
		const { t, admin, stranger, startCode } = await setup();
		const { token, code } = await startCode({ deviceName: 'Lobby TV' });
		expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
		expect(await t.query(api.displays.current, { token })).toEqual({ state: 'pending', code });

		await expect(t.mutation(api.displays.approveCode, { code, clientId: HERE })).rejects.toThrow('Not authenticated');
		await expect(stranger.mutation(api.displays.approveCode, { code, clientId: HERE })).rejects.toThrow('Not authorized');

		await admin.mutation(api.displays.approveCode, { code: ` ${code.slice(0, 3).toLowerCase()}-${code.slice(3)} `, clientId: HERE });
		expect(await t.query(api.displays.current, { token })).toEqual(IDLE);
		// Once active, the code is gone.
		await expect(admin.mutation(api.displays.approveCode, { code, clientId: HERE })).rejects.toMatchObject(code_('CODE_NOT_FOUND'));
		await expect(admin.mutation(api.displays.approveCode, { code: 'ABC', clientId: HERE })).rejects.toMatchObject(code_('INVALID_CODE'));

		const late = await startCode();
		vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1);
		await expect(admin.mutation(api.displays.approveCode, { code: late.code, clientId: HERE })).rejects.toMatchObject(code_('CODE_EXPIRED'));
		expect(await t.query(api.displays.current, { token: late.token })).toEqual({ state: 'unpaired' });
	});

	it('approving a code revokes the previous display', async () => {
		const { t, admin, startCode } = await setup();
		const first = await startCode();
		await admin.mutation(api.displays.approveCode, { code: first.code, clientId: HERE });
		const second = await startCode();
		await admin.mutation(api.displays.approveCode, { code: second.code, clientId: HERE });
		expect(await t.query(api.displays.current, { token: first.token })).toEqual({ state: 'unpaired' });
		expect(await t.query(api.displays.current, { token: second.token })).toEqual(IDLE);
	});

	it('keeps a token staff approved just as the display asked for a new code', async () => {
		const { t, admin, displays, startCode } = await setup();
		const { token, code } = await startCode();
		await admin.mutation(api.displays.approveCode, { code, clientId: HERE });
		// The display's expiry timer fires before its subscription sees the approval.
		expect(await t.mutation(api.displays.startPairing, { previousToken: token })).toEqual({ status: 'active' });
		expect((await displays()).map((display) => display.status)).toEqual(['active']);
		expect(await t.query(api.displays.current, { token })).toEqual(IDLE);
	});

	it('deletes the code a display was showing once it claims a link, but never an active row', async () => {
		const { t, admin, displays, link, startCode } = await setup();
		const pending = await startCode();
		const token = tokenOf(await t.mutation(api.displays.claimLink, { secret: (await link()).secret, previousToken: pending.token }));
		expect((await displays()).map((display) => display.status)).toEqual(['active']);

		// An active display's token is only revoked, as pairing any new display does; its row stays.
		await t.mutation(api.displays.claimLink, { secret: (await link()).secret, previousToken: token });
		expect((await displays()).map((display) => display.status)).toEqual(['revoked', 'active']);
		// A failed claim keeps the pending code on screen.
		const showing = await startCode();
		expect(await t.mutation(api.displays.claimLink, { secret: 'guess', previousToken: showing.token })).toEqual(LINK_INVALID);
		expect(await admin.query(api.displays.listDisplays, { clientId: HERE })).toMatchObject({ displays: [{ name: 'Customer display' }] });
		expect(await t.query(api.displays.current, { token: showing.token })).toEqual({ state: 'pending', code: showing.code });
	});

	it('replaces the previous pending row on refresh', async () => {
		const { displays, startCode } = await setup();
		const first = await startCode();
		const second = await startCode({ previousToken: first.token });
		expect((await displays()).map((display) => display.pairCode)).toEqual([second.code]);
	});

	it('cleans up pending displays and expired pairing links', async () => {
		const { t, displays, link, startCode } = await setup();
		await startCode();
		const claimed = await link();
		await t.mutation(api.displays.claimLink, { secret: claimed.secret });
		await link();
		vi.setSystemTime(Date.now() + PAIRING_TTL_MS + 1);
		const fresh = await startCode();
		const kept = await link();
		expect(await t.mutation(internal.displays.cleanPending, {})).toEqual({ displays: 1, links: 2 });
		expect((await displays()).filter((display) => display.status === 'pending').map((display) => display.pairCode)).toEqual([fresh.code]);
		const [row] = await t.run((ctx) => ctx.db.query('displayPairLinks').collect());
		expect(row.secretHash).toBe(await sha256(kept.secret));
	});
});

describe('which checkout drives the display', () => {
	async function showing() {
		const context = await setup();
		const { t, admin } = context;
		const order = async (name: string) => (await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name, price: 1000 } })).orderId;
		const show = (orderId: string | null, clientId = HERE) => admin.mutation(api.displays.showOrder, { orderId, clientId });
		const current = (token: string) => t.query(api.displays.current, { token });
		return { ...context, order, show, current };
	}

	it('lets only the tab that paired the display by link publish to it', async () => {
		const { list, pairByLink, order, show, current } = await showing();
		const token = await pairByLink(HERE);
		expect((await list(HERE)).driver).toBe('here');
		expect((await list(OTHER)).driver).toBe('elsewhere');

		const anna = await order('Anna tea');
		expect(await show(anna)).toEqual({ shown: true });
		expect(await show(await order('Bob tea'), OTHER)).toEqual({ shown: false });
		expect(await show(null, OTHER)).toEqual({ shown: false });
		expect(await current(token)).toMatchObject({ state: 'order', lines: [{ name: 'Anna tea' }] });
	});

	it('makes the tab that approves a code, or takes over, the driver', async () => {
		const { admin, list, startCode, order, show, current } = await showing();
		const { token, code } = await startCode();
		await admin.mutation(api.displays.approveCode, { code, clientId: OTHER });
		expect((await list(OTHER)).driver).toBe('here');
		expect(await show(await order('Mine'))).toEqual({ shown: false });

		await admin.mutation(api.displays.takeDisplay, { clientId: HERE, orderId: null });
		expect((await list(OTHER)).driver).toBe('elsewhere');
		expect(await show(await order('Taken over'))).toEqual({ shown: true });
		expect(await current(token)).toMatchObject({ lines: [{ name: 'Taken over' }] });
	});

	it('never lets a newly paired display inherit the previous customer', async () => {
		const { admin, link, pairByLink, startCode, order, show, current } = await showing();
		const first = await pairByLink(HERE);
		await show(await order('Anna tea'));
		expect(await current(first)).toMatchObject({ state: 'order' });

		// Another tab makes a link and leaves checkout; the link is claimed later.
		const later = await link(OTHER);
		const byLink = tokenOf(await admin.mutation(api.displays.claimLink, { secret: later.secret }));
		expect(await current(byLink)).toEqual(IDLE);

		await show(await order('Bob tea'), OTHER);
		const { token, code } = await startCode();
		await admin.mutation(api.displays.approveCode, { code, clientId: HERE });
		expect(await current(token)).toEqual(IDLE);
	});

	it('shows the taking tab\'s order in the same write as the take-over', async () => {
		const { admin, pairByLink, order, show, current } = await showing();
		const token = await pairByLink(OTHER);
		await show(await order('Anna tea'), OTHER);
		await admin.mutation(api.displays.takeDisplay, { clientId: HERE, orderId: await order('Bob tea') });
		expect(await current(token)).toMatchObject({ state: 'order', lines: [{ name: 'Bob tea' }] });
		await admin.mutation(api.displays.takeDisplay, { clientId: OTHER, orderId: 'notreal1' });
		expect(await current(token)).toEqual(IDLE);
	});

	it('no one drives and nothing is shown once the last display is disconnected', async () => {
		const { t, admin, list, pairByLink, order, show } = await showing();
		await pairByLink(HERE);
		await show(await order('Anna tea'));
		const [display] = (await list()).displays;
		await admin.mutation(api.displays.revoke, { displayId: display._id });
		expect(await list()).toEqual({ displays: [], driver: 'none' });
		expect(await show(null)).toEqual({ shown: false });
		expect((await t.run((ctx) => ctx.db.query('tills').first()))!.orderId).toBeUndefined();
	});

	it('shows the welcome screen for an order link that is not an order', async () => {
		const { t, pairByLink, order, show, current } = await showing();
		const token = await pairByLink();
		await show(await order('Water'));
		expect(await show('notreal1')).toEqual({ shown: true });
		expect(await current(token)).toEqual(IDLE);
		const lineId = await t.run(async (ctx) => (await ctx.db.query('orderLines').first())!._id);
		await show(await order('Juice'));
		await show(lineId);
		expect(await current(token)).toEqual(IDLE);
	});

	it('lets only admins publish, take over or list displays', async () => {
		const { t, stranger, pairByLink, order, current } = await showing();
		const token = await pairByLink();
		const orderId = await order('Water');
		await expect(t.mutation(api.displays.showOrder, { orderId, clientId: HERE })).rejects.toThrow('Not authenticated');
		await expect(stranger.mutation(api.displays.showOrder, { orderId, clientId: HERE })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.displays.takeDisplay, { clientId: OTHER, orderId })).rejects.toThrow('Not authorized');
		await expect(stranger.query(api.displays.listDisplays, { clientId: HERE })).rejects.toThrow('Not authorized');
		expect(await current(token)).toEqual(IDLE);
	});

	it('opens "This computer" as an ordinary display that can be disconnected', async () => {
		const { t, admin, list, link, current } = await showing();
		const { secret } = await link(HERE);
		const token = tokenOf(await t.mutation(api.displays.claimLink, { secret, deviceName: 'This computer' }));
		const { displays, driver } = await list();
		expect({ names: displays.map((display) => display.name), driver }).toEqual({ names: ['This computer'], driver: 'here' });
		await admin.mutation(api.displays.revoke, { displayId: displays[0]._id });
		expect(await current(token)).toEqual({ state: 'unpaired' });
	});
});

describe('display presence and access', () => {
	it('returns unpaired for a revoked or unknown token', async () => {
		const { t, admin, list, pairByLink } = await setup();
		const token = await pairByLink();
		const [display] = (await list()).displays;
		await admin.mutation(api.displays.revoke, { displayId: display._id });
		expect(await t.query(api.displays.current, { token })).toEqual({ state: 'unpaired' });
		expect(await t.query(api.displays.current, { token: 'nope' })).toEqual({ state: 'unpaired' });
		expect((await list()).displays).toEqual([]);
	});

	it('records heartbeats in displayPresence only', async () => {
		const { t, list, pairByLink } = await setup();
		const token = await pairByLink();
		await t.mutation(api.displays.heartbeat, { token });
		const [display] = (await list()).displays;
		expect(display.lastSeenAt).toBe(Date.now());
		await t.mutation(api.displays.heartbeat, { token: 'nope' });
		expect(await t.run((ctx) => ctx.db.query('displayPresence').collect())).toHaveLength(1);
	});

	it('ignores heartbeats from pending and revoked tokens', async () => {
		const { t, admin, list, pairByLink, startCode } = await setup();
		const token = await pairByLink();
		const pending = await startCode();
		await t.mutation(api.displays.heartbeat, { token: pending.token });
		const [display] = (await list()).displays;
		await admin.mutation(api.displays.revoke, { displayId: display._id });
		await t.mutation(api.displays.heartbeat, { token });
		expect(await t.run((ctx) => ctx.db.query('displayPresence').collect())).toEqual([]);
	});
});

describe('display order projection', () => {
	async function showing() {
		const context = await setup();
		const { t, admin, pairByLink } = context;
		const token = await pairByLink();
		const current = () => t.query(api.displays.current, { token });
		const show = (orderId: Id<'orders'> | null) => admin.mutation(api.displays.showOrder, { orderId, clientId: HERE });
		const view = (orderId: Id<'orders'>) => admin.query(api.pos.getOrder, { orderId }).then((result) => result!);
		const settle = async (orderId: Id<'orders'>) => {
			const { order, totals, customer } = await view(orderId);
			await admin.mutation(api.pos.settleOrder, {
				orderId, idempotencyKey: `attempt-${orderId}`, expectedDue: totals.due, expectedRevision: order.revision,
				...(customer && 'revision' in customer && typeof customer.revision === 'number' ? { expectedCustomerRevision: customer.revision } : {}),
				tenders: totals.due ? [{ method: 'cash', amount: totals.due }] : []
			});
		};
		return { ...context, current, show, view, settle };
	}

	it('shows coupon savings and line shares, hides invalid coupons and freezes the paid display', async () => {
		const { admin, current, show, settle, view } = await showing();
		const staffId = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', workingHours: [0, 1, 2, 3, 4, 5, 6].map(weekday => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] });
		const serviceId = await admin.mutation(api.adminServices.createService, { slug: 'spa', name: 'Spa', description: '', category: 'Spa', durationMin: 60, bufferMin: 0, price: 120000, currency: 'THB', staffIds: [staffId] });
		const { couponId } = await admin.mutation(api.marketing.saveCoupon, { code: 'SPA-500', benefit: { kind: 'fixed', amount: 50000 }, scope: 'services', minEligibleSubtotal: 150000 });
		await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'active' });
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'service', serviceId } });
		const { lineId } = await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
		await admin.mutation(api.pos.overrideLinePrice, { lineId, price: 60000, note: 'Foot spa' });
		await admin.mutation(api.pos.applyOrderCoupon, { orderId, code: 'SPA-500' });
		await show(orderId);
		expect(await current()).toMatchObject({ state: 'order', coupon: { code: 'SPA-500', saving: 50000 }, total: 130000, due: 130000, lines: [{ couponDiscount: 33333, total: 86667 }, { couponDiscount: 16667, total: 43333 }] });
		await admin.mutation(api.pos.removeLine, { lineId });
		expect(await current()).toMatchObject({ state: 'order', coupon: null, total: 120000, lines: [{ couponDiscount: 0 }] });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'service', serviceId } });
		expect((await view(orderId)).promotion?.problem).toBeNull();
		await settle(orderId);
		await admin.mutation(api.marketing.setCouponStatus, { couponId, status: 'paused' });
		expect(await current()).toMatchObject({ state: 'paid', coupon: { code: 'SPA-500', saving: 50000 }, total: 190000, amountPaid: 190000 });
	});

	it('shows a draft with items, with the customer first name only and no other fields', async () => {
		const { admin, current, show } = await showing();
		const customerId = await admin.mutation(api.customers.createCustomer, { name: '  Anna Maria Lee ', phone: '+66 81 234 5678', email: 'anna@example.com', notes: 'VIP, allergic to nuts' });
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Coconut', price: 8000 } });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
		await show(orderId);

		const state = await current();
		expect(state).toEqual({
			state: 'order', businessName: 'Auralis Cove Retreat', customerFirstName: 'Anna', orderNumber: 1, currency: 'THB',
			lines: [{ name: 'Coconut', detail: null, qty: 1, unitPrice: 8000, price: 8000, discount: 0, couponDiscount: 0, total: 8000, deposit: 0 }],
			subtotal: 8000, discount: 0, coupon: null, deposit: 0, total: 8000, vat: 523, due: 8000, activeAt: Date.now()
		});
		const json = JSON.stringify(state);
		for (const secret of ['Maria', 'Lee', '+66', 'anna@example.com', 'VIP', 'admin@example.com', HERE, orderId, customerId]) expect(json).not.toContain(secret);
	});

	it('matches the checkout totals with discounts, price overrides and deposits', async () => {
		const { t, admin, current, show, view } = await showing();
		const bookingId = await t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', {
				slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 1000000, currency: 'THB', maxGuests: 4,
				bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
			});
			return await insertFixture(ctx, 'bookings', {
				propertyId, guestName: 'Anna', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678', checkIn: '2026-11-01', checkOut: '2026-11-04',
				guests: 2, nights: 3, subtotal: 3000000, discountAmount: 0, total: 3000000, currency: 'THB', amountPaid: 1000000,
				paymentStatus: 'pending', status: 'confirmed', confirmationCode: 'CONF-ANNA', createdAt: Date.now()
			});
		});
		const { orderId } = await admin.mutation(api.pos.openOrderFor, { bookingId });
		const massage = await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Massage', price: 125050 } });
		await admin.mutation(api.pos.updateLine, { lineId: massage.lineId, discount: { type: 'percent', value: 1500 } });
		const juice = await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Juice', price: 12000 } });
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Juice', price: 12000 } });
		await admin.mutation(api.pos.overrideLinePrice, { lineId: juice.lineId, price: 9950, note: 'Happy hour' });
		await admin.mutation(api.pos.updateLine, { lineId: juice.lineId, discount: { type: 'amount', value: 1000 } });
		await show(orderId);

		const checkout = await view(orderId);
		const state = await current();
		if (state.state !== 'order') throw new Error('expected an order');
		expect(state).toMatchObject({
			subtotal: checkout.totals.subtotal, discount: checkout.totals.discount, deposit: checkout.totals.deposit,
			total: checkout.totals.total, vat: checkout.totals.vat, due: checkout.totals.due
		});
		expect(state.deposit).toBe(1000000);
		expect(state.lines.map((line) => line.total)).toEqual(checkout.lines.map((line) => line.net));
		expect(state.lines.find((line) => line.name === 'Juice')).toEqual({ name: 'Juice', detail: null, qty: 2, unitPrice: 12000, price: 9950, discount: 1000, couponDiscount: 0, total: 18900, deposit: 0 });
		expect(state.lines[0]).toMatchObject({ deposit: 1000000, detail: expect.any(String) });
		expect(state.customerFirstName).toBeNull();
	});

	it('shows idle for no order, an empty order, a discarded order and a voided one', async () => {
		const { admin, current, show, view, settle } = await showing();
		await show(null);
		expect(await current()).toEqual(IDLE);

		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 5000 } });
		await show(orderId);
		expect(await current()).toMatchObject({ state: 'order' });
		await admin.mutation(api.pos.removeLine, { lineId });
		expect(await current()).toEqual(IDLE);

		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Water', price: 5000 } });
		await admin.mutation(api.pos.discardOrder, { orderId, expectedRevision: (await view(orderId)).order.revision, idempotencyKey: 'discard-0001' });
		expect(await current()).toEqual(IDLE);

		const paid = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Towel', price: 30000 } });
		await show(paid.orderId);
		await settle(paid.orderId);
		await admin.mutation(api.pos.voidOrder, { orderId: paid.orderId, reason: 'Wrong order' });
		expect(await current()).toEqual(IDLE);
	});

	it('marks an open order active when it changes or is published again', async () => {
		const { admin, current, show } = await showing();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 5000 } });
		await show(orderId);
		const shownAt = Date.now();
		expect(await current()).toMatchObject({ activeAt: shownAt });

		vi.setSystemTime(shownAt + 60_000);
		await admin.mutation(api.pos.addItem, { orderId, item: { kind: 'extra', name: 'Juice', price: 8000 } });
		expect(await current()).toMatchObject({ activeAt: shownAt + 60_000 });

		vi.setSystemTime(shownAt + 120_000);
		await show(orderId);
		expect(await current()).toMatchObject({ activeAt: shownAt + 120_000 });
	});

	it('shows a legacy held order like a draft', async () => {
		const { t, admin, current, show } = await showing();
		const { orderId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 5000 } });
		await t.run((ctx) => ctx.db.patch(orderId, { status: 'draft' }));
		await show(orderId);
		expect(await current()).toMatchObject({ state: 'order', total: 5000 });
	});

	it('thanks the guest once paid, with what was paid at the counter and the receipt number', async () => {
		const { admin, current, show, settle } = await showing();
		const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Somchai Jaidee', phone: '+66 89 000 0000' });
		const { orderId, lineId } = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Spa day', price: 250000 } });
		await admin.mutation(api.pos.updateLine, { lineId, discount: { type: 'amount', value: 50000 } });
		await admin.mutation(api.pos.linkCustomer, { orderId, customerId });
		await show(orderId);
		await settle(orderId);

		const state = await current();
		expect(state).toEqual({
			state: 'paid', businessName: 'Auralis Cove Retreat', customerFirstName: 'Somchai', orderNumber: 1, currency: 'THB',
			total: 200000, vat: 13084, amountPaid: 200000, coupon: null, receiptNumber: 1, paidAt: Date.now()
		});
		expect(JSON.stringify(state)).not.toMatch(/Jaidee|\+66|cash|admin@example\.com/);
	});

	it('follows the order the driving checkout shows last', async () => {
		const { admin, current, show } = await showing();
		const first = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'First', price: 1000 } });
		const second = await admin.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Second', price: 2000 } });
		await show(first.orderId);
		await show(second.orderId);
		expect(await current()).toMatchObject({ state: 'order', total: 2000 });
		await show(null);
		expect(await current()).toEqual(IDLE);
	});
});

describe('display hardening', () => {
	it('rejects an oversized token in current, heartbeat and claimLink', async () => {
		const { t, link } = await setup();
		const { secret } = await link();
		const huge = 'x'.repeat(129);
		expect(await t.query(api.displays.current, { token: huge })).toEqual({ state: 'unpaired' });
		expect(await t.mutation(api.displays.heartbeat, { token: huge })).toBeNull();
		expect(await t.mutation(api.displays.claimLink, { secret: secret + huge })).toEqual(LINK_INVALID);
		expect(await t.run((ctx) => ctx.db.query('displayPresence').collect())).toEqual([]);
		expect(await t.run((ctx) => ctx.db.query('displays').collect())).toEqual([]);
	});

	it('caps invalid claims, but a valid link still claims when the cap is reached', async () => {
		const { t, link } = await setup();
		for (let i = 0; i < 30; i++) expect(await t.mutation(api.displays.claimLink, { secret: `guess-${i}` })).toEqual(LINK_INVALID);
		await expect(t.mutation(api.displays.claimLink, { secret: 'guess-31' })).rejects.toThrow('Too many requests');
		expect((await t.mutation(api.displays.claimLink, { secret: (await link()).secret })).ok).toBe(true);
		vi.setSystemTime(Date.now() + PAIRING_TTL_MS);
		expect(await t.mutation(api.displays.claimLink, { secret: 'guess-after' })).toEqual(LINK_INVALID);
	});

	it('refuses codes past the shop-wide cap, while link pairing stays open', async () => {
		const { t, link } = await setup();
		await t.run((ctx) => ctx.db.insert('rateLimits', { key: 'display:start', count: 600, expiresAt: Date.now() + PAIRING_TTL_MS }));
		await expect(t.mutation(api.displays.startPairing, {})).rejects.toThrow('Too many requests');
		expect((await t.mutation(api.displays.claimLink, { secret: (await link()).secret })).ok).toBe(true);
	});
});
