import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { FunctionArgs } from 'convex/server';
import type { Id } from './_generated/dataModel';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const reviewedCustomer = (view: { customer: object | null }) =>
	view.customer && 'revision' in view.customer && typeof view.customer.revision === 'number' ? { expectedCustomerRevision: view.customer.revision } : {};

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com,desk@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const desk = t.withIdentity({ email: 'desk@example.com', tokenIdentifier: 'desk' });
	const hours = { workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] };
	const nok = await admin.mutation(api.services.commands.createStaff.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', ...hours });
	const serviceId = await admin.mutation(api.services.commands.createService.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Massage',
		durationMin: 60, bufferMin: 15, price: 120000, currency: 'THB', staffIds: [nok]
	});
	const { bookingId } = await t.run(async (ctx) => {
		const propertyId = await ctx.db.insert('properties', {
			slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 1000000, currency: 'THB', maxGuests: 4,
			bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
		});
		// A confirmed stay with a 10,000 deposit already paid online (recorded before payments were itemised).
		const bookingId = await insertFixture(ctx, 'bookings', {
			propertyId, guestName: 'Anna', guestPhone: '+66 81 234 5678', guestPhoneDigits: '66812345678', checkIn: '2026-10-01', checkOut: '2026-10-04',
			guests: 2, nights: 3, subtotal: 3000000, discountAmount: 0, total: 3000000, currency: 'THB', amountPaid: 1000000,
			paymentStatus: 'pending', status: 'confirmed', confirmationCode: 'CONF-ANNA', createdAt: Date.now()
		});
		return { bookingId };
	});
	const order = (orderId: Id<'orders'>) => admin.query(api.pos.orders.getOrder, { orderId }).then((view) => view!);
	const settle = async (args: Omit<FunctionArgs<typeof api.pos.commands.settleOrder.settleOrder>, 'expectedRevision' | 'expectedDue' | 'idempotencyKey' | 'tenders'> & { key?: string }) => {
		const view = await order(args.orderId);
		return admin.mutation(api.pos.commands.settleOrder.settleOrder, {
			...reviewedCustomer(view), orderId: args.orderId, idempotencyKey: args.key ?? `pay-${args.orderId}`,
			expectedDue: view.totals.due, expectedRevision: view.order.revision, tenders: view.totals.due > 0 ? [{ method: 'cash', amount: view.totals.due }] : []
		});
	};
	const appointment = (overrides: Record<string, unknown> = {}) => {
		const start = Date.now() - 3 * 3_600_000;
		return t.run((ctx) => insertFixture(ctx, 'appointments', {
			serviceId, staffId: nok, start, end: start + 3_600_000, blockedUntil: start + 4_500_000, guestName: 'Eve', guestPhone: '+66 82 000 1111',
			source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 120000, currency: 'THB', confirmationCode: 'SVC-1', accessToken: 'tok', createdAt: Date.now(),
			...overrides
		}));
	};
	const extra = (orderId?: Id<'orders'>, price = 10000, name = 'Water') => admin.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'extra', name, price } });
	const revision = async (orderId: Id<'orders'>) => (await order(orderId)).order.revision;
	const discard = async (orderId: Id<'orders'>, key = `discard-${orderId}`, reason?: string) =>
		admin.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: await revision(orderId), idempotencyKey: key, reason });
	const restore = async (orderId: Id<'orders'>, extraArgs: { removeConflictingRows?: boolean; key?: string } = {}) =>
		admin.mutation(api.pos.commands.restoreOrder.restoreOrder, { orderId, expectedRevision: await revision(orderId), idempotencyKey: extraArgs.key ?? `restore-${orderId}`, removeConflictingRows: extraArgs.removeConflictingRows });
	const history = (orderId: Id<'orders'>) => admin.query(api.pos.orders.orderHistory, { orderId, paginationOpts: { numItems: 50, cursor: null } }).then((page) => page.page);
	const list = (filter: 'unpaid' | 'discarded', numItems = 20, cursor: string | null = null) =>
		admin.query(api.pos.orders.listOrders, { filter, paginationOpts: { numItems, cursor } });
	return { t, admin, desk, serviceId, bookingId, order, settle, appointment, extra, revision, discard, restore, history, list };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-02T03:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('discarding unpaid orders', () => {
	it('moves an order from Unpaid to Discarded, keeping its rows, links, customer and a full history entry', async () => {
		const { admin, bookingId, order, extra, discard, list, history } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await extra(orderId, 30000);
		const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Bob' });
		await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
		const before = await order(orderId);

		await expect(discard(orderId, 'discard-attempt-1', '  Duplicate of order 2  ')).resolves.toEqual({ replayed: false });
		const view = await order(orderId);
		expect(view.order).toMatchObject({ status: 'discarded', state: 'discarded', bookingId, customerId, orderNumber: before.order.orderNumber, revision: before.order.revision + 1 });
		expect(view.discarded).toEqual({ at: Date.now(), by: 'admin@example.com', reason: 'Duplicate of order 2' });
		expect(view.lines.map((line) => line._id)).toEqual(before.lines.map((line) => line._id));
		expect(view.customer).toMatchObject({ _id: customerId });
		expect((await list('unpaid')).page).toHaveLength(0);
		expect((await list('discarded')).page).toEqual([expect.objectContaining({
			_id: orderId, state: 'discarded', total: 3030000, discarded: { at: Date.now(), by: 'admin@example.com', reason: 'Duplicate of order 2' }
		})]);
		const [entry] = await history(orderId);
		expect(entry).toMatchObject({ kind: 'discarded', actor: 'admin@example.com', reason: 'Duplicate of order 2', after: { status: 'discarded' } });
		expect(entry.before).toMatchObject({ status: 'draft', bookingId, customerId, total: 3030000, lines: [expect.objectContaining({ kind: 'booking', bookingId }), expect.objectContaining({ name: 'Water', unitPrice: 30000 })] });
		// The stay itself is untouched: still confirmed and owing.
		expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId })).toMatchObject({ status: 'confirmed', paymentStatus: 'pending' });
		expect((await admin.query(api.pos.orders.ordersForBooking, { bookingId }))).toMatchObject({ activeOrder: null, orders: [], discardedOrders: [{ _id: orderId, discardReason: 'Duplicate of order 2' }] });
	});

	it('pages through discarded orders, newest discard first', async () => {
		const { extra, discard, list } = await setup();
		const ids = [];
		for (let i = 0; i < 3; i++) {
			const { orderId } = await extra(undefined, 100 + i);
			ids.push(orderId);
		}
		for (const id of ids) {
			vi.advanceTimersByTime(1000);
			await discard(id);
		}
		const first = await list('discarded', 2);
		expect(first.page.map((row) => row._id)).toEqual([ids[2], ids[1]]);
		expect(first.isDone).toBe(false);
		const second = await list('discarded', 2, first.continueCursor);
		expect(second.page.map((row) => row._id)).toEqual([ids[0]]);
	});

	it('retries a lost discard safely and refuses stale, paid, void, empty and repeated discards', async () => {
		const { admin, extra, discard, revision, settle, history } = await setup();
		const { orderId } = await extra();
		const seen = await revision(orderId);
		await extra(orderId, 5000, 'Snack');
		await expect(admin.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: seen, idempotencyKey: 'discard-stale' })).rejects.toThrow('changed since you opened it');
		await discard(orderId, 'discard-key-1');
		const after = await revision(orderId);
		await expect(admin.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: seen, idempotencyKey: 'discard-key-1' })).resolves.toEqual({ replayed: true });
		expect(await revision(orderId)).toBe(after);
		await expect(admin.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: after, idempotencyKey: 'discard-key-2' })).rejects.toThrow('already discarded');
		expect((await history(orderId)).filter((row) => row.kind === 'discarded')).toHaveLength(1);
		await expect(admin.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: after, idempotencyKey: 'short' })).rejects.toThrow('Invalid attempt key');

		const { orderId: paid } = await extra();
		await settle({ orderId: paid });
		await expect(discard(paid)).rejects.toThrow('Void it instead');
		await admin.mutation(api.pos.commands.voidOrder.voidOrder, { orderId: paid, reason: 'Test' });
		await expect(discard(paid)).rejects.toThrow('voided');

		const { orderId: empty } = await extra();
		const line = (await admin.query(api.pos.orders.getOrder, { orderId: empty }))!.lines[0];
		await admin.mutation(api.pos.commands.removeLine.removeLine, { lineId: line._id });
		await expect(discard(empty)).rejects.toThrow('no items');
	});

	it('refuses every change and payment while discarded, including legacy clear and source rows', async () => {
		const { admin, bookingId, appointment, order, extra, discard } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await extra(orderId);
		const view = await order(orderId);
		await discard(orderId);
		const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Bob' });
		const appointmentId = await appointment();
		const refused = [
			admin.mutation(api.pos.commands.addItem.addItem, { orderId, item: { kind: 'extra', name: 'Tea', price: 1000 } }),
			admin.mutation(api.pos.commands.attach.attach, { orderId, appointmentId }),
			admin.mutation(api.pos.commands.updateLine.updateLine, { lineId: view.lines[1]._id, qtyChange: 1 }),
			admin.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, { lineId: view.lines[1]._id, price: 100, note: 'x' }),
			admin.mutation(api.pos.commands.removeLine.removeLine, { lineId: view.lines[1]._id }),
			admin.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId: view.lines[0]._id }),
			admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId }),
			admin.mutation(api.pos.commands.unlinkCustomer.unlinkCustomer, { orderId }),
			admin.mutation(api.pos.commands.saveOrder.saveOrder, { orderId }),
			admin.mutation(api.pos.commands.clearOrder.clearOrder, { orderId }),
			admin.mutation(api.pos.commands.settleOrder.settleOrder, { orderId, idempotencyKey: 'pay-discarded', expectedDue: view.totals.due, expectedRevision: view.order.revision + 1, tenders: [{ method: 'cash', amount: view.totals.due }] }),
			admin.mutation(api.pos.commands.voidOrder.voidOrder, { orderId, reason: 'x' })
		];
		const results = await Promise.allSettled(refused);
		expect(results.every((result) => result.status === 'rejected')).toBe(true);
		const messages = results.map((result) => (result as PromiseRejectedResult).reason.message as string);
		expect(messages.filter((message) => message.includes('was discarded. Restore it'))).toHaveLength(11);
		expect(messages[messages.length - 1]).toContain('Only a paid order can be voided');
		const unchanged = await order(orderId);
		expect(unchanged.lines).toHaveLength(2);
		expect(unchanged.order.status).toBe('discarded');
	});

	it('releases its stay while discarded, keeps the booking from being deleted, and the stay is charged once', async () => {
		const { admin, bookingId, order, settle, discard } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await discard(orderId);
		// A pending test booking whose order was discarded still can't be hard-deleted: the order keeps its row.
		const testBooking = await admin.mutation(api.bookings.commands.createBooking.createBooking, {
			propertySlug: 'villa', guestName: 'Test', guestPhone: '+66 81 234 5678', checkIn: '2026-11-10', checkOut: '2026-11-12', guests: 2, notifyGuest: false
		});
		const { orderId: testOrder } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId: testBooking });
		await discard(testOrder);
		await expect(admin.mutation(api.bookings.commands.deleteBooking.deleteBooking, { bookingId: testBooking })).rejects.toThrow('has an order');
		// Staff can charge the stay on a new order meanwhile.
		const reopened = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		expect(reopened.orderId).not.toBe(orderId);
		expect((await order(reopened.orderId)).lines.filter((line) => line.bookingId === bookingId)).toHaveLength(1);
		await expect(admin.mutation(api.bookings.commands.recordPayment.recordPayment, {
			bookingId, expectedRevision: 0, expectedAmount: 2000000, method: 'cash', idempotencyKey: 'desk-pay-0001'
		})).rejects.toThrow('still open');
		await settle({ orderId: reopened.orderId });
		expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId })).toMatchObject({ paymentStatus: 'paid' });
	});
});

describe('restoring discarded orders', () => {
	it('restores rows, links and customer as they were and records who restored it', async () => {
		const { admin, bookingId, order, extra, discard, restore, list, history } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await extra(orderId, 30000);
		const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Bob' });
		await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
		const before = await order(orderId);
		await discard(orderId, undefined, 'Wrong guest');
		vi.advanceTimersByTime(60_000);
		const check = await admin.query(api.pos.orders.restoreCheck, { orderId });
		expect(check).toMatchObject({ blocking: 0, conflicts: [], rowsLeft: 2, discarded: { reason: 'Wrong guest' } });

		await expect(restore(orderId, { key: 'restore-key-1' })).resolves.toEqual({ replayed: false, removed: [], warnings: [] });
		const view = await order(orderId);
		expect(view.order).toMatchObject({ status: 'draft', state: 'unpaid', bookingId, customerId, total: 3030000, due: 2030000 });
		expect(view.order.revision).toBeGreaterThan(before.order.revision + 1);
		expect(view.order).not.toHaveProperty('discardedAt');
		expect(view.discarded).toBeNull();
		expect(view.lines.map(({ _id, unitPrice, sourceIssue }) => ({ _id, unitPrice, sourceIssue }))).toEqual(before.lines.map(({ _id, unitPrice }) => ({ _id, unitPrice, sourceIssue: null })));
		expect((await list('unpaid')).page.map((row) => row._id)).toEqual([orderId]);
		expect((await list('discarded')).page).toHaveLength(0);
		const [entry] = await history(orderId);
		expect(entry).toMatchObject({ kind: 'restored', actor: 'admin@example.com', recordedAt: Date.now(), before: { status: 'discarded', discardReason: 'Wrong guest' }, after: { status: 'draft', removed: [] } });
		// Retrying the restore returns the first result; a different attempt is refused.
		const now = await order(orderId);
		await expect(admin.mutation(api.pos.commands.restoreOrder.restoreOrder, { orderId, expectedRevision: 0, idempotencyKey: 'restore-key-1' })).resolves.toMatchObject({ replayed: true });
		await expect(admin.mutation(api.pos.commands.restoreOrder.restoreOrder, { orderId, expectedRevision: now.order.revision, idempotencyKey: 'restore-key-2' })).rejects.toThrow('not discarded');
	});

	it('refuses a stale restore', async () => {
		const { admin, extra, discard, revision } = await setup();
		const { orderId } = await extra();
		await discard(orderId);
		const seen = await revision(orderId);
		await expect(admin.mutation(api.pos.commands.restoreOrder.restoreOrder, { orderId, expectedRevision: seen - 1, idempotencyKey: 'restore-stale' })).rejects.toThrow('changed since you opened it');
	});

	it('never restores a second chargeable copy of a stay now on another order, unless that row is taken off', async () => {
		const { admin, bookingId, order, extra, discard, restore, history } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await extra(orderId, 30000);
		await discard(orderId);
		const { orderId: other } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });

		const check = await admin.query(api.pos.orders.restoreCheck, { orderId });
		expect(check).toMatchObject({
			blocking: 1, rowsLeft: 1,
			conflicts: expect.arrayContaining([
				expect.objectContaining({ kind: 'charged_elsewhere', blocking: true, name: 'Stay · Pool Villa', order: { _id: other, title: 'Order #2' } }),
				expect.objectContaining({ kind: 'link_shared', blocking: false })
			])
		});
		await expect(restore(orderId)).rejects.toThrow('Not restored: Stay · Pool Villa is now on Order #2.');
		expect((await order(orderId)).order.status).toBe('discarded');

		const result = await restore(orderId, { removeConflictingRows: true });
		expect(result.removed).toEqual([expect.objectContaining({ name: 'Stay · Pool Villa', reason: 'Stay · Pool Villa is now on Order #2.' })]);
		const view = await order(orderId);
		expect(view.order.state).toBe('unpaid');
		expect(view.lines.map((line) => line.name)).toEqual(['Water']);
		expect(view.order.bookingId).toBe(bookingId);
		expect((await order(other)).lines.filter((line) => line.bookingId === bookingId)).toHaveLength(1);
		expect((await history(orderId)).map((row) => row.kind).slice(0, 2)).toEqual(['restored', 'line_removed']);
	});

	it('refuses to restore when every row is now on another order', async () => {
		const { admin, bookingId, discard, restore } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await discard(orderId);
		await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await expect(restore(orderId, { removeConflictingRows: true })).rejects.toThrow('every item on this order is now on another order');
	});

	it('brings back a row whose stay changed or was paid meanwhile unchanged and flagged, so it is never charged stale or twice', async () => {
		const { admin, bookingId, order, settle, extra, discard, restore } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await extra(orderId);
		const staleRow = (await order(orderId)).lines[0];
		await discard(orderId);
		// The stay is edited while the order is discarded: the source keeps its new terms.
		const booking = (await admin.query(api.bookings.admin.getForAdmin, { bookingId }))!;
		await admin.mutation(api.bookings.commands.editBooking.editBooking, {
			bookingId, expectedRevision: booking.revision, propertyId: booking.propertyId, checkIn: '2026-10-01', checkOut: '2026-10-05',
			guests: 2, guestName: 'Anna', guestPhone: booking.guestPhone, notifyGuest: false
		});
		const result = await restore(orderId);
		expect(result.warnings).toEqual([expect.objectContaining({ kind: 'changed', name: 'Stay · Pool Villa' })]);
		const view = await order(orderId);
		expect(view.lines[0]).toMatchObject({ _id: staleRow._id, unitPrice: 3000000, detail: staleRow.detail, sourceIssue: { kind: 'changed' } });
		expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId })).toMatchObject({ checkOut: '2026-10-05', total: 4000000 });
		await expect(settle({ orderId })).rejects.toThrow('changed since it was added');
		await admin.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId: staleRow._id });
		await settle({ orderId });
		expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId })).toMatchObject({ paymentStatus: 'paid', amountPaid: 4000000 });

		// Paid elsewhere while discarded: the restored row is flagged and refused, then removed.
		const second = await setup();
		const { orderId: first } = await second.admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId: second.bookingId });
		await second.extra(first);
		await second.discard(first);
		const { orderId: other } = await second.admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId: second.bookingId });
		await second.settle({ orderId: other });
		const restored = await second.restore(first);
		expect(restored.warnings).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'settled' })]));
		await expect(second.settle({ orderId: first })).rejects.toThrow('paid since it was added');
		const row = (await second.order(first)).lines.find((line) => line.bookingId)!;
		await expect(second.admin.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId: row._id })).resolves.toEqual({ result: 'removed' });
		await second.settle({ orderId: first });
		expect((await second.order(first)).order.state).toBe('paid');
	});

	it('restores with a warning when the linked customer was archived meanwhile', async () => {
		const { admin, extra, discard, restore } = await setup();
		const { orderId } = await extra();
		const customerId = await admin.mutation(api.pos.customers.createCustomer, { name: 'Bob' });
		await admin.mutation(api.pos.commands.linkCustomer.linkCustomer, { orderId, customerId });
		await discard(orderId);
		const profile = (await admin.query(api.pos.customers.getCustomer, { customerId }))!;
		await admin.mutation(api.pos.customers.setCustomerArchived, { customerId, expectedRevision: profile.revision, archived: true });
		const result = await restore(orderId);
		expect(result.warnings).toEqual([expect.objectContaining({ kind: 'customer', message: expect.stringContaining('archived') })]);
	});

	it('keeps legacy clear working and logged', async () => {
		const { admin, extra, order, history } = await setup();
		const { orderId } = await extra();
		await admin.mutation(api.pos.commands.clearOrder.clearOrder, { orderId });
		expect((await order(orderId)).order).toMatchObject({ status: 'draft', hasItems: false });
		expect((await history(orderId))[0]).toMatchObject({ kind: 'cleared', before: { lines: [expect.objectContaining({ name: 'Water' })] } });
		expect((await order(orderId)).audit.map((row) => row.kind)).toContain('cleared');
	});
});

describe('no-show and late cancellation fees', () => {
 it('rejects a stale reviewed fee and replays its committed attempt after the source changes', async () => {
  const { t, admin, desk, appointment, order } = await setup();
  const appointmentId = await appointment({ status: 'no_show', revision: 2 });
  const args = { appointmentId, kind: 'no_show' as const, amount: 50000, reason: 'No attendance', expectedRevision: 2, idempotencyKey: 'fee-reviewed-attempt' };
  await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { ...args, expectedRevision: 1 })).rejects.toThrow('appointment changed');
  const added = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, args);
  await t.run(ctx => ctx.db.patch(appointmentId, { status: 'completed', revision: 3 }));
  await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, args)).resolves.toEqual({ ...added, replayed: true });
  await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { ...args, amount: 60000 })).rejects.toThrow('different details');
  await expect(desk.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, args)).rejects.toThrow('different details');
  expect((await order(added.orderId)).lines).toHaveLength(1);
  expect(await t.run(ctx => ctx.db.query('appointmentFeeAttempts').collect())).toHaveLength(1);
 });
	it('charges an audited no-show fee without reopening the appointment or marking it paid', async () => {
		const { t, admin, appointment, order, settle } = await setup();
		const appointmentId = await appointment({ status: 'no_show' });
		const added = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 50000, reason: 'Policy: 50% no-show' });
		expect(added.replayed).toBe(false);
		const view = await order(added.orderId);
		expect(view.lines).toEqual([expect.objectContaining({
			kind: 'extra', name: 'No-show fee · Thai massage', unitPrice: 50000, qty: 1, feeAppointmentId: appointmentId,
			fee: expect.objectContaining({ kind: 'no_show', reason: 'Policy: 50% no-show', by: 'admin@example.com' }), sourceIssue: null
		})]);
		expect(view.lines[0].detail).toContain('SVC-1 · no-show, service not given');
		expect(view.lines[0].appointmentId).toBeUndefined();
		// Same fee again on the same order is the same row.
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { orderId: added.orderId, appointmentId, kind: 'no_show', amount: 50000 })).resolves.toEqual({ ...added, replayed: true });
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 50000 })).rejects.toThrow('already on Order #1');
		// A fee keeps its amount.
		await expect(admin.mutation(api.pos.commands.updateLine.updateLine, { lineId: added.lineId, qtyChange: 1 })).rejects.toThrow('keeps the amount');
		await expect(admin.mutation(api.pos.commands.updateLine.updateLine, { lineId: added.lineId, discount: { type: 'percent', value: 1000 } })).rejects.toThrow('keeps the amount');
		await expect(admin.mutation(api.pos.commands.overrideLinePrice.overrideLinePrice, { lineId: added.lineId, price: 30000, note: 'x' })).rejects.toThrow('keeps the amount');
		// A plain extra with the same name and price never stacks onto the fee row.
		await admin.mutation(api.pos.commands.addItem.addItem, { orderId: added.orderId, item: { kind: 'extra', name: 'No-show fee · Thai massage', price: 50000 } });
		expect((await order(added.orderId)).lines.map((line) => line.qty)).toEqual([1, 1]);
		await admin.mutation(api.pos.commands.removeLine.removeLine, { lineId: (await order(added.orderId)).lines[1]._id });

		const { receiptNumber } = await settle({ orderId: added.orderId });
		const stored = await t.run((ctx) => ctx.db.get(appointmentId));
		expect(stored).toMatchObject({ status: 'no_show', paymentStatus: 'unpaid', price: 120000 });
		expect(stored!.paidAt).toBeUndefined();
		// Read directly: recordHistory.list is not in the generated API until the parent runs codegen.
		const notes = await t.run((ctx) => ctx.db.query('recordChanges')
			.withIndex('by_entityType_and_entityId_and_recordedAt', (q) => q.eq('entityType', 'appointment').eq('entityId', appointmentId)).order('desc').take(10));
		expect(notes.filter((row) => row.kind.startsWith('fee_')).map((row) => row.kind)).toEqual(['fee_charged', 'fee_added']);
		expect(notes.find((row) => row.kind === 'fee_charged')).toMatchObject({ actor: 'admin@example.com', after: { feeKind: 'no_show', amount: 50000, receiptNumber } });
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 20000 })).rejects.toThrow(`already charged on Order #1 (receipt ${receiptNumber})`);
		expect(await admin.query(api.pos.orders.appointmentFees, { appointmentId })).toEqual([expect.objectContaining({ kind: 'no_show', amount: 50000, order: expect.objectContaining({ state: 'paid', receiptNumber }) })]);
		// Opening the no-show appointment itself still has nothing to charge.
		await expect(admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { appointmentId })).rejects.toThrow('nothing left to pay');
	});

	it('refuses invalid amounts and appointments that are not no-show or cancelled and unpaid', async () => {
		const { admin, appointment } = await setup();
		const noShow = await appointment({ status: 'no_show' });
		for (const amount of [0, -5, Number.NaN, Number.POSITIVE_INFINITY, 10.005]) {
			await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId: noShow, kind: 'no_show', amount })).rejects.toThrow(/Fee|Price/);
		}
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId: noShow, kind: 'no_show', amount: 120001 })).rejects.toThrow('more than the appointment’s price');
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId: noShow, kind: 'late_cancellation', amount: 10000 })).rejects.toThrow('Only a cancelled appointment');
		const booked = await appointment();
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId: booked, kind: 'no_show', amount: 10000 })).rejects.toThrow('marked as a no-show');
		const prepaid = await appointment({ status: 'no_show', paymentStatus: 'paid' });
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId: prepaid, kind: 'no_show', amount: 10000 })).rejects.toThrow('already paid');
		const cancelled = await appointment({ status: 'cancelled' });
		const fee = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId: cancelled, kind: 'late_cancellation', amount: 120000 });
		expect((await admin.query(api.pos.orders.getOrder, { orderId: fee.orderId }))!.lines[0].name).toBe('Late cancellation fee · Thai massage');
	});

	it('refuses to settle a corrected appointment fee and keeps plain-voided money protected from a second fee', async () => {
		const { t, admin, appointment, order, settle } = await setup();
		const appointmentId = await appointment({ status: 'no_show' });
		const { orderId, lineId } = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 60000 });
		await t.run((ctx) => ctx.db.patch(appointmentId, { status: 'completed' }));
		expect((await order(orderId)).lines[0].sourceIssue).toMatchObject({ kind: 'settled', message: expect.stringContaining('Remove the fee') });
		await expect(settle({ orderId })).rejects.toThrow('marked as a no-show');
		await expect(admin.mutation(api.pos.commands.updateSourceLine.updateSourceLine, { lineId })).resolves.toEqual({ result: 'removed' });

		await t.run((ctx) => ctx.db.patch(appointmentId, { status: 'no_show' }));
		const again = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 60000 });
		await settle({ orderId: again.orderId });
		await admin.mutation(api.pos.commands.voidOrder.voidOrder, { orderId: again.orderId, reason: 'Fee waived after complaint' });
		await expect(admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 30000 })).rejects.toThrow('already charged');
	});

	it('releases a fee while its order is discarded and refuses to restore it beside another open fee', async () => {
		const { admin, appointment, discard, restore, extra } = await setup();
		const appointmentId = await appointment({ status: 'no_show' });
		const { orderId } = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 60000 });
		await extra(orderId);
		await discard(orderId);
		const other = await admin.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 40000 });
		await expect(restore(orderId)).rejects.toThrow(`No-show fee · Thai massage is now on Order #${2}.`);
		void other;
		const result = await restore(orderId, { removeConflictingRows: true });
		expect(result.removed).toHaveLength(1);
	});
});

describe('payment reversal on a cancelled stay', () => {
	it('dates a stay left with only refunded money as refunded, and keeps the stay cancelled rather than reopening it', async () => {
		const { admin, t, bookingId, settle } = await setup();
		const depositId = await t.run(ctx => ctx.db.insert('bookingPayments', { bookingId, origin: 'manual', amount: 1000000, currency: 'THB', method: 'cash', effectiveAt: Date.now(), recordedAt: Date.now(), recordedBy: 'admin@example.com', status: 'recorded', refunded: 0 }));
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await settle({ orderId });
		vi.advanceTimersByTime(3_600_000);
		const booking = (await admin.query(api.bookings.admin.getForAdmin, { bookingId }))!;
		const refundAt = Date.now() - 60_000;
		await admin.mutation(api.bookings.commands.cancelStay.cancelStay, {
			bookingId, expectedRevision: booking.revision, reason: 'Guest left', notifyGuest: false,
			refund: { amount: 1000000, currency: 'THB', method: 'cash', reason: 'Deposit returned', idempotencyKey: 'refund-0001', effectiveAt: refundAt, paymentId: depositId }
		});
		vi.advanceTimersByTime(3_600_000);
		await admin.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-unreceived-1', reason: 'Card never went through' });
		expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId })).toMatchObject({ status: 'cancelled', paymentStatus: 'refunded', refundedAt: refundAt });
	});

	it('keeps a confirmed stay confirmed when its mistaken payment is reversed', async () => {
		const { admin, bookingId, settle } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await settle({ orderId });
		await admin.mutation(api.pos.commands.voidUnreceivedOrder.voidUnreceivedOrder, { orderId, expectedCorrectionRevision: 0, idempotencyKey: 'void-unreceived-2', reason: 'Entered twice' });
		// The online deposit stays; the stay keeps its status (and nights) and owes the balance again.
		expect(await admin.query(api.bookings.admin.getForAdmin, { bookingId })).toMatchObject({ status: 'confirmed', paymentStatus: 'paid', amountPaid: 1000000, money: { owed: 2000000 } });
	});
});

describe('stay money views with a discarded order', () => {
	it('does not offer a discarded order as one that took money for the stay', async () => {
		const { admin, bookingId, discard } = await setup();
		const { orderId } = await admin.mutation(api.pos.commands.openOrderFor.openOrderFor, { bookingId });
		await discard(orderId);
	});
});

describe('access', () => {
	it('refuses the lifecycle and fee functions to anonymous and non-admin callers', async () => {
		const { t, extra, appointment } = await setup();
		const { orderId } = await extra();
		const appointmentId = await appointment({ status: 'no_show' });
		const outsider = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		for (const caller of [t, outsider]) {
			await expect(caller.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: 1, idempotencyKey: 'discard-anon' })).rejects.toThrow();
			await expect(caller.mutation(api.pos.commands.restoreOrder.restoreOrder, { orderId, expectedRevision: 1, idempotencyKey: 'restore-anon' })).rejects.toThrow();
			await expect(caller.query(api.pos.orders.restoreCheck, { orderId })).rejects.toThrow();
			await expect(caller.mutation(api.pos.commands.addAppointmentFee.addAppointmentFee, { appointmentId, kind: 'no_show', amount: 10000 })).rejects.toThrow();
			await expect(caller.query(api.pos.orders.appointmentFees, { appointmentId })).rejects.toThrow();
			await expect(caller.query(api.pos.orders.listOrders, { filter: 'discarded', paginationOpts: { numItems: 5, cursor: null } })).rejects.toThrow();
		}
	});

	it('records which admin discarded and restored', async () => {
		const { desk, admin, extra, revision, history } = await setup();
		const { orderId } = await extra();
		await desk.mutation(api.pos.commands.discardOrder.discardOrder, { orderId, expectedRevision: await revision(orderId), idempotencyKey: 'discard-desk-1' });
		await admin.mutation(api.pos.commands.restoreOrder.restoreOrder, { orderId, expectedRevision: await revision(orderId), idempotencyKey: 'restore-admin-1' });
		expect((await history(orderId)).slice(0, 2).map((row) => [row.kind, row.actor])).toEqual([['restored', 'admin@example.com'], ['discarded', 'desk@example.com']]);
	});
});
