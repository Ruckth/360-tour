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
  return booking.status !== "cancelled" && booking.paymentStatus !== "refunded";
}

/** Amount still owed (positive) or owed back to the guest (negative) after an edit. */
export function balanceText(total: number, paid: number, currency: string) {
  const balance = total - paid;
  if (balance > 0) return { text: `Balance due ${formatMoney(balance, currency)}`, tone: TONES.warning.text };
  if (balance < 0) return { text: `Credit ${formatMoney(-balance, currency)}`, tone: TONES.success.text };
  return null;
}

/** Confirm-dialog copy for cancelling; paid bookings record a refund. */
export function cancelConfirmOptions(booking: {
  paymentStatus: AdminBooking["paymentStatus"];
  amountPaid?: number;
  total: number;
  currency: string;
  hasStripePayment: boolean;
}): ConfirmOptions {
  if (booking.paymentStatus !== "paid") {
    return {
      title: "Cancel this booking?",
      description: "The booking is cancelled and its dates are released.",
      confirmLabel: "Cancel booking",
      cancelLabel: "Keep booking",
      destructive: true,
    };
  }
  const refund = formatMoney(booking.amountPaid ?? booking.total, booking.currency);
  return {
    title: "Cancel and record a refund?",
    description: booking.hasStripePayment
      ? `Issue the ${refund} refund in the Stripe dashboard first. This only records it: the booking is cancelled, marked refunded and its dates are released.`
      : `Refund ${refund} to the guest yourself (bank transfer or cash). This records the refund, cancels the booking and releases its dates.`,
    confirmLabel: "Cancel & record refund",
    cancelLabel: "Keep booking",
    destructive: true,
  };
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
