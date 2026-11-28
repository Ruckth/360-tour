// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { IntlProvider } from "@/platform/intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BOOKING_RULE_DEFAULTS } from "convex/shared/siteSettings";
import { BookingDatePicker } from "@/components/booking/BookingDatePicker";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  calendar: {} as {
    disabled: (date: Date) => boolean;
    onDayClick: (date: Date) => void;
  },
}));
vi.mock('convex/react', async (importOriginal) => ({ ...await importOriginal<typeof import('convex/react')>(), useConvex: () => state }));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: typeof state.calendar) => {
    state.calendar = props;
    return null;
  },
}));
vi.mock("@/components/ui/popover", () => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children);
  return { Popover: Wrapper, PopoverContent: Wrapper, PopoverAnchor: Wrapper };
});
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(Date.UTC(2026, 10, 3, 19)); // Already Nov 4 in Bangkok.
  state.query
    .mockReset()
    .mockResolvedValue({
      bookingRules: {
        ...BOOKING_RULE_DEFAULTS,
        minNights: 3,
        maxAdvanceDays: 10,
      },
    });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const date = (day: number) => new Date(2026, 10, day);
const render = (onChange = vi.fn(), checkOut = "") =>
  act(async () =>
    root.render(
      // eslint-disable-next-line react/no-children-prop -- use-intl requires children in createElement props.
      createElement(IntlProvider, {
        locale: "en",
        messages: en,
        children: createElement(BookingDatePicker, {
          checkIn: "2026-11-14",
          checkOut,
          onChange,
          isDateDisabled: () => false,
        }),
      }),
    ),
  );
it("limits arrivals by resort day and permits a departure after the last arrival date", async () => {
  await render();
  expect(state.calendar.disabled(date(14))).toBe(false);
  expect(state.calendar.disabled(date(15))).toBe(true);
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="booking-check-out"]')!.click());
  expect(state.calendar.disabled(date(15))).toBe(true); // One night, below minimum.
  expect(state.calendar.disabled(date(16))).toBe(true);
  expect(state.calendar.disabled(date(17))).toBe(false); // Three nights, beyond max arrival.
});
it("clears a saved departure if a new arrival would make the stay too short", async () => {
  const onChange = vi.fn();
  await render(onChange, "2026-11-16");
  await act(async () => state.calendar.onDayClick(date(14)));
  expect(onChange).toHaveBeenCalledWith({
    checkIn: "2026-11-14",
    checkOut: "",
  });
});
it("G28: explains the minimum stay and keys available, booked and unselectable days inside the picker", async () => {
  await render();
  const key = document.querySelector('[data-testid="booking-calendar-key"]')!;
  expect(key.querySelector('[data-testid="booking-min-stay"]')?.textContent).toBe("Minimum stay: 3 nights");
  expect([...key.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
    en.Booking.legendAvailable,
    en.Booking.legendBooked,
    en.Booking.legendNotSelectable,
  ]);
  expect(key.querySelector("ul")?.getAttribute("aria-label")).toBe(en.Booking.calendarKey);
  // The rule that disables a next-day checkout is the one displayed.
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="booking-check-out"]')!.click());
  expect(state.calendar.disabled(date(15))).toBe(true);
});
it("G28: hides the minimum-stay hint for one-night rules and keeps key ids unique per picker", async () => {
  state.query.mockResolvedValue({ bookingRules: { ...BOOKING_RULE_DEFAULTS, minNights: 1, maxAdvanceDays: 10 } });
  await act(async () =>
    root.render(
      // eslint-disable-next-line react/no-children-prop -- use-intl requires children in createElement props.
      createElement(IntlProvider, {
        locale: "en",
        messages: en,
        children: [0, 1].map((index) => createElement(BookingDatePicker, { key: index, checkIn: "", checkOut: "", onChange: vi.fn(), isDateDisabled: () => false })),
      }),
    ),
  );
  const keys = [...document.querySelectorAll('[data-testid="booking-calendar-key"]')];
  expect(keys).toHaveLength(2);
  expect(new Set(keys.map((item) => item.id)).size).toBe(2);
  expect(document.querySelector('[data-testid="booking-min-stay"]')).toBeNull();
  expect(new Set([...document.querySelectorAll('[data-testid="booking-check-in"]')].map((item) => item.id)).size).toBe(2);
});
