import { insertFixture } from './testing/completeFixture.test-support';
// @vitest-environment edge-runtime
// Regressions for the audit fixes: appointment contact lookup, legacy balances and frozen
// therapist names.

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { localDateTimeUtc } from './lib/serviceSlots';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const hours = { workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })), breaks: [] };
	const nok = await admin.mutation(api.adminServices.createStaff, { name: 'Nok', role: 'Therapist', color: '#abc', ...hours });
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Massage',
		durationMin: 60, bufferMin: 0, price: 120000, currency: 'THB', staffIds: [nok]
	});
	let hour = 9;
	/** An appointment made in the admin calendar (the real creation path). */
	const book = async (guest: { guestName: string; guestPhone: string; guestEmail?: string }) => {
		const start = localDateTimeUtc('2026-10-03', `${String(hour++).padStart(2, '0')}:00`);
		return (await admin.mutation(api.adminServices.createAppointment, { serviceId, start, staffId: nok, ...guest })).appointmentId;
	};
	/** An appointment as rows were stored before the lookup fields existed. */
	const legacy = (fields: Partial<Doc<'appointments'>> = {}) => t.run((ctx) => insertFixture(ctx, 'appointments', {
		serviceId, staffId: nok, start: 1, end: 2, blockedUntil: 2, guestName: 'Legacy guest', guestPhone: '+66 (89) 555-0101', guestEmail: 'Legacy.Guest@Example.com',
		source: 'admin', status: 'booked', paymentStatus: 'unpaid', price: 120000, currency: 'THB', confirmationCode: `SVC-L${Math.random()}`, accessToken: 'tok', createdAt: 1,
		...fields
	}));
	const found = async (args: { orderId?: Id<'orders'>; query?: string }) => (await admin.query(api.pos.listAttachable, args)).map((row) => row.id);
	const row = (id: Id<'appointments'>) => t.run((ctx) => ctx.db.get(id));
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
		const paid: Id<'appointments'>[] = [];
		for (let i = 0; i < 30; i++) paid.push(await legacy({ ...lookup, guestPhone: '0812345678', paymentStatus: 'paid', createdAt: 10 + i }));
		expect((await row(unpaid))?.guestPhoneDigits).toBe('0812345678');
		const ids = await found({ query: '081 234 5678' });
		expect(ids).toContain(unpaid);
		expect(ids.filter((id) => paid.includes(id as Id<'appointments'>))).toEqual([]);
	});

	it('keeps the lookup status admin-only', async () => {
		const { t } = await setup();
		await expect(t.query(api.pos.attachLookupStatus, {})).rejects.toThrow();
		await expect(t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' }).query(api.pos.attachLookupStatus, {})).rejects.toThrow();
	});
});
