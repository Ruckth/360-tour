// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { STALE_APPOINTMENT } from './lib/appointmentChanges';
import { addDays, localDateTimeUtc } from './lib/serviceSlots';
import { STALE_ROSTER } from './roster';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const date = '2026-09-25'; // a Friday
const at = (time: string, day = date) => localDateTimeUtc(day, time);
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const lunch = { start: '12:00', end: '13:00', label: 'Lunch' };
const tea = { start: '15:00', end: '15:15', label: 'Tea' };
const patternPlan = { shifts: [{ start: '09:00', end: '18:00' }], breaks: [lunch, tea] };

async function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const person = (name: string) => admin.mutation(api.adminServices.createStaff, {
		name, role: 'Therapist', color: '#abc',
		workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '18:00' })),
		breaks: weekdays.flatMap((weekday) => [{ weekday, ...lunch }, { weekday, ...tea }])
	});
	const maliId = await person('Mali');
	const nokId = await person('Nok');
	const pimId = await person('Pim'); // not qualified
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Wellness',
		durationMin: 60, bufferMin: 15, price: 2000, currency: 'THB', staffIds: [maliId, nokId]
	});
	const book = async (time: string, staffId: Id<'staff'> = maliId, day = date) => (await admin.mutation(api.adminServices.createAppointment, {
		serviceId, staffId, start: at(time, day), guestName: 'Ann', guestPhone: '+66111'
	})).appointmentId;
	const get = async (id: Id<'serviceAppointments'>) => (await t.run((ctx) => ctx.db.get(id)))!;
	const history = (appointmentId: Id<'serviceAppointments'>) => admin.query(api.adminServices.listAppointmentHistory, { appointmentId });
	return { t, admin, maliId, nokId, pimId, serviceId, book, get, history };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('appointment changes', () => {
	it('cancels while keeping the record and payment state, frees the slot and records who and why', async () => {
		const { admin, serviceId, maliId, book, get, history } = await setup();
		const id = await book('10:00');
		await admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId: id });
		await expect(admin.mutation(api.adminServices.cancelAppointment, { appointmentId: id, expectedRevision: 0 })).rejects.toThrow(STALE_APPOINTMENT);
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: id, expectedRevision: 1, reason: '  Guest unwell ' });
		expect(await get(id)).toMatchObject({
			status: 'cancelled', paymentStatus: 'paid', price: 2000, start: at('10:00'), staffId: maliId,
			cancelledAt: Date.now(), cancelledBy: 'admin@example.com', cancellationReason: 'Guest unwell', revision: 2
		});
		const slots = await admin.query(api.adminServices.findOpenSlots, { serviceId, date, staffId: maliId });
		expect(slots.some((slot) => slot.start === at('10:00'))).toBe(true);
		expect(await history(id)).toMatchObject([
			{ kind: 'cancelled', actor: 'admin@example.com', reason: 'Guest unwell', changes: [{ field: 'status', from: 'booked', to: 'cancelled' }] },
			{ kind: 'payment', changes: [{ field: 'paymentStatus', from: 'unpaid', to: 'paid' }] }
		]);
		// Still listed, so the calendar can show it on request.
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('00:00'), to: at('23:59') });
		expect(schedule.appointments.map((a) => a._id)).toContain(id);
	});

	it('shows cleanup that overlaps the next date even after the service is completed', async () => {
		const { admin, maliId, book } = await setup();
		const nextDate = addDays(date, 1);
		await admin.mutation(api.roster.applyCells, { cells: [{ staffId: maliId, date }], shifts: [{ start: '23:00', end: '24:00' }], breaks: [] });
		await admin.mutation(api.roster.applyCells, { cells: [{ staffId: maliId, date: nextDate }], shifts: [{ start: '00:00', end: '01:00' }], breaks: [] });
		const id = await book('23:00');
		const range = { from: at('00:00', nextDate), to: at('00:00', addDays(nextDate, 1)), staffIds: [maliId] };
		for (const status of ['booked', 'completed'] as const) {
			if (status === 'completed') await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: id, status });
			const schedule = await admin.query(api.adminServices.listSchedule, range);
			expect(schedule.appointments).toMatchObject([{ _id: id, end: range.from, blockedUntil: range.from + 15 * 60_000 }]);
		}
		// Cleanup ending exactly at the range boundary has no occupancy in that range.
		expect((await admin.query(api.adminServices.listSchedule, { ...range, from: range.from + 15 * 60_000 })).appointments).toEqual([]);
	});

	it('books a cancelled or no-show appointment again without touching the original', async () => {
		const { admin, serviceId, maliId, book, get, history } = await setup();
		const id = await book('10:00');
		await expect(admin.mutation(api.adminServices.createAppointment, {
			serviceId, staffId: maliId, start: at('14:00'), guestName: 'Ann', guestPhone: '+66111', rebookedFromId: id
		})).rejects.toThrow('Only cancelled or no-show');
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: id, expectedRevision: 0 });
		const before = await get(id);
		const again = await admin.mutation(api.adminServices.createAppointment, {
			serviceId, staffId: maliId, start: at('13:30'), guestName: 'Ann', guestPhone: '+66111', rebookedFromId: id
		});
		expect(await get(again.appointmentId)).toMatchObject({ status: 'booked', rebookedFromId: id, start: at('13:30') });
		expect(await get(id)).toEqual(before);
		expect((await history(id))[0]).toMatchObject({ kind: 'rebooked', changes: [{ field: 'rebookedAs', to: again.confirmationCode }] });
	});

	it('reschedules to another time and qualified staff, keeping length, turnaround and price', async () => {
		const { admin, maliId, nokId, pimId, serviceId, book, get, history } = await setup();
		const id = await book('10:00');
		// A later change to the service template doesn't alter this booking's turnaround when it moves.
		await admin.mutation(api.adminServices.updateService, { serviceId, bufferMin: 45, price: 2500 });
		await admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId: id, expectedRevision: 0, start: at('13:30'), staffId: nokId });
		expect(await get(id)).toMatchObject({ start: at('13:30'), end: at('14:30'), blockedUntil: at('14:45'), staffId: nokId, price: 2000, status: 'booked', revision: 1 });
		expect((await history(id))[0]).toMatchObject({
			kind: 'rescheduled', actor: 'admin@example.com',
			changes: expect.arrayContaining([
				{ field: 'staffId', from: maliId, to: nokId },
				{ field: 'start', from: at('10:00'), to: at('13:30') },
				{ field: 'blockedUntil', from: at('11:15'), to: at('14:45') }
			])
		});
		const move = { appointmentId: id, expectedRevision: 1 };
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { ...move, start: at('13:30'), staffId: nokId })).rejects.toThrow('Nothing to change');
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { ...move, start: at('16:00'), staffId: pimId })).rejects.toThrow("Pim doesn't perform");
		// Tea break at 15:00 is inside 14:15–15:30.
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { ...move, start: at('14:15'), staffId: nokId })).rejects.toThrow('That time was just taken');
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { ...move, expectedRevision: 0, start: at('16:00'), staffId: nokId })).rejects.toThrow(STALE_APPOINTMENT);
		expect(await get(id)).toMatchObject({ start: at('13:30'), staffId: nokId, revision: 1 });
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: id, status: 'arrived' });
		await expect(admin.mutation(api.adminServices.rescheduleAppointment, { ...move, expectedRevision: 2, start: at('16:00'), staffId: nokId })).rejects.toThrow('cannot be rescheduled');
	});

	it('offers reschedule times that fit the booked length and ignore the appointment itself', async () => {
		const { admin, maliId, nokId, book } = await setup();
		const id = await book('10:00');
		await book('13:30', nokId);
		const { staff, slots } = await admin.query(api.adminServices.rescheduleOptions, { appointmentId: id, date });
		expect(staff.map((s) => s.name)).toEqual(['Mali', 'Nok']);
		const who = (time: string) => slots.find((slot) => slot.start === at(time))?.staffIds ?? [];
		expect(who('10:00')).toEqual([maliId, nokId]); // its own time stays open
		expect(who('11:00')).toEqual([]); // 11:00–12:15 runs into lunch
		expect(who('13:45')).toEqual([maliId]); // Nok is booked 13:30–14:45
	});

	it('changes one appointment turnaround with conflict checks, and later moves keep it', async () => {
		const { admin, serviceId, book, get, history } = await setup();
		const id = await book('09:00');
		await book('10:30');
		const turnaround = (turnaroundMin: number, expectedRevision: number) =>
			admin.mutation(api.adminServices.updateAppointmentTurnaround, { appointmentId: id, expectedRevision, turnaroundMin });
		await expect(turnaround(7, 0)).rejects.toThrow('multiple of 5');
		await expect(turnaround(15, 0)).rejects.toThrow('Nothing to change');
		await expect(turnaround(45, 0)).rejects.toThrow("Mali isn't free"); // next booking at 10:30
		await turnaround(30, 0);
		expect(await get(id)).toMatchObject({ end: at('10:00'), blockedUntil: at('10:30') });
		await expect(turnaround(5, 0)).rejects.toThrow(STALE_APPOINTMENT);
		await turnaround(20, 1);
		expect((await history(id))[0]).toMatchObject({ kind: 'turnaround', changes: [{ field: 'blockedUntil', from: at('10:30'), to: at('10:20') }] });
		// The service default doesn't change existing bookings, and a move keeps the 20 minutes.
		await admin.mutation(api.adminServices.updateService, { serviceId, bufferMin: 0 });
		expect(await get(id)).toMatchObject({ blockedUntil: at('10:20') });
		await admin.mutation(api.adminServices.rescheduleAppointment, { appointmentId: id, expectedRevision: 2, start: at('16:00'), staffId: (await get(id)).staffId });
		expect(await get(id)).toMatchObject({ end: at('17:00'), blockedUntil: at('17:20') });
		// Into the end of the shift.
		await expect(turnaround(65, 3)).rejects.toThrow("Mali isn't free");
	});

	it('saves guest details and a service change together, or neither', async () => {
		const { admin, maliId, book, get } = await setup();
		const facialId = await admin.mutation(api.adminServices.createService, {
			slug: 'facial', name: 'Facial', description: '', category: 'Wellness', durationMin: 90, bufferMin: 0, price: 3000, currency: 'THB', staffIds: [maliId]
		});
		const id = await book('09:00');
		const before = await get(id);
		const edit = { appointmentId: id, expectedRevision: 0, guestName: 'Bea', guestPhone: '+66222', serviceId: facialId };
		await expect(admin.mutation(api.adminServices.updateAppointmentDetails, { ...edit, guestEmail: 'not-an-email' })).rejects.toThrow();
		expect(await get(id)).toEqual(before);
		// A clashing service leaves the guest details unsaved too.
		await book('10:15');
		await expect(admin.mutation(api.adminServices.updateAppointmentDetails, edit)).rejects.toThrow("Mali isn't free");
		expect(await get(id)).toEqual(before);
		await admin.mutation(api.adminServices.updateAppointmentDetails, { ...edit, serviceId: undefined, notes: 'Quiet room' });
		expect(await get(id)).toMatchObject({ guestName: 'Bea', guestPhone: '+66222', notes: 'Quiet room', serviceId: before.serviceId, revision: 1 });
	});

	it('keeps price currency snapshots and rejects changed service terms before saving', async () => {
		const { admin, maliId, book, get, history } = await setup();
		const id = await book('09:00');
		const serviceId = await admin.mutation(api.adminServices.createService, {
			slug: 'facial-usd', name: 'Facial', description: '', category: 'Wellness', durationMin: 45, bufferMin: 5, price: 60, currency: 'USD', staffIds: [maliId]
		});
		const expectedService = { durationMin: 45, bufferMin: 5, price: 60, currency: 'USD' };
		const edit = { appointmentId: id, expectedRevision: 0, guestName: 'Ann', guestPhone: '+66111', serviceId, expectedService };
		await admin.mutation(api.adminServices.updateService, { serviceId, price: 70 });
		await expect(admin.mutation(api.adminServices.updateAppointmentDetails, edit)).rejects.toThrow('service changed');
		expect(await get(id)).toMatchObject({ price: 2000, currency: 'THB' });
		await admin.mutation(api.adminServices.updateAppointmentDetails, { ...edit, expectedService: { ...expectedService, price: 70 } });
		expect((await history(id))[0]).toMatchObject({ currencyBefore: 'THB', currencyAfter: 'USD', changes: expect.arrayContaining([{ field: 'price', from: 2000, to: 70 }]) });
		await admin.mutation(api.adminServices.markAppointmentPaid, { appointmentId: id });
		expect((await history(id))[0]).toMatchObject({ currencyBefore: 'USD', currencyAfter: 'USD' });
	});

	it('refuses time off edited by a colleague after its confirmation was prepared', async () => {
		const { admin, maliId } = await setup();
		const timeOffId = (await admin.mutation(api.adminServices.addTimeOff, { staffId: maliId, start: at('09:00'), end: at('10:00'), label: 'Doctor' }))[0].timeOffId!;
		const expected = { start: at('09:00'), end: at('10:00'), label: 'Doctor' };
		await admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('09:00'), end: at('11:00'), label: 'Doctor', expected });
		await expect(admin.mutation(api.adminServices.updateTimeOff, { timeOffId, start: at('16:00'), end: at('17:00'), label: 'Leave', expected })).rejects.toThrow('changed since you opened');
		expect(await admin.query(api.adminServices.listTimeOff, { staffId: maliId })).toMatchObject([{ start: at('09:00'), end: at('11:00'), label: 'Doctor' }]);
	});

	it('requires an admin for every new appointment change', async () => {
		const { t, maliId, book } = await setup();
		const id = await book('10:00');
		const stranger = t.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other' });
		for (const caller of [t, stranger]) {
			const reason = caller === t ? 'Not authenticated' : 'Not authorized';
			await expect(caller.mutation(api.adminServices.rescheduleAppointment, { appointmentId: id, expectedRevision: 0, start: at('14:00'), staffId: maliId })).rejects.toThrow(reason);
			await expect(caller.mutation(api.adminServices.updateAppointmentTurnaround, { appointmentId: id, expectedRevision: 0, turnaroundMin: 30 })).rejects.toThrow(reason);
			await expect(caller.mutation(api.adminServices.cancelAppointment, { appointmentId: id, expectedRevision: 0 })).rejects.toThrow(reason);
			await expect(caller.query(api.adminServices.rescheduleOptions, { appointmentId: id, date })).rejects.toThrow(reason);
			await expect(caller.query(api.adminServices.listAppointmentHistory, { appointmentId: id })).rejects.toThrow(reason);
			const change = { staffId: maliId, date, scope: 'day' as const, original: lunch, next: null, expectedPlan: patternPlan };
			await expect(caller.query(api.roster.previewBreakChange, change)).rejects.toThrow(reason);
			await expect(caller.mutation(api.roster.editBreak, change)).rejects.toThrow(reason);
		}
	});
});

describe('calendar break edits', () => {
	const change = (staffId: Id<'staff'>, extra: Partial<{ scope: 'day' | 'weekly'; date: string; next: typeof lunch | null; expectedPlan: typeof patternPlan; original: typeof lunch }> = {}) => ({
		staffId, date, scope: 'day' as const, original: lunch, next: { ...lunch, start: '12:30', end: '13:30' }, expectedPlan: patternPlan, ...extra
	});
	const planOn = async (admin: Awaited<ReturnType<typeof setup>>['admin'], staffId: Id<'staff'>, day: string) => {
		const schedule = await admin.query(api.adminServices.listSchedule, { from: at('00:00', day), to: at('00:00', addDays(day, 1)), staffIds: [staffId] });
		return schedule.blocks.find((block) => block.kind === 'break')?.plan;
	};

	it('moves one break on this day only, keeping the other shifts, breaks, notes and dates', async () => {
		const { t, admin, maliId, nokId } = await setup();
		const split = { shifts: [{ start: '08:00', end: '12:00' }, { start: '13:00', end: '20:00' }], breaks: [{ start: '10:00', end: '10:15', label: 'Tea' }, { start: '16:00', end: '17:00', label: 'Dinner' }], note: 'Covering spa' };
		await admin.mutation(api.roster.applyCells, { cells: [{ staffId: maliId, date }], ...split });
		const moved = await admin.mutation(api.roster.editBreak, change(maliId, {
			expectedPlan: split, original: split.breaks[1], next: { start: '17:00', end: '18:00', label: 'Dinner' }
		}));
		expect(moved).toMatchObject({ ok: true });
		expect(await planOn(admin, maliId, date)).toEqual({ ...split, breaks: [split.breaks[0], { start: '17:00', end: '18:00', label: 'Dinner' }] });
		// Pattern days, other dates and other people are untouched.
		expect(await planOn(admin, maliId, addDays(date, 1))).toEqual(patternPlan);
		expect(await planOn(admin, nokId, date)).toEqual(patternPlan);
		expect((await t.run((ctx) => ctx.db.get(maliId)))?.breaks).toHaveLength(14);

		// A pattern day gets an override with every other break kept; Roster undo restores it.
		const result = await admin.mutation(api.roster.editBreak, change(nokId));
		expect(await planOn(admin, nokId, date)).toEqual({ ...patternPlan, breaks: [{ ...lunch, start: '12:30', end: '13:30' }, tea] });
		if (!result.ok) throw new Error('Expected the edit to save');
		await admin.mutation(api.roster.undo, { batchId: result.batchId });
		expect(await planOn(admin, nokId, date)).toEqual(patternPlan);
	});

	it('removes a break and rejects stale, out-of-shift, overlapping and unchanged edits', async () => {
		const { admin, maliId } = await setup();
		const preview = (extra: Parameters<typeof change>[1]) => admin.query(api.roster.previewBreakChange, change(maliId, extra));
		expect(await preview({ next: { ...lunch, start: '17:30', end: '18:30' } })).toMatchObject({ problem: 'Breaks must fall inside a shift' });
		expect(await preview({ next: { ...lunch, start: '14:45', end: '15:30' } })).toMatchObject({ problem: 'Breaks cannot overlap' });
		expect(await preview({ next: lunch })).toMatchObject({ problem: expect.stringContaining('Nothing to change') });
		expect(await preview({})).toMatchObject({ problem: null, conflicts: [], keptDates: [], affectedDates: [date] });
		const stale = { ...patternPlan, breaks: [lunch] };
		await expect(admin.mutation(api.roster.editBreak, change(maliId, { expectedPlan: stale }))).rejects.toThrow(STALE_ROSTER);
		await admin.mutation(api.roster.editBreak, change(maliId, { next: null }));
		expect(await planOn(admin, maliId, date)).toEqual({ ...patternPlan, breaks: [tea] });
		// The first edit made the shown plan stale.
		await expect(admin.mutation(api.roster.editBreak, change(maliId))).rejects.toThrow(STALE_ROSTER);
	});

	it('refuses a break over a booking or its turnaround and returns the conflict', async () => {
		const { admin, maliId, book } = await setup();
		const id = await book('10:45'); // 10:45–11:45, turnaround to 12:00
		const over = change(maliId, { next: { ...lunch, start: '11:45', end: '12:45' } });
		expect(await admin.query(api.roster.previewBreakChange, over)).toMatchObject({ problem: null, conflicts: [{ appointmentId: id, guestName: 'Ann' }] });
		expect(await admin.mutation(api.roster.editBreak, over)).toMatchObject({ ok: false, conflicts: [{ appointmentId: id }] });
		expect(await planOn(admin, maliId, date)).toEqual(patternPlan);
	});

	it('keeps a completed service busy until its turnaround ends for day and weekly breaks', async () => {
		const { admin, maliId, book } = await setup();
		const id = await book('10:45');
		await admin.mutation(api.adminServices.updateAppointmentStatus, { appointmentId: id, status: 'completed' });
		vi.setSystemTime(at('11:50'));
		for (const scope of ['day', 'weekly'] as const) {
			const over = change(maliId, { scope, next: { ...lunch, start: '11:45', end: '12:45' } });
			expect(await admin.query(api.roster.previewBreakChange, over)).toMatchObject({ conflicts: [{ appointmentId: id }] });
			expect(await admin.mutation(api.roster.editBreak, over)).toMatchObject({ ok: false, conflicts: [{ appointmentId: id }] });
		}
	});

	it('previews the next four weeks of affected weekly dates while exempting overrides', async () => {
		const { admin, maliId } = await setup();
		const exempt = addDays(date, 7);
		await admin.mutation(api.roster.applyCells, { cells: [{ staffId: maliId, date: exempt }], shifts: [], breaks: [] });
		const preview = await admin.query(api.roster.previewBreakChange, change(maliId, { scope: 'weekly' }));
		expect(preview).toMatchObject({
			problem: null,
			affectedDates: [date, addDays(date, 14), addDays(date, 21)],
			keptDates: [exempt],
			previewThrough: '2026-10-21'
		});
	});

	it('changes the weekly default only on pattern dates, keeping date overrides in force', async () => {
		const { t, admin, maliId, book } = await setup();
		const nextFriday = addDays(date, 7);
		const override = { shifts: [{ start: '10:00', end: '16:00' }], breaks: [{ start: '12:00', end: '12:30', label: 'Lunch' }] };
		await admin.mutation(api.roster.applyCells, { cells: [{ staffId: maliId, date: nextFriday }], ...override });
		const weekly = change(maliId, { scope: 'weekly', next: { ...lunch, start: '13:00', end: '14:00' } });
		expect(await admin.query(api.roster.previewBreakChange, weekly)).toMatchObject({ problem: null, conflicts: [], keptDates: [nextFriday] });
		// A booking on a later pattern Friday blocks the weekly change.
		const id = await book('13:00', maliId, addDays(date, 14));
		expect(await admin.mutation(api.roster.editBreak, weekly)).toMatchObject({ ok: false, conflicts: [{ appointmentId: id, date: addDays(date, 14) }] });
		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId: id, expectedRevision: 0 });
		expect(await admin.mutation(api.roster.editBreak, weekly)).toMatchObject({ ok: true });
		const moved = { ...patternPlan, breaks: [{ ...lunch, start: '13:00', end: '14:00' }, tea] };
		expect(await planOn(admin, maliId, date)).toEqual(moved);
		expect(await planOn(admin, maliId, addDays(date, 14))).toEqual(moved);
		expect(await planOn(admin, maliId, nextFriday)).toEqual(override);
		expect(await planOn(admin, maliId, addDays(date, 1))).toEqual(patternPlan); // Saturday
		expect((await t.run((ctx) => ctx.db.query('staffDays').take(10))).map((row) => row.date)).toEqual([nextFriday]);
		// The weekly scope needs a pattern day.
		await expect(admin.mutation(api.roster.editBreak, change(maliId, { scope: 'weekly', date: nextFriday, expectedPlan: override, original: override.breaks[0] })))
			.rejects.toThrow('has its own roster plan');
	});
});
