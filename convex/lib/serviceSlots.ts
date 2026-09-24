import { TZDate } from '@date-fns/tz';
import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { demoCode } from './codes';
import { assertValidIsoDate, assertValidEmail } from './validation';

const ZONE = 'Asia/Bangkok';
const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TIME_OFF_LOOKBACK = 60 * DAY;
const APPOINTMENT_LOOKBACK = DAY; // duration + buffer is capped at 24 hours
export const SLOT_CONFLICT = 'That time was just taken. Please choose another time.';

export type Range = [start: number, end: number];
export type Slot = { start: number; staffIds: Id<'staff'>[] };
type ReadCtx = QueryCtx | MutationCtx;
type LocalBlock = { weekday: number; start: string; end: string; label?: string };

export function assertValidTime(time: string): void {
	if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error('Time must be HH:mm');
}

export function localDateTimeUtc(date: string, time: string): number {
	assertValidIsoDate(date, 'Date');
	assertValidTime(time);
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	return TZDate.tz(ZONE, year, month - 1, day, hour, minute).getTime();
}

export function resortLocalParts(instant: number): { date: string; time: string; weekday: number } {
	const local = TZDate.tz(ZONE, instant);
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
		time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
		weekday: local.getDay()
	};
}

export function nextLocalDate(date: string): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function localDayRange(date: string): Range {
	return [localDateTimeUtc(date, '00:00'), localDateTimeUtc(nextLocalDate(date), '00:00')];
}

export function assertAppointmentStart(start: number): void {
	if (!Number.isSafeInteger(start) || start < Date.now() || start % (15 * MINUTE) !== 0) {
		throw new Error('Start must be a future 15-minute time');
	}
}

export function mergeRanges(ranges: Range[]): Range[] {
	const sorted = ranges.filter(([start, end]) => end > start).sort((a, b) => a[0] - b[0]);
	const merged: Range[] = [];
	for (const range of sorted) {
		const last = merged[merged.length - 1];
		if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
		else merged.push([...range]);
	}
	return merged;
}

export function recurringBlocks(
		blocks: LocalBlock[],
		from: number,
		to: number
): Array<{ start: number; end: number; label?: string }> {
	const result: Array<{ start: number; end: number; label?: string }> = [];
	if (to <= from) return result;
	let date = resortLocalParts(from).date;
	const lastDate = resortLocalParts(to - 1).date;
	while (date <= lastDate) {
		const weekday = resortLocalParts(localDateTimeUtc(date, '00:00')).weekday;
		for (const block of blocks) {
			if (block.weekday !== weekday) continue;
			const start = localDateTimeUtc(date, block.start);
			const end = localDateTimeUtc(date, block.end);
			if (start < to && end > from) {
				result.push({ start: Math.max(start, from), end: Math.min(end, to), label: block.label });
			}
		}
		date = nextLocalDate(date);
	}
	return result;
}

/** All unavailable time within [from, to), including the gaps around working hours. */
export async function staffBusyRanges(
		ctx: ReadCtx,
		staff: Doc<'staff'>,
		from: number,
		to: number,
		ignoreAppointmentId?: Id<'serviceAppointments'>
): Promise<Range[]> {
	if (to <= from) return [];
	const working = mergeRanges(recurringBlocks(staff.workingHours, from, to).map((b) => [b.start, b.end]));
	const busy: Range[] = [];
	let cursor = from;
	for (const [start, end] of working) {
		if (start > cursor) busy.push([cursor, start]);
		cursor = Math.max(cursor, end);
	}
	if (cursor < to) busy.push([cursor, to]);
	busy.push(...recurringBlocks(staff.breaks, from, to).map((b): Range => [b.start, b.end]));

	for await (const row of ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staff._id).gte('start', from - TIME_OFF_LOOKBACK).lt('start', to)
	)) {
		if (row.end > from) busy.push([Math.max(row.start, from), Math.min(row.end, to)]);
	}
	for await (const row of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staff._id).gte('start', from - APPOINTMENT_LOOKBACK).lt('start', to)
	)) {
		if (row._id !== ignoreAppointmentId && row.status !== 'cancelled' && row.status !== 'no_show' && row.blockedUntil > from) {
			busy.push([Math.max(row.start, from), Math.min(row.blockedUntil, to)]);
		}
	}
	return mergeRanges(busy);
}

export async function assertStaffFree(
		ctx: ReadCtx,
		staff: Doc<'staff'>,
		start: number,
		blockedUntil: number,
		ignoreAppointmentId?: Id<'serviceAppointments'>
): Promise<void> {
	if (staff.status !== 'active' || (await staffBusyRanges(ctx, staff, start, blockedUntil, ignoreAppointmentId)).length) {
		throw new Error(SLOT_CONFLICT);
	}
}

export async function findOpenSlots(
		ctx: ReadCtx,
		input: { serviceId: Id<'services'>; date: string; staffId?: Id<'staff'> }
): Promise<Slot[]> {
	const [dayStart, dayEnd] = localDayRange(input.date);
	const service = await ctx.db.get(input.serviceId);
	if (!service || service.status !== 'active') return [];
	const duration = (service.durationMin + service.bufferMin) * MINUTE;
	const staff = (await Promise.all(service.staffIds.map((id) => ctx.db.get(id))))
		.filter((person): person is Doc<'staff'> => !!person && person.status === 'active' && (!input.staffId || person._id === input.staffId));
	const busy = await Promise.all(staff.map((person) => staffBusyRanges(ctx, person, dayStart, dayEnd + DAY)));
	const slots: Slot[] = [];
	for (let start = dayStart; start < dayEnd; start += 15 * MINUTE) {
		if (start < Date.now()) continue;
		const staffIds = staff.filter((_, i) => !busy[i].some(([a, b]) => start < b && start + duration > a)).map((person) => person._id);
		if (staffIds.length) slots.push({ start, staffIds });
	}
	return slots;
}

export type AppointmentInput = {
	serviceId: Id<'services'>;
	start: number;
	staffId?: Id<'staff'>;
	guestName: string;
	guestPhone: string;
	guestEmail?: string;
	bookingId?: Id<'bookings'>;
	chatSessionId?: Id<'chatSessions'>;
	source: Doc<'serviceAppointments'>['source'];
};

export async function createAppointmentRecord(ctx: MutationCtx, input: AppointmentInput) {
	assertAppointmentStart(input.start);
	const guestName = input.guestName.trim();
	const guestPhone = input.guestPhone.trim();
	const guestEmail = input.guestEmail?.trim() || undefined;
	if (!guestName) throw new Error('Guest name is required');
	if (!guestPhone) throw new Error('Guest phone is required');
	if (guestEmail) assertValidEmail(guestEmail);
	const service = await ctx.db.get(input.serviceId);
	if (!service || service.status !== 'active') throw new Error('Service unavailable');
	const blockedUntil = input.start + (service.durationMin + service.bufferMin) * MINUTE;
	const [dayStart, dayEnd] = localDayRange(resortLocalParts(input.start).date);
	const candidates = (await Promise.all(service.staffIds.map((id) => ctx.db.get(id))))
		.filter((person): person is Doc<'staff'> => !!person && person.status === 'active' && (!input.staffId || person._id === input.staffId));
	const free: Array<{ staff: Doc<'staff'>; count: number }> = [];
	for (const person of candidates) {
		try {
			await assertStaffFree(ctx, person, input.start, blockedUntil);
		} catch (error) {
			if (error instanceof Error && error.message === SLOT_CONFLICT) continue;
			throw error;
		}
		let count = 0;
		if (!input.staffId) {
			for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', dayStart).lt('start', dayEnd)
			)) {
				if (appointment.status !== 'cancelled') count++;
			}
		}
		free.push({ staff: person, count });
	}
	free.sort((a, b) => a.count - b.count || a.staff.name.localeCompare(b.staff.name) || a.staff._id.localeCompare(b.staff._id));
	const chosen = free[0]?.staff;
	if (!chosen) throw new Error(SLOT_CONFLICT);
	const accessToken = crypto.randomUUID();
	const appointmentId = await ctx.db.insert('serviceAppointments', {
		serviceId: service._id,
		staffId: chosen._id,
		start: input.start,
		end: input.start + service.durationMin * MINUTE,
		blockedUntil,
		guestName,
		guestPhone,
		...(guestEmail ? { guestEmail } : {}),
		...(input.bookingId ? { bookingId: input.bookingId } : {}),
		...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
		source: input.source,
		status: 'booked',
		paymentStatus: 'unpaid',
		price: service.price,
		currency: service.currency,
		confirmationCode: '',
		accessToken,
		createdAt: Date.now()
	});
	const confirmationCode = demoCode('SVC', appointmentId);
	await ctx.db.patch(appointmentId, { confirmationCode });
	return { appointmentId, staffId: chosen._id, confirmationCode, accessToken };
}
