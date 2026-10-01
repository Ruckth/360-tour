import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import {
	APPOINTMENT_LOOKBACK,
	TIME_OFF_LOOKBACK,
	assertAppointmentStart,
	blocksTime,
	assertStaffFree,
	assertValidTime,
	createAppointmentRecord,
	findOpenSlots as openSlots,
	guestDetails,
	localDayRange,
	localDateTimeUtc,
	openStarts,
	planWorking,
	scheduleDays,
	staffBusyRanges,
	type DayPlan,
	type RosterBreak
} from './lib/serviceSlots';
import {
	canBookAgain,
	canEditTurnaround,
	canReschedule,
	movedWindow,
	turnaroundMinutes,
	turnaroundProblem,
	withTurnaround
} from './lib/appointmentWindow';
import {
	appointmentHistory,
	assertFresh,
	cancelAppointmentRecord,
	recordAppointmentChange,
	recordRebooked
} from './lib/appointmentChanges';

const DAY = 86_400_000;
const MINUTE = 60_000;
const hour = v.object({ weekday: v.number(), start: v.string(), end: v.string() });
const rest = v.object({ weekday: v.number(), start: v.string(), end: v.string(), label: v.string() });
const staffStatus = v.union(v.literal('active'), v.literal('archived'));
const serviceStatus = v.union(v.literal('active'), v.literal('archived'));
// Cancelling goes through cancelAppointment.
const appointmentStatus = v.union(
	v.literal('arrived'), v.literal('in_service'), v.literal('completed'), v.literal('no_show')
);

function required(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

function validateHours(rows: Array<{ weekday: number; start: string; end: string; label?: string }>) {
	for (const row of rows) {
		if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) throw new Error('Weekday must be 0–6');
		assertValidTime(row.start);
		assertValidTime(row.end);
		if (row.start >= row.end) throw new Error('Start must be before end');
		if ('label' in row) required(row.label ?? '', 'Break label');
	}
}

function validateService(input: Pick<Doc<'services'>, 'durationMin' | 'bufferMin' | 'price'>) {
	if (!Number.isInteger(input.durationMin) || input.durationMin <= 0 || input.durationMin % 15 !== 0) throw new Error('Duration must be a positive multiple of 15 minutes');
	const turnaround = turnaroundProblem(input.bufferMin, input.durationMin);
	if (turnaround) throw new Error(turnaround);
	if (!Number.isFinite(input.price) || input.price < 0) throw new Error('Price must be nonnegative');
}

async function validateStaffIds(ctx: MutationCtx, staffIds: Id<'staff'>[]) {
	if (!staffIds.length || new Set(staffIds).size !== staffIds.length) throw new Error('Choose distinct staff members');
	for (const id of staffIds) {
		const person = await ctx.db.get(id);
		if (!person) throw new Error('Staff member not found');
		if (person.status !== 'active') throw new Error(`${person.name} is archived. Restore them first or choose someone else`);
	}
}

const appointmentCount = (n: number) => (n === 1 ? '1 upcoming appointment' : `${n} upcoming appointments`);

/** Booked, arrived or in service appointments that aren't over yet. */
async function countUpcoming(ctx: QueryCtx | MutationCtx, owner: { staffId: Id<'staff'> } | { serviceId: Id<'services'> }) {
	const now = Date.now();
	const rows = 'staffId' in owner
		? ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) => q.eq('staffId', owner.staffId).gte('start', now - APPOINTMENT_LOOKBACK))
		: ctx.db.query('serviceAppointments').withIndex('by_service_start', (q) => q.eq('serviceId', owner.serviceId).gte('start', now - APPOINTMENT_LOOKBACK));
	let count = 0;
	for await (const appointment of rows) {
		if (appointment.blockedUntil > now && blocksTime(appointment) && appointment.status !== 'completed') count++;
	}
	return count;
}

/** Archived staff keep their past appointments but leave every service. */
async function archiveStaffRecord(ctx: MutationCtx, staff: Doc<'staff'>) {
	const upcoming = await countUpcoming(ctx, { staffId: staff._id });
	if (upcoming) throw new Error(`Reassign or cancel ${staff.name}'s ${appointmentCount(upcoming)} first`);
	let servicesUpdated = 0;
	for await (const service of ctx.db.query('services')) {
		if (!service.staffIds.includes(staff._id)) continue;
		await ctx.db.patch(service._id, { staffIds: service.staffIds.filter((id) => id !== staff._id), updatedAt: Date.now() });
		servicesUpdated++;
	}
	await ctx.db.patch(staff._id, { status: 'archived', updatedAt: Date.now() });
	return { servicesUpdated };
}

function assertTimeOffRange(start: number, end: number) {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > TIME_OFF_LOOKBACK) throw new Error('Time off must be positive and at most 60 days');
}

/** Booked appointments that would fall inside the time off. */
async function timeOffConflicts(ctx: MutationCtx, staffId: Id<'staff'>, start: number, end: number) {
	const conflicts: Array<{ appointmentId: Id<'serviceAppointments'>; start: number }> = [];
	for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staffId).gte('start', start - APPOINTMENT_LOOKBACK).lt('start', end)
	)) {
		if (appointment.blockedUntil > start && blocksTime(appointment) && appointment.status !== 'completed') conflicts.push({ appointmentId: appointment._id, start: appointment.start });
	}
	return conflicts;
}

async function assertTimeOffFits(ctx: MutationCtx, staffId: Id<'staff'>, start: number, end: number) {
	assertTimeOffRange(start, end);
	if ((await timeOffConflicts(ctx, staffId, start, end)).length) throw new Error('Reassign or cancel the appointments during this time off first');
}

export const listStaff = query({
	args: { includeArchived: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return args.includeArchived
			? await ctx.db.query('staff').take(200)
			: await ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200);
	}
});

export const createStaff = mutation({
	args: { name: v.string(), role: v.string(), avatarUrl: v.optional(v.string()), color: v.string(), workingHours: v.array(hour), breaks: v.array(rest) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		validateHours(args.workingHours);
		validateHours(args.breaks);
		const now = Date.now();
		return await ctx.db.insert('staff', {
			...args, name: required(args.name, 'Name'), role: required(args.role, 'Role'), color: required(args.color, 'Color'),
			status: 'active', createdAt: now, updatedAt: now
		});
	}
});

export const updateStaff = mutation({
	args: { staffId: v.id('staff'), name: v.optional(v.string()), role: v.optional(v.string()), avatarUrl: v.optional(v.string()), color: v.optional(v.string()), status: v.optional(staffStatus), workingHours: v.optional(v.array(hour)), breaks: v.optional(v.array(rest)) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const { staffId, ...changes } = args;
		if (changes.status === 'archived' && staff.status !== 'archived') await archiveStaffRecord(ctx, staff);
		validateHours(changes.workingHours ?? staff.workingHours);
		validateHours(changes.breaks ?? staff.breaks);
		if (changes.workingHours || changes.breaks) {
			// New hours must still cover every upcoming appointment.
			const next = { ...staff, ...changes };
			const now = Date.now();
			for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', staffId).gte('start', now - APPOINTMENT_LOOKBACK)
			)) {
				if (appointment.blockedUntil <= now || !blocksTime(appointment) || appointment.status === 'completed') continue;
				if ((await staffBusyRanges(ctx, next, appointment.start, appointment.blockedUntil, appointment._id)).length) {
					throw new Error('Reassign or cancel the appointments outside the new hours first');
				}
			}
		}
		await ctx.db.patch(staffId, {
			...changes,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.role !== undefined ? { role: required(changes.role, 'Role') } : {}),
			...(changes.color !== undefined ? { color: required(changes.color, 'Color') } : {}),
			// A blank photo URL clears the photo; omitting it keeps the current one.
			...(changes.avatarUrl !== undefined ? { avatarUrl: changes.avatarUrl.trim() || undefined } : {}),
			updatedAt: Date.now()
		});
	}
});

export const archiveStaff = mutation({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		return await archiveStaffRecord(ctx, staff);
	}
});

/** Shown before archiving a staff member or service. */
export const countUpcomingAppointments = query({
	args: { staffId: v.optional(v.id('staff')), serviceId: v.optional(v.id('services')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (args.staffId) return await countUpcoming(ctx, { staffId: args.staffId });
		if (args.serviceId) return await countUpcoming(ctx, { serviceId: args.serviceId });
		throw new Error('Choose a staff member or service');
	}
});

export const listServices = query({
	args: { includeArchived: v.optional(v.boolean()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return args.includeArchived
			? await ctx.db.query('services').take(200)
			: await ctx.db.query('services').withIndex('by_status', (q) => q.eq('status', 'active')).take(200);
	}
});

export const createService = mutation({
	args: { slug: v.string(), name: v.string(), description: v.string(), category: v.string(), durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string(), staffIds: v.array(v.id('staff')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const slug = required(args.slug, 'Slug').toLowerCase();
		if (await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first()) throw new Error('Service slug already exists');
		validateService(args);
		await validateStaffIds(ctx, args.staffIds);
		const now = Date.now();
		return await ctx.db.insert('services', {
			...args, slug, name: required(args.name, 'Name'), description: args.description.trim(),
			category: required(args.category, 'Category'), currency: required(args.currency, 'Currency'),
			status: 'active', createdAt: now, updatedAt: now
		});
	}
});

export const updateService = mutation({
	args: { serviceId: v.id('services'), slug: v.optional(v.string()), name: v.optional(v.string()), description: v.optional(v.string()), category: v.optional(v.string()), durationMin: v.optional(v.number()), bufferMin: v.optional(v.number()), price: v.optional(v.number()), currency: v.optional(v.string()), staffIds: v.optional(v.array(v.id('staff'))), status: v.optional(serviceStatus) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const service = await ctx.db.get(args.serviceId);
		if (!service) throw new Error('Service not found');
		const { serviceId, ...changes } = args;
		const slug = changes.slug !== undefined ? required(changes.slug, 'Slug').toLowerCase() : service.slug;
		const duplicate = await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
		if (duplicate && duplicate._id !== serviceId) throw new Error('Service slug already exists');
		validateService({ durationMin: changes.durationMin ?? service.durationMin, bufferMin: changes.bufferMin ?? service.bufferMin, price: changes.price ?? service.price });
		if (changes.staffIds) await validateStaffIds(ctx, changes.staffIds);
		if (changes.status === 'active' && service.status !== 'active') {
			const staff = await Promise.all((changes.staffIds ?? service.staffIds).map((id) => ctx.db.get(id)));
			if (!staff.some((person) => person?.status === 'active')) throw new Error('Assign at least one active staff member before restoring this service');
		}
		await ctx.db.patch(serviceId, {
			...changes, slug,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.category !== undefined ? { category: required(changes.category, 'Category') } : {}),
			...(changes.currency !== undefined ? { currency: required(changes.currency, 'Currency') } : {}),
			...(changes.description !== undefined ? { description: changes.description.trim() } : {}),
			updatedAt: Date.now()
		});
	}
});

/** Upcoming appointments stay booked; the count is returned so the UI can say so. */
export const archiveService = mutation({
	args: { serviceId: v.id('services') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.serviceId))) throw new Error('Service not found');
		const upcomingAppointments = await countUpcoming(ctx, { serviceId: args.serviceId });
		await ctx.db.patch(args.serviceId, { status: 'archived', updatedAt: Date.now() });
		return { upcomingAppointments };
	}
});

/** Saves the services × staff matrix in one go. Refuses if an active service would be left with no one. */
export const setServiceStaffMatrix = mutation({
	args: { assignments: v.array(v.object({ serviceId: v.id('services'), staffIds: v.array(v.id('staff')) })) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (args.assignments.length > 200) throw new Error('Save at most 200 services at once');
		if (new Set(args.assignments.map((row) => row.serviceId)).size !== args.assignments.length) throw new Error('Each service can appear only once');
		const staffCache = new Map<Id<'staff'>, Doc<'staff'> | null>();
		const services: Array<{ service: Doc<'services'>; staffIds: Id<'staff'>[] }> = [];
		const unstaffed: string[] = [];
		for (const row of args.assignments) {
			const service = await ctx.db.get(row.serviceId);
			if (!service) throw new Error('Service not found');
			if (new Set(row.staffIds).size !== row.staffIds.length) throw new Error(`Choose distinct staff members for ${service.name}`);
			for (const id of row.staffIds) {
				if (!staffCache.has(id)) staffCache.set(id, await ctx.db.get(id));
				const person = staffCache.get(id);
				if (!person) throw new Error('Staff member not found');
				if (person.status !== 'active') throw new Error(`${person.name} is archived. Restore them first or choose someone else`);
			}
			if (service.status === 'active' && !row.staffIds.length) unstaffed.push(service.name);
			services.push({ service, staffIds: row.staffIds });
		}
		if (unstaffed.length) throw new Error(`${unstaffed.join(', ')} would have no staff. Assign at least one person to each active service`);
		let updated = 0;
		for (const { service, staffIds } of services) {
			const same = staffIds.length === service.staffIds.length && staffIds.every((id) => service.staffIds.includes(id));
			if (same) continue;
			await ctx.db.patch(service._id, { staffIds, updatedAt: Date.now() });
			updated++;
		}
		return { updated };
	}
});

/** Time off that hasn't ended yet, soonest first. */
export const listTimeOff = query({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const now = Date.now();
		const rows: Doc<'staffTimeOff'>[] = [];
		for await (const row of ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
			q.eq('staffId', args.staffId).gte('start', now - TIME_OFF_LOOKBACK)
		)) {
			if (row.end > now) rows.push(row);
			if (rows.length >= 100) break;
		}
		return rows;
	}
});

/**
 * Adds the same time off for one or more staff. People with booked appointments in the way
 * are skipped and reported with those appointments; everyone else is saved.
 */
export const addTimeOff = mutation({
	args: { staffId: v.optional(v.id('staff')), staffIds: v.optional(v.array(v.id('staff'))), start: v.number(), end: v.number(), label: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const staffIds = [...new Set([...(args.staffId ? [args.staffId] : []), ...(args.staffIds ?? [])])];
		if (!staffIds.length) throw new Error('Choose at least one staff member');
		if (staffIds.length > 200) throw new Error('Choose at most 200 staff members');
		assertTimeOffRange(args.start, args.end);
		const label = required(args.label, 'Label');
		const people = await Promise.all(staffIds.map((id) => ctx.db.get(id)));
		if (people.some((person) => !person)) throw new Error('Staff member not found');
		const results: Array<{ staffId: Id<'staff'>; name: string; timeOffId?: Id<'staffTimeOff'>; conflicts: Array<{ appointmentId: Id<'serviceAppointments'>; start: number }> }> = [];
		for (const person of people as Doc<'staff'>[]) {
			const conflicts = await timeOffConflicts(ctx, person._id, args.start, args.end);
			const timeOffId = conflicts.length
				? undefined
				: await ctx.db.insert('staffTimeOff', { staffId: person._id, start: args.start, end: args.end, label, createdByAdminEmail: admin.email });
			results.push({ staffId: person._id, name: person.name, ...(timeOffId ? { timeOffId } : {}), conflicts });
		}
		return results;
	}
});

export const updateTimeOff = mutation({
	args: { timeOffId: v.id('staffTimeOff'), start: v.number(), end: v.number(), label: v.string(), expected: v.optional(v.object({ start: v.number(), end: v.number(), label: v.string() })) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const row = await ctx.db.get(args.timeOffId);
		if (!row) throw new Error('Time off not found');
		if (args.expected && (row.start !== args.expected.start || row.end !== args.expected.end || row.label !== args.expected.label)) throw new Error('This time off changed since you opened it. Review the latest details and try again.');
		await assertTimeOffFits(ctx, row.staffId, args.start, args.end);
		await ctx.db.patch(row._id, { start: args.start, end: args.end, label: required(args.label, 'Label') });
	}
});

export const removeTimeOff = mutation({
	args: { timeOffId: v.id('staffTimeOff') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.timeOffId))) throw new Error('Time off not found');
		await ctx.db.delete(args.timeOffId);
	}
});

const SELECTED_STAFF_READ_LIMIT = 10;

type ScheduleBlock = { staffId: Id<'staff'>; start: number; end: number; label: string } & (
	| { kind: 'break'; date: string; original: RosterBreak; plan: DayPlan; override: boolean }
	| { kind: 'time_off'; timeOff: Doc<'staffTimeOff'> }
);

export const listSchedule = query({
	args: { from: v.number(), to: v.number(), staffIds: v.optional(v.array(v.id('staff'))) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!Number.isSafeInteger(args.from) || !Number.isSafeInteger(args.to) || args.to <= args.from || args.to - args.from > 14 * DAY) throw new Error('Schedule range must be at most 14 days');
		const selected = args.staffIds ? new Set(args.staffIds) : undefined;
		const inRange: Doc<'serviceAppointments'>[] = [];
		// A few selected people: read only their appointments. Otherwise one scan of the range.
		const ranges = selected && selected.size <= SELECTED_STAFF_READ_LIMIT
			? [...selected].map((staffId) => ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', staffId).gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
			))
			: [ctx.db.query('serviceAppointments').withIndex('by_start', (q) =>
				q.gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
			)];
		for (const range of ranges) {
			for await (const appointment of range) {
				const occupiedUntil = blocksTime(appointment) ? appointment.blockedUntil : appointment.end;
				if (occupiedUntil > args.from && (!selected || selected.has(appointment.staffId))) inRange.push(appointment);
			}
		}
		inRange.sort((a, b) => a.start - b.start);
		const active = (await ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200))
			.filter((person) => !selected || selected.has(person._id));
		// Archived staff appear only when they have appointments in range, so their history stays visible.
		const activeIds = new Set(active.map((person) => person._id));
		const archivedIds = [...new Set(inRange.map((appointment) => appointment.staffId))].filter((id) => !activeIds.has(id));
		const archived = (await Promise.all(archivedIds.map((id) => ctx.db.get(id)))).filter((person): person is Doc<'staff'> => !!person);
		const staff = [...active, ...archived];
		const staffSet = new Set(staff.map((person) => person._id));
		const appointments = inRange.filter((appointment) => staffSet.has(appointment.staffId));
		const services = await ctx.db.query('services').take(200);
		const blocks: ScheduleBlock[] = [];
		// Working time from the roster (override or weekly pattern), so calendars can shade off-hours.
		const shifts: Array<{ staffId: Id<'staff'>; start: number; end: number }> = [];
		const clip = (start: number, end: number) => (start < args.to && end > args.from ? { start: Math.max(start, args.from), end: Math.min(end, args.to) } : null);
		for (const person of staff) {
			for (const { date, plan, override } of await scheduleDays(ctx, person, args.from, args.to)) {
				for (const [start, end] of planWorking(date, plan)) {
					const range = clip(start, end);
					if (range) shifts.push({ staffId: person._id, ...range });
				}
				for (const block of plan.breaks) {
					const range = clip(localDateTimeUtc(date, block.start), localDateTimeUtc(date, block.end));
					// The date, the break as stored and the whole day's plan, so an edit can be checked against what was shown.
					if (range) blocks.push({ staffId: person._id, ...range, label: block.label, kind: 'break', date, original: block, plan, override });
				}
			}
			for await (const row of ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', args.from - TIME_OFF_LOOKBACK).lt('start', args.to)
			)) {
				if (row.end > args.from) blocks.push({ staffId: person._id, start: Math.max(row.start, args.from), end: Math.min(row.end, args.to), label: row.label, kind: 'time_off', timeOff: row });
			}
		}
		return { staff, services, appointments, blocks, shifts };
	}
});

/**
 * Open times, each with `autoStaffId`: who `createAppointment` picks when no staff is given
 * (least appointments that day, then by name), so the dialog can preview the assignment.
 */
export const findOpenSlots = query({
	args: { serviceId: v.id('services'), date: v.string(), staffId: v.optional(v.id('staff')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const slots = await openSlots(ctx, args);
		const [dayStart, dayEnd] = localDayRange(args.date);
		const ranked = new Map<Id<'staff'>, { name: string; count: number }>();
		for (const id of new Set(slots.flatMap((slot) => slot.staffIds))) {
			const person = await ctx.db.get(id);
			let count = 0;
			for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', id).gte('start', dayStart).lt('start', dayEnd)
			)) {
				if (blocksTime(appointment)) count++;
			}
			ranked.set(id, { name: person?.name ?? '', count });
		}
		const order = (a: Id<'staff'>, b: Id<'staff'>) => {
			const x = ranked.get(a)!;
			const y = ranked.get(b)!;
			return x.count - y.count || x.name.localeCompare(y.name) || a.localeCompare(b);
		};
		return slots.map((slot) => ({ ...slot, autoStaffId: [...slot.staffIds].sort(order)[0] }));
	}
});


export const createAppointment = mutation({
	args: {
		serviceId: v.id('services'), start: v.number(), staffId: v.optional(v.id('staff')), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), bookingId: v.optional(v.id('bookings')), chatSessionId: v.optional(v.id('chatSessions')),
		rebookedFromId: v.optional(v.id('serviceAppointments'))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const original = args.rebookedFromId ? await ctx.db.get(args.rebookedFromId) : null;
		if (args.rebookedFromId && (!original || !canBookAgain(original))) throw new Error('Only cancelled or no-show appointments can be booked again');
		const created = await createAppointmentRecord(ctx, { ...args, source: 'admin' });
		if (original) await recordRebooked(ctx, original, created.confirmationCode, admin.email);
		return created;
	}
});

async function loadAppointment(ctx: QueryCtx | MutationCtx, appointmentId: Id<'serviceAppointments'>) {
	const appointment = await ctx.db.get(appointmentId);
	if (!appointment) throw new Error('Appointment not found');
	return appointment;
}

/** Open start times for moving this appointment, keeping its length and turnaround; it doesn't block itself. */
export const rescheduleOptions = query({
	args: { appointmentId: v.id('serviceAppointments'), date: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		const service = await ctx.db.get(appointment.serviceId);
		const staff = service
			? (await Promise.all(service.staffIds.map((id) => ctx.db.get(id)))).filter((person): person is Doc<'staff'> => person?.status === 'active')
			: [];
		const slots = await openStarts(ctx, staff, args.date, appointment.blockedUntil - appointment.start, appointment._id);
		return { staff: staff.map(({ _id, name }) => ({ _id, name })), slots };
	}
});

/**
 * Moves an upcoming booked appointment to another time and/or qualified staff member.
 * The service length, turnaround and price stay as booked; conflicts are rechecked here.
 */
export const rescheduleAppointment = mutation({
	args: { appointmentId: v.id('serviceAppointments'), expectedRevision: v.number(), start: v.number(), staffId: v.id('staff') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (!canReschedule(appointment, Date.now())) throw new Error('This appointment cannot be rescheduled: only upcoming booked appointments can move');
		if (args.start === appointment.start && args.staffId === appointment.staffId) throw new Error('Nothing to change: choose another time or staff member');
		assertAppointmentStart(args.start);
		const service = await ctx.db.get(appointment.serviceId);
		if (!service) throw new Error('Service unavailable');
		const staff = await ctx.db.get(args.staffId);
		if (!staff || !service.staffIds.includes(args.staffId)) throw new Error(`${staff?.name ?? 'This staff member'} doesn't perform ${service.name}`);
		const window = movedWindow(appointment, args.start);
		await assertStaffFree(ctx, staff, window.start, window.blockedUntil, appointment._id);
		await recordAppointmentChange(ctx, appointment, { staffId: args.staffId, ...window }, { actor: admin.email, kind: 'rescheduled' });
	}
});

/** This appointment's turnaround only; the service default is untouched. */
export const updateAppointmentTurnaround = mutation({
	args: { appointmentId: v.id('serviceAppointments'), expectedRevision: v.number(), turnaroundMin: v.number() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (!canEditTurnaround(appointment)) throw new Error('Turnaround can only change while the appointment is booked, arrived or in service');
		const problem = turnaroundProblem(args.turnaroundMin, (appointment.end - appointment.start) / MINUTE);
		if (problem) throw new Error(problem);
		if (args.turnaroundMin === turnaroundMinutes(appointment)) throw new Error('Nothing to change: choose another turnaround');
		const window = withTurnaround(appointment, args.turnaroundMin);
		if (window.blockedUntil > appointment.blockedUntil) {
			const staff = await ctx.db.get(appointment.staffId);
			if (!staff || (await staffBusyRanges(ctx, staff, appointment.blockedUntil, window.blockedUntil, appointment._id)).length) {
				throw new Error(`${staff?.name ?? 'The staff member'} isn't free for the longer turnaround: it would overlap another booking, a break, time off or the end of their shift`);
			}
		}
		await recordAppointmentChange(ctx, appointment, { blockedUntil: window.blockedUntil }, { actor: admin.email, kind: 'turnaround' });
	}
});

const transitions: Record<Doc<'serviceAppointments'>['status'], Doc<'serviceAppointments'>['status'][]> = {
	booked: ['arrived', 'in_service', 'completed', 'no_show'],
	arrived: ['in_service', 'completed', 'no_show'],
	in_service: ['completed'],
	completed: [], cancelled: [], no_show: []
};

export const updateAppointmentStatus = mutation({
	args: { appointmentId: v.id('serviceAppointments'), status: appointmentStatus },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		if (!transitions[appointment.status].includes(args.status)) throw new Error('Invalid appointment status transition');
		if (args.status === 'no_show' && appointment.start > Date.now()) throw new Error('No-show can only be marked after the start time');
		await recordAppointmentChange(ctx, appointment, { status: args.status }, { actor: admin.email, kind: 'status' });
	}
});

export const markAppointmentPaid = mutation({
	args: { appointmentId: v.id('serviceAppointments') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		if (appointment.status === 'cancelled') throw new Error('Cancelled appointment cannot be paid');
		await recordAppointmentChange(ctx, appointment, { paymentStatus: 'paid' }, { actor: admin.email, kind: 'payment' });
	}
});

type ServiceTerms = Pick<Doc<'services'>, 'durationMin' | 'bufferMin' | 'price' | 'currency'>;

/** Same staff and start time; the length, turnaround and price follow the reviewed service. */
async function serviceChange(ctx: MutationCtx, appointment: Doc<'serviceAppointments'>, serviceId: Id<'services'>, expected?: ServiceTerms) {
	if (appointment.status !== 'booked' && appointment.status !== 'arrived') throw new Error('Only booked or arrived appointments can change service');
	if (appointment.paymentStatus !== 'unpaid') throw new Error('Paid appointments cannot change service');
	const service = await ctx.db.get(serviceId);
	if (!service || service.status !== 'active') throw new Error('Service unavailable');
	if (expected && (service.durationMin !== expected.durationMin || service.bufferMin !== expected.bufferMin || service.price !== expected.price || service.currency !== expected.currency)) {
		throw new Error('The service changed since you reviewed it. Review the latest service and try again.');
	}
	const staff = await ctx.db.get(appointment.staffId);
	if (!staff || staff.status !== 'active' || !service.staffIds.includes(staff._id)) {
		throw new Error(`${staff?.name ?? 'This staff member'} doesn't perform ${service.name}`);
	}
	const end = appointment.start + service.durationMin * MINUTE;
	const blockedUntil = end + service.bufferMin * MINUTE;
	if ((await staffBusyRanges(ctx, staff, appointment.start, blockedUntil, appointment._id)).length) {
		throw new Error(`${staff.name} isn't free for the full ${service.durationMin + service.bufferMin} minutes this service needs`);
	}
	return { serviceId: service._id, end, blockedUntil, price: service.price, currency: service.currency };
}

/** Guest details, notes and optionally the service, validated together and saved in one write. */
export const updateAppointmentDetails = mutation({
	args: {
		appointmentId: v.id('serviceAppointments'), expectedRevision: v.number(), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), notes: v.optional(v.string()), serviceId: v.optional(v.id('services')),
		expectedService: v.optional(v.object({ durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string() }))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		const details = guestDetails(args);
		const newServiceId = args.serviceId !== undefined && args.serviceId !== appointment.serviceId ? args.serviceId : null;
		const service = newServiceId ? await serviceChange(ctx, appointment, newServiceId, args.expectedService) : {};
		await recordAppointmentChange(ctx, appointment, { ...details, ...service }, { actor: admin.email, kind: newServiceId ? 'service' : 'details' });
	}
});

/** Records a refund given at the desk; no money moves through the app. */
export const refundAppointment = mutation({
	args: { appointmentId: v.id('serviceAppointments') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		if (appointment.paymentStatus !== 'paid') throw new Error('Only paid appointments can be refunded');
		await recordAppointmentChange(ctx, appointment, { paymentStatus: 'refunded', refundedAt: Date.now() }, { actor: admin.email, kind: 'payment' });
	}
});

/** Keeps the record and its payment state; frees the staff member's time. */
export const cancelAppointment = mutation({
	args: { appointmentId: v.id('serviceAppointments'), expectedRevision: v.number(), reason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (appointment.status !== 'booked' && appointment.status !== 'arrived') throw new Error('Appointment cannot be cancelled');
		await cancelAppointmentRecord(ctx, appointment, { actor: admin.email, reason: args.reason });
	}
});

/** Newest first, at most HISTORY_LIMIT entries. */
export const listAppointmentHistory = query({
	args: { appointmentId: v.id('serviceAppointments') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await appointmentHistory(ctx, args.appointmentId);
	}
});
