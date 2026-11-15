import type { Id } from '../../_generated/dataModel';
import type { MutationCtx } from '../../_generated/server';
import type { BookingPatch, HistoryEntry } from '../../shared/bookingMoney';
import { bookingRevision } from '../../shared/bookingMoney';
import type { Booking } from '../../shared/stayMoney';
import { syncAffiliateCredit, syncCouponRedemption } from '../../marketing/model';
import { appendRecordHistory } from '../../settings/model';

/** Fields kept in the booking history. Secrets (access token, checkout URLs) never are. */
const HISTORY_FIELDS = [
	'propertyId', 'checkIn', 'checkOut', 'guests', 'nights', 'guestName', 'guestPhone', 'guestEmail',
	'subtotal', 'discountAmount', 'total', 'currency', 'priceOverride', 'status', 'paymentStatus', 'paymentMethod',
	'amountPaid', 'amountRefunded', 'paidAt', 'refundedAt', 'adminNotes', 'cancelledAt', 'cancelledBy', 'cancelReason',
	'confirmationCode', 'guestEmailsOff', 'promotion'
] as const satisfies ReadonlyArray<keyof Booking>;

type HistoryField = (typeof HISTORY_FIELDS)[number];

/** The booking as it stands, for a `created` or `deleted` history row. */
export function bookingSnapshot(booking: Booking) {
	return {
		...Object.fromEntries(HISTORY_FIELDS.map((field) => [field, booking[field] ?? null])),
		source: booking.source ?? 'web',
		createdAt: booking.createdAt,
		createdBy: booking.createdBy ?? null,
		hasStripePayment: Boolean(booking.stripePaymentIntentId),
		revision: bookingRevision(booking)
	};
}

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export async function appendBookingHistory(ctx: MutationCtx, bookingId: Id<'bookings'>, entry: HistoryEntry & { before?: unknown; after?: unknown }) {
	await appendRecordHistory(ctx, {
		entityType: 'booking', entityId: bookingId, actor: entry.actor, kind: entry.kind,
		...(entry.effectiveAt !== undefined ? { effectiveAt: entry.effectiveAt } : {}),
		...(entry.reason ? { reason: entry.reason } : {}),
		...(entry.before !== undefined ? { before: entry.before } : {}),
		...(entry.after !== undefined ? { after: entry.after } : {})
	});
}

/**
 * Patches the booking, bumps its revision and appends one history row with the old and new value of
 * every changed history field (plus `details`), all in the caller's transaction. Returns the new row.
 */
export async function writeBooking(ctx: MutationCtx, booking: Booking, patch: BookingPatch, entry: HistoryEntry, options: { deferCouponSync?: boolean; paymentUnlinked?: boolean } = {}): Promise<Booking> {
	await ctx.db.patch(booking._id, { ...patch, revision: bookingRevision(booking) + 1 });
	const changed = HISTORY_FIELDS.filter((field: HistoryField) => field in patch && !same(patch[field], booking[field]));
	await appendBookingHistory(ctx, booking._id, {
		...entry,
		before: Object.fromEntries(changed.map((field) => [field, booking[field] ?? null])),
		after: { ...Object.fromEntries(changed.map((field) => [field, patch[field] ?? null])), ...(entry.details ?? {}) }
	});
	const updated = (await ctx.db.get(booking._id))!;
	// A verified late capture reopens and records its payment in this same transaction.
	// Sync against that final paid state, rather than acquiring an unpaid hold in between.
	if (updated.promotion && !options.deferCouponSync) await syncCouponRedemption(ctx, updated);
	await syncAffiliateCredit(ctx, {bookingId: updated._id}, entry.actor, options.paymentUnlinked ? 'payment_unlinked' : undefined);
	return updated;
}
