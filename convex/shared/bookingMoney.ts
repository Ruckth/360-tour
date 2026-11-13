// Pure booking correction rules/types; ctx/history implementations belong to bookings/model.
import { ConvexError } from 'convex/values';
import { resortTodayIso } from './time';
import { MAX_ORDER, roundMoney } from './orderMath';
import type { Booking } from './stayMoney';

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
		if (required) throw new ConvexError('Reopen the booking and try again (missing revision).');
		return;
	}
	if (!Number.isInteger(expected) || expected !== bookingRevision(booking)) throw new ConvexError(STALE_BOOKING);
}

export function assertNoLiveCheckout(booking: Booking, now = Date.now()) {
	if ((booking.stripeCheckoutExpiresAt ?? 0) > now) throw new ConvexError(LIVE_CHECKOUT);
}

/** Trimmed text, at most REASON_MAX characters; `required` refuses an empty one. */
export function cleanReason(value: string | undefined, label = 'Reason', required = true): string | undefined {
	const trimmed = value?.trim() ?? '';
	if (!trimmed) {
		if (required) throw new ConvexError(`${label} is required`);
		return undefined;
	}
	if (trimmed.length > REASON_MAX) throw new ConvexError(`${label} must be at most ${REASON_MAX} characters`);
	return trimmed;
}

/** A stay price: zero or more, whole satang, within the till limit. */
export function assertStayPrice(total: number) {
	if (!Number.isFinite(total) || total < 0) throw new ConvexError('Price must be zero or more');
	if (roundMoney(total) !== total) throw new ConvexError('Price is in whole satang (at most 2 decimals)');
	if (total > MAX_ORDER) throw new ConvexError(`Price is at most ${(MAX_ORDER / 100).toLocaleString('en-US')}`);
}

/** The business time something happened. Defaults to now; any past date is allowed, the future is not. */
export function effectiveTime(value: number | undefined, now = Date.now()): number {
	if (value === undefined) return now;
	if (!Number.isSafeInteger(value) || value < EARLIEST_EFFECTIVE) throw new ConvexError('Invalid effective date');
	if (value > now + FUTURE_SKEW_MS) throw new ConvexError('The effective date cannot be in the future');
	return value;
}

/** One attempt's key: retrying with it returns the first result instead of recording twice. */
export function attemptKey(key: string): string {
	const trimmed = key.trim();
	if (trimmed.length < 8 || trimmed.length > 100) throw new ConvexError('Invalid attempt key');
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
export type BookingPatch = Partial<Omit<Booking, '_id' | '_creationTime'>>;

export type HistoryEntry = {
	actor: string;
	kind: string;
	reason?: string;
	effectiveAt?: number;
	/** Facts that are not booking fields (a refund's amount and method, the order that paid it). */
	details?: Record<string, unknown>;
};
