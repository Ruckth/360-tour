import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { requireAdmin } from '../../auth/model';
import { demoCode } from '../../lib/codes';
import { ensureLinkedOrder } from '../../lib/orderLinks';
import { assertValidEmail, assertValidIsoDate } from '../../lib/validation';
import { appendRecordHistory } from '../../settings/model';
import { RESORT_OFFSET, resortLocalParts } from '../../shared/resortLocalParts';
import type { DayPlan } from '../../shared/serviceScheduleTypes';
import { patternForDate, patternsForRange } from './rosterHistory';

const MINUTE = 60_000;

const DAY = 24 * 60 * MINUTE;

export const TIME_OFF_LOOKBACK = 60 * DAY;

// time off is capped at 60 days
export const APPOINTMENT_LOOKBACK = DAY;

// duration + buffer is capped at 24 hours
export const SLOT_CONFLICT = 'That time was just taken. Please choose another time.';

export type Range = [start: number, end: number];

export type Slot = { start: number; staffIds: Id<'staff'>[] };

type ReadCtx = QueryCtx | MutationCtx;

/** Integrity scans fail explicitly on overflow; they never approve against a truncated prefix. */
export async function* boundedIntegrityRows<T>(rows: AsyncIterable<T>, limit = 2000): AsyncGenerator<T> {
	let count = 0;
	for await (const row of rows) {
		if (++count > limit) throw new Error('Too many records to check safely. Narrow the range or contact support.');
		yield row;
	}
}

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

export function nextLocalDate(date: string): string {
	const [year, month, day] = date.split('-').map(Number);
	return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

export function localDayRange(date: string): Range {
	return [localDateTimeUtc(date, '00:00'), localDateTimeUtc(nextLocalDate(date), '00:00')];
}

export function assertAppointmentStart(start: number, policy?: AdminHistoricalPolicy): void {
	const historical = Boolean(policy && start < Date.now());
	if (!Number.isSafeInteger(start) || (!policy && start < Date.now()) || start % (historical ? MINUTE : 15 * MINUTE) !== 0) {
		throw new Error(historical ? 'Historical start must be a valid whole-minute time' : 'Start must be a future 15-minute time');
	}
}

/** Only passed explicitly by an authenticated admin endpoint. Public/chat callers omit it. */
export type AdminHistoricalPolicy = { kind: 'admin_historical'; reason?: string };

/** Retrospective evidence is not today's roster. Overlaps need a deliberate, logged explanation. */
export async function historicalWarnings(ctx: ReadCtx, staff: Doc<'staff'>, service: Doc<'services'>, start: number, blockedUntil: number, ignoreAppointmentId?: Id<'appointments'>) {
	const warnings: string[] = [];
	if ((await scheduleDays(ctx, staff, start, blockedUntil)).some(day => !day.patternHistoryKnown)) warnings.push('The weekly roster for this earlier date is unknown; the earliest observed pattern is shown. Verify the historical schedule.');
	if (staff.status !== 'active') warnings.push('Staff member is archived.');
	if (service.status !== 'active') warnings.push('Service is archived.');
	if (!service.staffIds.includes(staff._id)) warnings.push('Current service assignments do not confirm this historical assignment; verify who actually performed the work.');
	if ((await staffBusyRanges(ctx, staff, start, blockedUntil, ignoreAppointmentId)).length) warnings.push('The current roster, breaks, time off or appointment records do not show this entire time as available. These are not proof of the historical roster.');
	let overlap = false;
	for await (const row of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', q => q.eq('staffId', staff._id).gte('start', start - APPOINTMENT_LOOKBACK).lt('start', blockedUntil)))) {
		if (row._id !== ignoreAppointmentId && blocksTime(row) && row.blockedUntil > start) overlap = true;
	}
	if (overlap) warnings.push('Another appointment overlaps this historical time. Explain the correction before saving.');
	return { warnings, needsReason: overlap };
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
	for await (const row of boundedIntegrityRows(ctx.db.query('staffDays').withIndex('by_staff_date', (q) =>
		q.eq('staffId', staffId).gte('date', firstDate).lte('date', lastDate)
	))) {
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
	const days: Array<{ date: string; plan: DayPlan; override: boolean; patternHistoryKnown: boolean; patternKnownFrom: string }> = [];
	if (to <= from) return days;
	const first = resortLocalParts(from).date;
	const last = resortLocalParts(to - 1).date;
	const overrides = await staffDayOverrides(ctx, staff._id, first, last);
	const patterns = await patternsForRange(ctx, [staff], first, last);
	const resolve = patterns.get(staff._id)!;
	for (let date = first; date <= last; date = nextLocalDate(date)) {
		const evidence = resolve(date);
		days.push({ date, plan: effectivePlan(evidence.pattern, date, overrides.get(date)), override: overrides.has(date),
		 patternHistoryKnown: overrides.has(date) || evidence.historyKnown, patternKnownFrom: evidence.knownFrom });
	}
	return days;
}

export function blocksTime(appointment: Doc<'appointments'>): boolean {
	return appointment.status !== 'cancelled' && appointment.status !== 'no_show';
}

/** All unavailable time within [from, to), including the gaps around working hours. */
export async function staffBusyRanges(
		ctx: ReadCtx,
		staff: Doc<'staff'>,
		from: number,
		to: number,
		ignoreAppointmentId?: Id<'appointments'>
): Promise<Range[]> {
	if (to <= from) return [];
	const busy: Range[] = [];
	// A roster override replaces the weekly pattern for its date.
	for (const { date, plan } of await scheduleDays(ctx, staff, from, to)) {
		for (const [start, end] of planBusy(date, plan)) {
			if (start < to && end > from) busy.push([Math.max(start, from), Math.min(end, to)]);
		}
	}

	for await (const row of boundedIntegrityRows(ctx.db.query('staffTimeOff').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staff._id).gte('start', from - TIME_OFF_LOOKBACK).lt('start', to)
	))) {
		if (row.end > from) busy.push([Math.max(row.start, from), Math.min(row.end, to)]);
	}
	for await (const row of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
		q.eq('staffId', staff._id).gte('start', from - APPOINTMENT_LOOKBACK).lt('start', to)
	))) {
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
		ignoreAppointmentId?: Id<'appointments'>
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
		ignoreAppointmentId?: Id<'appointments'>
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
		if (effectivePlan((await patternForDate(ctx, person, date)).pattern, date, override).shifts.length) return true;
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
	chatSessionId?: Id<'conversations'>;
	rebookedFromId?: Id<'appointments'>;
	source: Doc<'appointments'>['source'];
	/** Who created it (an admin's email), recorded on its order. Defaults to the channel. */
	actor?: string;
};

/** Admin appointments may reserve a slot before guest details are known. Chat bookings still require contact details. */
export function guestDetails(input: { guestName: string; guestPhone: string; guestEmail?: string; notes?: string }, { requireContact = true } = {}) {
	const guestName = input.guestName.trim();
	const guestPhone = input.guestPhone.trim();
	const guestEmail = input.guestEmail?.trim() || undefined;
	const notes = input.notes?.trim() || undefined;
	if (requireContact && !guestName) throw new Error('Guest name is required');
	if (requireContact && !guestPhone) throw new Error('Guest phone is required');
	if (guestEmail) assertValidEmail(guestEmail);
	if (notes && notes.length > 2000) throw new Error('Notes must be at most 2000 characters');
	return { guestName, guestPhone, guestEmail, notes };
}

/**
 * The exact-lookup forms stored with an appointment's guest details (schema `guestPhoneDigits`).
 * `guestPhoneDigits` is always written ('' for no phone) so a missing value only ever means a row
 * saved before these fields; `guestEmailNormalized` is cleared when the email is removed.
 */
export function appointmentLookupFields(guest: { guestPhone: string; guestEmail?: string }) {
	return {
		guestPhoneDigits: guest.guestPhone.replace(/\D/g, ''),
		guestEmailNormalized: guest.guestEmail?.trim().toLowerCase() || undefined
	};
}

export async function createAppointmentRecord(ctx: MutationCtx, input: AppointmentInput, policy?: AdminHistoricalPolicy) {
	const admin = policy ? await requireAdmin(ctx) : null;
	assertAppointmentStart(input.start, policy);
	const { guestName, guestPhone, guestEmail } = guestDetails(input, { requireContact: input.source !== 'admin' || Boolean(input.chatSessionId) });
	const service = await ctx.db.get(input.serviceId);
	if (!service) throw new Error('Service unavailable');
	const blockedUntil = input.start + (service.durationMin + service.bufferMin) * MINUTE;
	const historical = Boolean(policy && blockedUntil <= Date.now());
	if (!historical && service.status !== 'active') throw new Error('Service unavailable');
	if (historical && !input.staffId) throw new Error('Choose the staff member who actually performed the historical service');
	const [dayStart, dayEnd] = localDayRange(resortLocalParts(input.start).date);
	const candidates = (await Promise.all((historical && input.staffId ? [input.staffId] : service.staffIds).map((id) => ctx.db.get(id))))
		.filter((person): person is Doc<'staff'> => !!person && (historical || person.status === 'active') && (!input.staffId || person._id === input.staffId));
	if (input.staffId && !candidates.length) throw new Error('Staff member is not available for this service');
	const free: Array<{ staff: Doc<'staff'>; count: number }> = [];
	for (const person of candidates) {
		if (!historical && (await staffBusyRanges(ctx, person, input.start, blockedUntil)).length) continue;
		let count = 0;
		if (!input.staffId) {
			for await (const appointment of boundedIntegrityRows(ctx.db.query('appointments').withIndex('by_staff_start', (q) =>
				q.eq('staffId', person._id).gte('start', dayStart).lt('start', dayEnd)
			))) {
				if (blocksTime(appointment)) count++;
			}
		}
		free.push({ staff: person, count });
	}
	free.sort((a, b) => a.count - b.count || a.staff.name.localeCompare(b.staff.name) || a.staff._id.localeCompare(b.staff._id));
	const chosen = free[0]?.staff;
	if (!chosen) throw new Error(SLOT_CONFLICT);
	const review = historical ? await historicalWarnings(ctx, chosen, service, input.start, blockedUntil) : { warnings: [], needsReason: false };
	const reason = policy?.reason?.trim();
	if (reason && reason.length > 500) throw new Error('Reason must be at most 500 characters');
	if (review.needsReason && !reason) throw new Error('Explain the historical appointment overlap before saving');
	const actor = admin?.email ?? input.actor ?? `system:${input.source}`;
	const accessToken = crypto.randomUUID();
	const lookup = appointmentLookupFields({ guestPhone, guestEmail });
	const status = policy && input.source === 'admin' && input.start + service.durationMin * MINUTE < Date.now() ? 'completed' as const : 'booked' as const;
	const appointmentId = await ctx.db.insert('appointments', {
		serviceId: service._id,
		staffId: chosen._id,
		staffNameSnapshot: chosen.name, serviceNameSnapshot: service.name, createdBy: actor,
		start: input.start,
		end: input.start + service.durationMin * MINUTE,
		blockedUntil,
		guestName,
		guestPhone,
		...(guestEmail ? { guestEmail } : {}),
		guestPhoneDigits: lookup.guestPhoneDigits,
		...(lookup.guestEmailNormalized ? { guestEmailNormalized: lookup.guestEmailNormalized } : {}),
		...(input.bookingId ? { bookingId: input.bookingId } : {}),
		...(input.chatSessionId ? { chatSessionId: input.chatSessionId } : {}),
		...(input.rebookedFromId ? { rebookedFromId: input.rebookedFromId } : {}),
		source: input.source,
		status,
		amountPaid: 0, amountRefunded: 0,
		paymentStatus: 'unpaid',
		price: service.price,
		currency: service.currency,
		confirmationCode: '',
		accessToken,
		createdAt: Date.now()
	});
	const confirmationCode = demoCode('SVC', appointmentId);
	await ctx.db.patch(appointmentId, { confirmationCode });
	const snapshot = { staffId: chosen._id, staffName: chosen.name, serviceId: service._id, serviceName: service.name, start: input.start, end: input.start + service.durationMin * MINUTE, blockedUntil, status, paymentStatus: 'unpaid', price: service.price, currency: service.currency, guestName, guestPhone, guestEmail: guestEmail ?? null, warnings: review.warnings };
	await appendRecordHistory(ctx, { entityType: 'appointment', entityId: appointmentId, actor, kind: 'created', effectiveAt: input.start, ...(reason ? { reason } : {}), after: snapshot });
	await ctx.db.insert('appointmentChanges', { appointmentId, at: Date.now(), actor, kind: 'details', currencyBefore: service.currency, currencyAfter: service.currency,
		...(reason ? { reason } : {}), changes: [
			{ field: 'created', from: null, to: confirmationCode }, { field: 'staffName', from: null, to: chosen.name }, { field: 'serviceName', from: null, to: service.name },
			{ field: 'start', from: null, to: input.start }, { field: 'effectiveAt', from: null, to: input.start },
			{ field: 'end', from: null, to: input.start + service.durationMin * MINUTE }, { field: 'blockedUntil', from: null, to: blockedUntil },
			{ field: 'status', from: null, to: status }, { field: 'paymentStatus', from: null, to: 'unpaid' },
			{ field: 'price', from: null, to: service.price }, { field: 'currency', from: null, to: service.currency },
			{ field: 'guestName', from: null, to: guestName }, { field: 'guestPhone', from: null, to: guestPhone }, { field: 'guestEmail', from: null, to: guestEmail ?? null },
			...review.warnings.map(warning => ({ field: 'warning', from: null, to: warning }))
		] });
	// Its order from the start (the stay's order for an appointment that is part of a stay), empty until opened at checkout.
	await ensureLinkedOrder(ctx, input.bookingId ? { bookingId: input.bookingId } : { appointmentId }, actor);
	return { appointmentId, staffId: chosen._id, confirmationCode, accessToken };
}
