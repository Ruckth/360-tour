import type { Doc, Id } from '../../_generated/dataModel';
import type { MutationCtx, QueryCtx } from '../../_generated/server';
import { appointmentRevision } from '../../shared/appointmentWindow';
import { appendRecordHistory } from '../../settings/model';
import { appointmentLookupFields } from './serviceSlots';

/**
 * Shared recording for calendar edits and guest cancellations. Each tracked change
 * bumps the revision and keeps its old and new values in history.
 */

type Appointment = Doc<'appointments'>;

type ChangeKind = Doc<'appointmentChanges'>['kind'];

export const STALE_APPOINTMENT = 'This appointment changed since you opened it. Review the latest details and try again.';

export const HISTORY_LIMIT = 50;

const REASON_MAX = 500;

/** Fields whose old and new values are kept in the history. */
const TRACKED = [
	'staffId', 'serviceId', 'start', 'end', 'blockedUntil', 'price', 'currency',
	'amountPaid', 'amountRefunded', 'financialRevision', 'status', 'paymentStatus', 'guestName', 'guestPhone', 'guestEmail', 'notes',
	'staffNameSnapshot', 'serviceNameSnapshot', 'paidAt', 'paidBy', 'refundedAt', 'cancelledAt', 'cancelledBy', 'cancellationReason'
] as const;

type Tracked = (typeof TRACKED)[number];

export type AppointmentPatch = Partial<Pick<Appointment, Tracked | 'refundedAt' | 'cancelledAt' | 'cancelledBy' | 'cancellationReason'>>;

export type ChangeEntry = { actor: string; kind: ChangeKind; reason?: string; effectiveAt?: number; warnings?: string[]; details?: Array<{ field: string; from: string | number | null; to: string | number | null }> };

/** Refuses a change confirmed against an older version of the appointment. */
export function assertFresh(appointment: Appointment, expectedRevision: number): void {
	if (appointmentRevision(appointment) !== expectedRevision) throw new Error(STALE_APPOINTMENT);
}

export function cleanReason(reason: string | undefined): string | undefined {
	const trimmed = reason?.trim();
	if (trimmed && trimmed.length > REASON_MAX) throw new Error(`Reason must be at most ${REASON_MAX} characters`);
	return trimmed || undefined;
}

/** Applies the patch and records it. Returns false (and writes nothing) when no tracked field changes. */
export async function recordAppointmentChange(ctx: MutationCtx, appointment: Appointment, patch: AppointmentPatch, entry: ChangeEntry): Promise<boolean> {
	const changes = [...TRACKED
		.filter((field) => field in patch && (patch[field] ?? null) !== (appointment[field] ?? null))
		.map((field) => ({ field, from: appointment[field] ?? null, to: patch[field] ?? null })), ...(entry.details ?? [])];
	if (!changes.length) return false;
	const effectiveAt = entry.effectiveAt ?? Date.now();
	if (!Number.isSafeInteger(effectiveAt)) throw new Error('Invalid effective time');
	// Keeps the exact-lookup fields in step with the guest's phone and email (and fills them on a
	// row saved before they existed). A removed email clears its lookup form.
	const lookup = appointmentLookupFields({
		guestPhone: 'guestPhone' in patch ? patch.guestPhone ?? '' : appointment.guestPhone,
		guestEmail: 'guestEmail' in patch ? patch.guestEmail : appointment.guestEmail
	});
	await ctx.db.patch(appointment._id, { ...patch, ...lookup, revision: appointmentRevision(appointment) + 1 });
	await ctx.db.insert('appointmentChanges', {
		appointmentId: appointment._id, at: Date.now(), actor: entry.actor, kind: entry.kind,
		currencyBefore: appointment.currency, currencyAfter: patch.currency ?? appointment.currency,
		...(entry.reason ? { reason: entry.reason } : {}), changes: [...changes,
			...(entry.effectiveAt !== undefined ? [{ field: 'effectiveAt', from: null, to: effectiveAt }] : []),
			...(entry.warnings ?? []).map(warning => ({ field: 'warning', from: null, to: warning }))]
	});
	await appendRecordHistory(ctx, { entityType: 'appointment', entityId: appointment._id, actor: entry.actor, kind: entry.kind, effectiveAt,
		...(entry.reason ? { reason: entry.reason } : {}),
		before: Object.fromEntries(changes.map(change => [change.field, change.from])),
		after: { ...Object.fromEntries(changes.map(change => [change.field, change.to])), ...(entry.warnings?.length ? { warnings: entry.warnings } : {}) }
	});
	return true;
}

/** Cancels while keeping the record and its payment state; the time is freed because cancelled appointments don't block. */
export async function cancelAppointmentRecord(ctx: MutationCtx, appointment: Appointment, input: { actor: string; reason?: string }) {
	const reason = cleanReason(input.reason);
	await recordAppointmentChange(ctx, appointment, {
		status: 'cancelled', cancelledAt: Date.now(), cancelledBy: input.actor, cancellationReason: reason
	}, { actor: input.actor, kind: 'cancelled', reason });
}

/** Notes on the original that it was booked again; the original record itself is left as it was. */
export async function recordRebooked(ctx: MutationCtx, original: Appointment, confirmationCode: string, actor: string) {
	await ctx.db.insert('appointmentChanges', {
		appointmentId: original._id, at: Date.now(), actor, kind: 'rebooked',
		currencyBefore: original.currency, currencyAfter: original.currency,
		changes: [{ field: 'rebookedAs', from: null, to: confirmationCode }]
	});
	await appendRecordHistory(ctx, { entityType: 'appointment', entityId: original._id, actor, kind: 'rebooked', after: { rebookedAs: confirmationCode } });
}

export async function appointmentHistory(ctx: QueryCtx | MutationCtx, appointmentId: Id<'appointments'>) {
	return await ctx.db.query('appointmentChanges')
		.withIndex('by_appointmentId_and_at', (q) => q.eq('appointmentId', appointmentId))
		.order('desc')
		.take(HISTORY_LIMIT);
}
