// @vitest-environment happy-dom
import { act, createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName } from "convex/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AdminBookingsView } from "@/components/admin/AdminBookingsView";
import { AdminStaffBookingsView } from "@/components/admin/AdminStaffBookingsView";
import type { NewBookingDialog } from "@/components/admin/NewBookingDialog";

type CalendarProps = {
  resources?: { id: string }[];
  events?: { id: string }[];
  canSelectSlot?: (slot: { start: Date }) => boolean;
  onSelectSlot: (slot: { start: Date; end: Date; allDay: boolean; resourceId?: string }) => void;
  onSlotClick: (slot: { date: Date; view: string; allDay: boolean; resourceId?: string }) => void;
};
const observed = vi.hoisted(() => ({ calendar: null as CalendarProps | null, branch: undefined as string | undefined, draft: null as ComponentProps<typeof NewBookingDialog>["prefill"] | null }));
const villa = { _id: "p1", name: "Garden Villa", slug: "garden-villa", status: "active", pricePerNight: 400000, currency: "THB", maxGuests: 4 };
const villas = [villa, { ...villa, _id: "p2", name: "Pool Villa", slug: "pool-villa" }];
const appointmentStart = Date.parse("2026-11-10T10:00:00+07:00");
const schedule = {
  staff: [{ _id: "staff-1", name: "Niran", status: "active" }, { _id: "staff-2", name: "Mali", status: "active" }],
  services: [{ _id: "service-1", name: "Massage", status: "active" }],
  appointments: [{
    _id: "appointment-1", staffId: "staff-2", serviceId: "service-1", guestName: "Maya",
    start: appointmentStart, end: appointmentStart + 3600000, blockedUntil: appointmentStart + 3600000, status: "booked",
  }],
  shifts: [],
  blocks: [],
};
vi.mock("@/components/admin/branch/branch-context", () => ({
  useAdminBranch: () => ({ branches: [{ id: "samui", key: "koh-samui" }, { id: "phuket", key: "phuket" }], current: observed.branch ? { id: observed.branch } : null }),
}));
vi.mock("@/components/admin/AppointmentSheet", () => ({ AppointmentSheet: (props: { appointment: { _id: string } | null }) => props.appointment ? createElement("span", null, `Sheet ${props.appointment._id}`) : null }));
const nav = vi.hoisted(() => ({ search: "", replace: vi.fn() }));
vi.mock("@/platform/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: nav.replace }),
  useSearchParams: () => new URLSearchParams(nav.search),
  usePathname: () => "/admin/staff/calendar",
}));
vi.mock("convex/react", () => ({
  useMutation: () => vi.fn(),
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const name = getFunctionName(ref);
    if (name.endsWith(":listCalendarProperties") && args !== "skip") return villas;
    if (name.endsWith(":resolveCalendarAppointment") && args !== "skip") {
      const appointment = schedule.appointments.find((item) => item._id === (args as { appointmentId: string }).appointmentId);
      return appointment ? { id: appointment._id, staffId: appointment.staffId, start: appointment.start } : null;
    }
    if (name.endsWith(":listSchedule")) return schedule;
    if (name.endsWith(":listForAdmin")) return { properties: villas, bookings: [], dateBlocks: [], blocks: [], complete: true };
    return undefined;
  },
}));
vi.mock("@/components/reui/event-calendar/event-calendar", () => ({
  EventCalendar: (props: CalendarProps) => { observed.calendar = props; return null; },
  useEventCalendarNavigation: () => ({ navigateToDate: vi.fn() }),
}));
vi.mock("@/components/admin/BookingSheet", () => ({
  BookingSheet: ({ bookingId, onClose }: { bookingId: string | null; onClose: () => void }) => (bookingId ? createElement("button", { "data-testid": "booking-sheet", "data-booking": bookingId, onClick: onClose }) : null),
}));
vi.mock("@/components/admin/IcalSourcesDialog", () => ({
  IcalSourcesDialog: ({ open, onClose }: { open: boolean; onClose: () => void }) => (open ? createElement("button", { "data-testid": "ota-calendars", onClick: onClose }, "OTA calendars open") : null),
}));
vi.mock("@/components/admin/OtaRatesDialog", () => ({ OtaRatesDialog: () => null }));
vi.mock("@/components/admin/NewBookingDialog", () => ({
  NewBookingDialog: (props: ComponentProps<typeof NewBookingDialog>) => { observed.draft = props.prefill; return createElement("span", null, "Booking form opened"); },
}));
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-10T14:32:00+07:00"));
  observed.calendar = null; observed.branch = undefined; observed.draft = null; nav.search = "";
  window.localStorage.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opens a one-night stay from the clicked villa/date cell without creating anything", async () => {
  await act(async () => root.render(createElement(AdminBookingsView)));
  await act(async () => observed.calendar!.onSlotClick({ date: new Date("2026-11-17T00:00:00"), view: "resource", allDay: true, resourceId: "p1" }));
  expect(observed.draft).toEqual({ propertyId: "p1", checkIn: "2026-11-17", checkOut: "2026-11-18" });
  expect(document.body.textContent).toContain("Booking form opened");
});

it("allows a future drag and preserves its villa and exclusive end date", async () => {
  await act(async () => root.render(createElement(AdminBookingsView)));
  const start = new Date("2026-11-14T00:00:00"), end = new Date("2026-11-17T00:00:00");
  expect(observed.calendar!.canSelectSlot?.({ start }) ?? true).toBe(true);
  await act(async () => observed.calendar!.onSelectSlot({ start, end, allDay: true, resourceId: "p1" }));
  expect(observed.draft).toEqual({ propertyId: "p1", checkIn: "2026-11-14", checkOut: "2026-11-17" });
});

it("refuses past calendar taps and drags while leaving explicit past-stay entry to its form", async () => {
  await act(async () => root.render(createElement(AdminBookingsView)));
  const start = new Date("2026-11-04T00:00:00"), end = new Date("2026-11-07T00:00:00");
  expect(observed.calendar!.canSelectSlot?.({ start })).toBe(false);
  await act(async () => observed.calendar!.onSlotClick({ date: start, view: "resource", allDay: true, resourceId: "p1" }));
  await act(async () => observed.calendar!.onSelectSlot({ start, end, allDay: true, resourceId: "p1" }));
  expect(observed.draft).toBeNull();
  expect(document.body.textContent).not.toContain("Booking form opened");
});

it("keeps the resort’s remembered villa filter when switching the working branch", async () => {
  window.localStorage.setItem("admin.hotel.villa:samui", villa._id);
  window.localStorage.setItem("admin.hotel.villa:phuket", "p2");
  observed.branch = "samui";
  await act(async () => root.render(createElement(AdminBookingsView)));
  expect(observed.calendar?.resources?.map((resource) => resource.id)).toEqual(["p1"]);

  observed.branch = "phuket";
  await act(async () => root.render(createElement(AdminBookingsView)));
  expect(observed.calendar?.resources?.map((resource) => resource.id)).toEqual(["p1"]);
});

it("applies remembered staff and service IDs only in their branch", async () => {
  window.localStorage.setItem("admin.staff.hiddenStaff:samui", '["staff-1"]');
  window.localStorage.setItem("admin.staff.hiddenServices:samui", '["service-1"]');
  observed.branch = "samui";
  const renderStaff = () => act(async () => root.render(createElement(AdminStaffBookingsView, { tab: "calendar" })));
  await renderStaff();
  expect(observed.calendar?.resources?.map((resource) => resource.id)).toEqual(["staff-2"]);
  expect(observed.calendar?.events?.map((event) => event.id)).not.toContain("appointment-1");

  observed.branch = "phuket";
  await renderStaff();
  expect(observed.calendar?.resources?.map((resource) => resource.id)).toEqual(["staff-1", "staff-2"]);
  expect(observed.calendar?.events?.map((event) => event.id)).toContain("appointment-1");
});

it("D23/F12: a calendar deep link opens that date, shows the linked person and opens the appointment", async () => {
  window.localStorage.setItem("admin.staff.hiddenStaff", '["staff-2"]');
  nav.search = "date=2026-11-10&staff=staff-2&appointment=appointment-1";
  await act(async () => root.render(createElement(AdminStaffBookingsView, { tab: "calendar" })));
  expect(observed.calendar?.resources?.map((resource) => resource.id)).toEqual(["staff-1", "staff-2"]);
  expect((observed.calendar as unknown as { date: Date }).date.getTime()).toBe(Date.parse("2026-11-10T00:00:00+07:00"));
  expect(document.body.textContent).toContain("Sheet appointment-1");
});

it("D18: activating an off-shift block explains it and links to that person's roster week", async () => {
  const props = () => observed.calendar as unknown as { onEventClick: (o: { event: { id: string; data: unknown } }) => void };
  await act(async () => root.render(createElement(AdminStaffBookingsView, { tab: "calendar" })));
  const start = Date.parse("2026-11-10T18:00:00+07:00");
  await act(async () => props().onEventClick({ event: { id: "off", data: { kind: "off", staffId: "staff-2", start, end: start + 5 * 3600000 } } }));
  expect(document.body.textContent).toContain("Mali is not working");
  expect(document.body.textContent).toContain("18:00–23:00");
  expect(document.querySelector<HTMLAnchorElement>('a[href="/admin/staff/roster?date=2026-11-10&staff=staff-2"]')?.textContent).toBe("Open roster week");
});

it("opens OTA calendars from the setup checklist link and clears the panel on close (N04)", async () => {
  nav.search = "panel=ota-calendars";
  await act(async () => root.render(createElement(AdminBookingsView)));
  const dialog = document.querySelector<HTMLButtonElement>('[data-testid="ota-calendars"]');
  expect(dialog).not.toBeNull();
  await act(async () => dialog!.click());
  expect(nav.replace).toHaveBeenCalledWith("/admin/hotel", { scroll: false });
  nav.search = "panel=bogus";
  await act(async () => root.render(createElement(AdminBookingsView)));
  expect(document.querySelector('[data-testid="ota-calendars"]')).toBeNull();
  nav.search = "";
});

it("opens a stay from an admin Search link and clears the link on close (D03)", async () => {
  nav.search = "booking=k57booking0000000000000000000001";
  nav.replace.mockClear();
  await act(async () => root.render(createElement(AdminBookingsView)));
  const sheet = document.querySelector<HTMLButtonElement>('[data-testid="booking-sheet"]');
  expect(sheet?.dataset.booking).toBe("k57booking0000000000000000000001");
  await act(async () => sheet!.click());
  expect(nav.replace).toHaveBeenCalledWith("/admin/hotel", { scroll: false });
  nav.search = "booking=not%20an%20id";
  await act(async () => root.render(createElement(AdminBookingsView)));
  expect(document.querySelector('[data-testid="booking-sheet"]')).toBeNull();
  nav.search = "";
});
