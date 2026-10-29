// @vitest-environment edge-runtime
// Regressions for the audit fixes: appointment contact lookup, legacy balances and frozen
// therapist names (tmp/pos-order-implementation/kiro-audit-fixes-report.md).

import migrationsTest from '@convex-dev/migrations/test';
import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, components, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { localDateTimeUtc } from './lib/serviceSlots';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const page = { numItems: 50, cursor: null };

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	migrationsTest.register(t);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const hours = { workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] };
	const nok = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', ...hours });
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Massage',
		durationMin: 60, bufferMin: 0, price: 1200, currency: 'THB', staffIds: [nok]
	});
	let hour = 9;
	/** An appointment made in the admin calendar (the real creation path). */
	const book = async (guest: { guestName: string; guestPhone: string; guestEmail?: string }) => {
		const start = localDateTimeUtc('2026-10-03', `${String(hour++).padStart(2, '0')}:00`);
		return (await admin.mutation(api.adminServices.createAppointment, { serviceId, start, staffId: nok, ...guest })).appointmentId;
	};
	/** An appointment as rows were stored before the lookup fields existed. */
	const legacy = (fields: Partial<Doc<'serviceAppointments'>> = {}) => t.run((ctx) => ctx.db.insert('serviceAppointments', {
		serviceId, staffId: nok, start: 1, end: 2, blockedUntil: 2, guestName: 'Legacy guest', guestPhone: '+66 (89) 555-0101', guestEmail: 'Legacy.Guest@Example.com',
		source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: `SVC-L${Math.random()}`, accessToken: 'tok', createdAt: 1,
		...fields
	}));
	const found = async (args: { orderId?: Id<'bills'>; query?: string }) => (await admin.query(api.pos.listAttachable, args)).map((row) => row.id);
	const row = (id: Id<'serviceAppointments'>) => t.run((ctx) => ctx.db.get(id));
	return { t, admin, nok, serviceId, book, legacy, found, row };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-10-02T03:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('Add booking finds standalone appointments by contact', () => {
	it('stores lookup forms at creation and finds the appointment by any-case email and differently formatted phone', async () => {
		const { book, found, row } = await setup();
		const id = await book({ guestName: 'Mia', guestPhone: '+66 81-222 3333', guestEmail: ' Mia.Guest@Example.COM ' });
		expect(await row(id)).toMatchObject({ guestPhoneDigits: '66812223333', guestEmailNormalized: 'mia.guest@example.com', guestPhone: '+66 81-222 3333', guestEmail: 'Mia.Guest@Example.COM' });
		expect(await found({ query: 'MIA.GUEST@example.com' })).toContain(id);
		expect(await found({ query: '66812223333' })).toContain(id);
		expect(await found({ query: '+66 (81) 222-3333' })).toContain(id);
		expect(await found({ query: 'nobody@example.com' })).not.toContain(id);
	});

	it('follows guest edits: a new phone and email are found, the old ones and a removed email are not', async () => {
		const { admin, book, found, row } = await setup();
		const id = await book({ guestName: 'Mia', guestPhone: '0811111111', guestEmail: 'old@example.com' });
		const revision = (await row(id))?.revision ?? 0;
		await admin.mutation(api.adminServices.updateAppointmentDetails, { appointmentId: id, expectedRevision: revision, guestName: 'Mia', guestPhone: '+66 82 999 0000', guestEmail: 'New@Example.com' });
		expect(await found({ query: 'new@example.com' })).toContain(id);
		expect(await found({ query: '66829990000' })).toContain(id);
		expect(await found({ query: 'old@example.com' })).not.toContain(id);
		expect(await found({ query: '0811111111' })).not.toContain(id);
		await admin.mutation(api.adminServices.updateAppointmentDetails, { appointmentId: id, expectedRevision: revision + 1, guestName: 'Mia', guestPhone: '+66 82 999 0000' });
		expect((await row(id))?.guestEmailNormalized).toBeUndefined();
		expect(await found({ query: 'new@example.com' })).not.toContain(id);
	});

	it("suggests the linked payer's appointments by phone digits and email, and leaves guest and payer details as they were", async () => {
		const { admin, book, found, row } = await setup();
		const byPhone = await book({ guestName: 'Guest one', guestPhone: '+66 81 444 5555' });
		const byEmail = await book({ guestName: 'Guest two', guestPhone: '0899999999', guestEmail: 'Payer@Example.com' });
		const other = await book({ guestName: 'Someone else', guestPhone: '0800000001' });
		const customerId = await admin.mutation(api.customers.createCustomer, { name: 'Payer', phone: '081-444-5555', email: 'payer@example.com' });
		// Different formatting (no country code is not the same number), so only the email matches here.
		const { orderId } = await admin.mutation(api.pos.linkCustomer, { customerId });
		expect(await found({ orderId })).toEqual(expect.arrayContaining([byEmail]));
		expect(await found({ orderId })).not.toContain(other);
		await admin.mutation(api.customers.updateCustomer, { customerId, name: 'Payer', phone: '+66 81 444 5555', email: 'payer@example.com' });
		expect(await found({ orderId })).toEqual(expect.arrayContaining([byPhone, byEmail]));
		// Suggesting is read-only: nothing is attached, merged or copied.
		expect((await admin.query(api.pos.getOrder, { orderId }))?.lines).toHaveLength(0);
		expect(await row(byPhone)).toMatchObject({ guestName: 'Guest one', guestPhone: '+66 81 444 5555' });
		expect((await admin.query(api.customers.getCustomer, { customerId }))?.name).toBe('Payer');
	});

	it('finds an unpaid appointment behind many paid ones for the same phone, and never offers paid ones', async () => {
		const { book, legacy, found, row } = await setup();
		const unpaid = await book({ guestName: 'Regular', guestPhone: '0812345678' });
		const lookup = { guestPhoneDigits: '0812345678' };
		const paid: Id<'serviceAppointments'>[] = [];
		for (let i = 0; i < 30; i++) paid.push(await legacy({ ...lookup, guestPhone: '0812345678', paymentStatus: 'paid', createdAt: 10 + i }));
		expect((await row(unpaid))?.guestPhoneDigits).toBe('0812345678');
		const ids = await found({ query: '081 234 5678' });
		expect(ids).toContain(unpaid);
		expect(ids.filter((id) => paid.includes(id as Id<'serviceAppointments'>))).toEqual([]);
	});

	it('finds appointments saved before the lookup fields, then backfills them (dry run first, idempotent rerun)', async () => {
		const { t, admin, legacy, found, row } = await setup();
		const old = await legacy();
		const paidOld = await legacy({ paymentStatus: 'paid', guestEmail: 'paid@example.com' });
		expect((await row(old))?.guestPhoneDigits).toBeUndefined();
		// During the rollout, before its migration.
		expect(await found({ query: 'legacy.guest@example.com' })).toContain(old);
		expect(await found({ query: '66895550101' })).toContain(old);
		expect(await admin.query(api.pos.attachLookupStatus, {})).toEqual({ complete: true });

		const before = await t.run((ctx) => ctx.db.query('serviceAppointments').collect());
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillAppointmentGuestLookup', dryRun: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await t.run((ctx) => ctx.db.query('serviceAppointments').collect())).toEqual(before);

		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillAppointmentGuestLookup' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const [status] = await t.query(components.migrations.lib.getStatus, { names: ['migrations:backfillAppointmentGuestLookup'] });
		expect(status).toMatchObject({ state: 'success' });
		expect(await row(old)).toMatchObject({ guestPhoneDigits: '66895550101', guestEmailNormalized: 'legacy.guest@example.com', guestPhone: '+66 (89) 555-0101', guestEmail: 'Legacy.Guest@Example.com', guestName: 'Legacy guest' });
		expect(await row(paidOld)).toMatchObject({ guestEmailNormalized: 'paid@example.com', paymentStatus: 'paid' });
		expect(await found({ query: 'LEGACY.guest@example.com' })).toContain(old);

		const after = await t.run((ctx) => ctx.db.query('serviceAppointments').collect());
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillAppointmentGuestLookup', reset: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await t.run((ctx) => ctx.db.query('serviceAppointments').collect())).toEqual(after);
	});

	it('says when older appointments exceed what search can check directly, instead of reporting no match', async () => {
		const { t, admin, serviceId, nok } = await setup();
		await t.run(async (ctx) => {
			for (let i = 0; i < 501; i++) {
				await ctx.db.insert('serviceAppointments', {
					serviceId, staffId: nok, start: 1, end: 2, blockedUntil: 2, guestName: `Old ${i}`, guestPhone: `0800${String(i).padStart(6, '0')}`,
					source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 1200, currency: 'THB', confirmationCode: `SVC-OLD-${i}`, accessToken: 'tok', createdAt: 1
				});
			}
		});
		expect(await admin.query(api.pos.attachLookupStatus, {})).toEqual({ complete: false });
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillAppointmentGuestLookup' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await admin.query(api.pos.attachLookupStatus, {})).toEqual({ complete: true });
	});

	it('keeps the lookup status admin-only', async () => {
		const { t } = await setup();
		await expect(t.query(api.pos.attachLookupStatus, {})).rejects.toThrow();
		await expect(t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' }).query(api.pos.attachLookupStatus, {})).rejects.toThrow();
	});
});

describe('legacy balances before the order backfill', () => {
	it("shows a booking's legacy deposited order with what is still owed on its detail sheet", async () => {
		const { t, admin } = await setup();
		const { bookingId, orderId } = await t.run(async (ctx) => {
			const propertyId = await ctx.db.insert('properties', {
				slug: 'villa', name: 'Pool Villa', tagline: '', description: '', pricePerNight: 10000, currency: 'THB', maxGuests: 4,
				bedrooms: 2, bathrooms: 2, area: 100, images: [], amenities: [], tourRoomIds: [], directDiscountPercent: 0, status: 'active'
			});
			const bookingId = await ctx.db.insert('bookings', {
				propertyId, guestName: 'Anna', guestPhone: '0800000000', checkIn: '2026-10-01', checkOut: '2026-10-04', guests: 2, nights: 3,
				subtotal: 30000, discountAmount: 0, total: 30000, currency: 'THB', amountPaid: 10000, paymentStatus: 'pending', status: 'confirmed', createdAt: 1
			});
			// Held, no `due` and no order number: as the walk-in checkout wrote it.
			const orderId = await ctx.db.insert('bills', { status: 'held', currency: 'THB', createdBy: 'legacy', itemCount: 2, total: 30100, hasItems: true, revision: 1, createdAt: 1, updatedAt: 1 });
			await ctx.db.insert('billLines', { billId: orderId, kind: 'booking', bookingId, name: 'Stay', unitPrice: 30000, deposit: 10000, currency: 'THB', qty: 1, createdAt: 1 });
			await ctx.db.insert('billLines', { billId: orderId, kind: 'extra', name: 'Water', unitPrice: 100, currency: 'THB', qty: 1, createdAt: 2 });
			return { bookingId, orderId };
		});
		const sheet = await admin.query(api.pos.ordersForBooking, { bookingId });
		expect(sheet?.activeOrder).toMatchObject({ _id: orderId, due: 20100 });
		expect(sheet?.orders.find((order) => order._id === orderId)?.due).toBe(20100);
		const rows = await admin.query(api.pos.listOrders, { filter: 'unpaid', paginationOpts: page });
		expect(rows.page.find((row) => row._id === orderId)).toMatchObject({ total: 30100, due: 20100 });
		// Read only: the stored row is not rewritten by listing it.
		expect((await t.run((ctx) => ctx.db.get(orderId)))?.due).toBeUndefined();
	});
});

describe('frozen therapist names on legacy receipts', () => {
	async function legacyReceipts() {
		const s = await setup();
		const gone = await s.t.run((ctx) => ctx.db.insert('staff', { name: 'Departed', role: 'Therapist', color: '#000', workingHours: [], breaks: [], status: 'active', createdAt: 1, updatedAt: 1 }));
		const ids = await s.t.run(async (ctx) => {
			const bill = (fields: Partial<Doc<'bills'>>) => ctx.db.insert('bills', { status: 'paid', currency: 'THB', createdBy: 'legacy', itemCount: 1, total: 1200, hasItems: true, revision: 1, createdAt: 1, updatedAt: 1, ...fields });
			const line = (billId: Id<'bills'>, fields: Partial<Doc<'billLines'>>) =>
				ctx.db.insert('billLines', { billId, kind: 'service', serviceId: s.serviceId, name: 'Thai massage', unitPrice: 1200, currency: 'THB', qty: 1, createdAt: 1, ...fields });
			const paid = await bill({ receiptNumber: 1, paidAt: 1 });
			const paidLine = await line(paid, { staffId: s.nok, discount: { type: 'amount', value: 100 } });
			const anyStaff = await line(paid, { name: 'Any therapist' });
			const voided = await bill({ status: 'void', receiptNumber: 2, voidReason: 'QA' });
			const goneLine = await line(voided, { staffId: gone });
			// Paid after the deploy: numbered, and its name frozen at payment.
			await ctx.db.insert('billCounters', { key: 'order', value: 1 });
			const frozen = await bill({ receiptNumber: 3, orderNumber: 1, due: 0 });
			const frozenLine = await line(frozen, { staffId: s.nok, staffName: 'Name at payment' });
			const open = await bill({ status: 'held' });
			const openLine = await line(open, { staffId: s.nok });
			await ctx.db.insert('billPayments', { billId: paid, method: 'cash', amount: 1100, idempotencyKey: 'k', createdBy: 'legacy', createdAt: 1 });
			await ctx.db.insert('billAudit', { billId: paid, at: 1, actor: 'legacy', kind: 'paid', toPrice: 1100 });
			await ctx.db.delete(gone);
			return { paid, paidLine, anyStaff, voided, goneLine, frozen, frozenLine, open, openLine };
		});
		const lines = () => s.t.run((ctx) => ctx.db.query('billLines').collect());
		const rest = () => s.t.run(async (ctx) => ({ payments: await ctx.db.query('billPayments').collect(), audit: await ctx.db.query('billAudit').collect() }));
		return { ...s, ids, lines, rest };
	}

	it('previews the names, rolls them back on a dry run, then freezes only those, additively and idempotently', async () => {
		const { t, admin, nok, ids, lines, rest } = await legacyReceipts();
		const preview = await t.query(internal.migrations.previewOrderBackfill, { paginationOpts: page });
		expect(preview.proposed.find((row) => row.orderId === ids.paid)?.lineStaffNames).toEqual([{ lineId: ids.paidLine, staffName: 'Nok' }]);
		expect(preview.proposed.find((row) => row.orderId === ids.voided)?.notes.join(' ')).toContain('no longer exists');
		expect(preview.proposed.find((row) => row.orderId === ids.frozen)?.lineStaffNames ?? []).toEqual([]);
		expect(preview.proposed.find((row) => row.orderId === ids.open)?.lineStaffNames).toEqual([]);
		expect((await t.query(internal.migrations.verifyOrderBackfill, { paginationOpts: page })).problems).toContainEqual({ orderId: ids.paid, problem: '1 paid therapist row(s) without a frozen name' });

		const beforeLines = await lines();
		const beforeRest = await rest();
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders', dryRun: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await lines()).toEqual(beforeLines);

		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders' });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		const afterLines = await lines();
		for (const before of beforeLines) {
			const after = afterLines.find((line) => line._id === before._id)!;
			if (before._id === ids.paidLine) {
				// Only the two snapshot fields are added; price, discount, quantity, ids are as they were.
				const { staffName, staffNameBackfilledAt, ...unchanged } = after;
				expect(unchanged).toEqual(before);
				expect(staffName).toBe('Nok');
				expect(staffNameBackfilledAt).toBe(Date.now());
			} else {
				expect(after).toEqual(before);
			}
		}
		expect(await rest()).toEqual(beforeRest);
		const verify = await t.query(internal.migrations.verifyOrderBackfill, { paginationOpts: page });
		expect(verify).toMatchObject({ problems: [], therapistUnknown: 1, staffNamesBackfilled: 1 });

		// A later rename leaves issued receipts alone; the open order shows the current name.
		await admin.mutation(api.adminServices.updateStaff, { staffId: nok, name: 'Nok Renamed' });
		expect((await admin.query(api.pos.getOrder, { orderId: ids.paid }))?.lines.find((line) => line._id === ids.paidLine)?.staffName).toBe('Nok');
		expect((await admin.query(api.pos.getOrder, { orderId: ids.frozen }))?.lines[0].staffName).toBe('Name at payment');
		expect((await admin.query(api.pos.getOrder, { orderId: ids.voided }))?.lines[0].staffName).toBe('Former staff member');
		expect((await admin.query(api.pos.getOrder, { orderId: ids.open }))?.lines[0].staffName).toBe('Nok Renamed');

		// Rerunning from the start changes nothing, even after the rename.
		await t.mutation(internal.migrations.run, { fn: 'migrations:backfillOrders', reset: true });
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await lines()).toEqual(afterLines);
	});
});
