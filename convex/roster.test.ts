// @vitest-environment edge-runtime

import { convexTest } from 'convex-test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './_generated/api';
import type { Id } from './_generated/dataModel';
import { addDays, localDateTimeUtc } from './lib/serviceSlots';
import schema from './schema';

const modules = import.meta.glob('./**/*.ts');
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const MON = '2026-09-28';
const TUE = '2026-09-29';
const evening = { shifts: [{ start: '14:00', end: '22:00' }], breaks: [{ start: '18:00', end: '19:00', label: 'Break' }] };

async function setup(names = ['Mali', 'Nok']) {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com');
	const t = convexTest(schema, modules);
	const admin = t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' });
	const staffIds: Id<'staff'>[] = [];
	for (const name of names) {
		staffIds.push(await admin.mutation(api.adminServices.createStaff, {
			name, role: 'Therapist', color: '#abc',
			workingHours: weekdays.map((weekday) => ({ weekday, start: '09:00', end: '17:00' })),
			breaks: weekdays.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' }))
		}));
	}
	const serviceId = await admin.mutation(api.adminServices.createService, {
		slug: 'thai-massage', name: 'Thai massage', description: '', category: 'Wellness',
		durationMin: 60, bufferMin: 0, price: 2000, currency: 'THB', staffIds
	});
	const book = (staffId: Id<'staff'>, date: string, time: string) => admin.mutation(api.adminServices.createAppointment, {
		serviceId, staffId, start: localDateTimeUtc(date, time), guestName: 'Guest One', guestPhone: '+66000000000'
	});
	const rows = () => t.run(async (ctx) => await ctx.db.query('staffDays').take(5000));
	const cell = (staffId: Id<'staff'>, date: string) => ({ staffId, date });
	return { t, admin, staffIds, serviceId, book, rows, cell };
}

beforeEach(() => {
	vi.useFakeTimers();
	vi.setSystemTime(new Date('2026-09-24T00:00:00.000Z'));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe('staff roster', () => {
	it('requires an admin', async () => {
		const { t, staffIds } = await setup();
		await expect(t.query(api.roster.getWeek, { weekStart: MON })).rejects.toThrow('Not authenticated');
		await expect(t.mutation(api.roster.applyCells, { cells: [{ staffId: staffIds[0], date: MON }], ...evening })).rejects.toThrow('Not authenticated');
		const stranger = t.withIdentity({ email: 'other@example.com', tokenIdentifier: 'other' });
		await expect(stranger.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 4, conflict: 'skip', dryRun: true })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.roster.makeDefault, { weekStart: MON })).rejects.toThrow('Not authorized');
		await expect(stranger.mutation(api.roster.resetCells, { cells: [{ staffId: staffIds[0], date: MON }] })).rejects.toThrow('Not authorized');
	});

	it('shows the pattern, applies shifts and off to many cells, and resets them', async () => {
		const { admin, staffIds, rows, cell } = await setup();
		let week = await admin.query(api.roster.getWeek, { weekStart: MON });
		expect(week.dates).toHaveLength(7);
		expect(week.cells).toHaveLength(14);
		expect(week.cells[0]).toMatchObject({ shifts: [{ start: '09:00', end: '17:00' }], override: false, appointments: 0 });

		const all = staffIds.flatMap((id) => week.dates.map((date) => cell(id, date)));
		const result = await admin.mutation(api.roster.applyCells, { cells: all, ...evening });
		expect(result).toMatchObject({ ok: true, changed: 14 });
		week = await admin.query(api.roster.getWeek, { weekStart: MON });
		expect(week.cells.every((c) => c.override && c.shifts[0].start === '14:00' && c.breaks[0].label === 'Break')).toBe(true);
		expect(week.lastBatch?.label).toContain('14:00–22:00');

		// Applying the pattern's own hours removes the override instead of storing a copy.
		await admin.mutation(api.roster.applyCells, {
			cells: [cell(staffIds[0], MON)], shifts: [{ start: '09:00', end: '17:00' }], breaks: [{ start: '12:00', end: '13:00', label: 'Lunch' }]
		});
		expect((await rows()).some((row) => row.staffId === staffIds[0] && row.date === MON)).toBe(false);

		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[1], TUE)], shifts: [], breaks: [] });
		week = await admin.query(api.roster.getWeek, { weekStart: MON });
		expect(week.cells.find((c) => c.staffId === staffIds[1] && c.date === TUE)).toMatchObject({ shifts: [], breaks: [], override: true });

		await admin.mutation(api.roster.resetCells, { cells: all });
		expect(await rows()).toHaveLength(0);
		await expect(admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], shifts: [{ start: '10:00', end: '09:00' }], breaks: [] }))
			.rejects.toThrow('Start must be before end');
		await expect(admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], shifts: [{ start: '09:00', end: '12:00' }], breaks: [{ start: '13:00', end: '14:00', label: 'x' }] }))
			.rejects.toThrow('inside a shift');
	});

	it('warns but allows scheduling over time off', async () => {
		const { admin, staffIds, cell } = await setup();
		await admin.mutation(api.adminServices.addTimeOff, {
			staffId: staffIds[0], start: localDateTimeUtc(MON, '00:00'), end: localDateTimeUtc(TUE, '00:00'), label: 'Leave'
		});
		const result = await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], ...evening });
		expect(result).toMatchObject({ ok: true, changed: 1, warnings: [{ staffId: staffIds[0], date: MON, label: 'Leave' }] });
		const week = await admin.query(api.roster.getWeek, { weekStart: MON });
		expect(week.cells.find((c) => c.staffId === staffIds[0] && c.date === MON)?.timeOff).toEqual(['Leave']);
	});

	it('refuses changes that would orphan appointments and lists them', async () => {
		const { admin, staffIds, book, rows, cell } = await setup();
		const { appointmentId } = await book(staffIds[0], TUE, '10:00');
		const cells = [cell(staffIds[0], TUE), cell(staffIds[1], TUE)];
		const refused = await admin.mutation(api.roster.applyCells, { cells, ...evening });
		expect(refused).toEqual({
			ok: false,
			conflicts: [expect.objectContaining({ staffId: staffIds[0], staffName: 'Mali', date: TUE, appointmentId, guestName: 'Guest One', serviceName: 'Thai massage' })]
		});
		expect(await rows()).toHaveLength(0);
		expect(await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], TUE)], shifts: [], breaks: [] })).toMatchObject({ ok: false });

		const partial = await admin.mutation(api.roster.applyCells, { cells, ...evening, skipConflicts: true });
		expect(partial).toMatchObject({ ok: true, changed: 1, skipped: [{ appointmentId }] });
		expect((await rows()).map((row) => row.staffId)).toEqual([staffIds[1]]);
		const week = await admin.query(api.roster.getWeek, { weekStart: MON });
		expect(week.cells.find((c) => c.staffId === staffIds[0] && c.date === TUE)?.appointments).toBe(1);

		// A shift that still covers the appointment is fine.
		expect(await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], TUE)], shifts: [{ start: '10:00', end: '11:00' }], breaks: [] }))
			.toMatchObject({ ok: true, changed: 1 });
		// Resetting to the pattern is checked too, but 09–17 covers it.
		expect(await admin.mutation(api.roster.resetCells, { cells: [cell(staffIds[0], TUE)] })).toMatchObject({ ok: true, changed: 1 });
	});

	it('copies a week forward with a dry-run preview, skip vs overwrite, and appointment guard', async () => {
		const { admin, staffIds, book, rows, cell } = await setup();
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], ...evening });
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[1], TUE)], shifts: [], breaks: [] });
		// Week 2 already has a different override for Mali on Monday; week 3 has a booking on Nok's Tuesday.
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], addDays(MON, 7))], shifts: [{ start: '06:00', end: '10:00' }], breaks: [] });
		await book(staffIds[1], addDays(TUE, 14), '10:00');
		const before = (await rows()).length;

		const preview = await admin.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 3, conflict: 'skip', dryRun: true });
		expect(preview).toMatchObject({ created: 4, updated: 0, skippedCount: 2, batchId: null });
		expect(preview.skipped).toEqual(expect.arrayContaining([
			expect.objectContaining({ staffId: staffIds[0], date: addDays(MON, 7), reason: 'override' }),
			expect.objectContaining({ staffId: staffIds[1], date: addDays(TUE, 14), reason: 'appointments', appointments: 1 })
		]));
		expect((await rows()).length).toBe(before);

		const overwrite = await admin.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 3, conflict: 'overwrite', dryRun: true });
		expect(overwrite).toMatchObject({ created: 4, updated: 1, skippedCount: 1 });

		const done = await admin.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 3, conflict: 'overwrite' });
		expect(done).toMatchObject({ created: 4, updated: 1, skippedCount: 1, running: false });
		for (const week of [1, 2, 3]) {
			const data = await admin.query(api.roster.getWeek, { weekStart: addDays(MON, 7 * week) });
			const mali = data.cells.find((c) => c.staffId === staffIds[0] && c.date === addDays(MON, 7 * week));
			expect(mali).toMatchObject({ override: true, shifts: evening.shifts });
			const nok = data.cells.find((c) => c.staffId === staffIds[1] && c.date === addDays(TUE, 7 * week));
			expect(nok?.shifts).toEqual(week === 2 ? [{ start: '09:00', end: '17:00' }] : []);
		}
		// Pattern days copy as pattern days: nothing is stored for them.
		expect((await rows()).length).toBe(2 + 3 + 2);
		await expect(admin.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 53, conflict: 'skip' })).rejects.toThrow('Weeks must be');
	});

	it('undoes the latest bulk action only', async () => {
		const { admin, staffIds, rows, cell } = await setup();
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], ...evening });
		const first = await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], TUE)], ...evening });
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], addDays(MON, 7))], shifts: [], breaks: [] });
		const copy = await admin.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 2, conflict: 'overwrite' });
		expect(copy.created + copy.updated).toBe(4);
		expect((await rows()).length).toBe(6);
		if (!first.ok || !first.batchId || !copy.batchId) throw new Error('expected batches');
		await expect(admin.mutation(api.roster.undo, { batchId: first.batchId })).rejects.toThrow('most recent');

		expect(await admin.mutation(api.roster.undo, { batchId: copy.batchId })).toMatchObject({ ok: true, restored: 4 });
		const after = await rows();
		expect(after.map((row) => row.date).sort()).toEqual([MON, TUE, addDays(MON, 7)]);
		expect(after.find((row) => row.date === addDays(MON, 7))?.shifts).toEqual([]);
		expect((await admin.query(api.roster.getWeek, { weekStart: MON })).lastBatch).toBeNull();
		await expect(admin.mutation(api.roster.undo, { batchId: copy.batchId })).rejects.toThrow('Already undone');
	});

	it('refuses an undo that would orphan an appointment booked since', async () => {
		const { admin, staffIds, book, cell } = await setup();
		const applied = await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], ...evening });
		await book(staffIds[0], MON, '20:00');
		if (!applied.ok || !applied.batchId) throw new Error('expected batch');
		expect(await admin.mutation(api.roster.undo, { batchId: applied.batchId })).toMatchObject({ ok: false, conflicts: [{ staffId: staffIds[0], date: MON }] });
	});

	it('makes a week the default pattern, guarded by appointments, and can undo it', async () => {
		const { admin, staffIds, book, rows, cell, t } = await setup();
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[0], MON)], ...evening });
		await admin.mutation(api.roster.applyCells, { cells: [cell(staffIds[1], TUE)], shifts: [], breaks: [] });
		// Next week's Monday 10:00 booking for Mali falls outside a 14:00–22:00 Monday pattern.
		const { appointmentId } = await book(staffIds[0], addDays(MON, 7), '10:00');
		const refused = await admin.mutation(api.roster.makeDefault, { weekStart: MON });
		expect(refused).toMatchObject({ ok: false, conflicts: [{ appointmentId, date: addDays(MON, 7) }] });

		await admin.mutation(api.adminServices.cancelAppointment, { appointmentId });
		const made = await admin.mutation(api.roster.makeDefault, { weekStart: MON });
		expect(made).toMatchObject({ ok: true, staffUpdated: 2 });
		expect(await rows()).toHaveLength(0); // the week's overrides are now the pattern
		const [mali, nok] = await t.run(async (ctx) => Promise.all(staffIds.map((id) => ctx.db.get(id))));
		expect(mali?.workingHours.filter((h) => h.weekday === 1)).toEqual([{ weekday: 1, start: '14:00', end: '22:00' }]);
		expect(mali?.breaks.filter((b) => b.weekday === 1)).toEqual([{ weekday: 1, start: '18:00', end: '19:00', label: 'Break' }]);
		expect(nok?.workingHours.some((h) => h.weekday === 2)).toBe(false);
		const nextWeek = await admin.query(api.roster.getWeek, { weekStart: addDays(MON, 7) });
		expect(nextWeek.cells.find((c) => c.staffId === staffIds[0] && c.date === addDays(MON, 7))).toMatchObject({ override: false, shifts: evening.shifts });

		if (!made.ok || !made.batchId) throw new Error('expected batch');
		expect(await admin.mutation(api.roster.undo, { batchId: made.batchId })).toMatchObject({ ok: true, restored: 2 });
		const restored = await t.run(async (ctx) => await ctx.db.get(staffIds[0]));
		expect(restored?.workingHours.filter((h) => h.weekday === 1)).toEqual([{ weekday: 1, start: '09:00', end: '17:00' }]);
		expect(await rows()).toHaveLength(2);
	});

	it('copies large rosters in chunks and blocks undo until done', async () => {
		const { t, admin, staffIds, rows, cell } = await setup(['A', 'B', 'C', 'D', 'E', 'F']);
		const week = staffIds.flatMap((id) => weekdays.map((i) => cell(id, addDays(MON, i))));
		await admin.mutation(api.roster.applyCells, { cells: week, ...evening });
		const copy = await admin.mutation(api.roster.copyWeek, { sourceWeekStart: MON, weeks: 52, conflict: 'skip' });
		expect(copy).toMatchObject({ created: 52 * 42, running: true });
		if (!copy.batchId) throw new Error('expected batch');
		await expect(admin.mutation(api.roster.undo, { batchId: copy.batchId })).rejects.toThrow('Still copying');
		await t.finishAllScheduledFunctions(vi.runAllTimers);
		expect(await rows()).toHaveLength(53 * 42);
		expect((await admin.query(api.roster.getWeek, { weekStart: MON })).lastBatch).toMatchObject({ batchId: copy.batchId, running: false });
	}, 60_000);
});
