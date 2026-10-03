import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { AdminBooking } from "convex/adminBookings";
import { format } from "date-fns";
import { addDaysIso } from "@/lib/booking/dates";
import type { CalendarEvent } from "@/components/reui/event-calendar/event-calendar-types";
import {
  canEditBooking,
  hotelStatusColor,
  statusKey,
  type DateBlock,
} from "@/components/admin/admin-bookings-shared";

/**
 * Pure transformation from the admin hotel-calendar query result into the vendored calendar's
 * events. Extracted verbatim from `AdminBookingsView`'s `events` useMemo so the view keeps only
 * React state and the transform can be unit-tested in isolation. No React, no component state, no
 * dependency on the vendored calendar's internals beyond its `CalendarEvent` shape.
 */

type ListData = FunctionReturnType<typeof api.adminBookings.listForAdmin>;

/** What a hotel-calendar chip carries, so clicks and drags can tell bookings from blocks apart. */
export type HotelEventData =
  | { kind: "booking"; booking: AdminBooking }
  | { kind: "hostBlock"; block: DateBlock }
  | { kind: "otaBlock"; propertyId: string; start: string; end: string; source: string };

/** `yyyy-MM-dd` for a Date in the browser's local zone — the calendar works in local days. */
export function isoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/** An all-day span from two ISO dates, in local time (midnight to midnight). */
function allDay(start: string, end: string) {
  return {
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
    allDay: true as const,
  };
}

/** Collapses per-night OTA block rows into contiguous ranges per villa and source. */
export function blockRanges(blocks: Array<{ propertyId: string; date: string; source: string }>) {
  const ranges: Array<{ propertyId: string; start: string; end: string; source: string }> = [];
  const sorted = [...blocks].sort(
    (a, b) =>
      a.propertyId.localeCompare(b.propertyId) || a.source.localeCompare(b.source) || a.date.localeCompare(b.date),
  );
  for (const block of sorted) {
    const last = ranges.at(-1);
    if (last && last.propertyId === block.propertyId && last.source === block.source && last.end === block.date) {
      last.end = addDaysIso(block.date, 1);
    } else {
      ranges.push({ propertyId: block.propertyId, start: block.date, end: addDaysIso(block.date, 1), source: block.source });
    }
  }
  return ranges;
}

export type HotelCalendarInput = {
  /** The `listForAdmin` result, or undefined before it loads (yields no events). */
  data: ListData | undefined;
  /** Selected villa id, or "all". */
  villa: string;
  /** Whether cancelled bookings are shown. */
  showCancelled: boolean;
  /** `HH:mm` check-in / check-out used to place the chip within its first and last day. */
  checkInTime: string;
  checkOutTime: string;
  /** Resolve a villa id to its display name. Defaults to the names in `data`. */
  sourceLabel: (source: string) => string;
};

/**
 * Build the hotel calendar's events: guest bookings (filtered by villa and the cancelled toggle),
 * host date-blocks, and OTA block ranges. Order is bookings, then host blocks, then OTA blocks —
 * the same order the view produced, which the calendar uses for stacking.
 */
export function buildHotelCalendarEvents(input: HotelCalendarInput): CalendarEvent<HotelEventData>[] {
  const { data, villa, showCancelled, checkInTime, checkOutTime, sourceLabel } = input;
  if (!data) return [];

  const names = new Map(data.properties.map((p) => [p._id as string, p.name]));
  const visible = (propertyId: string) => villa === "all" || propertyId === villa;

  const bookingEvents = data.bookings
    .filter((b) => visible(b.propertyId) && (showCancelled || b.status !== "cancelled"))
    .map((booking): CalendarEvent<HotelEventData> => ({
      id: booking._id,
      title: `${booking.guestName} · ${names.get(booking.propertyId) ?? "Villa"}`,
      start: new Date(`${booking.checkIn}T${checkInTime}:00`),
      end: new Date(`${booking.checkOut}T${checkOutTime}:00`),
      resourceId: booking.propertyId,
      color: hotelStatusColor(statusKey(booking)),
      // Drag to move, drag an edge to change dates. Cancelled and refunded bookings stay put.
      readOnly: !canEditBooking(booking),
      data: { kind: "booking", booking },
    }));

  const hostBlockEvents = data.dateBlocks
    .filter((block) => visible(block.propertyId))
    .map((block): CalendarEvent<HotelEventData> => ({
      id: `host-block-${block._id}`,
      title: `Blocked: ${block.reason} · ${names.get(block.propertyId) ?? "Villa"}`,
      ...allDay(block.start, block.end),
      resourceId: block.propertyId,
      color: hotelStatusColor("hostBlock"),
      readOnly: true,
      data: { kind: "hostBlock", block },
    }));

  const otaBlockEvents = blockRanges(data.blocks)
    .filter((block) => visible(block.propertyId))
    .map((block): CalendarEvent<HotelEventData> => ({
      id: `ota-block-${block.propertyId}-${block.source}-${block.start}`,
      title: `${sourceLabel(block.source)} · ${names.get(block.propertyId) ?? "Villa"}`,
      ...allDay(block.start, block.end),
      resourceId: block.propertyId,
      color: hotelStatusColor("otaBlock"),
      readOnly: true,
      data: { kind: "otaBlock", ...block },
    }));

  return [...bookingEvents, ...hostBlockEvents, ...otaBlockEvents];
}
