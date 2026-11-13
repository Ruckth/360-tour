import { v } from 'convex/values';
import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { attachPhotoUpload } from '../../lib/adminPhotos';
import { turnaroundProblem } from '../../lib/appointmentWindow';
import { appendRecordHistory } from '../../settings/model';
import { type DayPlan, type RosterBreak } from '../../shared/serviceScheduleTypes';
import { initializeWeeklyPattern } from './rosterHistory';
import { APPOINTMENT_LOOKBACK, TIME_OFF_LOOKBACK, assertValidTime, blocksTime, boundedIntegrityRows, localDayRange, openStarts, staffBusyRanges } from './serviceSlots';

export const DAY = 86_400_000;

export const MINUTE = 60_000;

export const hour = v.object({ weekday: v.number(), start: v.string(), end: v.string() });

export const rest = v.object({ weekday: v.number(), start: v.string(), end: v.string(), label: v.string() });

export const staffStatus = v.union(v.literal('active'), v.literal('archived'));

export const serviceStatus = v.union(v.literal('active'), v.literal('archived'));

// Cancelling goes through cancelAppointment.
export const appointmentStatus = v.union(
	v.literal('arrived'), v.literal('in_service'), v.literal('completed'), v.literal('no_show')
);

export function required(value: string, label: string): string {
	const trimmed = value.trim();
	if (!trimmed) throw new Error(`${label} is required`);
	return trimmed;
}

export function validateHours(rows: Array<{ weekday: number; start: string; end: string; label?: string }>) {
	for (const row of rows) {
		if (!Number.isInteger(row.weekday) || row.weekday < 0 || row.weekday > 6) throw new Error('Weekday must be 0–6');
		assertValidTime(row.start);
		assertValidTime(row.end);
		if (row.start >= row.end) throw new Error('Start must be before end');
		if ('label' in row) required(row.label ?? '', 'Break label');
	}
}

export function validateService(input: Pick<Doc<'services'>, 'durationMin' | 'bufferMin' | 'price'>) {
	if (!Number.isInteger(input.durationMin) || input.durationMin <= 0 || input.durationMin % 15 !== 0) throw new Error('Duration must be a positive multiple of 15 minutes');
	const turnaround = turnaroundProblem(input.bufferMin, input.durationMin);
	if (turnaround) throw new Error(turnaround);
	if (!Number.isSafeInteger(input.price) || input.price < 0) throw new Error('Price must be nonnegative');
}

export async function validateStaffIds(ctx: MutationCtx, staffIds: Id<'staff'>[]) {
	if (!staffIds.length || staffIds.length > 200 || new Set(staffIds).size !== staffIds.length) throw new Error('Choose distinct staff members');
	for (const id of staffIds) {
		const person = await ctx.db.get(id);
		if (!person) throw new Error('Staff member not found');
		if (person.status !== 'active') throw new Error(`${person.name} is archived. Restore them first or choose someone else`);
	}
}

export const appointmentCount = (n: number) => (n === 1 ? '1 upcoming appointment' : `${n} upcoming appointments`);

export const staffSnapshot = (row: Doc<'staff'>) => ({ name: row.name, role: row.role, color: row.color, status: row.status, workingHours: row.workingHours, breaks: row.breaks, archivedServiceIds: row.archivedServiceIds ?? [], hasPhoto: Boolean(row.avatarUrl) });

export const serviceSnapshot = (row: Doc<'services'>) => ({ slug: row.slug, name: row.name, description: row.description, category: row.category, durationMin: row.durationMin, bufferMin: row.bufferMin, price: row.price, currency: row.currency, staffIds: row.staffIds, status: row.status, hasPhoto: Boolean(row.imageUrl) });

export const timeOffSnapshot = (row: Doc<'staffTimeOff'>) => ({ staffId: row.staffId, start: row.start, end: row.end, label: row.label });

export async function logStaff(ctx: MutationCtx, before: Doc<'staff'> | null, after: Doc<'staff'>, actor: string, kind: string) {
	const previous = before ? staffSnapshot(before) : null;
	const next = staffSnapshot(after);
	if (JSON.stringify(previous) !== JSON.stringify(next) || before?.avatarUrl !== after.avatarUrl) await appendRecordHistory(ctx, { entityType: 'staff', entityId: after._id, actor, kind, before: previous, after: { ...next, photoChanged: before?.avatarUrl !== after.avatarUrl } });
}

export async function logService(ctx: MutationCtx, before: Doc<'services'> | null, after: Doc<'services'>, actor: string, kind: string) {
	const previous = before ? serviceSnapshot(before) : null;
	const next = serviceSnapshot(after);
	if (JSON.stringify(previous) !== JSON.stringify(next) || before?.imageUrl !== after.imageUrl) await appendRecordHistory(ctx, { entityType: 'service', entityId: after._id, actor, kind, before: previous, after: { ...next, photoChanged: before?.imageUrl !== after.imageUrl } });
}

/** Appointments that still occupy staff, including completed service turnaround. */
export async function countUpcoming(ctx: QueryCtx | MutationCtx, owner: { staffId: Id<'staff'> } | { serviceId: Id<'services'> }) {
	const now = Date.now();
	const rows = 'staffId' in owner
		? ctx.db.query('appointments').withIndex('by_staff_start', (q) => q.eq('staffId', owner.staffId).gte('start', now - APPOINTMENT_LOOKBACK))
		: ctx.db.query('appointments').withIndex('by_service_start', (q) => q.eq('serviceId', owner.serviceId).gte('start', now - APPOINTMENT_LOOKBACK));
	let count = 0;
	for await (const appointment of boundedIntegrityRows(rows)) {
		if (appointment.blockedUntil > now && blocksTime(appointment)) count++;
	}
	return count;
}

/** Archived staff keep their past appointments but leave every service. */
export async function archiveStaffRecord(ctx: MutationCtx, staff: Doc<'staff'>, actor: string) {
	await initializeWeeklyPattern(ctx, staff._id, actor);
	const upcoming = await countUpcoming(ctx, { staffId: staff._id });
	if (upcoming) throw new Error(`Reassign or cancel ${staff.name}'s ${appointmentCount(upcoming)} first`);
	let servicesUpdated = 0;
	const archivedServiceIds: Id<'services'>[] = [];
	const services = await ctx.db.query('services').take(201);
	if (services.length > 200) throw new Error('Too many services to archive assignments safely. Contact support.');
	for (const service of services) {
		if (!service.staffIds.includes(staff._id)) continue;
		await ctx.db.patch(service._id, { staffIds: service.staffIds.filter((id) => id !== staff._id), updatedAt: Date.now() });
		archivedServiceIds.push(service._id);
		await logService(ctx, service, (await ctx.db.get(service._id))!, actor, 'staff_archived');
		servicesUpdated++;
	}
	await ctx.db.patch(staff._id, { status: 'archived', archivedServiceIds: [...new Set([...(staff.archivedServiceIds ?? []), ...archivedServiceIds])], updatedAt: Date.now() });
	return { servicesUpdated };
}

export function assertTimeOffRange(start: number, end: number) {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > TIME_OFF_LOOKBACK) throw new Error('Time off must be positive and at most 60 days');
}

/** Booked appointments that would fall inside the time off. */
export async function timeOffConflicts(ctx: MutationCtx, staffId: Id<'staff'>, start: number, end: number) {
	const conflicts: Array<{ appointmentId: Id<'appointments'>; start: number }> = [];
	for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staffId).gte('start', start - APPOINTMENT_LOOKBACK).lt('start', end)
	))) {
		if (appointment.blockedUntil > Math.max(start, Date.now()) && blocksTime(appointment)) conflicts.push({ appointmentId: appointment._id, start: appointment.start });
	}
	return conflicts;
}

export async function assertTimeOffFits(ctx: MutationCtx, staffId: Id<'staff'>, start: number, end: number) {
	assertTimeOffRange(start, end);
	if ((await timeOffConflicts(ctx, staffId, start, end)).length) throw new Error('Reassign or cancel the appointments during this time off first');
}

// The browser sends optimized bytes to an action that creates a new file and registers it as pending.
// Public callers cannot register an existing storage ID, so property files cannot become deletable avatars.

export async function attachAvatarUpload(ctx: MutationCtx, storageId: Id<'_storage'>) {
	return { avatarUrl: await attachPhotoUpload(ctx, storageId), avatarStorageId: storageId };
}

export async function attachServiceImage(ctx: MutationCtx, storageId: Id<'_storage'>) {
	return { imageUrl: await attachPhotoUpload(ctx, storageId), imageStorageId: storageId };
}

export const SELECTED_STAFF_READ_LIMIT = 10;

export type ScheduleBlock = { staffId: Id<'staff'>; start: number; end: number; label: string } & (
	| { kind: 'break'; date: string; original: RosterBreak; plan: DayPlan; override: boolean }
	| { kind: 'time_off'; timeOff: Doc<'staffTimeOff'> }
);

export async function loadAppointment(ctx: QueryCtx | MutationCtx, appointmentId: Id<'appointments'>) {
	const appointment = await ctx.db.get(appointmentId);
	if (!appointment) throw new Error('Appointment not found');
	return appointment;
}

export async function boundedStaff(ctx: QueryCtx | MutationCtx) {
	const rows = await ctx.db.query('staff').take(201);
	if (rows.length > 200) throw new Error('Too many staff to show safely. Contact support.');
	return rows;
}

/** Admin-only slot list: past slots are evidence entry, future slots still require availability. */
export async function adminStarts(ctx: QueryCtx | MutationCtx, people: Doc<'staff'>[], date: string, occupyMs: number, ignoreId?: Id<'appointments'>, nonBlocking = false) {
	const [from, to] = localDayRange(date);
	const future = nonBlocking ? [] : await openStarts(ctx, people.filter(p => p.status === 'active'), date, occupyMs, ignoreId);
	const slots = [...future];
	for (let start = from; start < to; start += 15 * MINUTE) {
		if (start + occupyMs <= Date.now() || (nonBlocking && start >= Date.now())) slots.push({ start, staffIds: people.map(p => p._id) });
	}
	return slots.sort((a, b) => a.start - b.start);
}

export function assertPageSize(size: number) {
	if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('Page size must be 1–100');
}

export const transitions: Record<Doc<'appointments'>['status'], Doc<'appointments'>['status'][]> = {
	booked: ['arrived', 'in_service', 'completed', 'no_show'],
	arrived: ['in_service', 'completed', 'no_show'],
	in_service: ['completed'],
	completed: [], cancelled: [], no_show: []
};

export type ServiceTerms = Pick<Doc<'services'>, 'durationMin' | 'bufferMin' | 'price' | 'currency'>;

/** Same staff and start time; the length, turnaround and price follow the reviewed service. */
export async function serviceChange(ctx: MutationCtx, appointment: Doc<'appointments'>, serviceId: Id<'services'>, expected?: ServiceTerms) {
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
	return { serviceId: service._id, serviceNameSnapshot: service.name, end, blockedUntil, price: service.price, currency: service.currency };
}

export type RosterConflict = {
	staffId: Id<'staff'>;
	staffName: string;
	date: string;
	appointmentId: Id<'appointments'>;
	start: number;
	end: number;
	guestName: string;
	confirmationCode: string;
	serviceName: string;
};

export const STALE_ROSTER = 'This roster day changed since you opened it. Review the latest schedule and try again.';

export const NOT_SCHEDULED = 'The staff schedule for this date is not set yet, so it is not fully booked. Say it is not scheduled yet and offer another date or to have the team follow up.';

export const STAFF_AVATAR_UPLOAD_TTL_MS = 24 * 60 * 60 * 1000;
