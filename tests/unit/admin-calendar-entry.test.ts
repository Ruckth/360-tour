// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import type { NewBookingDialog } from "@/components/admin/NewBookingDialog";

type CalendarProps = {
  canSelectSlot?: (slot: { start: Date }) => boolean;
  onSelectSlot: (slot: { start: Date; end: Date; allDay: boolean; resourceId?: string }) => void;
  onSlotClick: (slot: { date: Date; view: string; allDay: boolean; resourceId?: string }) => void;
};
const observed = vi.hoisted(() => ({ calendar: null as CalendarProps | null, draft: null as ComponentProps<typeof NewBookingDialog>["prefill"] | null }));
const villa = { _id: "p1", name: "Garden Villa", slug: "garden-villa", status: "active", pricePerNight: 4000, currency: "THB", maxGuests: 4 };
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => getFunctionName(ref).endsWith(":listForAdmin")
    ? { properties: [villa], bookings: [], dateBlocks: [], blocks: [], complete: true }
    : undefined,
}));
vi.mock("@/components/reui/event-calendar/event-calendar", () => ({
  EventCalendar: (props: CalendarProps) => { observed.calendar = props; return null; },
  useEventCalendarNavigation: () => ({ navigateToDate: vi.fn() }),
}));
vi.mock("@/components/admin/BookingSheet", () => ({ BookingSheet: () => null }));
vi.mock("@/components/admin/IcalSourcesDialog", () => ({ IcalSourcesDialog: () => null }));
vi.mock("@/components/admin/OtaRatesDialog", () => ({ OtaRatesDialog: () => null }));
vi.mock("@/components/admin/NewBookingDialog", () => ({
  NewBookingDialog: (props: ComponentProps<typeof NewBookingDialog>) => { observed.draft = props.prefill; return createElement("span", null, "Booking form opened"); },
}));
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T14:32:00+07:00"));
  observed.calendar = null; observed.draft = null;
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opens a one-night past stay from the clicked villa/date cell without creating anything", async () => {
  await act(async () => root.render(createElement(AdminBookingsView)));
  await act(async () => observed.calendar!.onSlotClick({ date: new Date("2026-11-07T00:00:00"), view: "resource", allDay: true, resourceId: "p1" }));
  expect(observed.draft).toEqual({ propertyId: "p1", checkIn: "2026-11-07", checkOut: "2026-11-08" });
  expect(document.body.textContent).toContain("Booking form opened");
});

it("allows a past drag and preserves its villa and exclusive end date", async () => {
  await act(async () => root.render(createElement(AdminBookingsView)));
  const start = new Date("2026-11-04T00:00:00"), end = new Date("2026-11-07T00:00:00");
  expect(observed.calendar!.canSelectSlot?.({ start }) ?? true).toBe(true);
  await act(async () => observed.calendar!.onSelectSlot({ start, end, allDay: true, resourceId: "p1" }));
  expect(observed.draft).toEqual({ propertyId: "p1", checkIn: "2026-11-04", checkOut: "2026-11-07" });
});
