// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { MAX_STAY_APPOINTMENTS } from './lib/stayAppointments';
import schema from './schema';

declare global {
	interface ImportMeta { glob(pattern: string): Record<string, () => Promise<unknown>> }
}

const modules = import.meta.glob('./**/*.ts');
const now = Date.parse('2026-11-14T03:00:00Z');
beforeEach(() => {
	vi.stubEnv('ADMIN_EMAILS', 'owner@example.com');
	vi.spyOn(Date, 'now').mockReturnValue(now);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

async function setup() {
	const t = convexTest(schema, modules);
	const owner = t.withIdentity({ email: 'owner@example.com', tokenIdentifier: 'owner' });
	const { propertyId, bookingId, serviceId, staffId } = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'villa', name: 'Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 4,
			bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		});
		const bookingId = await ctx.db.insert('bookings', {
			propertyId, guestName: 'Guest', guestPhone: '0812345678', checkIn: '2026-11-01', checkOut: '2026-11-30',
			guests: 2, nights: 29, subtotal: 30000, discountAmount: 0, total: 30000, amountPaid: 10000,
			currency: 'THB', paymentStatus: 'pending', status: 'confirmed', createdAt: now
		});
		const staffId = await ctx.db.insert('staff', {
			name: 'Nok', role: 'Therapist', color: '#abc', workingHours: [], breaks: [], status: 'active', createdAt: now, updatedAt: now
		});
		const serviceId = await ctx.db.insert('services', {
			slug: 'massage', name: 'Massage', description: '', category: 'Spa', durationMin: 60, bufferMin: 0,
			price: 1200, currency: 'THB', staffIds: [staffId], status: 'active', createdAt: now, updatedAt: now
		});
		return { propertyId, bookingId, serviceId, staffId };
	});
	const appointment = (patch: Partial<Doc<'serviceAppointments'>> = {}) => t.run((ctx) => ctx.db.insert('serviceAppointments', {
		serviceId, staffId, bookingId, start: now, end: now + 3600000, blockedUntil: now + 3600000,
		guestName: 'Guest', guestPhone: '0812345678', source: 'admin', status: 'booked', paymentStatus: 'unpaid',
		price: 1200, currency: 'THB', confirmationCode: 'SPA', accessToken: 'test-only', createdAt: now, ...patch
	}));
	const open = () => owner.mutation(api.pos.openStayCheckout, { bookingId });
	const read = () => owner.query(api.adminBookings.stayAppointments, { bookingId });
	const order = (orderId: Id<'bills'>) => owner.query(api.pos.getOrder, { orderId }).then((view) => view!);
	return { t, owner, propertyId, bookingId, appointment, open, read, order };
}

describe('stay checkout', () => {
	it('uses operations permission for the read and checkout permission for the write', async () => {
		const { t, owner, bookingId } = await setup();
		const outsider = t.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other' });
		for (const client of [t, outsider]) {
			await expect(client.query(api.adminBookings.stayAppointments, { bookingId })).rejects.toThrow();
			await expect(client.mutation(api.pos.openStayCheckout, { bookingId })).rejects.toThrow();
		}
		const cashier = t.withIdentity({ email: 'cashier@example.com', tokenIdentifier: 'cashier' });
		await owner.mutation(api.staffAccess.setGrant, { email: 'cashier@example.com', role: 'cashier' });
		await cashier.mutation(api.staffAccess.claimInvite, {});
		await expect(cashier.query(api.adminBookings.stayAppointments, { bookingId })).rejects.toThrow('Not authorized');
		await expect(cashier.mutation(api.pos.openStayCheckout, { bookingId })).resolves.toMatchObject({ added: [] });
		const manager = t.withIdentity({ email: 'manager@example.com', tokenIdentifier: 'manager' });
		await owner.mutation(api.staffAccess.setGrant, { email: 'manager@example.com', role: 'manager' });
		await manager.mutation(api.staffAccess.claimInvite, {});
		await expect(manager.query(api.adminBookings.stayAppointments, { bookingId })).resolves.toEqual({ appointments: [], complete: true });
	});

	it('attaches only unpaid chargeable appointments of this stay, with explicit skip reasons', async () => {
		const { owner, bookingId, appointment, open, read, order } = await setup();
		const booked = await appointment({ serviceNameSnapshot: 'Booked massage' });
		const completed = await appointment({ status: 'completed' });
		const arrived = await appointment({ status: 'arrived' });
		const inService = await appointment({ status: 'in_service' });
		const paid = await appointment({ paymentStatus: 'paid' });
		const refunded = await appointment({ paymentStatus: 'refunded' });
		const cancelled = await appointment({ status: 'cancelled' });
		const noShow = await appointment({ status: 'no_show' });
		const foreign = await appointment({ currency: 'USD' });
		const elsewhere = await appointment();
		const unrelated = await appointment({ bookingId: undefined });
		await owner.mutation(api.pos.openOrderFor, { bookingId });
		const { orderId: other } = await owner.mutation(api.pos.addItem, { item: { kind: 'extra', name: 'Water', price: 100 } });
		await owner.mutation(api.pos.attach, { orderId: other, appointmentId: elsewhere });
		const before = await read();
		expect(before.appointments.find((a) => a._id === booked)).toMatchObject({ serviceName: 'Booked massage', onOrder: null });
		expect(before.appointments.find((a) => a._id === completed)?.serviceName).toBe('Massage');
		expect(before.appointments.find((a) => a._id === elsewhere)?.onOrder).toMatchObject({ _id: other, title: 'Order #2' });
		expect(before.appointments.map((a) => a._id)).not.toContain(unrelated);
		const result = await open();
		expect(result.added).toEqual([booked, completed, arrived, inService]);
		for (const appointmentId of [paid, refunded, cancelled, noShow]) {
			expect(result.skipped).toContainEqual({ appointmentId, reason: 'This appointment has nothing left to pay' });
		}
		expect(result.skipped).toContainEqual({ appointmentId: foreign, reason: 'This appointment is priced in USD. Checkout takes THB only.' });
		expect(result.skipped).toContainEqual({ appointmentId: elsewhere, reason: 'This appointment is already on Order #2' });
		const view = await order(result.orderId);
		expect(view.lines.filter((l) => l.appointmentId).map((l) => l.appointmentId)).toEqual(result.added);
		expect(view.lines.filter((l) => l.bookingId === bookingId)).toHaveLength(1);
		expect(view.order.due).toBe(24800);
		expect((await read()).appointments.find((a) => a._id === booked)?.onOrder?._id).toBe(result.orderId);
	});

	it('reuses the stay order and does not write again on a second call', async () => {
		const { t, owner, bookingId, appointment, open, order } = await setup();
		const appointmentId = await appointment();
		const existing = await owner.mutation(api.pos.openOrderFor, { bookingId });
		const first = await open();
		expect(first).toEqual({ ...existing, added: [appointmentId], skipped: [] });
		const before = await order(first.orderId);
		const second = await open();
		expect(second).toEqual({ orderId: first.orderId, added: [], skipped: [{ appointmentId, reason: 'This appointment is already on this order' }] });
		expect(await order(first.orderId)).toEqual(before);
		expect(await t.run((ctx) => ctx.db.query('bills').take(2))).toHaveLength(1);
		// Source edits are still caught by the ordinary checkout revision and source guards.
		await t.run((ctx) => ctx.db.patch(appointmentId, { price: 1500, revision: 1 }));
		expect((await order(first.orderId)).lines.find((l) => l.appointmentId === appointmentId)?.sourceIssue?.kind).toBe('changed');
	});

	it('can attach spa on an already paid stay without recharging the stay', async () => {
		const { t, bookingId, appointment, open, order } = await setup();
		await t.run((ctx) => ctx.db.patch(bookingId, { paymentStatus: 'paid', amountPaid: 30000 }));
		const appointmentId = await appointment();
		const first = await open();
		expect(first.added).toEqual([appointmentId]);
		expect((await order(first.orderId)).order.due).toBe(1200);
		expect((await open()).orderId).toBe(first.orderId);
	});

	it('reads by stay across long dates, returns at most 50 and detects overflow before writing', async () => {
		const { t, appointment, open, read } = await setup();
		for (let i = 0; i < MAX_STAY_APPOINTMENTS; i++) await appointment({ start: now + i * 86400000 });
		expect(await read()).toMatchObject({ complete: true });
		expect((await read()).appointments).toHaveLength(50);
		await appointment();
		const result = await read();
		expect(result.complete).toBe(false);
		expect(result.appointments).toHaveLength(50);
		await expect(open()).rejects.toThrow('more than 50 appointments');
		expect(await t.run((ctx) => ctx.db.query('bills').take(1))).toEqual([]);
	});

	it('preserves live checkout, currency and cancellation guards without partial writes', async () => {
		const { t, bookingId, appointment, open } = await setup();
		await appointment();
		for (const [patch, message] of [
			[{ stripeCheckoutExpiresAt: now + 60000 }, 'Online checkout is in progress'],
			[{ stripeCheckoutExpiresAt: undefined, currency: 'USD' }, 'THB only'],
			[{ currency: 'THB', status: 'cancelled' }, 'cancelled'],
		] as const) {
			await t.run((ctx) => ctx.db.patch(bookingId, patch));
			await expect(open()).rejects.toThrow(message);
			expect(await t.run((ctx) => ctx.db.query('bills').take(1))).toEqual([]);
			expect(await t.run((ctx) => ctx.db.query('billLines').take(1))).toEqual([]);
		}
	});

	it('rolls back every attachment if a later write exceeds the bill limit', async () => {
		const { t, appointment, open } = await setup();
		for (let i = 0; i < 11; i++) await appointment({ price: 1000000 });
		await expect(open()).rejects.toThrow('An order is at most');
		expect(await t.run((ctx) => ctx.db.query('bills').take(1))).toEqual([]);
		expect(await t.run((ctx) => ctx.db.query('billLines').take(1))).toEqual([]);
	});

	it('returns the sheet balance as owed without adding per-booking reads', async () => {
		const { t, owner, bookingId } = await setup();
		for (const patch of [
			{ paymentStatus: 'pending' as const, amountPaid: 10000, amountRefunded: 0 },
			{ paymentStatus: 'paid' as const, amountPaid: 35000, amountRefunded: 0 },
			{ paymentStatus: 'paid' as const, amountPaid: 30000, amountRefunded: 5000 },
			{ paymentStatus: 'refunded' as const, amountPaid: 30000, amountRefunded: 30000, providerRefundWaived: 30000 },
		]) {
			await t.run((ctx) => ctx.db.patch(bookingId, patch));
			const detail = (await owner.query(api.adminBookings.getForAdmin, { bookingId }))!;
			const list = await owner.query(api.adminBookings.listForAdmin, { from: '2026-11-13', to: '2026-11-15' });
			expect(list.bookings.find((b) => b._id === bookingId)?.owed).toBe(detail.money.owed);
			expect(detail.owed).toBe(detail.money.owed);
		}
	});
});
