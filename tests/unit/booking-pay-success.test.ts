// @vitest-environment happy-dom
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
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
  payState: "payable", amountDue: 2000000,
};
const never = () => new Promise<never>(() => {});
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

describe("G30 pay screen follows the link and the backend payment rules", () => {
  const payButton = () => [...document.querySelectorAll("button")].find((button) => button.textContent === en.Booking.pay);
  const summary = () => document.querySelector('[data-testid="pay-stay-summary"]');

  it("never keeps the previous stay on screen after a link change or a refusal", async () => {
    client.query.mockResolvedValue(booking);
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "secret" }));
    expect(summary()).not.toBeNull();
    client.query.mockImplementation(never);
    await show(createElement(PayClient, { bookingId: "b2", accessToken: "other" }));
    expect(summary()).toBeNull();
    expect(document.body.textContent).not.toContain("Pool Villa");
    client.query.mockResolvedValue(booking);
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "secret" }));
    expect(summary()).not.toBeNull();
    client.query.mockRejectedValue(new ConvexError("Booking access denied"));
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "wrong" }));
    expect(summary()).toBeNull();
    expect(document.body.textContent).toContain(en.Booking.unableToVerify);
    expect(payButton()?.disabled).toBe(true);
  });

  it.each([
    ["settled", en.Booking.paySettled],
    ["expired", en.Booking.payHoldExpired],
    ["closed", en.Booking.payClosed],
  ])("a %s stay explains itself and never starts checkout", async (payState, notice) => {
    client.query.mockResolvedValue({ ...booking, payState, amountDue: 0, paymentStatus: payState === "settled" ? "paid" : "pending" });
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "secret" }));
    expect(document.querySelector('[data-testid="pay-state"]')?.textContent).toBe(notice);
    expect(payButton()).toBeUndefined();
    for (const button of document.querySelectorAll("button")) await act(async () => button.click());
    expect(client.action).not.toHaveBeenCalled();
    const confirmation = [...document.querySelectorAll("a")].find((a) => a.textContent === en.Booking.viewConfirmation);
    expect(Boolean(confirmation)).toBe(payState === "settled");
  });

  it("keeps a positive balance on a paid stay payable and shows what is due now", async () => {
    vi.spyOn(window.location, "assign").mockImplementation(() => {});
    client.query.mockResolvedValue({ ...booking, status: "confirmed", paymentStatus: "paid", amountDue: 500000 });
    client.action.mockResolvedValue({ url: "https://checkout.stripe.com/test" });
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "secret" }));
    expect(document.querySelector('[data-testid="pay-amount-due"]')?.textContent).toBe(en.Booking.amountDueNow.replace("{amount}", "฿5,000"));
    await act(async () => payButton()!.click());
    expect(client.action.mock.calls[0][1]).toEqual({ bookingId: "b1", accessToken: "secret" });
  });

  it("requires a read-only status check after a checkout response is lost", async () => {
    client.query.mockResolvedValueOnce(booking)
      .mockResolvedValue({ ...booking, payState: "settled", status: "confirmed", paymentStatus: "paid", amountDue: 0 });
    client.action.mockRejectedValue(new Error("Provider response unavailable"));
    await show(createElement(PayClient, { bookingId: "b1", accessToken: "secret" }));
    await act(async () => payButton()!.click());
    expect(payButton()).toBeUndefined();
    expect(document.body.textContent).toContain(en.Booking.paymentCouldNotConfirm);
    expect(document.body.textContent).not.toContain("Provider response unavailable");
    const check = [...document.querySelectorAll("button")].find((button) => button.textContent === en.Booking.checkAgain);
    await act(async () => check!.click());
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.action).toHaveBeenCalledTimes(1);
    expect(payButton()).toBeUndefined();
    expect(document.body.textContent).toContain(en.Booking.viewConfirmation);
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

  it("refuses a malformed link and a ConvexError denial terminally", async () => {
    client.query.mockResolvedValue(null);
    await show(createElement(BookingSuccessClient, { bookingId: "not-an-id", accessToken: "secret" }));
    expect(phase()).toBe("invalid");
    expect(checkAgain()).toBeUndefined();
    client.query.mockRejectedValue(new ConvexError("Booking access denied"));
    await show(createElement(BookingSuccessClient, { bookingId: "b2", accessToken: "wrong" }));
    expect(phase()).toBe("invalid");
    expect(checkAgain()).toBeUndefined();
  });

  it("clears a transient failure while verifying again", async () => {
    client.query.mockRejectedValueOnce(new Error("Network down")).mockImplementation(never);
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    expect(document.body.textContent).toContain(en.Booking.unableToVerify);
    await act(async () => checkAgain()!.click());
    expect(phase()).toBe("verifying");
    expect(document.body.textContent).not.toContain(en.Booking.unableToVerify);
  });

  it("lets a network failure be retried", async () => {
    client.query.mockRejectedValueOnce(new Error("Network down")).mockResolvedValue({ ...booking, paymentStatus: "paid", status: "confirmed" });
    await show(createElement(BookingSuccessClient, { bookingId: "b1", accessToken: "secret" }));
    expect(phase()).toBe("pending");
    await act(async () => checkAgain()!.click());
    expect(phase()).toBe("confirmed");
  });
});
