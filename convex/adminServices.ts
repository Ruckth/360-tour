import { v } from 'convex/values';
import { paginationOptsValidator } from 'convex/server';
import { initializeWeeklyPattern, writeWeeklyPattern } from './lib/rosterHistory';
import { appendRecordHistory } from './lib/recordHistory';
import { action, internalMutation, mutation, query } from './_generated/server';
import { internal } from './_generated/api';
import type { MutationCtx, QueryCtx } from './_generated/server';
import type { Doc, Id } from './_generated/dataModel';
import { requireAdmin } from './lib/adminAuth';
import { avatarUploadProblem } from './lib/imageUploads';
import { attachPhotoUpload, deleteStoredFile, deleteUnreferencedPhoto, pendingAvatarUpload } from './lib/adminPhotos';
import {
	APPOINTMENT_LOOKBACK,
	TIME_OFF_LOOKBACK,
	assertAppointmentStart,
	blocksTime,
	boundedIntegrityRows,
	assertStaffFree,
	assertValidTime,
	createAppointmentRecord,
	findOpenSlots as openSlots,
	guestDetails,
	historicalWarnings,
	resortLocalParts,
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
	canCorrectAppointmentTime,
	movedWindow,
	turnaroundMinutes,
	turnaroundProblem,
	withTurnaround
} from './lib/appointmentWindow';
import {
	appointmentHistory,
	assertFresh,
	cleanReason,
	cancelAppointmentRecord,
	recordAppointmentChange,
	recordRebooked
} from './lib/appointmentChanges';

import { appointmentFinancials, recordAppointmentPayment, recordAppointmentRefund, correctAppointmentPayment } from './lib/appointmentFinance';
import { manualPaymentMethod, refundMethod } from './lib/financeValidators';

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
	if (!Number.isSafeInteger(input.price) || input.price < 0) throw new Error('Price must be nonnegative');
}

async function validateStaffIds(ctx: MutationCtx, staffIds: Id<'staff'>[]) {
	if (!staffIds.length || staffIds.length > 200 || new Set(staffIds).size !== staffIds.length) throw new Error('Choose distinct staff members');
	for (const id of staffIds) {
		const person = await ctx.db.get(id);
		if (!person) throw new Error('Staff member not found');
		if (person.status !== 'active') throw new Error(`${person.name} is archived. Restore them first or choose someone else`);
	}
}

const appointmentCount = (n: number) => (n === 1 ? '1 upcoming appointment' : `${n} upcoming appointments`);

const staffSnapshot = (row: Doc<'staff'>) => ({ name: row.name, role: row.role, color: row.color, status: row.status, workingHours: row.workingHours, breaks: row.breaks, archivedServiceIds: row.archivedServiceIds ?? [], hasPhoto: Boolean(row.avatarUrl) });
const serviceSnapshot = (row: Doc<'services'>) => ({ slug: row.slug, name: row.name, description: row.description, category: row.category, durationMin: row.durationMin, bufferMin: row.bufferMin, price: row.price, currency: row.currency, staffIds: row.staffIds, status: row.status, hasPhoto: Boolean(row.imageUrl) });
const timeOffSnapshot = (row: Doc<'staffTimeOff'>) => ({ staffId: row.staffId, start: row.start, end: row.end, label: row.label });
async function logStaff(ctx: MutationCtx, before: Doc<'staff'> | null, after: Doc<'staff'>, actor: string, kind: string) {
	const previous = before ? staffSnapshot(before) : null;
	const next = staffSnapshot(after);
	if (JSON.stringify(previous) !== JSON.stringify(next) || before?.avatarUrl !== after.avatarUrl) await appendRecordHistory(ctx, { entityType: 'staff', entityId: after._id, actor, kind, before: previous, after: { ...next, photoChanged: before?.avatarUrl !== after.avatarUrl } });
}
async function logService(ctx: MutationCtx, before: Doc<'services'> | null, after: Doc<'services'>, actor: string, kind: string) {
	const previous = before ? serviceSnapshot(before) : null;
	const next = serviceSnapshot(after);
	if (JSON.stringify(previous) !== JSON.stringify(next) || before?.imageUrl !== after.imageUrl) await appendRecordHistory(ctx, { entityType: 'service', entityId: after._id, actor, kind, before: previous, after: { ...next, photoChanged: before?.imageUrl !== after.imageUrl } });
}

/** Appointments that still occupy staff, including completed service turnaround. */
async function countUpcoming(ctx: QueryCtx | MutationCtx, owner: { staffId: Id<'staff'> } | { serviceId: Id<'services'> }) {
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
async function archiveStaffRecord(ctx: MutationCtx, staff: Doc<'staff'>, actor: string) {
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

function assertTimeOffRange(start: number, end: number) {
	if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || end <= start || end - start > TIME_OFF_LOOKBACK) throw new Error('Time off must be positive and at most 60 days');
}

/** Booked appointments that would fall inside the time off. */
async function timeOffConflicts(ctx: MutationCtx, staffId: Id<'staff'>, start: number, end: number) {
	const conflicts: Array<{ appointmentId: Id<'appointments'>; start: number }> = [];
	for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staffId).gte('start', start - APPOINTMENT_LOOKBACK).lt('start', end)
	))) {
		if (appointment.blockedUntil > Math.max(start, Date.now()) && blocksTime(appointment)) conflicts.push({ appointmentId: appointment._id, start: appointment.start });
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
		const rows = args.includeArchived
			? await ctx.db.query('staff').take(201)
			: await ctx.db.query('staff').withIndex('by_status', q => q.eq('status', 'active')).take(201);
		if (rows.length > 200) throw new Error('Too many staff to show safely. Narrow the list or contact support.');
		return rows;
	}
});

// The browser sends optimized bytes to an action that creates a new file and registers it as pending.
// Public callers cannot register an existing storage ID, so property files cannot become deletable avatars.

async function attachAvatarUpload(ctx: MutationCtx, storageId: Id<'_storage'>) {
	return { avatarUrl: await attachPhotoUpload(ctx, storageId), avatarStorageId: storageId };
}

async function attachServiceImage(ctx: MutationCtx, storageId: Id<'_storage'>) {
	return { imageUrl: await attachPhotoUpload(ctx, storageId), imageStorageId: storageId };
}

export const registerStaffAvatarUpload = internalMutation({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		await ctx.db.insert('staffAvatarUploads', { storageId: args.storageId, createdAt: Date.now() });
		return null;
	}
});

export const uploadStaffAvatar = action({
	args: { bytes: v.bytes(), contentType: v.string() },
	handler: async (ctx, args): Promise<Id<'_storage'>> => {
		await requireAdmin(ctx);
		const problem = avatarUploadProblem(args.contentType, args.bytes.byteLength);
		if (problem) throw new Error(problem);
		const storageId = await ctx.storage.store(new Blob([args.bytes], { type: args.contentType }));
		try {
			await ctx.runMutation(internal.adminServices.registerStaffAvatarUpload, { storageId });
			return storageId;
		} catch (error) {
			await ctx.storage.delete(storageId);
			throw error;
		}
	}
});

/** Drops an upload whose save failed or was cancelled. Does nothing once the photo is attached. */
export const discardStaffAvatarUpload = mutation({
	args: { storageId: v.id('_storage') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const pending = await pendingAvatarUpload(ctx, args.storageId);
		if (!pending) return null;
		await ctx.db.delete(pending._id);
		await deleteStoredFile(ctx, args.storageId);
		return null;
	}
});

export const createStaff = mutation({
	args: { name: v.string(), role: v.string(), avatarUrl: v.optional(v.string()), avatarStorageId: v.optional(v.id('_storage')), color: v.string(), workingHours: v.array(hour), breaks: v.array(rest) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		if (args.avatarStorageId !== undefined && args.avatarUrl !== undefined) throw new Error('Send either a photo upload or a photo URL');
		validateHours(args.workingHours);
		validateHours(args.breaks);
		const now = Date.now();
		const id = await ctx.db.insert('staff', {
			...args, name: required(args.name, 'Name'), role: required(args.role, 'Role'), color: required(args.color, 'Color'),
			...(args.avatarStorageId ? await attachAvatarUpload(ctx, args.avatarStorageId) : {}),
			status: 'active', createdAt: now, updatedAt: now
		});
		await initializeWeeklyPattern(ctx, id, admin.email);
		await logStaff(ctx, null, (await ctx.db.get(id))!, admin.email, 'created');
		return id;
	}
});

export const updateStaff = mutation({
	// `avatarStorageId`: an uploaded photo to attach, or null to remove the photo. `avatarUrl` sets an external URL.
	args: { staffId: v.id('staff'), name: v.optional(v.string()), role: v.optional(v.string()), avatarUrl: v.optional(v.string()), avatarStorageId: v.optional(v.union(v.id('_storage'), v.null())), color: v.optional(v.string()), status: v.optional(staffStatus), workingHours: v.optional(v.array(hour)), breaks: v.optional(v.array(rest)) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const { staffId, avatarStorageId, avatarUrl, ...changes } = args;
		await initializeWeeklyPattern(ctx, staffId, admin.email);
		if (changes.status === 'archived' && staff.status !== 'archived') await archiveStaffRecord(ctx, staff, admin.email);
		validateHours(changes.workingHours ?? staff.workingHours);
		validateHours(changes.breaks ?? staff.breaks);
		if (changes.workingHours || changes.breaks) {
			// Install the proposed version before availability validation; failure rolls back version, log and profile together.
			await writeWeeklyPattern(ctx, staff, { workingHours: changes.workingHours ?? staff.workingHours, breaks: changes.breaks ?? staff.breaks }, admin.email);
			// New hours must still cover every upcoming appointment.
			const next = { ...staff, ...changes };
			const now = Date.now();
			for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', staffId).gte('start', now - APPOINTMENT_LOOKBACK)
			))) {
				if (appointment.blockedUntil <= now || !blocksTime(appointment)) continue;
				if ((await staffBusyRanges(ctx, next, appointment.start, appointment.blockedUntil, appointment._id)).length) {
					throw new Error('Reassign or cancel the appointments outside the new hours first');
				}
			}
		}
		if (avatarStorageId !== undefined && avatarUrl !== undefined) throw new Error('Send either a photo upload or a photo URL');
		// Omitting both keeps the current photo, as does re-sending what is already saved.
		let photo: { avatarUrl?: string; avatarStorageId?: Id<'_storage'> } | null = null;
		if (avatarStorageId === null) photo = { avatarUrl: undefined, avatarStorageId: undefined };
		else if (avatarStorageId !== undefined) {
			if (avatarStorageId !== staff.avatarStorageId) photo = await attachAvatarUpload(ctx, avatarStorageId);
		} else if (avatarUrl !== undefined && (avatarUrl.trim() || undefined) !== staff.avatarUrl) {
			// A blank photo URL clears the photo.
			photo = { avatarUrl: avatarUrl.trim() || undefined, avatarStorageId: undefined };
		}
		await ctx.db.patch(staffId, {
			...changes,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.role !== undefined ? { role: required(changes.role, 'Role') } : {}),
			...(changes.color !== undefined ? { color: required(changes.color, 'Color') } : {}),
			...photo,
			updatedAt: Date.now()
		});
		if (staff.status === 'archived' && changes.status === 'active') {
			for (const serviceId of staff.archivedServiceIds ?? []) {
				const service = await ctx.db.get(serviceId);
				if (!service || service.staffIds.includes(staffId)) continue;
				if (service.staffIds.length >= 200) throw new Error('Too many service assignments to restore safely');
				await ctx.db.patch(serviceId, { staffIds: [...service.staffIds, staffId], updatedAt: Date.now() });
				await logService(ctx, service, (await ctx.db.get(serviceId))!, admin.email, 'staff_restored');
			}
			await ctx.db.patch(staffId, { archivedServiceIds: undefined });
		}
		await logStaff(ctx, staff, (await ctx.db.get(staffId))!, admin.email, 'updated');
		// Last, and in this transaction: a failed save rolls the delete back and keeps the old photo.
		if (photo && staff.avatarStorageId) {
			await deleteUnreferencedPhoto(ctx, staff.avatarStorageId, staff.avatarUrl, staffId);
		}
	}
});

export const archiveStaff = mutation({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const result = await archiveStaffRecord(ctx, staff, admin.email);
		await logStaff(ctx, staff, (await ctx.db.get(staff._id))!, admin.email, 'archived');
		return result;
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
		const rows = args.includeArchived
			? await ctx.db.query('services').take(201)
			: await ctx.db.query('services').withIndex('by_status', q => q.eq('status', 'active')).take(201);
		if (rows.length > 200) throw new Error('Too many services to show safely. Narrow the list or contact support.');
		return rows;
	}
});

export const createService = mutation({
	args: { slug: v.string(), name: v.string(), description: v.string(), category: v.string(), durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string(), staffIds: v.array(v.id('staff')), imageStorageId: v.optional(v.id('_storage')) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const slug = required(args.slug, 'Slug').toLowerCase();
		if (await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first()) throw new Error('Service slug already exists');
		validateService(args);
		await validateStaffIds(ctx, args.staffIds);
		const now = Date.now();
		const id = await ctx.db.insert('services', {
			...args, slug, name: required(args.name, 'Name'), description: args.description.trim(),
			category: required(args.category, 'Category'), currency: required(args.currency, 'Currency'),
			...(args.imageStorageId ? await attachServiceImage(ctx, args.imageStorageId) : {}),
			status: 'active', createdAt: now, updatedAt: now
		});
		await logService(ctx, null, (await ctx.db.get(id))!, admin.email, 'created');
		return id;
	}
});

export const updateService = mutation({
	args: { serviceId: v.id('services'), slug: v.optional(v.string()), name: v.optional(v.string()), description: v.optional(v.string()), category: v.optional(v.string()), durationMin: v.optional(v.number()), bufferMin: v.optional(v.number()), price: v.optional(v.number()), currency: v.optional(v.string()), staffIds: v.optional(v.array(v.id('staff'))), status: v.optional(serviceStatus),
		// An uploaded photo to attach, or null to remove the photo. Omitted keeps the current one.
		imageStorageId: v.optional(v.union(v.id('_storage'), v.null())) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const service = await ctx.db.get(args.serviceId);
		if (!service) throw new Error('Service not found');
		const { serviceId, imageStorageId, ...changes } = args;
		const slug = changes.slug !== undefined ? required(changes.slug, 'Slug').toLowerCase() : service.slug;
		const duplicate = await ctx.db.query('services').withIndex('by_slug', (q) => q.eq('slug', slug)).first();
		if (duplicate && duplicate._id !== serviceId) throw new Error('Service slug already exists');
		validateService({ durationMin: changes.durationMin ?? service.durationMin, bufferMin: changes.bufferMin ?? service.bufferMin, price: changes.price ?? service.price });
		if (changes.staffIds) await validateStaffIds(ctx, changes.staffIds);
		if (changes.status === 'active' && service.status !== 'active') {
			const staff = await Promise.all((changes.staffIds ?? service.staffIds).map((id) => ctx.db.get(id)));
			if (!staff.some((person) => person?.status === 'active')) throw new Error('Assign at least one active staff member before restoring this service');
		}
		let photo: { imageUrl?: string; imageStorageId?: Id<'_storage'> } | null = null;
		if (imageStorageId === null) photo = { imageUrl: undefined, imageStorageId: undefined };
		else if (imageStorageId !== undefined && imageStorageId !== service.imageStorageId) photo = await attachServiceImage(ctx, imageStorageId);
		await ctx.db.patch(serviceId, {
			...changes, slug, ...photo,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.category !== undefined ? { category: required(changes.category, 'Category') } : {}),
			...(changes.currency !== undefined ? { currency: required(changes.currency, 'Currency') } : {}),
			...(changes.description !== undefined ? { description: changes.description.trim() } : {}),
			updatedAt: Date.now()
		});
		await logService(ctx, service, (await ctx.db.get(serviceId))!, admin.email, 'updated');
		// Last, and in this transaction: a failed save rolls the delete back and keeps the old photo.
		if (photo && service.imageStorageId) await deleteUnreferencedPhoto(ctx, service.imageStorageId, service.imageUrl);
	}
});

/** Upcoming appointments stay booked; the count is returned so the UI can say so. */
export const archiveService = mutation({
	args: { serviceId: v.id('services') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const service = await ctx.db.get(args.serviceId);
		if (!service) throw new Error('Service not found');
		const upcomingAppointments = await countUpcoming(ctx, { serviceId: args.serviceId });
		await ctx.db.patch(args.serviceId, { status: 'archived', updatedAt: Date.now() });
		await logService(ctx, service, (await ctx.db.get(args.serviceId))!, admin.email, 'archived');
		return { upcomingAppointments };
	}
});

/** Saves the services × staff matrix in one go. Refuses if an active service would be left with no one. */
export const setServiceStaffMatrix = mutation({
	args: { assignments: v.array(v.object({ serviceId: v.id('services'), staffIds: v.array(v.id('staff')) })) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		if (args.assignments.length > 200) throw new Error('Save at most 200 services at once');
		if (new Set(args.assignments.map((row) => row.serviceId)).size !== args.assignments.length) throw new Error('Each service can appear only once');
		const staffCache = new Map<Id<'staff'>, Doc<'staff'> | null>();
		const services: Array<{ service: Doc<'services'>; staffIds: Id<'staff'>[] }> = [];
		const unstaffed: string[] = [];
		for (const row of args.assignments) {
			if (row.staffIds.length > 200) throw new Error('Assign at most 200 staff to one service');
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
			await logService(ctx, service, (await ctx.db.get(service._id))!, admin.email, 'assignments');
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
		for await (const row of boundedIntegrityRows(ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
			q.eq('staffId', args.staffId).gte('start', now - TIME_OFF_LOOKBACK)
		))) {
			if (row.end > now) rows.push(row);
			if (rows.length > 100) throw new Error('More time off is available. Use the paginated time-off reader.');
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
		const results: Array<{ staffId: Id<'staff'>; name: string; timeOffId?: Id<'staffTimeOff'>; conflicts: Array<{ appointmentId: Id<'appointments'>; start: number }> }> = [];
		for (const person of people as Doc<'staff'>[]) {
			const conflicts = await timeOffConflicts(ctx, person._id, args.start, args.end);
			const timeOffId = conflicts.length
				? undefined
				: await ctx.db.insert('staffTimeOff', { staffId: person._id, start: args.start, end: args.end, label, createdByAdminEmail: admin.email });
			if (timeOffId) await appendRecordHistory(ctx, { entityType: 'timeOff', entityId: timeOffId, actor: admin.email, kind: 'created', effectiveAt: args.start, after: { staffId: person._id, staffName: person.name, start: args.start, end: args.end, label } });
			results.push({ staffId: person._id, name: person.name, ...(timeOffId ? { timeOffId } : {}), conflicts });
		}
		return results;
	}
});

export const updateTimeOff = mutation({
	args: { timeOffId: v.id('staffTimeOff'), start: v.number(), end: v.number(), label: v.string(), expected: v.optional(v.object({ start: v.number(), end: v.number(), label: v.string() })) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const row = await ctx.db.get(args.timeOffId);
		if (!row) throw new Error('Time off not found');
		if (args.expected && (row.start !== args.expected.start || row.end !== args.expected.end || row.label !== args.expected.label)) throw new Error('This time off changed since you opened it. Review the latest details and try again.');
		await assertTimeOffFits(ctx, row.staffId, args.start, args.end);
		const after = { start: args.start, end: args.end, label: required(args.label, 'Label') };
		await ctx.db.patch(row._id, after);
		await appendRecordHistory(ctx, { entityType: 'timeOff', entityId: row._id, actor: admin.email, kind: 'updated', effectiveAt: args.start, before: timeOffSnapshot(row), after: { staffId: row.staffId, ...after } });
	}
});

export const removeTimeOff = mutation({
	args: { timeOffId: v.id('staffTimeOff') },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const row = await ctx.db.get(args.timeOffId);
		if (!row) throw new Error('Time off not found');
		await ctx.db.delete(args.timeOffId);
		await appendRecordHistory(ctx, { entityType: 'timeOff', entityId: row._id, actor: admin.email, kind: 'removed', effectiveAt: row.start, before: timeOffSnapshot(row) });
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
		const inRange: Doc<'appointments'>[] = [];
		// A few selected people: read only their appointments. Otherwise one scan of the range.
		const ranges = selected && selected.size <= SELECTED_STAFF_READ_LIMIT
			? [...selected].map((staffId) => ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', staffId).gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
			))
			: [ctx.db.query('appointments').withIndex('by_start', (q) =>
				q.gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
			)];
		for (const range of ranges) {
			for await (const appointment of boundedIntegrityRows(range)) {
				const occupiedUntil = blocksTime(appointment) ? appointment.blockedUntil : appointment.end;
				if (occupiedUntil > args.from && (!selected || selected.has(appointment.staffId))) inRange.push(appointment);
				if (inRange.length > 2000) throw new Error('Too many appointments to show safely. Narrow the calendar range.');
			}
		}
		inRange.sort((a, b) => a.start - b.start);
		const activeRows = await ctx.db.query('staff').withIndex('by_status', q => q.eq('status', 'active')).take(201);
		if (activeRows.length > 200) throw new Error('Too many staff to show safely. Contact support.');
		const active = activeRows.filter(person => !selected || selected.has(person._id));
		// Archived staff appear only when they have appointments in range, so their history stays visible.
		const activeIds = new Set(active.map((person) => person._id));
		const archivedIds = [...new Set(inRange.map((appointment) => appointment.staffId))].filter((id) => !activeIds.has(id));
		const archived = (await Promise.all(archivedIds.map((id) => ctx.db.get(id)))).filter((person): person is Doc<'staff'> => !!person);
		const staff = [...active, ...archived];
		const staffSet = new Set(staff.map((person) => person._id));
		const appointments = inRange.filter((appointment) => staffSet.has(appointment.staffId));
		const services = await ctx.db.query('services').take(201);
		if (services.length > 200) throw new Error('Too many services to show safely. Contact support.');
		const blocks: ScheduleBlock[] = [];
		// Working time from the roster (override or weekly pattern), so calendars can shade off-hours.
		const patternHistory: Array<{ staffId: Id<'staff'>; date: string; known: boolean; knownFrom: string }> = [];
		const shifts: Array<{ staffId: Id<'staff'>; start: number; end: number }> = [];
		const clip = (start: number, end: number) => (start < args.to && end > args.from ? { start: Math.max(start, args.from), end: Math.min(end, args.to) } : null);
		for (const person of staff) {
			for (const { date, plan, override, patternHistoryKnown, patternKnownFrom } of await scheduleDays(ctx, person, args.from, args.to)) {
				patternHistory.push({ staffId: person._id, date, known: patternHistoryKnown, knownFrom: patternKnownFrom });
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
			for await (const row of boundedIntegrityRows(ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', args.from - TIME_OFF_LOOKBACK).lt('start', args.to)
			))) {
				if (row.end > args.from) blocks.push({ staffId: person._id, start: Math.max(row.start, args.from), end: Math.min(row.end, args.to), label: row.label, kind: 'time_off', timeOff: row });
			}
		}
		return { staff, services, appointments, blocks, shifts, patternHistory };
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
		const service = await ctx.db.get(args.serviceId);
		let slots;
		if (service && args.staffId && args.date <= resortLocalParts(Date.now()).date) {
			const person = await ctx.db.get(args.staffId);
			slots = person ? await adminStarts(ctx, [person], args.date, (service.durationMin + service.bufferMin) * MINUTE) : [];
			slots = slots.filter(slot => slot.start + (service.durationMin + service.bufferMin) * MINUTE <= Date.now() || (person?.status === 'active' && service.status === 'active' && service.staffIds.includes(person._id)));
		} else slots = await openSlots(ctx, args);
		const [dayStart, dayEnd] = localDayRange(args.date);
		const ranked = new Map<Id<'staff'>, { name: string; count: number }>();
		for (const id of new Set(slots.flatMap((slot) => slot.staffIds))) {
			const person = await ctx.db.get(id);
			let count = 0;
			for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', id).gte('start', dayStart).lt('start', dayEnd)
			))) {
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


/** The original booking reference for rebooked appointments, including ones outside the visible calendar dates. */
export const getAppointmentReference = query({
	args: { appointmentId: v.id('appointments') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return (await ctx.db.get(args.appointmentId))?.confirmationCode ?? null;
	}
});

export const createAppointment = mutation({
	args: {
		serviceId: v.id('services'), start: v.number(), staffId: v.optional(v.id('staff')), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), bookingId: v.optional(v.id('bookings')), chatSessionId: v.optional(v.id('conversations')),
		rebookedFromId: v.optional(v.id('appointments')), historicalReason: v.optional(v.string())
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const original = args.rebookedFromId ? await ctx.db.get(args.rebookedFromId) : null;
		if (args.rebookedFromId && (!original || !canBookAgain(original))) throw new Error('Only cancelled or no-show appointments can be booked again');
		const created = await createAppointmentRecord(ctx, { ...args, source: 'admin', actor: admin.email }, { kind: 'admin_historical', reason: args.historicalReason });
		if (original) await recordRebooked(ctx, original, created.confirmationCode, admin.email);
		return created;
	}
});

async function loadAppointment(ctx: QueryCtx | MutationCtx, appointmentId: Id<'appointments'>) {
	const appointment = await ctx.db.get(appointmentId);
	if (!appointment) throw new Error('Appointment not found');
	return appointment;
}

async function boundedStaff(ctx: QueryCtx | MutationCtx) {
	const rows = await ctx.db.query('staff').take(201);
	if (rows.length > 200) throw new Error('Too many staff to show safely. Contact support.');
	return rows;
}

/** Admin-only slot list: past slots are evidence entry, future slots still require availability. */
async function adminStarts(ctx: QueryCtx | MutationCtx, people: Doc<'staff'>[], date: string, occupyMs: number, ignoreId?: Id<'appointments'>, nonBlocking = false) {
	const [from, to] = localDayRange(date);
	const future = nonBlocking ? [] : await openStarts(ctx, people.filter(p => p.status === 'active'), date, occupyMs, ignoreId);
	const slots = [...future];
	for (let start = from; start < to; start += 15 * MINUTE) {
		if (start + occupyMs <= Date.now() || (nonBlocking && start >= Date.now())) slots.push({ start, staffIds: people.map(p => p._id) });
	}
	return slots.sort((a, b) => a.start - b.start);
}

export const previewAppointmentTime = query({
	args: { serviceId: v.id('services'), staffId: v.id('staff'), start: v.number(), appointmentId: v.optional(v.id('appointments')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		try { assertAppointmentStart(args.start, { kind: 'admin_historical' }); }
		catch (error) { return { warnings: [], needsReason: false, problem: error instanceof Error ? error.message : 'Choose a valid service time' }; }
		const service = await ctx.db.get(args.serviceId);
		const person = await ctx.db.get(args.staffId);
		if (!service || !person) throw new Error('Staff or service not found');
		const appointment = args.appointmentId ? await loadAppointment(ctx, args.appointmentId) : null;
		const occupied = appointment ? appointment.blockedUntil - appointment.start : (service.durationMin + service.bufferMin) * MINUTE;
		if (args.start + occupied > Date.now()) {
			let problem: string | null = null;
			if ((!appointment || args.staffId !== appointment.staffId) && (service.status !== 'active' || !service.staffIds.includes(args.staffId))) problem = 'Choose an active service and a currently assigned staff member for current or future work.';
			if ((!appointment || blocksTime(appointment)) && (person.status !== 'active' || (await staffBusyRanges(ctx, person, args.start, args.start + occupied, appointment?._id)).length)) problem = 'The staff member is not available for the full service and turnaround. Choose another time or correct the conflicting schedule first.';
			return { warnings: [], needsReason: false, problem };
		}
		return { ...await historicalWarnings(ctx, person, service, args.start, args.start + occupied, appointment?._id), problem: null };
	}
});

/** Deliberate correction, separate from the frictionless forward operational buttons. */
export const correctAppointmentStatus = mutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), status: v.union(v.literal('booked'), v.literal('arrived'), v.literal('in_service'), v.literal('completed'), v.literal('cancelled'), v.literal('no_show')), reason: v.optional(v.string()), effectiveAt: v.number() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (appointment.status === args.status) throw new Error('Choose a different status');
		const reason = cleanReason(args.reason);
		if (['completed', 'cancelled', 'no_show', 'in_service'].includes(appointment.status) && !reason) throw new Error('Explain why the recorded status was mistaken');
		if (!Number.isSafeInteger(args.effectiveAt) || args.effectiveAt > Date.now()) throw new Error('Effective time must be an actual past or current time');
		if (args.status === 'no_show' && appointment.start > args.effectiveAt) throw new Error('No-show can only be marked after the start time');
		const nextBlocks = args.status !== 'cancelled' && args.status !== 'no_show';
		let warnings: string[] = [];
		if (nextBlocks) {
			const person = await ctx.db.get(appointment.staffId);
			if (!person) throw new Error('Staff member not found');
			if (appointment.blockedUntil > Date.now()) {
				// Real current/future occupancy is never overridable.
				await assertStaffFree(ctx, person, appointment.start, appointment.blockedUntil, appointment._id);
			} else {
				const service = await ctx.db.get(appointment.serviceId);
				if (!service) throw new Error('Service not found');
				const review = await historicalWarnings(ctx, person, service, appointment.start, appointment.blockedUntil, appointment._id);
				warnings = review.warnings;
				if (review.needsReason && !reason) throw new Error('Explain the historical appointment overlap before saving');
			}
		}
		await recordAppointmentChange(ctx, appointment, { status: args.status,
			cancelledAt: args.status === 'cancelled' ? args.effectiveAt : undefined,
			cancelledBy: args.status === 'cancelled' ? admin.email : undefined,
			cancellationReason: args.status === 'cancelled' ? reason : undefined
		}, { actor: admin.email, kind: 'status', reason, effectiveAt: args.effectiveAt, warnings });
	}
});

export const listAppointmentHistoryPage = query({
	args: { appointmentId: v.id('appointments'), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		assertPageSize(args.paginationOpts.numItems);
		return await ctx.db.query('appointmentChanges').withIndex('by_appointmentId_and_at', q => q.eq('appointmentId', args.appointmentId)).order('desc').paginate(args.paginationOpts);
	}
});

function assertPageSize(size: number) {
	if (!Number.isInteger(size) || size < 1 || size > 100) throw new Error('Page size must be 1–100');
}

/** start-based range, [from,to); past/all include ended records. Consumers must follow the cursor. */
export const listTimeOffPage = query({
	args: { staffId: v.id('staff'), range: v.union(v.literal('upcoming'), v.literal('past'), v.literal('all')), from: v.optional(v.number()), to: v.optional(v.number()), paginationOpts: paginationOptsValidator },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		assertPageSize(args.paginationOpts.numItems);
		if ((args.from !== undefined && !Number.isSafeInteger(args.from)) || (args.to !== undefined && !Number.isSafeInteger(args.to)) || (args.from !== undefined && args.to !== undefined && args.to <= args.from)) throw new Error('Invalid time-off range');
		const result = await ctx.db.query('staffTimeOff').withIndex('by_staff_start', q => {
			const staff = q.eq('staffId', args.staffId);
			return args.from !== undefined ? (args.to !== undefined ? staff.gte('start', args.from).lt('start', args.to) : staff.gte('start', args.from)) : args.to !== undefined ? staff.lt('start', args.to) : staff;
		}).order('desc').paginate(args.paginationOpts);
		const now = Date.now();
		return { ...result, page: result.page.filter(row => args.range === 'all' || (args.range === 'past' ? row.end <= now : row.end > now)) };
	}
});

/** Open start times for moving this appointment, keeping its length and turnaround; it doesn't block itself. */
export const rescheduleOptions = query({
	args: { appointmentId: v.id('appointments'), date: v.string() },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		const service = await ctx.db.get(appointment.serviceId);
		const historicalDate = args.date <= resortLocalParts(Date.now()).date;
		const staff = historicalDate ? await boundedStaff(ctx) : service
			? (await Promise.all([...new Set([...service.staffIds, appointment.staffId])].map(id => ctx.db.get(id)))).filter((person): person is Doc<'staff'> => !!person && (person.status === 'active' || person._id === appointment.staffId)) : [];
		const starts = await adminStarts(ctx, staff, args.date, appointment.blockedUntil - appointment.start, appointment._id, !blocksTime(appointment));
		const slots = starts.map(slot => slot.start + appointment.blockedUntil - appointment.start <= Date.now() ? slot : { ...slot, staffIds: slot.staffIds.filter(id => id === appointment.staffId || service?.staffIds.includes(id)) }).filter(slot => slot.staffIds.length);
		return { staff: staff.map(({ _id, name }) => ({ _id, name })), slots };
	}
});

/**
 * Corrects an appointment's time/staff in any status. Financial terms stay as booked.
 * Past roster gaps are logged; historical overlaps need a reason; current/future occupancy is strict.
 */
export const rescheduleAppointment = mutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), start: v.number(), staffId: v.id('staff'), historicalReason: v.optional(v.string()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		if (!canCorrectAppointmentTime(appointment, Date.now())) throw new Error('This appointment cannot be rescheduled');
		if (args.start === appointment.start && args.staffId === appointment.staffId) throw new Error('Nothing to change: choose another time or staff member');
		assertAppointmentStart(args.start, { kind: 'admin_historical' });
		const service = await ctx.db.get(appointment.serviceId);
		if (!service) throw new Error('Service unavailable');
		const staff = await ctx.db.get(args.staffId);
		if (!staff) throw new Error('Staff member not found');
		const window = movedWindow(appointment, args.start);
		const historical = window.blockedUntil <= Date.now();
		const reason = cleanReason(args.historicalReason);
		let warnings: string[] = [];
		if (historical) {
			const review = await historicalWarnings(ctx, staff, service, window.start, window.blockedUntil, appointment._id);
			warnings = review.warnings;
			if (review.needsReason && !reason) throw new Error('Explain the historical appointment overlap before saving');
		} else {
			// The existing assignment is booked truth even when the template was later archived/reassigned.
			if (args.staffId !== appointment.staffId && (!service.staffIds.includes(args.staffId) || service.status !== 'active')) throw new Error(`${staff.name} doesn't perform ${service.name}`);
			if (blocksTime(appointment)) await assertStaffFree(ctx, staff, window.start, window.blockedUntil, appointment._id);
		}
		await recordAppointmentChange(ctx, appointment, { staffId: args.staffId, staffNameSnapshot: args.staffId === appointment.staffId ? appointment.staffNameSnapshot ?? staff.name : staff.name, ...window }, { actor: admin.email, kind: 'rescheduled', reason, effectiveAt: window.start, warnings });
	}
});

/** This appointment's turnaround only; the service default is untouched. */
export const updateAppointmentTurnaround = mutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), turnaroundMin: v.number() },
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

const transitions: Record<Doc<'appointments'>['status'], Doc<'appointments'>['status'][]> = {
	booked: ['arrived', 'in_service', 'completed', 'no_show'],
	arrived: ['in_service', 'completed', 'no_show'],
	in_service: ['completed'],
	completed: [], cancelled: [], no_show: []
};

export const updateAppointmentStatus = mutation({
	args: { appointmentId: v.id('appointments'), status: appointmentStatus, expectedRevision: v.optional(v.number()) },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		if (args.expectedRevision !== undefined) assertFresh(appointment, args.expectedRevision);
		if (!transitions[appointment.status].includes(args.status)) throw new Error('Invalid appointment status transition');
		if (args.status === 'no_show' && appointment.start > Date.now()) throw new Error('No-show can only be marked after the start time');
		await recordAppointmentChange(ctx, appointment, { status: args.status }, { actor: admin.email, kind: 'status' });
	}
});

export const markAppointmentPaid = mutation({
 args: { appointmentId: v.id('appointments'), expectedRevision: v.optional(v.number()), effectiveAt: v.optional(v.number()), method: v.optional(manualPaymentMethod), idempotencyKey: v.optional(v.string()) },
 handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx);
  return await recordAppointmentPayment(ctx, await loadAppointment(ctx, args.appointmentId), args, admin.email);
 }
});

export const getAppointmentFinancials = query({
 args: { appointmentId: v.id('appointments') },
 handler: async (ctx, args) => {
  await requireAdmin(ctx);
  return await appointmentFinancials(ctx, await loadAppointment(ctx, args.appointmentId));
 }
});

export const correctAppointmentPaymentEntry = mutation({
 args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), paymentId: v.id('appointmentPayments'), idempotencyKey: v.string(), action: v.union(v.literal('amend'), v.literal('cancel')), reason: v.string(), method: v.optional(manualPaymentMethod), effectiveAt: v.optional(v.number()) },
 handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx);
  return await correctAppointmentPayment(ctx, await loadAppointment(ctx, args.appointmentId), args, admin.email);
 }
});

type ServiceTerms = Pick<Doc<'services'>, 'durationMin' | 'bufferMin' | 'price' | 'currency'>;

/** Same staff and start time; the length, turnaround and price follow the reviewed service. */
async function serviceChange(ctx: MutationCtx, appointment: Doc<'appointments'>, serviceId: Id<'services'>, expected?: ServiceTerms) {
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

/** Guest details, notes and optionally the service, validated together and saved in one write. */
export const updateAppointmentDetails = mutation({
	args: {
		appointmentId: v.id('appointments'), expectedRevision: v.number(), guestName: v.string(), guestPhone: v.string(),
		guestEmail: v.optional(v.string()), notes: v.optional(v.string()), serviceId: v.optional(v.id('services')),
		expectedService: v.optional(v.object({ durationMin: v.number(), bufferMin: v.number(), price: v.number(), currency: v.string() }))
	},
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		const appointment = await loadAppointment(ctx, args.appointmentId);
		assertFresh(appointment, args.expectedRevision);
		const details = guestDetails(args, { requireContact: appointment.source !== 'admin' || Boolean(appointment.chatSessionId) });
		const newServiceId = args.serviceId !== undefined && args.serviceId !== appointment.serviceId ? args.serviceId : null;
		const service = newServiceId ? await serviceChange(ctx, appointment, newServiceId, args.expectedService) : {};
		await recordAppointmentChange(ctx, appointment, { ...details, ...service }, { actor: admin.email, kind: newServiceId ? 'service' : 'details' });
	}
});

/** Records a refund given at the desk; no money moves through the app. */
export const refundAppointment = mutation({
 args: { appointmentId: v.id('appointments'), expectedRevision: v.optional(v.number()), effectiveAt: v.optional(v.number()), amount: v.optional(v.number()), currency: v.optional(v.string()), method: v.optional(refundMethod), reason: v.optional(v.string()), idempotencyKey: v.optional(v.string()), paymentId: v.optional(v.id('appointmentPayments')), orderId: v.optional(v.id('orders')) },
 handler: async (ctx, args) => {
  const admin = await requireAdmin(ctx);
  return await recordAppointmentRefund(ctx, await loadAppointment(ctx, args.appointmentId), args, admin.email);
 }
});

/** Keeps the record and its payment state; frees the staff member's time. */
export const cancelAppointment = mutation({
	args: { appointmentId: v.id('appointments'), expectedRevision: v.number(), reason: v.optional(v.string()) },
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
	args: { appointmentId: v.id('appointments') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await appointmentHistory(ctx, args.appointmentId);
	}
});
