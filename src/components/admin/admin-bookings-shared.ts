import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { AdminBooking } from "convex/adminBookings";
import { format } from "date-fns";
import { addDaysIso, isoToDate } from "@/lib/booking/dates";

type ListData = FunctionReturnType<typeof api.adminBookings.listForAdmin>;
export type AdminProperty = ListData["properties"][number];
export type DateBlock = ListData["dateBlocks"][number];

/** One source of truth for booking and block state: drives chip colours and the legend. */
export const STATUS = {
  pending: { label: "Pending", color: "var(--color-amber-500)" },
  confirmed: { label: "Confirmed", color: "var(--color-blue-500)" },
  paid: { label: "Paid", color: "var(--color-emerald-500)" },
  cancelled: { label: "Cancelled", color: "var(--color-zinc-400)" },
  hostBlock: { label: "Host block", color: "var(--color-rose-500)" },
  otaBlock: { label: "OTA calendar", color: "var(--color-violet-500)" },
} as const;

export type StatusKey = keyof typeof STATUS;

export function statusKey(booking: Pick<AdminBooking, "status" | "paymentStatus">): StatusKey {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.paymentStatus === "paid") return "paid";
  if (booking.status === "confirmed" || booking.status === "completed") return "confirmed";
  return "pending";
}

export const SOURCE_LABELS: Record<string, string> = {
  web: "Website",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  line: "LINE",
  instagram: "Instagram",
  admin: "Manual",
  airbnb: "Airbnb",
  booking_com: "Booking.com",
  agoda: "Agoda",
  manual: "Manual block",
  direct: "Direct",
};

export function paymentText(booking: Pick<AdminBooking, "paymentStatus" | "paymentMethod">) {
  switch (booking.paymentStatus) {
    case "paid":
      if (booking.paymentMethod === "stripe") return "Paid by card (Stripe)";
      if (booking.paymentMethod === "admin") return "Paid (recorded by host)";
      return "Paid";
    case "refunded":
      return "Refunded";
    case "failed":
      return "Payment failed";
    default:
      return "Unpaid";
  }
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
