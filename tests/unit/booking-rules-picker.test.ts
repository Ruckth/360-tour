// @vitest-environment happy-dom
import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { BOOKING_RULE_DEFAULTS } from "convex/lib/siteSettings";
import { BookingDatePicker } from "@/components/booking/BookingDatePicker";
import en from "../../messages/en.json";

const state = vi.hoisted(() => ({
  query: vi.fn(),
  calendar: {} as {
    disabled: (date: Date) => boolean;
    onDayClick: (date: Date) => void;
  },
}));
vi.mock("@/lib/react/convex", () => ({ useOptionalConvex: () => state }));
vi.mock("@/components/ui/calendar", () => ({
  Calendar: (props: typeof state.calendar) => {
    state.calendar = props;
    return null;
  },
}));
vi.mock("@/components/ui/popover", () => {
  const Wrapper = ({ children }: { children: ReactNode }) =>
    createElement(Fragment, null, children);
  return { Popover: Wrapper, PopoverContent: Wrapper, PopoverTrigger: Wrapper };
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
      // eslint-disable-next-line react/no-children-prop -- next-intl requires children in createElement props.
      createElement(NextIntlClientProvider, {
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
  await act(async () => document.getElementById("booking-check-out")!.click());
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
