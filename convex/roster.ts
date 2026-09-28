import { v } from 'convex/values';
import { internalMutation, mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { internal } from './_generated/api';
import { requireAdmin } from './lib/adminAuth';
import {
	APPOINTMENT_LOOKBACK,
	TIME_OFF_LOOKBACK,
	addDays,
	assertValidTime,
	blocksTime,
	effectivePlan,
	localDayRange,
	patternDay,
	planUncovers,
	resortLocalParts,
	weekdayOf,
	type DayPlan
} from './lib/serviceSlots';
import { assertValidIsoDate } from './lib/validation';

/**
 * Staff roster: the weekly pattern on `staff` plus per-date overrides in `staffDays`.
 * Every bulk action is one `rosterBatches` row with the previous state of each cell it touched,
 * so the latest action can be undone. Changes that would leave an upcoming appointment outside
 * working time are refused and the appointments are returned instead.
 */

type ReadCtx = QueryCtx | MutationCtx;
type Staff = Doc<'staff'>;
type Appointment = Doc<'serviceAppointments'>;
type Pattern = Pick<Staff, 'workingHours' | 'breaks'>;

const shiftValidator = v.object({ start: v.string(), end: v.string() });
const breakValidator = v.object({ start: v.string(), end: v.string(), label: v.string() });
const cellValidator = v.object({ staffId: v.id('staff'), date: v.string() });

const MAX_CELLS = 1000;
const MAX_WEEKS = 52;
/** Cells written per transaction by copyWeek; bigger copies continue in scheduled chunks. */
const CELLS_PER_TX = 2000;
const MAX_SKIPPED_LISTED = 200;

export type RosterConflict = {
	staffId: Id<'staff'>;
	staffName: string;
	date: string;
	appointmentId: Id<'serviceAppointments'>;
	start: number;
	end: number;
	guestName: string;
	serviceName: string;
};

const cellKey = (staffId: Id<'staff'>, date: string) => `${staffId}|${date}`;

function snapshot(row: Doc<'staffDays'> | null | undefined): DayPlan | null {
	return row ? { shifts: row.shifts, breaks: row.breaks, ...(row.note ? { note: row.note } : {}) } : null;
}

function samePlan(a: DayPlan, b: DayPlan): boolean {
	const shape = (plan: DayPlan) => JSON.stringify([
		plan.shifts.map((s) => [s.start, s.end]),
		plan.breaks.map((b) => [b.start, b.end, b.label]),
		plan.note ?? ''
	]);
	return shape(a) === shape(b);
}

function assertWeekStart(date: string, label = 'Week start') {
	assertValidIsoDate(date, label);
}

/** Sorted, non-overlapping shifts; breaks inside a shift. Off (no shifts) drops breaks. */
function normalizePlan(input: { shifts: DayPlan['shifts']; breaks: DayPlan['breaks']; note?: string }): DayPlan {
	if (input.shifts.length > 4 || input.breaks.length > 4) throw new Error('At most 4 shifts and 4 breaks per day');
	const range = (row: { start: string; end: string }) => {
		assertValidTime(row.start);
		assertValidTime(row.end);
		if (row.start >= row.end) throw new Error('Start must be before end');
	};
	const shifts = input.shifts.map(({ start, end }) => ({ start, end })).sort((a, b) => a.start.localeCompare(b.start));
	shifts.forEach(range);
	for (let i = 1; i < shifts.length; i++) {
		if (shifts[i].start < shifts[i - 1].end) throw new Error('Shifts cannot overlap');
	}
	const breaks = shifts.length
		? input.breaks.map(({ start, end, label }) => ({ start, end, label: label.trim() || 'Break' })).sort((a, b) => a.start.localeCompare(b.start))
		: [];
	breaks.forEach(range);
	for (const b of breaks) {
		if (!shifts.some((s) => s.start <= b.start && b.end <= s.end)) throw new Error('Breaks must fall inside a shift');
	}
	const note = input.note?.trim();
	if (note && note.length > 200) throw new Error('Note must be at most 200 characters');
	return { shifts, breaks, ...(note ? { note } : {}) };
}

async function activeStaff(ctx: ReadCtx): Promise<Staff[]> {
	const staff = await ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200);
	return staff.sort((a, b) => a.name.localeCompare(b.name) || a._id.localeCompare(b._id));
}

/** Overrides for every person on dates in [first, last], keyed by cell. */
async function overridesByCell(ctx: ReadCtx, first: string, last: string) {
	const rows = new Map<string, Doc<'staffDays'>>();
	for await (const row of ctx.db.query('staffDays').withIndex('by_date', (q) => q.gte('date', first).lte('date', last))) {
		rows.set(cellKey(row.staffId, row.date), row);
	}
	return rows;
}

/** Non-cancelled appointments touching each cell in [first, last]. */
async function appointmentsByCell(ctx: ReadCtx, first: string, last: string) {
	const cells = new Map<string, Appointment[]>();
	const from = localDayRange(first)[0];
	const to = localDayRange(last)[1];
	for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_start', (q) =>
		q.gte('start', from - APPOINTMENT_LOOKBACK).lt('start', to)
	)) {
		if (!blocksTime(appointment) || appointment.blockedUntil <= from) continue;
		const lastTouched = resortLocalParts(appointment.blockedUntil - 1).date;
		for (let date = resortLocalParts(appointment.start).date; date <= lastTouched; date = addDays(date, 1)) {
			if (date < first || date > last) continue;
			const key = cellKey(appointment.staffId, date);
			cells.set(key, [...(cells.get(key) ?? []), appointment]);
		}
	}
	return cells;
}

/** Time off labels touching each cell in [first, last]. */
async function timeOffByCell(ctx: ReadCtx, staffIds: Id<'staff'>[], first: string, last: string) {
	const cells = new Map<string, string[]>();
	const from = localDayRange(first)[0];
	const to = localDayRange(last)[1];
	for (const staffId of staffIds) {
		for await (const row of ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
			q.eq('staffId', staffId).gte('start', from - TIME_OFF_LOOKBACK).lt('start', to)
		)) {
			if (row.end <= from) continue;
			const lastTouched = resortLocalParts(row.end - 1).date;
			for (let date = resortLocalParts(Math.max(row.start, from)).date; date <= lastTouched && date <= last; date = addDays(date, 1)) {
				const key = cellKey(staffId, date);
				cells.set(key, [...(cells.get(key) ?? []), row.label]);
			}
		}
	}
	return cells;
}

/** Upcoming appointments that the plan would leave outside working time on that date. */
function uncovered(date: string, plan: DayPlan, appointments: Appointment[] | undefined, now: number): Appointment[] {
	return (appointments ?? []).filter((a) =>
		a.blockedUntil > now && a.status !== 'completed' && planUncovers(date, plan, a.start, a.blockedUntil)
	);
}

async function describeConflicts(ctx: ReadCtx, items: Array<{ staff: Staff; date: string; appointments: Appointment[] }>) {
	const serviceNames = new Map<string, string>();
	const conflicts: RosterConflict[] = [];
	for (const { staff, date, appointments } of items) {
		for (const a of appointments) {
			if (!serviceNames.has(a.serviceId)) serviceNames.set(a.serviceId, (await ctx.db.get(a.serviceId))?.name ?? 'Service');
			conflicts.push({
				staffId: staff._id, staffName: staff.name, date, appointmentId: a._id,
				start: a.start, end: a.end, guestName: a.guestName, serviceName: serviceNames.get(a.serviceId)!
			});
		}
	}
	return conflicts.sort((a, b) => a.start - b.start);
}

async function newBatch(ctx: MutationCtx, email: string, label: string, extra: Pick<Partial<Doc<'rosterBatches'>>, 'status' | 'patterns'> = {}) {
	const batchId = await ctx.db.insert('rosterBatches', { label, status: 'done', createdByAdminEmail: email, createdAt: Date.now(), ...extra });
	await ctx.scheduler.runAfter(0, internal.roster.pruneBatches, { keep: batchId });
	return batchId;
}

/** Sets a cell to a plan (null = back to the weekly pattern), recording its previous state for undo. */
async function writeCell(
	ctx: MutationCtx,
	batchId: Id<'rosterBatches'>,
	staffId: Id<'staff'>,
	date: string,
	existing: Doc<'staffDays'> | null | undefined,
	next: DayPlan | null
) {
	await ctx.db.insert('rosterBatchItems', { batchId, staffId, date, previous: snapshot(existing) });
	if (!next) {
		if (existing) await ctx.db.delete(existing._id);
		return;
	}
	const fields = { shifts: next.shifts, breaks: next.breaks, note: next.note, updatedAt: Date.now() };
	if (existing) await ctx.db.patch(existing._id, fields);
	else await ctx.db.insert('staffDays', { staffId, date, ...fields });
}

/** Staff by id for the cells, rejecting unknown or archived people and bad dates. */
async function cellStaff(ctx: ReadCtx, cells: Array<{ staffId: Id<'staff'>; date: string }>) {
	if (!cells.length) throw new Error('Select at least one cell');
	if (cells.length > MAX_CELLS) throw new Error(`Select at most ${MAX_CELLS} cells at once`);
	if (new Set(cells.map((c) => cellKey(c.staffId, c.date))).size !== cells.length) throw new Error('Cells must be distinct');
	const staff = new Map<Id<'staff'>, Staff>();
	for (const cell of cells) {
		assertValidIsoDate(cell.date, 'Date');
		if (staff.has(cell.staffId)) continue;
		const person = await ctx.db.get(cell.staffId);
		if (!person) throw new Error('Staff member not found');
		if (person.status !== 'active') throw new Error(`${person.name} is archived`);
		staff.set(person._id, person);
	}
	return staff;
}

/**
 * Shared by applyCells and resetCells. `plan` null = back to the pattern.
 * A cell only keeps an override row when it differs from the pattern.
 */
async function setCells(
	ctx: MutationCtx,
	email: string,
	label: string,
	cells: Array<{ staffId: Id<'staff'>; date: string }>,
	plan: DayPlan | null,
	skipConflicts = false
) {
	const staff = await cellStaff(ctx, cells);
	const dates = cells.map((c) => c.date).sort();
	const [first, last] = [dates[0], dates[dates.length - 1]];
	const overrides = await overridesByCell(ctx, first, last);
	const appointments = await appointmentsByCell(ctx, first, last);
	const now = Date.now();
	const changes: Array<{ staff: Staff; date: string; existing?: Doc<'staffDays'>; next: DayPlan | null }> = [];
	const blocked: Array<{ staff: Staff; date: string; appointments: Appointment[] }> = [];
	for (const cell of cells) {
		const person = staff.get(cell.staffId)!;
		const key = cellKey(cell.staffId, cell.date);
		const existing = overrides.get(key);
		const pattern = patternDay(person, cell.date);
		const target = plan ?? pattern;
		const next = samePlan(target, pattern) ? null : target;
		if (existing ? next && samePlan(next, snapshot(existing)!) : !next) continue; // no change
		const orphaned = uncovered(cell.date, target, appointments.get(key), now);
		if (orphaned.length) blocked.push({ staff: person, date: cell.date, appointments: orphaned });
		else changes.push({ staff: person, date: cell.date, existing, next });
	}
	const conflicts = await describeConflicts(ctx, blocked);
	if (conflicts.length && !skipConflicts) return { ok: false as const, conflicts };
	const timeOff = plan?.shifts.length ? await timeOffByCell(ctx, [...staff.keys()], first, last) : new Map<string, string[]>();
	const warnings = cells.flatMap((c) => (timeOff.get(cellKey(c.staffId, c.date)) ?? []).map((reason) => ({
		staffId: c.staffId, staffName: staff.get(c.staffId)!.name, date: c.date, label: reason
	})));
	if (!changes.length) return { ok: true as const, batchId: null, changed: 0, warnings, skipped: conflicts };
	const batchId = await newBatch(ctx, email, label);
	for (const change of changes) await writeCell(ctx, batchId, change.staff._id, change.date, change.existing, change.next);
	return { ok: true as const, batchId, changed: changes.length, warnings, skipped: conflicts };
}

export const getWeek = query({
	args: { weekStart: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		assertWeekStart(args.weekStart);
		const dates = Array.from({ length: 7 }, (_, i) => addDays(args.weekStart, i));
		const first = dates[0];
		const last = dates[6];
		const staff = await activeStaff(ctx);
		const overrides = await overridesByCell(ctx, first, last);
		const appointments = await appointmentsByCell(ctx, first, last);
		const timeOff = await timeOffByCell(ctx, staff.map((s) => s._id), first, last);
		const cells = staff.flatMap((person) => dates.map((date) => {
			const key = cellKey(person._id, date);
			const override = overrides.get(key);
			const plan = effectivePlan(person, date, override);
			return {
				staffId: person._id,
				date,
				shifts: plan.shifts,
				breaks: plan.breaks,
				note: plan.note ?? null,
				override: !!override,
				appointments: appointments.get(key)?.length ?? 0,
				timeOff: timeOff.get(key) ?? []
			};
		}));
		const latest = await ctx.db.query('rosterBatches').order('desc').first();
		return {
			dates,
			staff: staff.map(({ _id, name, role, color, avatarUrl }) => ({ _id, name, role, color, avatarUrl })),
			cells,
			lastBatch: latest && latest.status !== 'undone'
				? { batchId: latest._id, label: latest.label, createdAt: latest.createdAt, running: latest.status === 'running' }
				: null
		};
	}
});

/** Sets shifts and breaks on the selected cells. No shifts = off. Refused if it would orphan appointments. */
export const applyCells = mutation({
	args: { cells: v.array(cellValidator), shifts: v.array(shiftValidator), breaks: v.array(breakValidator), note: v.optional(v.string()), skipConflicts: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const plan = normalizePlan(args);
		const count = args.cells.length === 1 ? '1 cell' : `${args.cells.length} cells`;
		const label = plan.shifts.length ? `Set ${plan.shifts.map((s) => `${s.start}–${s.end}`).join(', ')} on ${count}` : `Set ${count} to off`;
		return await setCells(ctx, admin.email, label, args.cells, plan, args.skipConflicts);
	}
});

/** Removes overrides so the cells follow the weekly pattern again. */
export const resetCells = mutation({
	args: { cells: v.array(cellValidator), skipConflicts: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const count = args.cells.length === 1 ? '1 cell' : `${args.cells.length} cells`;
		return await setCells(ctx, admin.email, `Reset ${count} to default`, args.cells, null, args.skipConflicts);
	}
});

type CopyAction = { staffId: Id<'staff'>; date: string; existing?: Doc<'staffDays'>; next: DayPlan | null };
type SkippedCell = { staffId: Id<'staff'>; staffName: string; date: string; reason: 'override' | 'appointments'; appointments: number };

/**
 * What copying the source week onto weeks [fromWeek, toWeek] (1 = the week after) would do.
 * Source cells that follow the pattern leave target cells on the pattern; source overrides become target overrides.
 */
async function planCopy(ctx: ReadCtx, sourceWeekStart: string, fromWeek: number, toWeek: number, conflict: 'skip' | 'overwrite') {
	const staff = await activeStaff(ctx);
	const sourceOverrides = await overridesByCell(ctx, sourceWeekStart, addDays(sourceWeekStart, 6));
	const first = addDays(sourceWeekStart, 7 * fromWeek);
	const last = addDays(sourceWeekStart, 7 * toWeek + 6);
	const targetOverrides = await overridesByCell(ctx, first, last);
	const appointments = await appointmentsByCell(ctx, first, last);
	const now = Date.now();
	const actions: CopyAction[] = [];
	const skipped: SkippedCell[] = [];
	let created = 0;
	let updated = 0;
	let unchanged = 0;
	for (let week = fromWeek; week <= toWeek; week++) {
		for (const person of staff) {
			for (let day = 0; day < 7; day++) {
				const source = snapshot(sourceOverrides.get(cellKey(person._id, addDays(sourceWeekStart, day))));
				const date = addDays(sourceWeekStart, 7 * week + day);
				const key = cellKey(person._id, date);
				const existing = targetOverrides.get(key);
				const pattern = patternDay(person, date);
				const next = source && !samePlan(source, pattern) ? source : null;
				if (existing ? next && samePlan(next, snapshot(existing)!) : !next) {
					unchanged++;
					continue;
				}
				if (existing && conflict === 'skip') {
					skipped.push({ staffId: person._id, staffName: person.name, date, reason: 'override', appointments: 0 });
					continue;
				}
				const orphaned = uncovered(date, next ?? pattern, appointments.get(key), now);
				if (orphaned.length) {
					skipped.push({ staffId: person._id, staffName: person.name, date, reason: 'appointments', appointments: orphaned.length });
					continue;
				}
				if (existing) updated++;
				else created++;
				actions.push({ staffId: person._id, date, existing, next });
			}
		}
	}
	return { staffCount: staff.length, actions, skipped, created, updated, unchanged };
}

/** Copies a week's schedule onto the next 1–52 weeks. `dryRun` returns the preview only. */
export const copyWeek = mutation({
	args: {
		sourceWeekStart: v.string(),
		weeks: v.number(),
		conflict: v.union(v.literal('skip'), v.literal('overwrite')),
		dryRun: v.optional(v.boolean())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		assertWeekStart(args.sourceWeekStart);
		if (!Number.isInteger(args.weeks) || args.weeks < 1 || args.weeks > MAX_WEEKS) throw new Error(`Weeks must be 1–${MAX_WEEKS}`);
		const plan = await planCopy(ctx, args.sourceWeekStart, 1, args.weeks, args.conflict);
		const summary = {
			created: plan.created,
			updated: plan.updated,
			unchanged: plan.unchanged,
			skippedCount: plan.skipped.length,
			skipped: plan.skipped.slice(0, MAX_SKIPPED_LISTED)
		};
		if (args.dryRun || !plan.actions.length) return { ...summary, batchId: null, running: false };
		const weeksPerTx = Math.max(1, Math.floor(CELLS_PER_TX / Math.max(1, plan.staffCount * 7)));
		const running = args.weeks > weeksPerTx;
		const batchId = await newBatch(ctx, admin.email, `Copy week of ${args.sourceWeekStart} to ${args.weeks === 1 ? '1 week' : `${args.weeks} weeks`}`, {
			status: running ? 'running' : 'done'
		});
		const lastInChunk = addDays(args.sourceWeekStart, 7 * Math.min(weeksPerTx, args.weeks) + 6);
		for (const action of plan.actions) {
			if (action.date > lastInChunk) break;
			await writeCell(ctx, batchId, action.staffId, action.date, action.existing, action.next);
		}
		if (running) {
			await ctx.scheduler.runAfter(0, internal.roster.continueCopy, {
				batchId, sourceWeekStart: args.sourceWeekStart, fromWeek: weeksPerTx + 1, toWeek: args.weeks, weeksPerTx, conflict: args.conflict
			});
		}
		return { ...summary, batchId, running };
	}
});

/** The next chunk of a large copyWeek; re-checks conflicts at write time. */
export const continueCopy = internalMutation({
	args: {
		batchId: v.id('rosterBatches'),
		sourceWeekStart: v.string(),
		fromWeek: v.number(),
		toWeek: v.number(),
		weeksPerTx: v.number(),
		conflict: v.union(v.literal('skip'), v.literal('overwrite'))
	},
	handler: async (ctx, args) => {
		const batch = await ctx.db.get(args.batchId);
		if (!batch || batch.status !== 'running') return;
		const chunkEnd = Math.min(args.toWeek, args.fromWeek + args.weeksPerTx - 1);
		const plan = await planCopy(ctx, args.sourceWeekStart, args.fromWeek, chunkEnd, args.conflict);
		for (const action of plan.actions) await writeCell(ctx, args.batchId, action.staffId, action.date, action.existing, action.next);
		if (chunkEnd < args.toWeek) {
			await ctx.scheduler.runAfter(0, internal.roster.continueCopy, { ...args, fromWeek: chunkEnd + 1 });
		} else {
			await ctx.db.patch(args.batchId, { status: 'done' });
		}
	}
});

/** Upcoming appointments on pattern days (no override) that a new weekly pattern would leave uncovered. */
async function patternConflicts(ctx: ReadCtx, person: Staff, pattern: Pattern, overrideDates: Set<string>) {
	const now = Date.now();
	const blocked = new Map<string, Appointment[]>();
	for await (const a of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
		q.eq('staffId', person._id).gte('start', now - APPOINTMENT_LOOKBACK)
	)) {
		if (!blocksTime(a) || a.status === 'completed' || a.blockedUntil <= now) continue;
		const lastTouched = resortLocalParts(a.blockedUntil - 1).date;
		for (let date = resortLocalParts(a.start).date; date <= lastTouched; date = addDays(date, 1)) {
			if (overrideDates.has(date)) continue;
			if (planUncovers(date, patternDay(pattern, date), a.start, a.blockedUntil)) {
				blocked.set(date, [...(blocked.get(date) ?? []), a]);
				break;
			}
		}
	}
	return [...blocked].map(([date, appointments]) => ({ staff: person, date, appointments }));
}

/** Dates with an override for this person from today on (the only ones a pattern change can't touch). */
async function upcomingOverrideDates(ctx: ReadCtx, staffId: Id<'staff'>) {
	const today = addDays(resortLocalParts(Date.now()).date, -1);
	const dates = new Set<string>();
	for await (const row of ctx.db.query('staffDays').withIndex('by_staff_date', (q) => q.eq('staffId', staffId).gte('date', today))) {
		dates.add(row.date);
	}
	return dates;
}

/** Rewrites each person's weekly pattern from this week's schedule; the week's overrides become redundant and are removed. */
export const makeDefault = mutation({
	args: { weekStart: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		assertWeekStart(args.weekStart);
		const dates = Array.from({ length: 7 }, (_, i) => addDays(args.weekStart, i));
		const staff = await activeStaff(ctx);
		const weekOverrides = await overridesByCell(ctx, dates[0], dates[6]);
		const updates: Array<{ person: Staff; pattern: Pattern }> = [];
		const blocked: Array<{ staff: Staff; date: string; appointments: Appointment[] }> = [];
		for (const person of staff) {
			const pattern: Pattern = { workingHours: [], breaks: [] };
			for (const date of dates) {
				const weekday = weekdayOf(date);
				const plan = effectivePlan(person, date, weekOverrides.get(cellKey(person._id, date)));
				pattern.workingHours.push(...plan.shifts.map((s) => ({ weekday, ...s })));
				pattern.breaks.push(...plan.breaks.map((b) => ({ weekday, ...b })));
			}
			const changed = dates.some((date) => !samePlan(patternDay(pattern, date), patternDay(person, date)));
			if (!changed) continue;
			const overrideDates = await upcomingOverrideDates(ctx, person._id);
			for (const date of dates) overrideDates.delete(date); // this week's overrides are removed below
			blocked.push(...(await patternConflicts(ctx, person, pattern, overrideDates)));
			updates.push({ person, pattern });
		}
		if (blocked.length) return { ok: false as const, conflicts: await describeConflicts(ctx, blocked) };
		const weekRows = [...weekOverrides.values()].filter((row) => staff.some((s) => s._id === row.staffId));
		if (!updates.length && !weekRows.length) return { ok: true as const, batchId: null, staffUpdated: 0 };
		const batchId = await newBatch(ctx, admin.email, `Make week of ${args.weekStart} the default`, {
			patterns: updates.map(({ person }) => ({ staffId: person._id, workingHours: person.workingHours, breaks: person.breaks }))
		});
		for (const { person, pattern } of updates) {
			await ctx.db.patch(person._id, { workingHours: pattern.workingHours, breaks: pattern.breaks, updatedAt: Date.now() });
		}
		for (const row of weekRows) await writeCell(ctx, batchId, row.staffId, row.date, row, null);
		return { ok: true as const, batchId, staffUpdated: updates.length };
	}
});

/** Reverts the latest bulk action, unless that would now orphan appointments booked since. */
export const undo = mutation({
	args: { batchId: v.id('rosterBatches') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const batch = await ctx.db.get(args.batchId);
		if (!batch) throw new Error('Nothing to undo');
		const latest = await ctx.db.query('rosterBatches').order('desc').first();
		if (latest?._id !== batch._id) throw new Error('Only the most recent roster change can be undone');
		if (batch.status === 'running') throw new Error('Still copying. Try again in a moment');
		if (batch.status === 'undone') throw new Error('Already undone');
		// Bounded by the batch size: at most MAX_CELLS, or 52 weeks of the roster for a copy.
		const items = await ctx.db.query('rosterBatchItems').withIndex('by_batch', (q) => q.eq('batchId', batch._id)).take(20_000);
		const staff = new Map<Id<'staff'>, Staff>();
		for (const id of new Set([...items.map((i) => i.staffId), ...(batch.patterns ?? []).map((p) => p.staffId)])) {
			const person = await ctx.db.get(id);
			if (person) staff.set(id, person);
		}
		// Patterns first, so restored cells without an override are checked against the old pattern.
		const patterns = new Map((batch.patterns ?? []).map((p) => [p.staffId, p]));
		const patternOf = (person: Staff): Pattern => patterns.get(person._id) ?? person;
		const blocked: Array<{ staff: Staff; date: string; appointments: Appointment[] }> = [];
		if (items.length) {
			const dates = items.map((i) => i.date).sort();
			const appointments = await appointmentsByCell(ctx, dates[0], dates[dates.length - 1]);
			const now = Date.now();
			for (const item of items) {
				const person = staff.get(item.staffId);
				if (!person) continue;
				const plan = item.previous ?? patternDay(patternOf(person), item.date);
				const orphaned = uncovered(item.date, plan, appointments.get(cellKey(item.staffId, item.date)), now);
				if (orphaned.length) blocked.push({ staff: person, date: item.date, appointments: orphaned });
			}
		}
		for (const saved of batch.patterns ?? []) {
			const person = staff.get(saved.staffId);
			if (!person) continue;
			const overrideDates = await upcomingOverrideDates(ctx, person._id);
			for (const item of items) {
				if (item.staffId !== person._id) continue;
				if (item.previous) overrideDates.add(item.date);
				else overrideDates.delete(item.date);
			}
			blocked.push(...(await patternConflicts(ctx, person, saved, overrideDates)));
		}
		if (blocked.length) return { ok: false as const, conflicts: await describeConflicts(ctx, blocked) };
		for (const saved of batch.patterns ?? []) {
			if (staff.has(saved.staffId)) await ctx.db.patch(saved.staffId, { workingHours: saved.workingHours, breaks: saved.breaks, updatedAt: Date.now() });
		}
		for (const item of items) {
			const existing = await ctx.db.query('staffDays').withIndex('by_staff_date', (q) => q.eq('staffId', item.staffId).eq('date', item.date)).unique();
			if (!item.previous) {
				if (existing) await ctx.db.delete(existing._id);
				continue;
			}
			const fields = { shifts: item.previous.shifts, breaks: item.previous.breaks, note: item.previous.note, updatedAt: Date.now() };
			if (existing) await ctx.db.patch(existing._id, fields);
			else await ctx.db.insert('staffDays', { staffId: item.staffId, date: item.date, ...fields });
		}
		await ctx.db.patch(batch._id, { status: 'undone' });
		return { ok: true as const, restored: items.length };
	}
});

/** Only the latest batch can be undone, so older batches and their items are dropped in chunks. */
export const pruneBatches = internalMutation({
	args: { keep: v.id('rosterBatches') },
	handler: async (ctx, args) => {
		const keep = await ctx.db.get(args.keep);
		if (!keep) return;
		const older = await ctx.db.query('rosterBatches').withIndex('by_creation_time', (q) => q.lt('_creationTime', keep._creationTime)).take(50);
		let budget = 2000;
		for (const batch of older) {
			if (batch.status === 'running') continue;
			const items = await ctx.db.query('rosterBatchItems').withIndex('by_batch', (q) => q.eq('batchId', batch._id)).take(budget);
			for (const item of items) await ctx.db.delete(item._id);
			budget -= items.length;
			if (budget <= 0) {
				await ctx.scheduler.runAfter(0, internal.roster.pruneBatches, args);
				return;
			}
			await ctx.db.delete(batch._id);
		}
	}
});
