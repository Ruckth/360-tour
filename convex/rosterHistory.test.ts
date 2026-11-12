// @vitest-environment edge-runtime
import { convexTest } from 'convex-test';
import { makeFunctionReference, type PaginationOptions, type PaginationResult } from 'convex/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, internal } from './_generated/api';
import type { Doc, Id } from './_generated/dataModel';
import { initializeWeeklyPattern, patternForDate, patternsForRange, writeWeeklyPattern } from './lib/rosterHistory';
import { localDateTimeUtc, serviceRostered } from './lib/serviceSlots';
import schema from './schema';
const modules = import.meta.glob('./**/*.ts');
const list = makeFunctionReference<
	'query',
	{ entityType: string; entityId: string; paginationOpts: PaginationOptions },
	PaginationResult<Doc<'recordChanges'>>
>('settings/recordHistory:list');
const days = [0, 1, 2, 3, 4, 5, 6];
const hours = (start = '09:00', end = '17:00') => days.map((weekday) => ({ weekday, start, end }));
const breaks = days.map((weekday) => ({ weekday, start: '12:00', end: '13:00', label: 'Lunch' }));
const at = (date: string, time = '10:00') => localDateTimeUtc(date, time);
const now = (date: string) => vi.setSystemTime(at(date));
function setup() {
	vi.stubEnv('ADMIN_EMAILS', 'admin@example.com,second@example.com');
	const t = convexTest(schema, modules);
	return {
		t,
		admin: t.withIdentity({ email: 'admin@example.com', tokenIdentifier: 'admin' }),
		second: t.withIdentity({ email: 'second@example.com', tokenIdentifier: 'second' })
	};
}
async function person(admin: ReturnType<typeof setup>['admin']) {
	return admin.mutation(api.services.commands.createStaff.createStaff, {
		name: 'Mali',
		role: 'Therapist',
		color: '#abc',
		workingHours: hours(),
		breaks
	});
}
async function schedule(admin: ReturnType<typeof setup>['admin'], staffId: Id<'staff'>, date: string) {
	return admin.query(api.services.admin.listSchedule, {
		from: at(date, '00:00'),
		to: at(date, '24:00'),
		staffIds: [staffId]
	});
}
beforeEach(() => {
	vi.useFakeTimers({ toFake: ['Date'] });
	now('2026-09-20');
});
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe('durable effective roster patterns', () => {
	it('keeps past shifts and breaks stable through actual roster and schedule readers after staff pattern edits', async () => {
		const { t, admin } = setup();
		const staffId = await person(admin);
		const before = await schedule(admin, staffId, '2026-09-28');
		now('2026-10-01');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, {
			staffId,
			workingHours: hours('14:00', '22:00'),
			breaks: days.map((weekday) => ({ weekday, start: '18:00', end: '19:00', label: 'Dinner' }))
		});
		const past = await schedule(admin, staffId, '2026-09-28');
		expect(past.shifts).toEqual(before.shifts);
		expect(past.blocks).toEqual(before.blocks);
		expect(past.patternHistory).toMatchObject([{ date: '2026-09-28', known: true, knownFrom: '2026-09-20' }]);
		expect((await schedule(admin, staffId, '2026-10-01')).shifts[0].start).toBe(at('2026-10-01', '14:00'));
		const week = await admin.query(api.services.roster.getWeek, { weekStart: '2026-09-28' });
		expect(week.cells.find((cell) => cell.date === '2026-09-30')).toMatchObject({
			shifts: [{ start: '09:00', end: '17:00' }],
			patternHistoryKnown: true
		});
		expect(week.cells.find((cell) => cell.date === '2026-10-01')).toMatchObject({
			shifts: [{ start: '14:00', end: '22:00' }]
		});
		const events = await t.run((ctx) => ctx.db.query('staffPatternVersions').take(100));
		expect(events.map((event) => [event.effectiveFrom, event.provenance])).toEqual([
			['2026-09-20', 'created'],
			['2026-10-01', 'change']
		]);
	});
	it('preserves the creation baseline when a profile-only edit comes before the first weekly change', async () => {
		const { admin } = setup();
		const staffId = await person(admin);
		now('2026-09-25');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, name: 'Mali renamed' });
		now('2026-10-01');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: hours('10:00', '18:00') });
		const past = await schedule(admin, staffId, '2026-09-21');
		expect(past.shifts[0].start).toBe(at('2026-09-21', '09:00'));
		expect(past.patternHistory[0].known).toBe(true);
	});
	it('does not invent a creation baseline for legacy staff that had already changed', async () => {
		const { t, admin } = setup();
		const staffId = await t.run((ctx) =>
			ctx.db.insert('staff', {
				name: 'Legacy',
				role: 'Therapist',
				color: '#abc',
				status: 'active',
				workingHours: hours(),
				breaks,
				createdAt: at('2026-08-01'),
				updatedAt: at('2026-09-10')
			})
		);
		now('2026-10-01');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: hours('14:00', '22:00'), breaks: [] });
		const past = await schedule(admin, staffId, '2026-08-15');
		expect(past.shifts[0].start).toBe(at('2026-08-15', '09:00'));
		expect(past.patternHistory).toMatchObject([{ known: false, knownFrom: '2026-10-01' }]);
		now('2026-10-02');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: hours('10:00', '18:00') });
		expect((await schedule(admin, staffId, '2026-08-15')).shifts).toEqual(past.shifts);
		expect(
			(await admin.query(api.services.roster.getWeek, { weekStart: '2026-08-10' })).cells.every(
				(cell) => !cell.patternHistoryKnown
			)
		).toBe(true);
		const versions = await t.run((ctx) => ctx.db.query('staffPatternVersions').take(20));
		expect(versions[0]).toMatchObject({ effectiveFrom: '2026-10-01', provenance: 'observed' });
	});
	it('records day edits, reset, copy and undo per entity, and pruning the undo buffer keeps all events', async () => {
		const { t, admin, second } = setup();
		const staffId = await person(admin);
		now('2026-10-01');
		const cell = { staffId, date: '2026-10-05' };
		const applied = await admin.mutation(api.services.roster.applyCells, {
			cells: [cell],
			shifts: [{ start: '14:00', end: '22:00' }],
			breaks: []
		});
		const copied = await admin.mutation(api.services.roster.copyWeek, {
			sourceWeekStart: '2026-10-05',
			weeks: 2,
			conflict: 'overwrite'
		});
		const reset = await admin.mutation(api.services.roster.resetCells, { cells: [cell] });
		if (!reset.ok || !reset.batchId) throw new Error('Expected reset batch');
		await t.mutation(internal.services.roster.pruneBatches, { keep: reset.batchId });
		expect(await t.run((ctx) => ctx.db.get(applied.ok ? applied.batchId! : ('' as Id<'rosterBatches'>)))).toBeNull();
		expect(await t.run((ctx) => ctx.db.get(copied.batchId!))).toBeNull();
		const undone = await second.mutation(api.services.roster.undo, { batchId: reset.batchId });
		expect(undone.ok).toBe(true);
		const history = (
			await admin.query(list, {
				entityType: 'roster',
				entityId: staffId,
				paginationOpts: { numItems: 100, cursor: null }
			})
		).page;
		expect(history.map((event) => event.kind)).toEqual([
			'day_undone',
			'day_reset',
			'day_updated',
			'day_updated',
			'day_updated'
		]);
		expect(history[0]).toMatchObject({
			actor: 'second@example.com',
			effectiveAt: at('2026-10-05', '00:00'),
			before: { date: '2026-10-05', override: null },
			after: { override: { shifts: [{ start: '14:00', end: '22:00' }] } }
		});
		expect(history.every((event) => !('cells' in (event.after ?? {})) && !('patterns' in (event.after ?? {})))).toBe(
			true
		);
		expect((await schedule(admin, staffId, '2026-10-05')).shifts[0].start).toBe(at('2026-10-05', '14:00'));
	});
	it('makes a new default and later undoes it without rewriting the intervening day or earlier overrides', async () => {
		const { t, admin, second } = setup();
		const staffId = await person(admin);
		now('2026-10-01');
		await admin.mutation(api.services.roster.applyCells, {
			cells: [
				{ staffId, date: '2026-09-28' },
				{ staffId, date: '2026-10-01' }
			],
			shifts: [{ start: '14:00', end: '22:00' }],
			breaks: []
		});
		const result = await admin.mutation(api.services.roster.makeDefault, { weekStart: '2026-09-28' });
		if (!result.ok || !result.batchId) throw new Error('Expected pattern batch');
		await t.mutation(internal.services.roster.pruneBatches, { keep: result.batchId });
		const beforeUndo = await schedule(admin, staffId, '2026-10-01');
		const earlierOverride = await t.run((ctx) =>
			ctx.db
				.query('staffDays')
				.withIndex('by_staff_date', (q) => q.eq('staffId', staffId).eq('date', '2026-09-28'))
				.unique()
		);
		expect(earlierOverride).not.toBeNull();
		now('2026-10-02');
		expect((await second.mutation(api.services.roster.undo, { batchId: result.batchId })).ok).toBe(true);
		expect((await schedule(admin, staffId, '2026-10-01')).shifts).toEqual(beforeUndo.shifts);
		expect((await schedule(admin, staffId, '2026-10-08')).shifts[0].start).toBe(at('2026-10-08', '09:00'));
		const events = (
			await admin.query(list, {
				entityType: 'roster',
				entityId: staffId,
				paginationOpts: { numItems: 100, cursor: null }
			})
		).page;
		expect(events.find((event) => event.kind === 'pattern_undone')).toMatchObject({
			actor: 'second@example.com',
			after: { effectiveFrom: '2026-10-02' }
		});
		expect(events.find((event) => event.kind === 'pattern_updated')).toMatchObject({
			actor: 'admin@example.com',
			after: { effectiveFrom: '2026-10-01' }
		});
	});
	it('versions weekly break edits and undo, but directs past break edits to a date-only correction', async () => {
		const { admin } = setup();
		const staffId = await person(admin);
		now('2026-10-01');
		const edit = {
			staffId,
			date: '2026-10-01',
			scope: 'weekly' as const,
			original: { start: '12:00', end: '13:00', label: 'Lunch' },
			next: { start: '13:00', end: '14:00', label: 'Lunch later' },
			expectedPlan: {
				shifts: [{ start: '09:00', end: '17:00' }],
				breaks: [{ start: '12:00', end: '13:00', label: 'Lunch' }]
			}
		};
		const result = await admin.mutation(api.services.roster.editBreak, edit);
		if (!result.ok) throw new Error('Unexpected conflict');
		expect((await schedule(admin, staffId, '2026-09-24')).blocks[0].start).toBe(at('2026-09-24', '12:00'));
		expect((await schedule(admin, staffId, '2026-10-01')).blocks[0].start).toBe(at('2026-10-01', '13:00'));
		now('2026-10-02');
		await admin.mutation(api.services.roster.undo, { batchId: result.batchId });
		expect((await schedule(admin, staffId, '2026-10-01')).blocks[0].start).toBe(at('2026-10-01', '13:00'));
		expect((await schedule(admin, staffId, '2026-10-08')).blocks[0].start).toBe(at('2026-10-08', '12:00'));
		await expect(admin.mutation(api.services.roster.editBreak, { ...edit, date: '2026-09-24' })).rejects.toThrow(
			'Change this day only'
		);
	});
	it('validates new hours against upcoming appointments using the proposed version and rolls all writes back on conflict', async () => {
		const { t, admin } = setup();
		const staffId = await person(admin);
		const serviceId = await admin.mutation(api.services.commands.createService.createService, {
			slug: 'massage',
			name: 'Massage',
			description: '',
			category: 'Wellness',
			durationMin: 60,
			bufferMin: 0,
			price: 10000,
			currency: 'THB',
			staffIds: [staffId]
		});
		now('2026-10-01');
		await admin.mutation(api.services.commands.createAppointment.createAppointment, {
			staffId,
			serviceId,
			start: at('2026-10-02', '10:00'),
			guestName: 'Guest',
			guestPhone: '123'
		});
		const prior = await t.run((ctx) => ctx.db.query('staffPatternVersions').take(20));
		await expect(
			admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: hours('14:00', '22:00'), breaks: [] })
		).rejects.toThrow('outside the new hours');
		expect(await t.run((ctx) => ctx.db.query('staffPatternVersions').take(20))).toEqual(prior);
		expect((await schedule(admin, staffId, '2026-10-02')).shifts[0].start).toBe(at('2026-10-02', '09:00'));
		expect(
			(
				await admin.query(list, {
					entityType: 'roster',
					entityId: staffId,
					paginationOpts: { numItems: 100, cursor: null }
				})
			).page
		).toHaveLength(0);
	});
	it('uses the real helper for indexed single-date and batched range resolution, including repeated same-day changes', async () => {
		const { t, admin } = setup();
		const staffId = await person(admin);
		now('2026-10-01');
		await t.run(async (ctx) => {
			await initializeWeeklyPattern(ctx, staffId, 'admin@example.com');
			const first = (await ctx.db.get(staffId))!;
			await writeWeeklyPattern(ctx, first, { workingHours: hours('10:00', '18:00'), breaks: [] }, 'admin@example.com');
			const second = (await ctx.db.get(staffId))!;
			await writeWeeklyPattern(ctx, second, { workingHours: hours('11:00', '19:00'), breaks: [] }, 'admin@example.com');
		});
		const resolved = await t.run(async (ctx) => {
			const staff = (await ctx.db.get(staffId))!;
			const range = await patternsForRange(ctx, [staff], '2026-09-28', '2026-10-08');
			return {
				single: await patternForDate(ctx, staff, '2026-10-01'),
				past: range.get(staffId)!('2026-09-28'),
				current: range.get(staffId)!('2026-10-01')
			};
		});
		expect(resolved.single.pattern.workingHours[0].start).toBe('11:00');
		expect(resolved.current.pattern).toEqual(resolved.single.pattern);
		expect(resolved.past.pattern.workingHours[0].start).toBe('09:00');
		expect(resolved.past.historyKnown).toBe(true);
	});
	it('uses versioned defaults for serviceRostered and availability after a staff pattern update', async () => {
		const { t, admin } = setup();
		const staffId = await person(admin);
		const serviceId = await admin.mutation(api.services.commands.createService.createService, {
			slug: 'massage',
			name: 'Massage',
			description: '',
			category: 'Wellness',
			durationMin: 60,
			bufferMin: 0,
			price: 10000,
			currency: 'THB',
			staffIds: [staffId]
		});
		now('2026-10-01');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: [], breaks: [] });
		expect(await t.run((ctx) => serviceRostered(ctx, serviceId, '2026-09-28'))).toBe(true);
		expect(await t.run((ctx) => serviceRostered(ctx, serviceId, '2026-10-01'))).toBe(false);
		expect(await admin.query(api.services.admin.findOpenSlots, { serviceId, staffId, date: '2026-10-02' })).toEqual([]);
	});
	it('copies the historical source plan across a newer default instead of silently substituting current hours', async () => {
		const { admin } = setup();
		const staffId = await person(admin);
		now('2026-10-01');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: hours('14:00', '22:00'), breaks: [] });
		const copy = await admin.mutation(api.services.roster.copyWeek, {
			sourceWeekStart: '2026-09-21',
			weeks: 2,
			conflict: 'overwrite'
		});
		expect(copy.created).toBeGreaterThan(0);
		const copied = await schedule(admin, staffId, '2026-10-05');
		expect(copied.shifts[0].start).toBe(at('2026-10-05', '09:00'));
		expect(copied.blocks[0].start).toBe(at('2026-10-05', '12:00'));
		expect((await schedule(admin, staffId, '2026-09-21')).shifts[0].start).toBe(at('2026-09-21', '09:00'));
	});
	it('refuses to undo an old pattern batch over a later staff-editor pattern change', async () => {
		const { admin } = setup();
		const staffId = await person(admin);
		now('2026-10-01');
		const edit = await admin.mutation(api.services.roster.editBreak, {
			staffId,
			date: '2026-10-01',
			scope: 'weekly',
			original: { start: '12:00', end: '13:00', label: 'Lunch' },
			next: null,
			expectedPlan: {
				shifts: [{ start: '09:00', end: '17:00' }],
				breaks: [{ start: '12:00', end: '13:00', label: 'Lunch' }]
			}
		});
		if (!edit.ok) throw new Error('Expected a pattern edit');
		await admin.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: hours('10:00', '18:00') });
		await expect(admin.mutation(api.services.roster.undo, { batchId: edit.batchId })).rejects.toThrow('weekly default changed');
		expect((await schedule(admin, staffId, '2026-10-01')).shifts[0].start).toBe(at('2026-10-01', '10:00'));
	});
	it('protects roster mutation authorization without creating versions or history', async () => {
		const { t, admin } = setup();
		const staffId = await person(admin);
		const outsider = t.withIdentity({ email: 'guest@example.com', tokenIdentifier: 'guest' });
		await expect(outsider.mutation(api.services.commands.updateStaff.updateStaff, { staffId, workingHours: [] })).rejects.toThrow(
			'Not authorized'
		);
		await expect(t.mutation(api.services.roster.makeDefault, { weekStart: '2026-10-01' })).rejects.toThrow('Not authenticated');
		expect(await t.run((ctx) => ctx.db.query('staffPatternVersions').take(20))).toHaveLength(1);
	});
});
