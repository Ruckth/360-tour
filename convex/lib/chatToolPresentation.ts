import type { FunctionReturnType } from 'convex/server';
import type { internal } from '../_generated/api';
import type { Doc } from '../_generated/dataModel';
import { satangToBaht } from '../shared/money';
import { resortLocalParts } from './serviceSlots';

type MutationResults = {
  prepare_booking: FunctionReturnType<typeof internal.bookings.bookings.prepareChatBooking>;
  confirm_booking: FunctionReturnType<typeof internal.bookings.bookings.confirmChatBooking>;
  prepare_service_booking: FunctionReturnType<typeof internal.services.serviceBookings.prepareChatServiceBooking>;
  confirm_service_booking: FunctionReturnType<typeof internal.services.serviceBookings.confirmChatServiceBooking>;
  cancel_booking: FunctionReturnType<typeof internal.bookings.bookings.cancelChatBooking> | FunctionReturnType<typeof internal.services.serviceBookings.cancelChatServiceBooking>;
};
export type MutationToolResult = { [Name in keyof MutationResults]: { name: Name; result: MutationResults[Name] } }[keyof MutationResults];

export function bookingPaymentUrl(siteUrl: string | undefined, bookingId: string, accessToken: string) {
  return `${siteUrl?.replace(/\/+$/, '') ?? ''}/booking/pay?bookingId=${bookingId}&token=${accessToken}`;
}

function proposalUrl(siteUrl: string | undefined, token: string, couponCode?: string) {
  return `${siteUrl?.replace(/\/+$/, '') ?? ''}/booking/pay?proposal=${encodeURIComponent(token)}${couponCode ? `&coupon=${encodeURIComponent(couponCode)}` : ''}`;
}

/** Raw mutation results stay in satang at rest. Both live execution and recovery present them here once. */
export function presentMutationToolResult(write: MutationToolResult, siteUrl?: string): string {
  switch (write.name) {
    case 'prepare_booking': {
      const { confirmToken, ...details } = write.result;
      return humanToolResult({ ...details, confirmUrl: proposalUrl(siteUrl, confirmToken, details.coupon?.code), next: 'Share confirmUrl as "Confirm & pay", or offer replying "yes". No booking or hold exists until confirmation.' });
    }
    case 'confirm_booking': {
      const booking = write.result;
      if (booking.needsReview) {
        const { confirmToken, ...quote } = booking.quote;
        return humanToolResult({ ...quote, needsReview: true, confirmUrl: proposalUrl(siteUrl, confirmToken, quote.coupon?.code) });
      }
      return humanToolResult({
        confirmationCode: booking.confirmationCode,
        property: booking.property, checkIn: booking.checkIn, checkOut: booking.checkOut, guests: booking.guests, nights: booking.nights,
        status: booking.paymentStatus === 'paid' ? 'paid' : 'pending_payment',
        total: booking.total, currency: booking.currency,
        ...(booking.coupon ? { coupon: booking.coupon } : {}),
        ...(booking.paymentStatus === 'pending' && booking.accessToken ? { paymentUrl: bookingPaymentUrl(siteUrl, booking.bookingId, booking.accessToken) } : {}),
        alreadyConfirmed: booking.alreadyConfirmed,
      });
    }
    case 'prepare_service_booking':
      return humanToolResult('error' in write.result ? write.result : { ...write.result, next: 'Ask the guest to reply "yes" to confirm.' });
    case 'confirm_service_booking':
      return humanToolResult(write.result);
    case 'cancel_booking':
      return humanToolResult(write.result.state === 'needs_confirmation' ? { ...write.result, next: 'Ask the guest to reply "yes" to cancel this booking.' } : write.result);
  }
}

/** Stored JSON was written by these mutations; the discriminant restores its typed presentation contract. */
export function presentStoredToolResult(write: { name: string; resultJson: string }, siteUrl?: string): string {
  const result: unknown = JSON.parse(write.resultJson);
  if (result && typeof result === 'object' && ('error' in result || ('ok' in result && result.ok === false))) return humanToolResult(result);
  switch (write.name) {
    case 'prepare_booking':
    case 'confirm_booking':
    case 'prepare_service_booking':
    case 'confirm_service_booking':
    case 'cancel_booking':
      return presentMutationToolResult({ name: write.name, result } as MutationToolResult, siteUrl);
    default:
      return humanToolResult({ error: 'Unknown stored tool operation' });
  }
}

/** Also fence results written before replacement intents were recorded, or invalidated outside this turn. */
export function storedProposalIsCurrent(write: { name: string; resultJson: string }, session: Doc<'conversations'>): boolean {
  const result = JSON.parse(write.resultJson) as Record<string, unknown>;
  if (result.error || result.ok === false) return false;
  if (write.name === 'prepare_booking' || (write.name === 'confirm_booking' && result.needsReview === true)) {
    const quote = write.name === 'confirm_booking' ? result.quote as MutationResults['prepare_booking'] : result;
    const pending = session.pendingBookingQuote;
    return !!pending?.proposalId && typeof quote.confirmToken === 'string' && quote.confirmToken.startsWith(`${session._id}.${pending.proposalId}.${pending.expiresAt}.`);
  }
  if (write.name === 'prepare_service_booking') {
    const pending = session.pendingServiceQuote;
    if (!pending) return false;
    const { date, time } = resortLocalParts(pending.start);
    return result.service === pending.serviceName && result.date === date && result.time === time &&
      result.price === pending.price && result.currency === pending.currency && result.guestName === pending.guestName && result.guestPhone === pending.guestPhone;
  }
  return true;
}

/** LLM/tool output is a presentation boundary; IDs, counts and timestamps retain their units. */
export function humanToolResult(value: unknown): string {
  const currencyFields = new Set(['price', 'pricePerNight', 'nightlyRate', 'directPrice', 'totalDirect', 'totalOTA', 'listedTotal', 'discountPercent', 'discountAmount', 'directTotal', 'maxSavings', 'total', 'subtotal', 'discount', 'amount', 'saving', 'fee', 'owed', 'minEligibleSubtotal', 'eligibleSubtotal']);
  return JSON.stringify(value, (key, item) => typeof item === 'number' && currencyFields.has(key) ? satangToBaht(item) : item);
}
