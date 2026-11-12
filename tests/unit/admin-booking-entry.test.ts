// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { getFunctionName, type FunctionReference } from "convex/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en.json";
import { NewBookingDialog } from "@/components/admin/NewBookingDialog";
import { MoveBookingDialog, type Move } from "@/components/admin/AdminBookingsView";

const mutations = vi.hoisted(() => ({ createBooking: vi.fn(), editBooking: vi.fn() }));
const queries = vi.hoisted(() => ({ getForAdmin: vi.fn(), findGuests: vi.fn(), quoteBookingEdit: vi.fn() }));
// Availability months: loaded, nothing blocked. One stable client, like ConvexProvider's.
const client = vi.hoisted(() => ({ watchQuery: () => ({ localQueryResult: () => [], onUpdate: () => () => undefined }) }));
vi.mock("convex/react", () => ({
  useMutation: (ref: FunctionReference<"mutation">) => {
    const name = getFunctionName(ref).split(":").pop() as keyof typeof mutations;
    if (!mutations[name]) throw new Error(`Unexpected mutation ${name}`);
    return mutations[name];
  },
  useQuery: (ref: FunctionReference<"query">, args: unknown) => {
    if (args === "skip") return undefined;
    const name = getFunctionName(ref).split(":").pop() as keyof typeof queries;
    return queries[name]?.(args);
  },
  useConvex: () => client,
  useQueries: (requests: Record<string, { query: FunctionReference<"query">; args: unknown }>) => Object.fromEntries(
    Object.entries(requests).map(([key, request]) => {
      const name = getFunctionName(request.query).split(":").pop() as keyof typeof queries;
      return [key, queries[name]?.(request.args)];
    }),
  ),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
// The real phone widget is a country combobox; a plain input keeps these tests about the booking rules.
vi.mock("@/components/reui/phone-input", () => ({
  PhoneInput: ({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) =>
    createElement("input", { id, value, onChange: (event: { target: { value: string } }) => onChange(event.target.value) }),
}));

const NOW = Date.parse("2026-10-28T03:00:00Z");
const villa = { _id: "p1", slug: "pool-villa", name: "Pool Villa", maxGuests: 4, status: "active", pricePerNight: 1000000, directDiscountPercent: 0, currency: "THB" };
const oldVilla = { ...villa, _id: "p2", slug: "old-villa", name: "Old Villa", status: "archived" };

const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
let root: Root;
const render = (node: ReactNode) => act(async () => root.render(createElement(NextIntlClientProvider, intl, node)));
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const button = (text: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === text) as HTMLButtonElement | undefined;
const type = (id: string, value: string) => act(async () => {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), "value")!.set!;
  setter.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const text = () => document.body.textContent ?? "";
const alertText = () => [...document.querySelectorAll('[role="alert"]')].map((el) => el.textContent).join(" ");
const submit = () => act(async () => {
  (document.querySelector("form") as HTMLFormElement).requestSubmit();
});

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  for (const mutation of Object.values(mutations)) mutation.mockReset().mockResolvedValue(null);
  for (const query of Object.values(queries)) query.mockReset();
  queries.findGuests.mockReturnValue([]);
  queries.quoteBookingEdit.mockReturnValue({ subtotal: 3000000, discountAmount: 0, total: 3000000, currency: "THB", promotion: null, couponRemoved: false, repriced: true });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function fillGuest() {
  await type("nb-phone", "+66812345678");
  await type("nb-email", "mia@example.com");
  await type("nb-name", "Mia");
}

describe("new booking", () => {
  const props = (prefill: { propertyId?: string; checkIn: string; checkOut: string }, onCreated = vi.fn()) => ({
    properties: [villa, oldVilla] as never, prefill, onClose: vi.fn(), onCreated, onBlockInstead: vi.fn(),
  });

  it("does not email the guest about a past stay unless staff tick it, and sends the choice explicitly", async () => {
    await render(createElement(NewBookingDialog, props({ propertyId: "p1", checkIn: "2026-10-20", checkOut: "2026-10-22" })));
    await fillGuest();
    expect(text()).toContain("Email mia@example.com about this booking");
    expect(text()).toContain("The guest will not be emailed.");
    expect(text()).toContain("Past stays don’t email the guest unless you tick this.");
    await submit();
    expect(mutations.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ checkIn: "2026-10-20", notifyGuest: false, confirmed: true }));
    expect(mutations.createBooking.mock.calls[0][0]).not.toHaveProperty("priceOverride");
    expect(mutations.createBooking.mock.calls[0][0]).not.toHaveProperty("archivedVillaReason");

    await click(document.getElementById("nb-notify"));
    expect(text()).toContain("The guest will be emailed.");
    await submit();
    expect(mutations.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ notifyGuest: true }));
  });

  it("emails the guest about a future stay by default, and says so", async () => {
    await render(createElement(NewBookingDialog, props({ propertyId: "p1", checkIn: "2026-11-20", checkOut: "2026-11-22" })));
    await fillGuest();
    expect(text()).toContain("The guest will be emailed.");
    expect(text()).not.toContain("Past stays don’t email");
    await submit();
    expect(mutations.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ notifyGuest: true }));
  });

  it("takes an optional custom price only with a valid amount and a reason", async () => {
    await render(createElement(NewBookingDialog, props({ propertyId: "p1", checkIn: "2026-11-20", checkOut: "2026-11-22" })));
    await fillGuest();
    await click(document.getElementById("nb-custom"));
    await type("nb-custom-total", "15000.555");
    expect(text()).toContain("Enter the stay total, at most 2 decimals.");
    expect(button("Create booking")?.disabled).toBe(true);
    await type("nb-custom-total", "15000");
    expect(text()).toContain("Add the reason for the custom price.");
    expect(button("Create booking")?.disabled).toBe(true);
    await type("nb-custom-reason", "  Returning guest rate ");
    expect(button("Create booking")?.disabled).toBe(false);
    await submit();
    expect(mutations.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ priceOverride: { total: 1500000, reason: "Returning guest rate" } }));
  });

  it("records a past stay in an archived villa only with a reason, and refuses it for a current stay", async () => {
    await render(createElement(NewBookingDialog, props({ propertyId: "p2", checkIn: "2026-10-20", checkOut: "2026-10-22" })));
    await fillGuest();
    expect(text()).toContain("Old Villa");
    expect(text()).toContain("This villa is archived. Why record this past stay in it? (required)");
    expect(button("Create booking")?.disabled).toBe(true);
    await type("nb-villa-reason", "Villa closed after this stay");
    await submit();
    expect(mutations.createBooking).toHaveBeenLastCalledWith(expect.objectContaining({ propertySlug: "old-villa", archivedVillaReason: "Villa closed after this stay" }));

    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    // A current stay never starts in an archived villa, even if one is prefilled.
    await render(createElement(NewBookingDialog, props({ propertyId: "p2", checkIn: "2026-11-20", checkOut: "2026-11-22" })));
    expect(text()).toContain("Pool Villa");
    expect(text()).not.toContain("This villa is archived");
  });

  it("blocks closing and a second submit while saving, and keeps everything for a retry after a failure", async () => {
    let fail!: (error: Error) => void;
    mutations.createBooking.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const onCreated = vi.fn();
    await render(createElement(NewBookingDialog, props({ propertyId: "p1", checkIn: "2026-10-20", checkOut: "2026-10-22" }, onCreated)));
    await fillGuest();
    await click(document.getElementById("nb-notify"));
    await submit();
    expect(button("Create booking")?.disabled).toBe(true);
    expect(button("Close")?.disabled).toBe(true);
    await submit();
    expect(mutations.createBooking).toHaveBeenCalledTimes(1);
    await act(async () => fail(new Error("[CONVEX M(adminBookings:createBooking)] Uncaught Error: These dates are no longer available.\n at x")));
    expect(alertText()).toContain("These dates are no longer available.");
    expect((document.getElementById("nb-name") as HTMLInputElement).value).toBe("Mia");
    expect(text()).toContain("The guest will be emailed.");
    mutations.createBooking.mockResolvedValueOnce("b9");
    await submit();
    expect(mutations.createBooking).toHaveBeenCalledTimes(2);
    expect(mutations.createBooking.mock.calls[1][0]).toEqual(mutations.createBooking.mock.calls[0][0]);
    expect(onCreated).toHaveBeenCalledWith("b9");
  });
});

describe("moving a booking on the calendar", () => {
  const booking = {
    _id: "b1", propertyId: "p1", guestName: "Mia", guestPhone: "+66 81", guestEmail: "mia@example.com", checkIn: "2026-11-20", checkOut: "2026-11-22",
    guests: 2, nights: 2, total: 2000000, currency: "THB", status: "confirmed", paymentStatus: "pending", amountPaid: undefined, source: "admin", createdAt: 0, revision: 4,
  };
  const move = { booking, propertyId: "p1", checkIn: "2026-11-21", checkOut: "2026-11-24" } as unknown as Move;
  const detail = (overrides: Record<string, unknown> = {}) => ({ ...booking, revision: 4, priceOverride: null, guestEmailsOff: false, ...overrides });
  const props = (overrides: Partial<ComponentProps<typeof MoveBookingDialog>> = {}) => ({
    move, properties: [villa] as never, onClose: vi.fn(), onMoved: vi.fn(), onOpenBooking: vi.fn(), ...overrides,
  });

  it("sends the revision captured at the drop and an explicit email choice, with pending and retry", async () => {
    queries.getForAdmin.mockReturnValue(detail());
    let fail!: (error: Error) => void;
    mutations.editBooking.mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
    const onMoved = vi.fn();
    const onClose = vi.fn();
    await render(createElement(MoveBookingDialog, props({ onMoved, onClose })));
    expect(text()).toContain("New total ฿30,000");
    expect(text()).toContain("The guest will be emailed.");
    await click(document.getElementById("move-notify"));
    expect(text()).toContain("The guest will not be emailed.");
    await click(button("Move booking"));
    expect(button("Move booking")?.disabled).toBe(true);
    expect(button("Keep dates")?.disabled).toBe(true);
    await act(async () => fail(new Error("[CONVEX M(adminBookings:editBooking)] Uncaught Error: Network glitch\n at x")));
    expect(alertText()).toContain("Network glitch");
    expect(onClose).not.toHaveBeenCalled();
    await click(button("Try again"));
    expect(mutations.editBooking).toHaveBeenCalledTimes(2);
    expect(mutations.editBooking.mock.calls[1][0]).toEqual(mutations.editBooking.mock.calls[0][0]);
    expect(mutations.editBooking.mock.calls[0][0]).toMatchObject({
      bookingId: "b1", expectedRevision: 4, propertyId: "p1", checkIn: "2026-11-21", checkOut: "2026-11-24", notifyGuest: false,
      expectedPrice: { total: 3000000, currency: "THB" },
    });
    expect(onMoved).toHaveBeenCalledWith(expect.stringContaining("Mia: moved to"));
  });

  it("does not email a guest who was entered silently unless staff tick it", async () => {
    queries.getForAdmin.mockReturnValue(detail({ guestEmailsOff: true }));
    await render(createElement(MoveBookingDialog, props()));
    expect(text()).toContain("The guest will not be emailed.");
    await click(button("Move booking"));
    expect(mutations.editBooking).toHaveBeenCalledWith(expect.objectContaining({ notifyGuest: false }));
  });

  it("does not move a custom-priced stay at the villa rate, and offers to open the booking", async () => {
    queries.getForAdmin.mockReturnValue(detail({ priceOverride: { total: 1500000, quotedTotal: 2000000, reason: "Friends rate", by: "a", at: 0 } }));
    const onOpenBooking = vi.fn();
    await render(createElement(MoveBookingDialog, props({ onOpenBooking })));
    expect(text()).toContain("This stay has a custom price of ฿15,000: Friends rate");
    expect(button("Move booking")).toBeUndefined();
    await click(button("Open booking"));
    expect(onOpenBooking).toHaveBeenCalledWith("b1");
    expect(mutations.editBooking).not.toHaveBeenCalled();
  });

  it("explains a custom-price refusal from the server and offers the booking", async () => {
    queries.getForAdmin.mockReturnValue(detail());
    mutations.editBooking.mockRejectedValueOnce(new Error("[CONVEX M(adminBookings:editBooking)] Uncaught Error: This booking has a custom price. Enter the price for the new stay, or go back to the villa rate.\n at x"));
    const onOpenBooking = vi.fn();
    await render(createElement(MoveBookingDialog, props({ onOpenBooking })));
    await click(button("Move booking"));
    expect(alertText()).toContain("This booking has a custom price.");
    await click(button("Open booking"));
    expect(onOpenBooking).toHaveBeenCalledWith("b1");
  });

  it("refuses to move a booking that changed since the calendar showed it", async () => {
    queries.getForAdmin.mockReturnValue(detail({ revision: 5 }));
    await render(createElement(MoveBookingDialog, props()));
    expect(alertText()).toContain("changed since the calendar showed it");
    expect(button("Move booking")?.disabled).toBe(true);
  });

  it("waits for the booking to load before it can move", async () => {
    queries.getForAdmin.mockReturnValue(undefined);
    await render(createElement(MoveBookingDialog, props()));
    expect(button("Move booking")?.disabled).toBe(true);
  });

  it("reviews the server's coupon price and submits it instead of a direct-rate estimate", async () => {
    queries.getForAdmin.mockReturnValue(detail());
    queries.quoteBookingEdit.mockReturnValue({ subtotal: 3000000, discountAmount: 600000, total: 2400000, currency: "THB", promotion: { code: "DCNT-F1-20", couponVersion: 1, discount: 600000 }, couponRemoved: false, repriced: true });
    await render(createElement(MoveBookingDialog, props()));
    expect(text()).toContain("New total ฿24,000");
    await click(button("Move booking"));
    expect(mutations.editBooking).toHaveBeenCalledWith(expect.objectContaining({ expectedPrice: { total: 2400000, currency: "THB" } }));
    expect(queries.quoteBookingEdit).toHaveBeenCalledWith({ bookingId: "b1", propertySlug: "pool-villa", checkIn: "2026-11-21", checkOut: "2026-11-24", guests: 2 });
  });

  it("cannot move until the quote is ready, including a refused quote", async () => {
    queries.getForAdmin.mockReturnValue(detail());
    queries.quoteBookingEdit.mockReturnValue(undefined);
    await render(createElement(MoveBookingDialog, props()));
    expect(button("Move booking")?.disabled).toBe(true);
    queries.quoteBookingEdit.mockReturnValue(new Error("Those dates are no longer available."));
    await render(createElement(MoveBookingDialog, props()));
    expect(alertText()).toContain("Those dates are no longer available.");
    expect(button("Move booking")?.disabled).toBe(true);
    expect(mutations.editBooking).not.toHaveBeenCalled();
  });

  it("shows the quoted currency and sends it for the server to check", async () => {
    queries.getForAdmin.mockReturnValue(detail());
    queries.quoteBookingEdit.mockReturnValue({ subtotal: 30000, discountAmount: 0, total: 30000, currency: "USD", promotion: null, couponRemoved: false, repriced: true });
    await render(createElement(MoveBookingDialog, props()));
    expect(text()).toContain("New total $300");
    await click(button("Move booking"));
    expect(mutations.editBooking).toHaveBeenCalledWith(expect.objectContaining({ expectedPrice: { total: 30000, currency: "USD" } }));
  });
});
