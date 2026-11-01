// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference, type FunctionReturnType } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { api } from "convex/_generated/api";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { BookingFinancials } from "@/components/admin/BookingFinancials";
import { CancelStayDialog, ReopenBookingDialog } from "@/components/admin/BookingCorrectionDialogs";
import { BookingHistory } from "@/components/admin/BookingHistory";
import { BookingSheet, EditBookingDialog } from "@/components/admin/BookingSheet";

type BookingDetail = NonNullable<FunctionReturnType<typeof api.adminBookings.getForAdmin>>;
type Financials = NonNullable<FunctionReturnType<typeof api.adminBookings.bookingFinancials>>;

const mutations = vi.hoisted(() => ({
  updateBooking: vi.fn(), resendBookingEmails: vi.fn(), deleteBooking: vi.fn(), updateNotes: vi.fn(),
  linkRecordedStripeRefund: vi.fn(),
  recordPayment: vi.fn(),
  recordRefund: vi.fn(),
  amendPayment: vi.fn(),
  cancelPayment: vi.fn(),
  cancelStay: vi.fn(),
  reopenBooking: vi.fn(),
  editBooking: vi.fn(),
}));
const queries = vi.hoisted(() => ({ bookingFinancials: vi.fn(), getForAdmin: vi.fn() }));
const pages = vi.hoisted(() => ({ read: vi.fn(), loadMore: vi.fn() }));
// The edit dialog's availability months: loaded, nothing blocked. One stable client, like ConvexProvider's.
const client = vi.hoisted(() => ({ watchQuery: () => ({ localQueryResult: () => [], onUpdate: () => () => undefined }) }));
vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref).split(":").pop() as keyof typeof mutations;
    if (!mutations[name]) throw new Error(`Unexpected mutation ${name}`);
    return mutations[name];
  },
  useQuery: (ref: FunctionReference<"query">) => {
    const name = getFunctionName(ref).split(":").pop() as keyof typeof queries;
    return queries[name]?.();
  },
  usePaginatedQuery: (_ref: unknown, args: unknown) => pages.read(args),
  useConvex: () => client,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

/** A resort (Bangkok, UTC+7) wall-clock time, whatever zone the test machine runs in. */
const at = (date: string, time: string) => Date.parse(`${date}T${time}:00+07:00`);
const NOW = at("2026-10-28", "10:00");

const money = { total: 17000, currency: "THB", gross: 25500, refunded: 0, net: 25500, owed: 0, credit: 8500, refundable: 8500, refundContext: "credit" as const, legacyRefund: false };
const booking = {
  _id: "b1", propertyId: "p1", guestName: "Mia", guestPhone: "+66 81", guestEmail: "mia@example.com", checkIn: "2026-10-20", checkOut: "2026-10-22",
  guests: 2, nights: 2, total: 17000, currency: "THB", status: "completed", paymentStatus: "paid", paymentMethod: "admin", amountPaid: 25500,
  source: "admin", createdAt: 0, revision: 7, propertyName: "Pool Villa", propertyStatus: "active", subtotal: 20000, discountAmount: 3000,
  priceOverride: null, hasStripePayment: false, checkoutLive: false, money, historical: true, guestEmailsOff: false, notifyByDefault: false,
  confirmationEmailed: true,
} as unknown as BookingDetail;

const cashPayment = {
  _id: "pay1", origin: "manual", amount: 25500, currency: "THB", method: "cash", effectiveAt: at("2026-10-20", "15:00"), recordedAt: at("2026-10-21", "09:00"),
  recordedBy: "desk@example.com", refunded: 0, refundable: 25500, status: "recorded", order: null, amendBlocker: null, cancelBlocker: null,
};
const onlinePayment = {
  ...cashPayment, _id: "pay2", origin: "online", method: "stripe", amount: 1000, refundable: 1000, recordedBy: "system:stripe",
  amendBlocker: "Online payments are the provider’s record and can’t be changed here.", cancelBlocker: "Online payments are the provider’s record.",
};
const financials = {
  revision: 7, money, payments: [cashPayment, onlinePayment], refunds: [], legacyOrders: [], unitemised: 0,
  legacyManual: { cancellable: false, reason: "x" }, hasStripePayment: false, complete: true,
} as unknown as Financials;

/** The booking date picker reads its labels from next-intl. */
const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;

let root: Root;
const render = (node: ReactNode) => act(async () => root.render(
  createElement(NextIntlClientProvider, intl, createElement(ConfirmProvider, null, node)),
));
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text);
const type = (id: string, value: string) => act(async () => {
  const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(" ");

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const mutation of Object.values(mutations)) mutation.mockReset().mockResolvedValue(null);
  queries.bookingFinancials.mockReset().mockReturnValue(financials);
  queries.getForAdmin.mockReset().mockReturnValue(booking);
  pages.read.mockReset().mockReturnValue({ results: [], status: "Exhausted", loadMore: pages.loadMore });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
it("links exact Stripe evidence with the reviewed revision and retains the identical attempt after a lost response", async () => {
  queries.bookingFinancials.mockReturnValue({ ...financials, refunds: [{ _id: "refund1", amount: 500, currency: "THB", method: "stripe", reason: "Returned online", effectiveAt: NOW, recordedBy: "desk@example.com", order: null }] });
  mutations.linkRecordedStripeRefund.mockRejectedValueOnce(new Error("Response lost")).mockResolvedValue(null);
  await render(createElement(BookingFinancials, { booking }));
  await click(button("Link Stripe refund evidence"));
  await type("stripe-charge-id", "ch_test123");
  await type("stripe-refund-id", "re_test123");
  await click(button("Link refund"));
  expect(alertText()).toContain("Response lost");
  expect((document.getElementById("stripe-charge-id") as HTMLInputElement).value).toBe("ch_test123");
  expect((document.getElementById("stripe-charge-id") as HTMLInputElement).disabled).toBe(true);
  await click(button("Retry linking"));
  expect(mutations.linkRecordedStripeRefund.mock.calls).toEqual([
    [{ bookingId: booking._id, refundId: "refund1", expectedRevision: 7, chargeId: "ch_test123", providerRefundId: "re_test123" }],
    [{ bookingId: booking._id, refundId: "refund1", expectedRevision: 7, chargeId: "ch_test123", providerRefundId: "re_test123" }],
  ]);
  expect(document.body.textContent).toContain("Stripe refund evidence linked");
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("booking payments and refunds", () => {
  it("keeps Edit and Cancel reachable for a live fully refunded stay", async () => {
    queries.getForAdmin.mockReturnValue({ ...booking, status: "confirmed", paymentStatus: "refunded", money: { ...money, gross: 17000, refunded: 17000, net: 0, owed: 0, credit: 0, refundable: 0 } });
    await render(createElement(BookingSheet, { bookingId: booking._id, properties: [], onClose: vi.fn() }));
    expect(button("Edit")).toBeDefined();
    expect(button("Cancel booking")).toBeDefined();
    expect(button("Reopen")).toBeUndefined();
  });
  it("shows each payment with its corrections, and no corrections for online money", async () => {
    await render(createElement(BookingFinancials, { booking }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Paid ฿25,500");
    expect(text).toContain("Credit ฿8,500");
    expect(text).toContain("Recorded on the booking · Cash");
    expect(text).toContain("Paid online · Stripe");
    expect(text).toContain("Online payments are the provider’s record and can’t be changed here.");
    // Correct and Not received for the desk payment only.
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "Correct method or date")).toHaveLength(1);
    expect([...document.querySelectorAll("button")].filter((b) => b.textContent === "Not received…")).toHaveLength(1);
    expect(button("Record payment")).toBeUndefined();
  });

  it("records a refund with a reason, keeps the input and attempt after a failure, and retries once", async () => {
    mutations.recordRefund.mockRejectedValueOnce(new Error("[CONVEX M(adminBookings:recordRefund)] Uncaught Error: This booking changed since you opened it. Review the latest details and try again.\n at x"));
    await render(createElement(BookingFinancials, { booking }));
    await click(button("Record refund"));
    expect(document.body.textContent).toContain("Recording does not return money");
    expect((document.getElementById("refund-amount") as HTMLInputElement).value).toBe("8500");
    const confirm = () => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent?.trim() === "Record refund") as HTMLButtonElement;
    expect(confirm().disabled).toBe(true);
    await type("refund-amount", "9000");
    expect(document.body.textContent).toContain("At most ฿8,500.");
    await type("refund-amount", "8500");
    await type("refund-reason", "Left a night early");
    await click(button("Card"));
    expect(confirm().disabled).toBe(false);
    await click(confirm());
    expect(alertText()).toContain("This booking changed since you opened it");
    expect((document.getElementById("refund-reason") as HTMLTextAreaElement).value).toBe("Left a night early");
    expect(document.getElementById("refund-reason")?.closest("fieldset")?.disabled).toBe(true);
    await type("refund-reason", "Changed after response loss");
    await click(confirm());
    expect(mutations.recordRefund).toHaveBeenCalledTimes(2);
    const [first, retry] = mutations.recordRefund.mock.calls.map(([args]) => args);
    expect(retry).toEqual(first);
    expect(retry).toMatchObject({
      bookingId: "b1", expectedRevision: 7, amount: 8500, currency: "THB", method: "card", reason: "Left a night early",
      paymentId: "pay1", effectiveAt: NOW,
    });
    expect(retry.idempotencyKey).toMatch(/^refund-/);
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain("Refund recorded");
  });

  it("records a desk payment with its method and the date it was received, without emailing for a past stay", async () => {
    const owing = { ...booking, money: { ...money, credit: 0, refundable: 0, owed: 4000, net: 13000 }, confirmationEmailed: false } as BookingDetail;
    queries.bookingFinancials.mockReturnValue({ ...financials, money: owing.money, payments: [] });
    let finish!: () => void;
    mutations.recordPayment.mockImplementation(() => new Promise((resolve) => { finish = () => resolve({ paymentId: "p", replayed: false }); }));
    await render(createElement(BookingFinancials, { booking: owing }));
    await click(button("Record payment"));
    expect(document.body.textContent).toContain("This does not charge the guest.");
    expect(document.body.textContent).toContain("The guest will not be emailed.");
    await click(button("Bank transfer"));
    await type("pay-when-time", "08:30");
    await click(button("Record ฿4,000"));
    expect(button("Record ฿4,000")?.disabled).toBe(true);
    expect(button("Close")?.disabled).toBe(true);
    await act(async () => finish());
    expect(mutations.recordPayment).toHaveBeenCalledWith(expect.objectContaining({
      bookingId: "b1", expectedRevision: 7, expectedAmount: 4000, method: "transfer", effectiveAt: at("2026-10-28", "08:30"), notifyGuest: false,
    }));
  });

  it("cancels a mistaken desk entry only with a reason", async () => {
    await render(createElement(BookingFinancials, { booking }));
    await click(button("Not received…"));
    expect(document.body.textContent).toContain("Nothing is refunded");
    expect(button("Cancel this entry")?.disabled).toBe(true);
    await type("cancel-entry-reason", "Entered on the wrong booking");
    await click(button("Cancel this entry"));
    expect(mutations.cancelPayment).toHaveBeenCalledWith({ bookingId: "b1", expectedRevision: 7, reason: "Entered on the wrong booking", paymentId: "pay1" });
  });
});

describe("cancel and reopen", () => {
  const paidFuture = { ...booking, status: "confirmed", checkIn: "2026-11-20", historical: false, notifyByDefault: true, money: { ...money, total: 25500, credit: 0, refundable: 25500, refundContext: "cancellation" } } as BookingDetail;

  it("cancels keeping the payment by default, with the guest email choice explicit", async () => {
    const onClose = vi.fn();
    await render(createElement(CancelStayDialog, { booking: paidFuture, onClose }));
    expect(document.body.textContent).toContain("Cancelling does not refund anything");
    expect(document.body.textContent).toContain("The guest will be emailed.");
    await click(document.getElementById("cancel-notify"));
    expect(document.body.textContent).toContain("The guest will not be emailed.");
    await click(button("Cancel booking"));
    expect(mutations.cancelStay).toHaveBeenCalledWith({ bookingId: "b1", expectedRevision: 7, reason: undefined, effectiveAt: NOW, notifyGuest: false });
    expect(onClose).toHaveBeenCalled();
  });

  it("cancels and records part of the payment as a refund in one save", async () => {
    await render(createElement(CancelStayDialog, { booking: paidFuture, onClose: vi.fn() }));
    await click(button("Record a refund"));
    await type("cancel-refund-amount", "20000");
    expect(document.body.textContent).toContain("฿5,500 stays kept");
    expect(button("Cancel & record refund")?.disabled).toBe(true);
    await type("cancel-refund-reason", "Cancellation fee kept");
    await click(button("Cancel & record refund"));
    expect(mutations.cancelStay).toHaveBeenCalledWith(expect.objectContaining({
      expectedRevision: 7, notifyGuest: true,
      refund: expect.objectContaining({ amount: 20000, currency: "THB", method: "cash", reason: "Cancellation fee kept", effectiveAt: NOW }),
    }));
  });

  it("reopens with a required reason and an archived-villa reason", async () => {
    const cancelled = { ...booking, status: "cancelled", propertyStatus: "archived", money: { ...money, net: 0, gross: 0, credit: 0, refundable: 0 } } as BookingDetail;
    await render(createElement(ReopenBookingDialog, { booking: cancelled, onClose: vi.fn() }));
    expect(button("Reopen booking")?.disabled).toBe(true);
    await type("reopen-reason", "Cancelled by mistake");
    expect(button("Reopen booking")?.disabled).toBe(true);
    await type("reopen-villa", "Recording the real stay");
    await click(button("Pending"));
    await click(button("Reopen booking"));
    expect(mutations.reopenBooking).toHaveBeenCalledWith({
      bookingId: "b1", expectedRevision: 7, confirmed: false, reason: "Cancelled by mistake", notifyGuest: false, archivedVillaReason: "Recording the real stay",
    });
  });
});

describe("booking history", () => {
  it("reads history page by page with labels, amounts and reasons", async () => {
    pages.read.mockReturnValue({
      status: "CanLoadMore", loadMore: pages.loadMore,
      results: [
        { _id: "h2", kind: "refund_recorded", actor: "desk@example.com", recordedAt: NOW, effectiveAt: NOW - 86_400_000, reason: "Left early", before: { amountRefunded: null }, after: { amountRefunded: 8500, amount: 8500, method: "card" } },
        { _id: "h1", kind: "payment_amended", actor: "desk@example.com", recordedAt: NOW, effectiveAt: NOW, reason: "Was a transfer", before: {}, after: { before: { method: "cash" }, after: { method: "transfer" } } },
      ],
    });
    await render(createElement(BookingHistory, { bookingId: "b1" as never, currency: "THB", villaName: () => "Pool Villa" }));
    const text = document.body.textContent ?? "";
    expect(text).toContain("Refund recorded");
    expect(text).toContain("Refunded: — → ฿8,500");
    expect(text).toContain("Method: Card");
    expect(text).toContain("Reason: Left early");
    expect(text).toContain("Effective");
    expect(text).toContain("Method: Cash → Bank transfer");
    await click(button("Load earlier history"));
    expect(pages.loadMore).toHaveBeenCalledWith(10);
    expect(pages.read).toHaveBeenCalledWith({ bookingId: "b1" });
  });
});

describe("editing the stay price", () => {
  const villa = { _id: "p1", slug: "pool-villa", name: "Pool Villa", maxGuests: 4, status: "active", pricePerNight: 10000, directDiscountPercent: 15, currency: "THB" };

  it("sets a custom price with a reason against the reviewed revision, silent for a past stay unless chosen", async () => {
    mutations.editBooking.mockRejectedValueOnce(new Error("Uncaught Error: These dates are no longer available.\n"));
    const onClose = vi.fn();
    await render(createElement(EditBookingDialog, { booking, properties: [villa] as never, onClose }));
    await click(document.getElementById("eb-custom"));
    await type("eb-custom-total", "15000");
    expect(button("Save changes")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("Add the reason for the custom price.");
    await type("eb-custom-reason", "Negotiated with the owner");
    expect(document.body.textContent).toContain("New total ฿15,000");
    expect(document.body.textContent).toContain("The guest will not be emailed.");
    await click(button("Save changes"));
    expect(alertText()).toContain("These dates are no longer available.");
    expect(onClose).not.toHaveBeenCalled();
    await click(document.getElementById("eb-notify"));
    await click(button("Save changes"));
    expect(mutations.editBooking).toHaveBeenLastCalledWith(expect.objectContaining({
      bookingId: "b1", expectedRevision: 7, checkIn: "2026-10-20", checkOut: "2026-10-22",
      priceOverride: { total: 15000, reason: "Negotiated with the owner" }, notifyGuest: true,
    }));
    expect(onClose).toHaveBeenCalled();
  });

  it("returns a custom price to the villa rate explicitly", async () => {
    const custom = { ...booking, priceOverride: { total: 15000, quotedTotal: 17000, reason: "Deal", by: "a", at: 0 }, total: 15000 } as BookingDetail;
    await render(createElement(EditBookingDialog, { booking: custom, properties: [villa] as never, onClose: vi.fn() }));
    await click(document.getElementById("eb-custom"));
    expect(document.body.textContent).toContain("Saving returns this stay to the villa rate.");
    expect(document.body.textContent).toContain("New total ฿17,000");
    await click(button("Save changes"));
    expect(mutations.editBooking).toHaveBeenCalledWith(expect.objectContaining({ priceOverride: null, expectedRevision: 7 }));
  });
});
