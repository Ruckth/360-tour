import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { AdminBooking } from "convex/adminBookings";
import { format } from "date-fns";
import { addDaysIso, isoToDate } from "@/lib/booking/dates";
import type { ConfirmOptions } from "./ConfirmDialog";
import { formatMoney, paymentLabel } from "./labels";
import { CALENDAR_TONE_COLORS, STATUS_TONES, TONES, statusMeta } from "./status-tones";

type ListData = FunctionReturnType<typeof api.adminBookings.listForAdmin>;
export type AdminProperty = ListData["properties"][number];
export type DateBlock = ListData["dateBlocks"][number];

/** What the hotel calendar shows for a booking or block; labels and tones come from `labels.ts` / `status-tones.ts`. */
export type HotelStatus = "pending" | "confirmed" | "paid" | "cancelled" | "hostBlock" | "otaBlock";

/** Legend order. */
export const HOTEL_STATUSES: HotelStatus[] = ["pending", "confirmed", "paid", "cancelled", "hostBlock", "otaBlock"];

/** Label and tone, for `<StatusBadge {...hotelStatus(key)} />`. */
export const hotelStatus = (key: HotelStatus) => statusMeta("hotelBooking", key);

/** Calendar chip colour, the same hue as the badge. */
export const hotelStatusColor = (key: HotelStatus) => CALENDAR_TONE_COLORS[STATUS_TONES.hotelBooking[key]];

export function statusKey(booking: Pick<AdminBooking, "status" | "paymentStatus">): HotelStatus {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.paymentStatus === "paid") return "paid";
  if (booking.status === "confirmed" || booking.status === "completed") return "confirmed";
  return "pending";
}

export function paymentText(booking: Pick<AdminBooking, "paymentStatus" | "paymentMethod">) {
  return paymentLabel(booking.paymentStatus, booking.paymentMethod);
}

/** Nights in [start, end) as ISO dates. */
export function isoNights(start: string, end: string) {
  const nights: string[] = [];
  for (let day = start; day && day < end; day = addDaysIso(day, 1)) nights.push(day);
  return nights;
}

export function displayDate(iso: string) {
  const date = isoToDate(iso);
  return date ? format(date, "EEE d MMM yyyy") : iso;
}

export function canEditBooking(booking: Pick<AdminBooking, "status" | "paymentStatus">) {
  return booking.status !== "cancelled";
}

/** Amount still owed (positive) or owed back to the guest (negative) after an edit. */
export function balanceText(total: number, paid: number, currency: string) {
  const balance = total - paid;
  if (balance > 0) return { text: `Balance due ${formatMoney(balance, currency)}`, tone: TONES.warning.text };
  if (balance < 0) return { text: `Credit ${formatMoney(-balance, currency)}`, tone: TONES.success.text };
  return null;
}

/**
 * Confirm-dialog copy for cancelling an unpaid booking from the calendar. Paid bookings are
 * cancelled from the booking sheet, which asks whether to keep the payment or record a refund.
 */
export function cancelConfirmOptions(booking: { guestEmail?: string; notifyByDefault: boolean }): ConfirmOptions {
  const email = booking.guestEmail
    ? booking.notifyByDefault
      ? " The guest is emailed about the cancellation."
      : " The guest is not emailed (past stay)."
    : "";
  return {
    title: "Cancel this booking?",
    description: `The booking is cancelled and its dates are released.${email}`,
    confirmLabel: "Cancel booking",
    cancelLabel: "Keep booking",
    destructive: true,
  };
}

/** How money was received or given back, as staff read it. */
export const MONEY_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  promptpay: "PromptPay",
  card: "Card",
  transfer: "Bank transfer",
  other: "Other",
  stripe: "Stripe",
  provider: "Online payment",
  order: "Checkout order",
  unrecorded: "Method not recorded",
};

export const PAYMENT_ORIGIN_LABELS: Record<string, string> = {
  manual: "Recorded on the booking",
  pos: "Paid at checkout",
  online: "Paid online",
};

/** Methods staff choose for a desk payment, and for a refund (Stripe = refunded in the Stripe dashboard). */
export const DESK_PAYMENT_METHODS = ["cash", "promptpay", "card", "transfer", "other"] as const;
export const REFUND_METHODS = ["cash", "promptpay", "card", "transfer", "stripe", "other"] as const;
export type DeskPaymentMethod = (typeof DESK_PAYMENT_METHODS)[number];
export type RefundMethod = (typeof REFUND_METHODS)[number];

/** One attempt key per dialog: a retry after a dropped connection is recorded once. */
export function newAttemptKey(prefix: string) {
  return `${prefix}-${crypto.randomUUID()}`;
}

/** Today as the server's booking calendar date (UTC ISO), which decides the email default. */
export function serverTodayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** The server's default for emailing the guest about a change to this stay. */
export function notifyDefault(stay: { checkIn: string; guestEmailsOff?: boolean }) {
  return !stay.guestEmailsOff && stay.checkIn >= serverTodayIso();
}

/** A typed amount in whole satang, or null. */
export function parseAmount(text: string): number | null {
  const trimmed = text.trim().replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

export function payLink(bookingId: string, accessToken: string) {
  return `${window.location.origin}/booking/pay?bookingId=${bookingId}&token=${accessToken}`;
}

type Occupancy = {
  bookings: Array<Pick<AdminBooking, "_id" | "propertyId" | "status" | "checkIn" | "checkOut">>;
  dateBlocks: Array<Pick<DateBlock, "propertyId" | "start" | "end">>;
  blocks: Array<{ propertyId: string; date: string }>;
};

/**
 * Whether [checkIn, checkOut) on a villa overlaps a date-holding booking or a block, using the calendar's
 * loaded range. A hint for drag and drop; the server re-checks.
 */
export function stayConflicts(data: Occupancy, propertyId: string, checkIn: string, checkOut: string, excludeBookingId?: string) {
  return (
    data.bookings.some(
      (b) =>
        b._id !== excludeBookingId &&
        b.propertyId === propertyId &&
        (b.status === "confirmed" || b.status === "completed") &&
        b.checkIn < checkOut &&
        b.checkOut > checkIn,
    ) ||
    data.dateBlocks.some((b) => b.propertyId === propertyId && b.start < checkOut && b.end > checkIn) ||
    data.blocks.some((b) => b.propertyId === propertyId && b.date >= checkIn && b.date < checkOut)
  );
}
