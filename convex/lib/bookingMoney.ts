import type { Doc, Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { MAX_BILL, bookingBalance, round2 } from './billMath';
import { resortTodayIso } from './dates';
import { syncCouponRedemption } from './couponRedemptions';
import { appendRecordHistory } from './recordHistory';

/**
 * Shared rules for booking corrections and money: revisions, reasons, amounts, effective dates,
 * notification defaults and the booking history (recordChanges, entity type `booking`).
 *
 * Every booking write that should be traceable goes through `writeBooking`, which patches the
 * booking, bumps its revision and appends the before/after of each changed field in the same
 * transaction. History starts when this shipped; nothing earlier is reconstructed.
 */

type Booking = Doc<'bookings'>;

export const STALE_BOOKING = 'This booking changed since you opened it. Review the latest details and try again.';
export const LIVE_CHECKOUT = 'The guest has a Stripe checkout open. Wait for it to finish or expire before changing this booking.';
export const REASON_MAX = 500;
/** A business date may be a few minutes ahead of the server clock (device clocks drift), never more. */
const FUTURE_SKEW_MS = 5 * 60_000;
/** 2000-01-01: anything earlier is a typo, not a correction. */
const EARLIEST_EFFECTIVE = 946_684_800_000;

export const bookingRevision = (booking: Pick<Booking, 'revision'>) => booking.revision ?? 0;

/** New correction paths always send the revision staff reviewed; older API callers may omit it. */
export function assertBookingRevision(booking: Booking, expected: number | undefined, required = true) {
	if (expected === undefined) {
		if (required) throw new Error('Reopen the booking and try again (missing revision).');
		return;
	}
	if (!Number.isInteger(expected) || expected !== bookingRevision(booking)) throw new Error(STALE_BOOKING);
}

export function assertNoLiveCheckout(booking: Booking, now = Date.now()) {
	if ((booking.stripeCheckoutExpiresAt ?? 0) > now) throw new Error(LIVE_CHECKOUT);
}

/** Trimmed text, at most REASON_MAX characters; `required` refuses an empty one. */
export function cleanReason(value: string | undefined, label = 'Reason', required = true): string | undefined {
	const trimmed = value?.trim() ?? '';
	if (!trimmed) {
		if (required) throw new Error(`${label} is required`);
		return undefined;
	}
	if (trimmed.length > REASON_MAX) throw new Error(`${label} must be at most ${REASON_MAX} characters`);
	return trimmed;
}

/** A money amount: finite, more than zero, whole satang and within the till limit. */
export function assertMoney(amount: number, label = 'Amount') {
	if (!Number.isFinite(amount) || amount <= 0) throw new Error(`${label} must be more than zero`);
	if (round2(amount) !== amount) throw new Error(`${label} is in whole satang (at most 2 decimals)`);
	if (amount > MAX_BILL) throw new Error(`${label} is at most ${MAX_BILL.toLocaleString('en-US')}`);
}

/** A stay price: zero or more, whole satang, within the till limit. */
export function assertStayPrice(total: number) {
	if (!Number.isFinite(total) || total < 0) throw new Error('Price must be zero or more');
	if (round2(total) !== total) throw new Error('Price is in whole satang (at most 2 decimals)');
	if (total > MAX_BILL) throw new Error(`Price is at most ${MAX_BILL.toLocaleString('en-US')}`);
}

/** The business time something happened. Defaults to now; any past date is allowed, the future is not. */
export function effectiveTime(value: number | undefined, now = Date.now()): number {
	if (value === undefined) return now;
	if (!Number.isSafeInteger(value) || value < EARLIEST_EFFECTIVE) throw new Error('Invalid effective date');
	if (value > now + FUTURE_SKEW_MS) throw new Error('The effective date cannot be in the future');
	return value;
}

/** One attempt's key: retrying with it returns the first result instead of recording twice. */
export function attemptKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length < 8 || trimmed.length > 100) throw new Error('Invalid attempt key');
	return trimmed;
}

/** A stay that started before the resort's today (Asia/Bangkok calendar date). */
export const isHistoricalStay = (stay: { checkIn: string }) => stay.checkIn < resortTodayIso();

/**
 * Whether a staff action emails the guest when the caller doesn't say: yes for current and future
 * stays, no for historical corrections or bookings entered silently.
 */
export function resolveNotify(explicit: boolean | undefined, stay: { checkIn: string; guestEmailsOff?: boolean }) {
	return explicit ?? (!stay.guestEmailsOff && !isHistoricalStay(stay));
}

/** Money on the stay, net of refunds (see billMath.bookingBalance). */
export function stayMoney(booking: Booking) {
	const { paid, owed, gross, refunded } = bookingBalance(booking);
	const legacyRefund = booking.paymentStatus === 'refunded' && booking.amountRefunded === undefined;
	const cancelled = booking.status === 'cancelled';
	// A live stay only refunds what exceeds its price, so a refund never reopens a balance; to give
	// back more, correct the price or cancel first. A cancelled stay can refund everything kept.
	const refundable = booking.paymentStatus === 'refunded' ? 0 : cancelled ? paid : Math.max(0, round2(-owed));
	return {
		total: booking.total,
		currency: booking.currency,
		gross,
		refunded,
		net: paid,
		owed: Math.max(0, owed),
		credit: Math.max(0, round2(-owed)),
		refundable,
		refundContext: cancelled ? ('cancellation' as const) : ('credit' as const),
		legacyRefund
	};
}

/** Fields kept in the booking history. Secrets (access token, checkout URLs) never are. */
const HISTORY_FIELDS = [
	'propertyId', 'checkIn', 'checkOut', 'guests', 'nights', 'guestName', 'guestPhone', 'guestEmail',
	'subtotal', 'discountAmount', 'total', 'currency', 'priceOverride', 'status', 'paymentStatus', 'paymentMethod',
	'amountPaid', 'amountRefunded', 'paidAt', 'refundedAt', 'adminNotes', 'cancelledAt', 'cancelledBy', 'cancelReason',
	'confirmationCode', 'guestEmailsOff', 'promotion'
] as const satisfies ReadonlyArray<keyof Booking>;
type HistoryField = (typeof HISTORY_FIELDS)[number];
export type BookingPatch = Partial<Omit<Booking, '_id' | '_creationTime'>>;

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

export type HistoryEntry = {
	actor: string;
	kind: string;
	reason?: string;
	effectiveAt?: number;
	/** Facts that are not booking fields (a refund's amount and method, the order that paid it). */
	details?: Record<string, unknown>;
};

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
export async function writeBooking(ctx: MutationCtx, booking: Booking, patch: BookingPatch, entry: HistoryEntry, options: { deferCouponSync?: boolean } = {}): Promise<Booking> {
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
	return updated;
}
