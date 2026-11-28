// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { IntlProvider } from "@/platform/intl";
import { PayClient } from "@/components/booking/PayClient";
import { BookingSuccessClient, SUCCESS_POLL_ATTEMPTS, SUCCESS_POLL_INTERVAL_MS } from "@/components/booking/BookingSuccessClient";
import en from "../../messages/en.json";
import th from "../../messages/th.json";

const client = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn(), action: vi.fn() }));
vi.mock("convex/react", async (importOriginal) => ({ ...await importOriginal<typeof import("convex/react")>(), useConvex: () => client }));
vi.mock("@/platform/navigation", () => ({ useRouter: () => ({ prefetch: () => {}, push: () => {} }) }));

const booking = {
  _id: "b1", checkIn: "2030-01-10", checkOut: "2030-01-12", guests: 3, nights: 2, subtotal: 2000000, discountAmount: 0,
  customPrice: false, total: 2000000, currency: "THB", paymentStatus: "pending", status: "pending", propertyName: "Pool Villa",
};
let root: Root;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  client.query.mockReset();
  client.action.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
const show = (node: ReactElement, locale: "en" | "th" = "en") =>
  // eslint-disable-next-line react/no-children-prop -- use-intl requires children in createElement props.
  act(async () => root.render(createElement(IntlProvider, { locale, messages: locale === "th" ? th : en, timeZone: "Asia/Bangkok", children: node })));
const text = (id: string) => document.querySelector(`[data-testid="${id}"]`)?.textContent;

describe("G30 pay screen stay summary", () => {
  it("shows villa, localized dates and guest count above Pay for a verified link", async () => {
    client.query.mockResolvedValue(booking);
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "secret" }), "th");
    expect(text("pay-stay-villa")).toBe("Pool Villa");
    expect(text("pay-stay-dates")).toContain(new Intl.DateTimeFormat("th", { day: "numeric" }).format(new Date(2030, 0, 10)));
    expect(text("pay-stay-guests")).toBe(th.Villa.guests.replace("{count}", "3"));
    const summary = document.querySelector('[data-testid="pay-stay-summary"]')!;
    const pay = [...document.querySelectorAll("button")].find((button) => button.textContent === th.Booking.pay)!;
    expect(summary.compareDocumentPosition(pay) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("shows no stay details when the token is refused or missing", async () => {
    client.query.mockRejectedValue(new Error("Booking access denied"));
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "wrong" }));
    expect(document.querySelector('[data-testid="pay-stay-summary"]')).toBeNull();
    await show(createElement(PayClient, { bookingId: "b2", accessToken: "" }));
    expect(document.querySelector('[data-testid="pay-stay-summary"]')).toBeNull();
    expect(document.body.textContent).toContain(en.Booking.missingToken);
  });
});

describe("G31 confirmation verification states", () => {
  const phase = () => document.querySelector<HTMLElement>('[data-testid="booking-success"]')?.dataset.phase;
  const checkAgain = () => [...document.querySelectorAll("button")].find((button) => button.textContent === en.Booking.checkAgain);
  const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

  it("shows progress, not a warning, while polling and confirms on a late webhook", async () => {
    vi.useFakeTimers();
    client.query.mockResolvedValueOnce(booking).mockResolvedValueOnce(booking).mockResolvedValue({ ...booking, paymentStatus: "paid", status: "confirmed" });
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    expect(phase()).toBe("verifying");
    expect(document.body.textContent).toContain(en.Booking.verifyingCopy);
    expect(document.body.textContent).not.toContain(en.Booking.notConfirmedCopy);
    expect(checkAgain()).toBeUndefined();
    await advance(SUCCESS_POLL_INTERVAL_MS * 2);
    expect(phase()).toBe("confirmed");
    expect(client.query).toHaveBeenCalledTimes(3);
  });

  it("offers Check again only after polling runs out, then restarts one read-only run", async () => {
    vi.useFakeTimers();
    client.query.mockResolvedValue(booking);
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    await advance(SUCCESS_POLL_INTERVAL_MS * SUCCESS_POLL_ATTEMPTS);
    expect(phase()).toBe("pending");
    expect(client.query).toHaveBeenCalledTimes(SUCCESS_POLL_ATTEMPTS);
    expect(document.body.textContent).toContain(en.Booking.paymentPendingCopy);
    client.query.mockClear().mockResolvedValue({ ...booking, paymentStatus: "paid", status: "confirmed" });
    await act(async () => checkAgain()!.click());
    expect(phase()).toBe("confirmed");
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.query.mock.calls.every(([ref]) => getFunctionName(ref) === "bookings/bookings:getById")).toBe(true);
    expect(client.mutation).not.toHaveBeenCalled();
    expect(client.action).not.toHaveBeenCalled();
  });

  it("stops polling on unmount, so runs never overlap", async () => {
    vi.useFakeTimers();
    client.query.mockResolvedValue(booking);
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await advance(SUCCESS_POLL_INTERVAL_MS * SUCCESS_POLL_ATTEMPTS);
    expect(client.query).toHaveBeenCalledTimes(1);
  });

  it("treats a cancelled booking as terminal and an invalid token as unverifiable, without retry", async () => {
    client.query.mockResolvedValue({ ...booking, status: "cancelled" });
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    expect(phase()).toBe("cancelled");
    expect(checkAgain()).toBeUndefined();
    client.query.mockRejectedValue(new Error("Booking access denied"));
    await show(createElement(BookingSuccessClient, { bookingId: "b2", accessToken: "wrong" }));
    expect(phase()).toBe("invalid");
    expect(checkAgain()).toBeUndefined();
    await show(createElement(BookingSuccessClient, { bookingId: "b3", accessToken: "" }));
    expect(phase()).toBe("invalid");
    expect(document.body.textContent).toContain(en.Booking.missingConfirmationToken);
  });

  it("lets a network failure be retried", async () => {
    client.query.mockRejectedValueOnce(new Error("Network down")).mockResolvedValue({ ...booking, paymentStatus: "paid", status: "confirmed" });
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    expect(phase()).toBe("pending");
    await act(async () => checkAgain()!.click());
    expect(phase()).toBe("confirmed");
  });
});
