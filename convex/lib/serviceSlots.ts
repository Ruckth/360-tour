import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../_generated/server';
import { demoCode } from './codes';
import { assertValidIsoDate, assertValidEmail } from './validation';

const MINUTE = 60_000;
// Asia/Bangkok is UTC+7 with no DST. Use fixed arithmetic: zone-aware helpers returned
// UTC clock times in the Convex production runtime, shifting every service slot by 7 hours.
const RESORT_OFFSET = 7 * 60 * MINUTE;
const DAY = 24 * 60 * MINUTE;
export const TIME_OFF_LOOKBACK = 60 * DAY; // time off is capped at 60 days
export const APPOINTMENT_LOOKBACK = DAY; // duration + buffer is capped at 24 hours
export const SLOT_CONFLICT = 'That time was just taken. Please choose another time.';

export type Range = [start: number, end: number];
export type Slot = { start: number; staffIds: Id<'staff'>[] };
type ReadCtx = QueryCtx | MutationCtx;

/** Local "HH:mm"; "24:00" is allowed so shifts and breaks can end at midnight. */
export function assertValidTime(time: string): void {
	if (!/^(([01]\d|2[0-3]):[0-5]\d|24:00)$/.test(time)) throw new Error('Time must be HH:mm');
}

export function localDateTimeUtc(date: string, time: string): number {
	assertValidIsoDate(date, 'Date');
	assertValidTime(time);
	const [year, month, day] = date.split('-').map(Number);
	const [hour, minute] = time.split(':').map(Number);
	return Date.UTC(year, month - 1, day, hour, minute) - RESORT_OFFSET;
}

export function resortLocalParts(instant: number): { date: string; time: string; weekday: number } {
	const local = new Date(instant + RESORT_OFFSET);
	const pad = (n: number) => String(n).padStart(2, '0');
	return {
		date: local.toISOString().slice(0, 10),
		time: `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`,
		weekday: local.getUTCDay()
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

export type Shift = { start: string; end: string };
export type RosterBreak = { start: string; end: string; label: string };
/** One person's working day: shifts minus breaks. No shifts = off. */
export type DayPlan = { shifts: Shift[]; breaks: RosterBreak[]; note?: string };
type Pattern = Pick<Doc<'staff'>, 'workingHours' | 'breaks'>;

/** 0 = Sunday, for a "YYYY-MM-DD" date. */
export function weekdayOf(date: string): number {
	return new Date(`${date}T00:00:00Z`).getUTCDay();
}

export function addDays(date: string, days: number): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

const byStart = (a: { start: string }, b: { start: string }) => a.start.localeCompare(b.start);

/** The weekly pattern's plan for a date. */
export function patternDay(staff: Pattern, date: string): DayPlan {
	const weekday = weekdayOf(date);
	return {
		shifts: staff.workingHours.filter((h) => h.weekday === weekday).map(({ start, end }) => ({ start, end })).sort(byStart),
		breaks: staff.breaks.filter((b) => b.weekday === weekday).map(({ start, end, label }) => ({ start, end, label })).sort(byStart)
	};
}

/** Roster overrides for one person, keyed by date, in [firstDate, lastDate]. */
export async function staffDayOverrides(ctx: ReadCtx, staffId: Id<'staff'>, firstDate: string, lastDate: string) {
	const rows = new Map<string, Doc<'staffDays'>>();
	for await (const row of ctx.db.query('staffDays').withIndex('by_staff_date', (q) =>
		q.eq('staffId', staffId).gte('date', firstDate).lte('date', lastDate)
	)) {
		rows.set(row.date, row);
	}
	return rows;
}

/** The plan in force on a date: the override row if there is one, otherwise the weekly pattern. */
export function effectivePlan(staff: Pattern, date: string, override: Doc<'staffDays'> | null | undefined): DayPlan {
	if (!override) return patternDay(staff, date);
	return { shifts: override.shifts, breaks: override.breaks, ...(override.note ? { note: override.note } : {}) };
}

/** Working time for a plan on a date, as absolute ranges. */
export function planWorking(date: string, plan: DayPlan): Range[] {
	return mergeRanges(plan.shifts.map((s): Range => [localDateTimeUtc(date, s.start), localDateTimeUtc(date, s.end)]));
}

/** Unavailable time within a date's local day: the gaps around shifts, plus breaks. */
export function planBusy(date: string, plan: DayPlan): Range[] {
	const [dayStart, dayEnd] = localDayRange(date);
	const busy: Range[] = [];
	let cursor = dayStart;
	for (const [start, end] of planWorking(date, plan)) {
		if (start > cursor) busy.push([cursor, start]);
		cursor = Math.max(cursor, end);
	}
	if (cursor < dayEnd) busy.push([cursor, dayEnd]);
	busy.push(...plan.breaks.map((b): Range => [localDateTimeUtc(date, b.start), localDateTimeUtc(date, b.end)]));
	return mergeRanges(busy);
}

/** True when part of [start, end) on this date falls outside the plan's working time. */
export function planUncovers(date: string, plan: DayPlan, start: number, end: number): boolean {
	return planBusy(date, plan).some(([a, b]) => start < b && end > a);
}

/** Each local date touched by [from, to), with the plan in force. */
export async function scheduleDays(ctx: ReadCtx, staff: Doc<'staff'>, from: number, to: number) {
	const days: Array<{ date: string; plan: DayPlan; override: boolean }> = [];
	if (to <= from) return days;
	const first = resortLocalParts(from).date;
	const last = resortLocalParts(to - 1).date;
	const overrides = await staffDayOverrides(ctx, staff._id, first, last);
	for (let date = first; date <= last; date = nextLocalDate(date)) {
		days.push({ date, plan: effectivePlan(staff, date, overrides.get(date)), override: overrides.has(date) });
	}
	return days;
}

export function blocksTime(appointment: Doc<'serviceAppointments'>): boolean {
	return appointment.status !== 'cancelled' && appointment.status !== 'no_show';
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
	const busy: Range[] = [];
	// A roster override replaces the weekly pattern for its date.
	for (const { date, plan } of await scheduleDays(ctx, staff, from, to)) {
		for (const [start, end] of planBusy(date, plan)) {
			if (start < to && end > from) busy.push([Math.max(start, from), Math.min(end, to)]);
		}
	}

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

/** Future 15-minute starts on a date, each with the people free for `occupyMs` from then. */
export async function openStarts(
		ctx: ReadCtx,
		staff: Doc<'staff'>[],
		date: string,
		occupyMs: number,
		ignoreAppointmentId?: Id<'serviceAppointments'>
): Promise<Slot[]> {
	const [dayStart, dayEnd] = localDayRange(date);
	const busy = await Promise.all(staff.map((person) => staffBusyRanges(ctx, person, dayStart, dayEnd + DAY, ignoreAppointmentId)));
	const slots: Slot[] = [];
	for (let start = dayStart; start < dayEnd; start += 15 * MINUTE) {
		if (start < Date.now()) continue;
		const staffIds = staff.filter((_, i) => !busy[i].some(([a, b]) => start < b && start + occupyMs > a)).map((person) => person._id);
		if (staffIds.length) slots.push({ start, staffIds });
	}
	return slots;
}

export async function findOpenSlots(
		ctx: ReadCtx,
		input: { serviceId: Id<'services'>; date: string; staffId?: Id<'staff'> }
): Promise<Slot[]> {
	assertValidIsoDate(input.date, 'Date');
	const service = await ctx.db.get(input.serviceId);
	if (!service || service.status !== 'active') return [];
	const staff = (await Promise.all(service.staffIds.map((id) => ctx.db.get(id))))
		.filter((person): person is Doc<'staff'> => !!person && person.status === 'active' && (!input.staffId || person._id === input.staffId));
	return await openStarts(ctx, staff, input.date, (service.durationMin + service.bufferMin) * MINUTE);
}

/** Whether anyone active who offers the service has shifts on this date. No open slots then means "fully booked", not "not scheduled yet". */
export async function serviceRostered(ctx: ReadCtx, serviceId: Id<'services'>, date: string): Promise<boolean> {
	const service = await ctx.db.get(serviceId);
	if (!service) return false;
	for (const id of service.staffIds) {
		const person = await ctx.db.get(id);
		if (!person || person.status !== 'active') continue;
		const override = await ctx.db.query('staffDays').withIndex('by_staff_date', (q) => q.eq('staffId', id).eq('date', date)).unique();
		if (effectivePlan(person, date, override).shifts.length) return true;
	}
	return false;
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
	rebookedFromId?: Id<'serviceAppointments'>;
	source: Doc<'serviceAppointments'>['source'];
};

/** Trimmed guest details; throws on a missing name or phone, a bad email or long notes. */
export function guestDetails(input: { guestName: string; guestPhone: string; guestEmail?: string; notes?: string }) {
	const guestName = input.guestName.trim();
	const guestPhone = input.guestPhone.trim();
	const guestEmail = input.guestEmail?.trim() || undefined;
	const notes = input.notes?.trim() || undefined;
	if (!guestName) throw new Error('Guest name is required');
	if (!guestPhone) throw new Error('Guest phone is required');
	if (guestEmail) assertValidEmail(guestEmail);
	if (notes && notes.length > 2000) throw new Error('Notes must be at most 2000 characters');
	return { guestName, guestPhone, guestEmail, notes };
}

export async function createAppointmentRecord(ctx: MutationCtx, input: AppointmentInput) {
	assertAppointmentStart(input.start);
	const { guestName, guestPhone, guestEmail } = guestDetails(input);
	const service = await ctx.db.get(input.serviceId);
	if (!service || service.status !== 'active') throw new Error('Service unavailable');
	const blockedUntil = input.start + (service.durationMin + service.bufferMin) * MINUTE;
	const [dayStart, dayEnd] = localDayRange(resortLocalParts(input.start).date);
	const candidates = (await Promise.all(service.staffIds.map((id) => ctx.db.get(id))))
		.filter((person): person is Doc<'staff'> => !!person && person.status === 'active' && (!input.staffId || person._id === input.staffId));
	if (input.staffId && !candidates.length) throw new Error('Staff member is not available for this service');
	const free: Array<{ staff: Doc<'staff'>; count: number }> = [];
	for (const person of candidates) {
		if ((await staffBusyRanges(ctx, person, input.start, blockedUntil)).length) continue;
		let count = 0;
		if (!input.staffId) {
			for await (const appointment of ctx.db.query('serviceAppointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', dayStart).lt('start', dayEnd)
			)) {
				if (blocksTime(appointment)) count++;
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
		...(input.rebookedFromId ? { rebookedFromId: input.rebookedFromId } : {}),
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
