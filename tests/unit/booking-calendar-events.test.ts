import { describe, expect, it } from "vitest";
import { addDaysIso } from "@/lib/booking/dates";
import {
  blockRanges,
  buildHotelCalendarEvents,
  isoDate,
  type HotelCalendarInput,
} from "@/lib/admin/booking-calendar-events";

// Minimal fixture types matching the `listForAdmin` return shape the view consumes.
type Data = NonNullable<HotelCalendarInput["data"]>;
type Booking = Data["bookings"][number];
type Property = Data["properties"][number];

const sourceLabel = (source: string) => (source === "airbnb" ? "Airbnb" : source === "booking" ? "Booking.com" : source);

/** Brand a plain string as any Convex Id for fixtures (double-cast through unknown). */
function id<T>(value: string): T {
  return value as unknown as T;
}

function property(id_: string, name: string, over: Partial<Property> = {}): Property {
  return {
    _id: id<Property["_id"]>(id_),
    slug: id_,
    name,
    maxGuests: 2,
    status: "active",
    pricePerNight: 100,
    directDiscountPercent: 0,
    currency: "THB",
    ...over,
  } as Property;
}

function booking(
  over: Partial<Omit<Booking, "_id" | "propertyId">> & { _id: string; propertyId: string; checkIn: string; checkOut: string },
): Booking {
  return {
    guestName: "Guest",
    guestPhone: "",
    guests: 2,
    nights: 1,
    total: 100,
    currency: "THB",
    status: "confirmed",
    paymentStatus: "pending",
    source: "web",
    createdAt: 0,
    ...over,
  } as Booking;
}

function makeData(over: Partial<Data> = {}): Data {
  return {
    properties: [property("villa-a", "Villa A"), property("villa-b", "Villa B")],
    bookings: [],
    blocks: [],
    dateBlocks: [],
    complete: true,
    ...over,
  } as Data;
}

const BASE: Omit<HotelCalendarInput, "data"> = {
  villa: "all",
  showCancelled: false,
  checkInTime: "14:00",
  checkOutTime: "11:00",
  sourceLabel,
};

/**
 * The original inline transform, copied verbatim from the pre-extraction AdminBookingsView, so the
 * extracted module can be proved identical rather than merely plausible.
 */
function legacyEvents(input: HotelCalendarInput) {
  const { data, villa, showCancelled, checkInTime, checkOutTime, sourceLabel: label } = input;
  if (!data) return [];
  const names = new Map(data.properties.map((p) => [p._id as string, p.name]));
  const visible = (propertyId: string) => villa === "all" || propertyId === villa;
  const allDay = (start: string, end: string) => ({
    start: new Date(`${start}T00:00:00`),
    end: new Date(`${end}T00:00:00`),
    allDay: true as const,
  });
  const statusColorKey = (b: Booking) =>
    b.status === "cancelled"
      ? "cancelled"
      : b.paymentStatus === "paid"
        ? "paid"
        : b.status === "confirmed" || b.status === "completed"
          ? "confirmed"
          : "pending";
  const bookingEvents = data.bookings
    .filter((b) => visible(b.propertyId) && (showCancelled || b.status !== "cancelled"))
    .map((b) => ({
      id: b._id,
      title: `${b.guestName} · ${names.get(b.propertyId) ?? "Villa"}`,
      start: new Date(`${b.checkIn}T${checkInTime}:00`),
      end: new Date(`${b.checkOut}T${checkOutTime}:00`),
      resourceId: b.propertyId,
      _statusKey: statusColorKey(b),
      readOnly: b.status === "cancelled" || b.paymentStatus === "refunded",
      data: { kind: "booking" as const, booking: b },
    }));
  const hostBlockEvents = data.dateBlocks
    .filter((block) => visible(block.propertyId))
    .map((block) => ({
      id: `host-block-${block._id}`,
      title: `Blocked: ${block.reason} · ${names.get(block.propertyId) ?? "Villa"}`,
      ...allDay(block.start, block.end),
      resourceId: block.propertyId,
      readOnly: true,
      data: { kind: "hostBlock" as const, block },
    }));
  const otaBlockEvents = blockRanges(data.blocks)
    .filter((block) => visible(block.propertyId))
    .map((block) => ({
      id: `ota-block-${block.propertyId}-${block.source}-${block.start}`,
      title: `${label(block.source)} · ${names.get(block.propertyId) ?? "Villa"}`,
      ...allDay(block.start, block.end),
      resourceId: block.propertyId,
      readOnly: true,
      data: { kind: "otaBlock" as const, ...block },
    }));
  return [...bookingEvents, ...hostBlockEvents, ...otaBlockEvents];
}

/** Compare two event lists on the fields that don't depend on an opaque color token. */
function shape(events: ReturnType<typeof buildHotelCalendarEvents>) {
  return events.map((e) => ({
    id: e.id,
    title: e.title,
    start: e.start.getTime(),
    end: e.end?.getTime(),
    allDay: e.allDay ?? false,
    resourceId: e.resourceId,
    readOnly: e.readOnly ?? false,
    kind: e.data?.kind,
  }));
}

describe("buildHotelCalendarEvents", () => {
  it("returns nothing before data loads", () => {
    expect(buildHotelCalendarEvents({ ...BASE, data: undefined })).toEqual([]);
  });

  it("matches the original inline transform exactly across every event kind", () => {
    const data = makeData({
      bookings: [
        booking({ _id: "b1", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-07", guestName: "Alice" }),
        booking({ _id: "b2", propertyId: "villa-b", checkIn: "2026-10-06", checkOut: "2026-10-08", guestName: "Bob", status: "cancelled" }),
        booking({ _id: "b3", propertyId: "villa-a", checkIn: "2026-10-10", checkOut: "2026-10-12", guestName: "Cara", paymentStatus: "paid" }),
      ],
      dateBlocks: [
        { _id: id<Data["dateBlocks"][number]["_id"]>("d1"), propertyId: id<Property["_id"]>("villa-b"), start: "2026-10-03", end: "2026-10-05", reason: "Maintenance" },
      ],
      blocks: [
        { propertyId: id<Property["_id"]>("villa-a"), date: "2026-10-15", source: "airbnb" },
        { propertyId: id<Property["_id"]>("villa-a"), date: "2026-10-16", source: "airbnb" },
        { propertyId: id<Property["_id"]>("villa-b"), date: "2026-10-20", source: "booking" },
      ],
    });

    for (const opts of [
      { ...BASE, data },
      { ...BASE, data, showCancelled: true },
      { ...BASE, data, villa: "villa-a" },
      { ...BASE, data, checkInTime: "15:00", checkOutTime: "10:00" },
    ] as HotelCalendarInput[]) {
      expect(shape(buildHotelCalendarEvents(opts))).toEqual(shape(legacyEvents(opts) as never));
    }
  });

  it("hides cancelled bookings unless showCancelled is set", () => {
    const data = makeData({
      bookings: [
        booking({ _id: "ok", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-06" }),
        booking({ _id: "x", propertyId: "villa-a", checkIn: "2026-10-07", checkOut: "2026-10-08", status: "cancelled" }),
      ],
    });
    expect(buildHotelCalendarEvents({ ...BASE, data }).map((e) => e.id)).toEqual(["ok"]);
    expect(buildHotelCalendarEvents({ ...BASE, data, showCancelled: true }).map((e) => e.id).sort()).toEqual(["ok", "x"]);
  });

  it("marks cancelled and refunded bookings read-only, others editable", () => {
    const data = makeData({
      bookings: [
        booking({ _id: "editable", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-06" }),
        booking({ _id: "cancelled", propertyId: "villa-a", checkIn: "2026-10-07", checkOut: "2026-10-08", status: "cancelled" }),
        booking({ _id: "refunded", propertyId: "villa-a", checkIn: "2026-10-09", checkOut: "2026-10-10", paymentStatus: "refunded" }),
      ],
    });
    const byId = new Map(buildHotelCalendarEvents({ ...BASE, data, showCancelled: true }).map((e) => [e.id, e.readOnly ?? false]));
    expect(byId.get("editable")).toBe(false);
    expect(byId.get("cancelled")).toBe(true);
    expect(byId.get("refunded")).toBe(true);
  });

  it("filters to the selected villa for every kind", () => {
    const data = makeData({
      bookings: [
        booking({ _id: "a", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-06" }),
        booking({ _id: "b", propertyId: "villa-b", checkIn: "2026-10-05", checkOut: "2026-10-06" }),
      ],
      dateBlocks: [
        { _id: id<Data["dateBlocks"][number]["_id"]>("da"), propertyId: id<Property["_id"]>("villa-a"), start: "2026-10-01", end: "2026-10-02", reason: "x" },
        { _id: id<Data["dateBlocks"][number]["_id"]>("db"), propertyId: id<Property["_id"]>("villa-b"), start: "2026-10-01", end: "2026-10-02", reason: "x" },
      ],
      blocks: [
        { propertyId: id<Property["_id"]>("villa-a"), date: "2026-10-10", source: "airbnb" },
        { propertyId: id<Property["_id"]>("villa-b"), date: "2026-10-10", source: "airbnb" },
      ],
    });
    const events = buildHotelCalendarEvents({ ...BASE, data, villa: "villa-a" });
    expect(events.every((e) => e.resourceId === "villa-a")).toBe(true);
    expect(events).toHaveLength(3);
  });

  it("places bookings at local check-in/out times and blocks at local midnight (Asia/Bangkok day boundaries)", () => {
    const data = makeData({
      bookings: [booking({ _id: "b", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-07" })],
      dateBlocks: [{ _id: id<Data["dateBlocks"][number]["_id"]>("d"), propertyId: id<Property["_id"]>("villa-a"), start: "2026-10-05", end: "2026-10-06", reason: "x" }],
    });
    const [bookingEvent, blockEvent] = buildHotelCalendarEvents({ ...BASE, data });
    // The chip's start/end are parsed as LOCAL wall-clock, which on an Asia/Bangkok (UTC+7) admin
    // resolves to the same calendar day the ISO date names — the day boundary never slips.
    expect(bookingEvent.start).toEqual(new Date("2026-10-05T14:00:00"));
    expect(bookingEvent.end).toEqual(new Date("2026-10-07T11:00:00"));
    expect(blockEvent.allDay).toBe(true);
    expect(blockEvent.start).toEqual(new Date("2026-10-05T00:00:00"));
    expect(blockEvent.end).toEqual(new Date("2026-10-06T00:00:00"));
  });

  it("keeps overlapping bookings as separate chips", () => {
    const data = makeData({
      bookings: [
        booking({ _id: "x", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-08" }),
        booking({ _id: "y", propertyId: "villa-a", checkIn: "2026-10-06", checkOut: "2026-10-09" }),
      ],
    });
    const events = buildHotelCalendarEvents({ ...BASE, data });
    expect(events.map((e) => e.id).sort()).toEqual(["x", "y"]);
    expect(events[0].start.getTime()).toBeLessThan(events[1].end!.getTime());
    expect(events[1].start.getTime()).toBeLessThan(events[0].end!.getTime());
  });

  it("does not read or alter the completeness/truncation flag (events ignore it)", () => {
    const base = makeData({ bookings: [booking({ _id: "b", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-06" })] });
    const complete = { ...base, complete: true } as Data;
    const truncated = { ...base, complete: false } as Data;
    expect(shape(buildHotelCalendarEvents({ ...BASE, data: complete }))).toEqual(
      shape(buildHotelCalendarEvents({ ...BASE, data: truncated })),
    );
  });

  it("orders events bookings, then host blocks, then OTA blocks", () => {
    const data = makeData({
      bookings: [booking({ _id: "bk", propertyId: "villa-a", checkIn: "2026-10-05", checkOut: "2026-10-06" })],
      dateBlocks: [{ _id: id<Data["dateBlocks"][number]["_id"]>("hb"), propertyId: id<Property["_id"]>("villa-a"), start: "2026-10-01", end: "2026-10-02", reason: "x" }],
      blocks: [{ propertyId: id<Property["_id"]>("villa-a"), date: "2026-10-10", source: "airbnb" }],
    });
    expect(buildHotelCalendarEvents({ ...BASE, data }).map((e) => e.data?.kind)).toEqual([
      "booking",
      "hostBlock",
      "otaBlock",
    ]);
  });
});

describe("blockRanges", () => {
  it("collapses contiguous per-night rows per villa and source into [start, end) ranges", () => {
    const ranges = blockRanges([
      { propertyId: "a", date: "2026-10-05", source: "airbnb" },
      { propertyId: "a", date: "2026-10-06", source: "airbnb" },
      { propertyId: "a", date: "2026-10-07", source: "airbnb" },
    ]);
    expect(ranges).toEqual([{ propertyId: "a", start: "2026-10-05", end: "2026-10-08", source: "airbnb" }]);
  });

  it("breaks a range on a gap, a different source, or a different villa", () => {
    const ranges = blockRanges([
      { propertyId: "a", date: "2026-10-05", source: "airbnb" },
      { propertyId: "a", date: "2026-10-07", source: "airbnb" }, // gap on the 6th
      { propertyId: "a", date: "2026-10-07", source: "booking" }, // different source, same night
      { propertyId: "b", date: "2026-10-05", source: "airbnb" }, // different villa
    ]);
    expect(ranges).toEqual([
      { propertyId: "a", start: "2026-10-05", end: addDaysIso("2026-10-05", 1), source: "airbnb" },
      { propertyId: "a", start: "2026-10-07", end: addDaysIso("2026-10-07", 1), source: "airbnb" },
      { propertyId: "a", start: "2026-10-07", end: addDaysIso("2026-10-07", 1), source: "booking" },
      { propertyId: "b", start: "2026-10-05", end: addDaysIso("2026-10-05", 1), source: "airbnb" },
    ]);
  });
});

describe("isoDate", () => {
  it("formats a Date as its local yyyy-MM-dd", () => {
    expect(isoDate(new Date("2026-10-05T14:00:00"))).toBe("2026-10-05");
    expect(isoDate(new Date("2026-10-05T00:00:00"))).toBe("2026-10-05");
  });
});
