import { v } from 'convex/values';
import { mutation, query } from './_generated/server';
import type { MutationCtx } from './_generated/server';
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
	recurringBlocks
} from './lib/serviceSlots';

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
	if (!Number.isInteger(input.bufferMin) || input.bufferMin < 0 || input.bufferMin % 5 !== 0) throw new Error('Buffer must be a nonnegative multiple of 5 minutes');
	if (input.durationMin + input.bufferMin > 1440) throw new Error('Duration and buffer cannot exceed 24 hours');
	if (!Number.isFinite(input.price) || input.price < 0) throw new Error('Price must be nonnegative');
}

async function validateStaffIds(ctx: MutationCtx, staffIds: Id<'staff'>[]) {
	if (!staffIds.length || new Set(staffIds).size !== staffIds.length) throw new Error('Choose distinct staff members');
	for (const id of staffIds) if (!(await ctx.db.get(id))) throw new Error('Staff member not found');
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
		validateHours(changes.workingHours ?? staff.workingHours);
		validateHours(changes.breaks ?? staff.breaks);
		await ctx.db.patch(staffId, {
			...changes,
			...(changes.name !== undefined ? { name: required(changes.name, 'Name') } : {}),
			...(changes.role !== undefined ? { role: required(changes.role, 'Role') } : {}),
			...(changes.color !== undefined ? { color: required(changes.color, 'Color') } : {}),
			updatedAt: Date.now()
		});
	}
});

export const archiveStaff = mutation({
	args: { staffId: v.id('staff') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.staffId))) throw new Error('Staff member not found');
		for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
			q.eq('staffId', args.staffId).gte('start', Date.now() - APPOINTMENT_LOOKBACK)
		)) {
			if (appointment.blockedUntil > Date.now() && blocksTime(appointment) && appointment.status !== 'completed') {
				throw new Error('Reassign or cancel this staff member\'s upcoming appointments first');
			}
		}
		await ctx.db.patch(args.staffId, { status: 'archived', updatedAt: Date.now() });
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

export const archiveService = mutation({
	args: { serviceId: v.id('services') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!(await ctx.db.get(args.serviceId))) throw new Error('Service not found');
		await ctx.db.patch(args.serviceId, { status: 'archived', updatedAt: Date.now() });
	}
});

export const addTimeOff = mutation({
	args: { staffId: v.id('staff'), start: v.number(), end: v.number(), label: v.string() },
	handler: async (ctx, args) => {
		const admin = await requireAdmin(ctx);
		if (!(await ctx.db.get(args.staffId))) throw new Error('Staff member not found');
		if (!Number.isSafeInteger(args.start) || !Number.isSafeInteger(args.end) || args.end <= args.start || args.end - args.start > TIME_OFF_LOOKBACK) throw new Error('Time off must be positive and at most 60 days');
		for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
			q.eq('staffId', args.staffId).gte('start', args.start - APPOINTMENT_LOOKBACK).lt('start', args.end)
		)) {
			if (appointment.blockedUntil > args.start && appointment.status === 'booked') {
				throw new Error('Reassign or cancel the appointments during this time off first');
			}
		}
		return await ctx.db.insert('staffTimeOff', { ...args, label: required(args.label, 'Label'), createdByAdminEmail: admin.email });
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

export const listSchedule = query({
	args: { from: v.number(), to: v.number(), staffIds: v.optional(v.array(v.id('staff'))) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		if (!Number.isSafeInteger(args.from) || !Number.isSafeInteger(args.to) || args.to <= args.from || args.to - args.from > 14 * DAY) throw new Error('Schedule range must be at most 14 days');
		const selected = args.staffIds ? new Set(args.staffIds) : undefined;
		const staff = (await ctx.db.query('staff').withIndex('by_status', (q) => q.eq('status', 'active')).take(200))
			.filter((person) => !selected || selected.has(person._id));
		const services = await ctx.db.query('services').take(200);
		const staffSet = new Set(staff.map((person) => person._id));
		const appointments: Doc<'serviceAppointments'>[] = [];
		for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_start', (q) =>
			q.gte('start', args.from - APPOINTMENT_LOOKBACK).lt('start', args.to)
		)) {
			if (appointment.end > args.from && staffSet.has(appointment.staffId)) appointments.push(appointment);
		}
		const blocks: Array<{ staffId: Id<'staff'>; start: number; end: number; label: string; kind: 'break' | 'time_off' }> = [];
		for (const person of staff) {
			for (const block of recurringBlocks(person.breaks, args.from, args.to)) {
				blocks.push({ staffId: person._id, start: block.start, end: block.end, label: block.label ?? '', kind: 'break' });
			}
			for await (const row of ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', args.from - TIME_OFF_LOOKBACK).lt('start', args.to)
			)) {
				if (row.end > args.from) blocks.push({ staffId: person._id, start: Math.max(row.start, args.from), end: Math.min(row.end, args.to), label: row.label, kind: 'time_off' });
			}
		}
		return { staff, services, appointments, blocks };
	}
});

export const findOpenSlots = query({
	args: { serviceId: v.id('services'), date: v.string(), staffId: v.optional(v.id('staff')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await openSlots(ctx, args);
	}
});

export const createAppointment = mutation({
	args: { serviceId: v.id('services'), start: v.number(), staffId: v.optional(v.id('staff')), guestName: v.string(), guestPhone: v.string(), guestEmail: v.optional(v.string()), bookingId: v.optional(v.id('bookings')), chatSessionId: v.optional(v.id('chatSessions')) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		return await createAppointmentRecord(ctx, { ...args, source: 'admin' });
	}
});

/** Move (drag) or resize an upcoming appointment; `durationMin` defaults to the current length. */
export const rescheduleAppointment = mutation({
	args: { appointmentId: v.id('serviceAppointments'), start: v.number(), staffId: v.optional(v.id('staff')), durationMin: v.optional(v.number()) },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const appointment = await ctx.db.get(args.appointmentId);
		if (!appointment) throw new Error('Appointment not found');
		if (appointment.status !== 'booked') throw new Error('Appointment cannot be rescheduled');
		assertAppointmentStart(args.start);
		const service = await ctx.db.get(appointment.serviceId);
		if (!service) throw new Error('Service unavailable');
		const durationMin = args.durationMin ?? (appointment.end - appointment.start) / MINUTE;
		validateService({ durationMin, bufferMin: service.bufferMin, price: appointment.price });
		const staffId = args.staffId ?? appointment.staffId;
		const staff = await ctx.db.get(staffId);
		if (!staff || !service.staffIds.includes(staffId)) throw new Error('Staff member is not qualified');
		const end = args.start + durationMin * MINUTE;
		const blockedUntil = end + service.bufferMin * MINUTE;
		await assertStaffFree(ctx, staff, args.start, blockedUntil, appointment._id);
		await ctx.db.patch(appointment._id, { staffId, start: args.start, end, blockedUntil });
	}
});

const transitions: Record<Doc<'serviceAppointments'>['status'], Doc<'serviceAppointments'>['status'][]> = {
	booked: ['arrived', 'in_service', 'completed', 'no_show', 'cancelled'],
	arrived: ['in_service', 'completed', 'no_show', 'cancelled'],
	in_service: ['completed'],
	completed: [], cancelled: [], no_show: []
};

export const updateAppointmentStatus = mutation({
	args: { appointmentId: v.id('serviceAppointments'), status: appointmentStatus },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const appointment = await ctx.db.get(args.appointmentId);
		if (!appointment) throw new Error('Appointment not found');
		if (!transitions[appointment.status].includes(args.status)) throw new Error('Invalid appointment status transition');
		if (args.status === 'no_show' && appointment.start > Date.now()) throw new Error('No-show can only be marked after the start time');
		await ctx.db.patch(appointment._id, { status: args.status });
	}
});

export const markAppointmentPaid = mutation({
	args: { appointmentId: v.id('serviceAppointments') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const appointment = await ctx.db.get(args.appointmentId);
		if (!appointment) throw new Error('Appointment not found');
		if (appointment.status === 'cancelled') throw new Error('Cancelled appointment cannot be paid');
		await ctx.db.patch(appointment._id, { paymentStatus: 'paid' });
	}
});

export const cancelAppointment = mutation({
	args: { appointmentId: v.id('serviceAppointments') },
	handler: async (ctx, args) => {
		await requireAdmin(ctx);
		const appointment = await ctx.db.get(args.appointmentId);
		if (!appointment) throw new Error('Appointment not found');
		if (!transitions[appointment.status].includes('cancelled')) throw new Error('Appointment cannot be cancelled');
		await ctx.db.patch(appointment._id, { status: 'cancelled' });
	}
});
