// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import type { DisplayOrderState } from "convex/lib/displayView";
import { NextIntlClientProvider } from "next-intl";
import { act, createElement, useState, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import messages from "../../messages/display/en.json";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { receiptText } from "@/components/checkout/checkout-ui";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { HistoryValues } from "@/components/checkout/OrderHistory";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { Screen } from "@/components/display/DisplayScreens";

type Fixture = ReturnType<typeof createFixtureBackend>;
let root: Root;

function Page({ start }: { start: OrderId | null }) {
  const [orderId, setOrderId] = useState<OrderId | null>(start);
  return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
}
const render = (node: ReactNode) => act(async () => root.render(node));
const show = (backend: CheckoutBackend, start: OrderId | null) =>
  render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Page, { start })));
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(400); });
const click = (el: Element | null | undefined) => act(async () => (el as HTMLElement).click());
const panel = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const button = (text: string | RegExp, within: ParentNode = panel()) =>
  [...within.querySelectorAll("button")].find((el) => (typeof text === "string" ? el.textContent?.trim() === text : text.test(el.textContent ?? ""))) as HTMLButtonElement | undefined;
const row = (name: string) => [...panel().querySelectorAll("li")].find((li) => li.querySelector("button")?.textContent?.startsWith(name))!;
const field = () => panel().querySelector<HTMLInputElement>('form[aria-label="Add coupon"] input')!;
const due = () => panel().querySelector('[data-testid="order-due"]')?.textContent;
function type(el: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
/** What a scanner or Enter does: types the value and submits the field. */
async function enter(value: string) {
  await act(async () => type(field(), value));
  await act(async () => field().form!.requestSubmit());
  await settle();
}

const svc = (n: number) => ({ kind: "service" as const, serviceId: `fxsvc${String(n).padStart(6, "0")}` as Id<"services"> });
/** Thai massage 60 ฿1,200 + Foot spa 45 ฿600 + Breakfast basket ฿450 (kit/data.md). */
async function spaOrder(backend: CheckoutBackend) {
  const actions = backend.useActions();
  const first = actions.addItem({ item: svc(1) });
  await vi.advanceTimersByTimeAsync(200);
  const { orderId, lineId } = await first;
  const rest = Promise.all([actions.addItem({ orderId, item: svc(7) }), actions.addItem({ orderId, item: { kind: "extra", name: "Breakfast basket", price: 450 } })]);
  await vi.advanceTimersByTimeAsync(400);
  await rest;
  return { orderId, massage: lineId };
}
async function write<T>(promise: Promise<T>) {
  await vi.advanceTimersByTimeAsync(200);
  return promise;
}
async function readOrder(backend: CheckoutBackend, orderId: OrderId) {
  const read: { view?: OrderView | null } = {};
  function Read() {
    read.view = backend.useOrder(orderId);
    return null;
  }
  const reader = createRoot(document.createElement("div"));
  await act(async () => reader.render(createElement(Read)));
  await act(async () => reader.unmount());
  return read.view!;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("adding a coupon at checkout", () => {
  it("applies a typed code, splits it over the spa rows and shows it apart from staff discounts", async () => {
    const backend = createFixtureBackend();
    const { orderId } = await spaOrder(backend);
    await show(backend, orderId);
    expect(due()).toBe("฿2,250");

    await click(button(/^Add coupon/));
    await enter("dcnt-spa-500 ");
    const chip = panel().querySelector('[data-testid="order-coupon"]')!;
    expect(chip.textContent).toContain("DCNT-SPA-500");
    expect(chip.textContent).toContain("Saves ฿500");
    expect(chip.textContent).toContain("฿500 off spa services of ฿1,500 or more");
    expect(panel().querySelector('[data-testid="order-coupon-total"]')?.textContent).toBe("Coupon DCNT-SPA-500-฿500");
    expect(panel().textContent).not.toContain("Discounts");
    expect(due()).toBe("฿1,750");
    // ฿500 over ฿1,200 + ฿600, the breakfast basket not covered.
    expect(row("Thai massage 60").textContent).toContain("Coupon -฿333");
    expect(row("Foot spa 45").textContent).toContain("Coupon -฿167");
    expect(row("Breakfast basket").textContent).not.toContain("Coupon");
    expect(row("Thai massage 60").textContent).toContain("฿867");

    // A staff discount stays its own row in the totals.
    await click(row("Breakfast basket").querySelector("button"));
    await act(async () => type(panel().querySelector<HTMLInputElement>('input[aria-label="Discount"]')!, "50"));
    await click(button("Apply"));
    await settle();
    expect(panel().textContent).toContain("Discounts-฿50");
    expect(panel().querySelector('[data-testid="order-coupon-total"]')?.textContent).toContain("-฿500");

    await click(panel().querySelector('button[aria-label="Remove coupon DCNT-SPA-500"]'));
    await settle();
    expect(panel().querySelector('[data-testid="order-coupon"]')).toBeNull();
    expect(button(/^Add coupon/)).toBeDefined();
    expect(due()).toBe("฿2,200");
  });

  it("takes a pasted or scanned offer link and refuses other sites' links before any lookup", async () => {
    const backend = createFixtureBackend();
    const { orderId } = await spaOrder(backend);
    await show(backend, orderId);
    const apply = vi.spyOn(backend.useActions(), "applyOrderCoupon");
    await click(button(/^Add coupon/));

    await enter("https://elsewhere.example/q1");
    expect(field().getAttribute("aria-invalid")).toBe("true");
    expect(panel().textContent).toContain("Only offer links from this site can be used.");
    await enter("   ");
    expect(panel().textContent).toContain("Enter a coupon code, or scan or paste an offer link.");
    expect(apply).not.toHaveBeenCalled();

    await enter(`${window.location.origin}/f`);
    expect(apply).toHaveBeenLastCalledWith({ orderId, slug: "f" });
    expect(panel().textContent).toContain("This link has no active offer.");

    // A scanner types the poster QR's URL and Enter.
    await enter(`${window.location.origin}/q1`);
    expect(apply).toHaveBeenLastCalledWith({ orderId, slug: "q1" });
    expect(panel().querySelector('[data-testid="order-coupon"]')?.textContent).toContain("DCNT-SPA-500");
  });

  it("explains a code that can't be used on this order", async () => {
    const backend = createFixtureBackend();
    const { orderId } = await spaOrder(backend);
    await show(backend, orderId);
    await click(button(/^Add coupon/));
    const cases: [string, string][] = [
      ["DCNT-NOPE", "No coupon has this code. Check the spelling."],
      ["DCNT-RAIN-15", "This coupon ended on 31 Oct 2026."],
      ["DCNT-YOGA-200", "This coupon has no uses left."],
      ["DCNT-F1-20", "This coupon does not cover any item on this order."],
      ["DCNT-VILLA-10", "This coupon is limited to certain villas, so it can't be used at checkout."],
    ];
    for (const [code, message] of cases) {
      await enter(code);
      expect(panel().querySelector('form[aria-label="Add coupon"]')?.textContent, code).toContain(message);
    }
    expect(due()).toBe("฿2,250");
  });

  it("waits for order edits still saving before the field can be used", async () => {
    const backend = createFixtureBackend();
    const { orderId } = await spaOrder(backend);
    await show(backend, orderId);
    await click(button(/^Add coupon/));
    await act(async () => type(field(), "DCNT-SPA-500"));
    // Another tap on the catalog: its write is in flight.
    await click([...document.querySelectorAll("button")].find((el) => /^Hot stone 60/.test(el.getAttribute("aria-label") ?? el.textContent ?? "")));
    expect(field().disabled).toBe(true);
    expect(button("Apply")?.disabled).toBe(true);
    await settle();
    expect(field().disabled).toBe(false);
  });

  it("shows only on open orders with items", async () => {
    const backend = createFixtureBackend();
    await show(backend, null);
    expect(button(/^Add coupon/)).toBeUndefined();
  });
});

describe("a coupon that no longer fits", () => {
  it("warns, blocks payment with the reason, and can be removed", async () => {
    const backend = createFixtureBackend();
    const { orderId } = await spaOrder(backend);
    await write(backend.useActions().applyOrderCoupon({ orderId, code: "DCNT-SPA-500" }));
    await show(backend, orderId);
    await click(row("Thai massage 60").querySelector("button"));
    await click(button("Remove item"));
    await settle();

    const warning = panel().querySelector('[data-testid="order-coupon-problem"]')!;
    expect(warning.textContent).toContain("DCNT-SPA-500 not applied");
    expect(warning.textContent).toContain("Eligible items come to ฿600. This coupon needs at least ฿1,500.");
    expect(panel().textContent).toContain("Fix or remove the coupon before taking payment.");
    for (const tender of ["Cash", "PromptPay", "Card", "Transfer", "Split payment"]) expect(button(tender)?.disabled, tender).toBe(true);
    expect(panel().querySelector('[data-testid="order-coupon-total"]')).toBeNull();
    expect(due()).toBe("฿1,050");

    await click(button("Remove", warning));
    await settle();
    expect(panel().querySelector('[data-testid="order-coupon-problem"]')).toBeNull();
    expect(button("Card")?.disabled).toBe(false);
  });

  it("checks again once a paused coupon is live, restoring the saving and payment", async () => {
    const backend = createFixtureBackend();
    const { orderId } = await spaOrder(backend);
    await write(backend.useActions().applyOrderCoupon({ orderId, code: "DCNT-SPA-500" }));
    backend.setCouponSnapshot("DCNT-SPA-500", { status: "paused" });
    await write(backend.useActions().addItem({ orderId, item: { kind: "extra", name: "Water", price: 50 } }));
    await show(backend, orderId);
    const warning = panel().querySelector('[data-testid="order-coupon-problem"]')!;
    expect(warning.textContent).toContain("This coupon is paused or not published yet.");

    backend.setCouponSnapshot("DCNT-SPA-500", { status: "active" });
    await click(button("Check again", warning));
    await settle();
    expect(panel().querySelector('[data-testid="order-coupon-problem"]')).toBeNull();
    expect(panel().querySelector('[data-testid="order-coupon"]')?.textContent).toContain("Saves ฿500");
    expect(button("Card")?.disabled).toBe(false);
  });

  it("never offers the coupon to a stay priced with its own booking coupon", async () => {
    const backend = createFixtureBackend({ bookings: [{ id: "fxbkg000001" as Id<"bookings">, promotion: { code: "DCNT-F1-20", discount: 3000 } }] });
    const { orderId } = await write(backend.useActions().openOrderFor({ bookingId: "fxbkg000001" as Id<"bookings"> }));
    await write(backend.useActions().addItem({ orderId, item: svc(1) }));
    await write(backend.useActions().applyOrderCoupon({ orderId, code: "DCNT-L-10" }));
    await show(backend, orderId);
    const stay = row("Stay · Lagoon Pool Villa");
    expect(stay.textContent).toContain("Priced with DCNT-F1-20 on the booking");
    expect(stay.textContent).not.toContain("Coupon -");
    expect(row("Thai massage 60").textContent).toContain("Coupon -฿120");
    expect(panel().querySelector('[data-testid="order-coupon-total"]')?.textContent).toContain("-฿120");
  });
});

describe("paying with a coupon", () => {
  async function payByCard(fixture: Fixture, orderId: OrderId) {
    await show(fixture, orderId);
    await click(button("Card"));
    await click(button(/^Confirm .* received$/));
    await settle();
  }

  it("refuses a coupon sold out at payment, records no payment, and offers a re-check or removal", async () => {
    const fixture = createFixtureBackend();
    const { orderId } = await spaOrder(fixture);
    await write(fixture.useActions().applyOrderCoupon({ orderId, code: "DCNT-L2-300" }));
    fixture.setCouponSnapshot("DCNT-L2-300", { used: 50 });
    await payByCard(fixture, orderId);

    const alert = panel().querySelector('[data-testid="pay-coupon-problem"]')!;
    expect(alert.textContent).toContain("Payment not recorded.");
    expect(alert.textContent).not.toContain("Nothing was charged");
    expect(alert.textContent).toContain("This coupon has no uses left.");
    expect(button("Retry payment")).toBeUndefined();
    expect((await readOrder(fixture, orderId)).order.state).toBe("unpaid");

    await click(button(/Check coupon again/, alert));
    await settle();
    // Back on the order: the re-check stored why the coupon no longer fits, and payment waits.
    const problem = panel().querySelector('[data-testid="order-coupon-problem"]')!;
    expect(problem.textContent).toContain("This coupon has no uses left.");
    expect(button("Card")?.disabled).toBe(true);
    await click(button("Remove", problem));
    await settle();
    // At the full price, to review before a new attempt.
    expect(due()).toBe("฿2,250");
    expect(button(/^Add coupon/)).toBeDefined();
  });

  it("refuses a coupon whose saving changed and re-checks it at the new saving", async () => {
    const fixture = createFixtureBackend();
    const { orderId } = await spaOrder(fixture);
    await write(fixture.useActions().applyOrderCoupon({ orderId, code: "DCNT-L-10" }));
    fixture.setCouponSnapshot("DCNT-L-10", { maxSaving: 100 });
    await payByCard(fixture, orderId);
    const alert = panel().querySelector('[data-testid="pay-coupon-problem"]')!;
    expect(alert.textContent).toContain("The coupon now saves ฿100.");
    await click(button(/Check coupon again/, alert));
    await settle();
    expect(panel().querySelector('[data-testid="order-coupon"]')?.textContent).toContain("Saves ฿100");
    expect(due()).toBe("฿2,150");
  });

  it("shows the coupon in the amount due and consumes it when paid", async () => {
    const fixture = createFixtureBackend();
    const { orderId } = await spaOrder(fixture);
    await write(fixture.useActions().applyOrderCoupon({ orderId, code: "DCNT-SPA-500" }));
    await show(fixture, orderId);
    await click(button("Card"));
    expect(panel().textContent).toContain("Includes coupon DCNT-SPA-500 · -฿500");
    await click(button("Confirm ฿1,750 received"));
    await settle();
    const view = await readOrder(fixture, orderId);
    expect(view.order.state).toBe("paid");
    expect(view.promotion).toMatchObject({ code: "DCNT-SPA-500", discount: 500, problem: null });
  });
});

describe("receipts with a coupon", () => {
  async function paidOrder() {
    const fixture = createFixtureBackend();
    const { orderId } = await spaOrder(fixture);
    const applied = await write(fixture.useActions().applyOrderCoupon({ orderId, code: "DCNT-SPA-500" }));
    await write(fixture.useActions().settleOrder({ orderId, expectedRevision: applied.revision, expectedDue: 1750, idempotencyKey: "coupon-receipt", tenders: [{ method: "cash", amount: 1750, received: 2000 }] }));
    return { fixture, orderId, view: await readOrder(fixture, orderId) };
  }

  it("prints a coupon line per row, apart from the staff discount, and in the totals", async () => {
    const { fixture, orderId } = await paidOrder();
    await render(createElement(CheckoutBackendProvider, { backend: fixture as CheckoutBackend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(ReceiptView, { orderId, onNewSale: () => {}, onOpenOrder: () => {} })));
    const receipt = document.querySelector("article.pos-receipt")!;
    expect([...receipt.querySelectorAll('[data-testid="receipt-line-coupon"]')].map((el) => el.textContent)).toEqual(["Coupon DCNT-SPA-500-฿333", "Coupon DCNT-SPA-500-฿167"]);
    expect(receipt.textContent).not.toContain("Discount-");
    expect(receipt.querySelector('[data-testid="receipt-coupon-total"]')?.textContent).toBe("Coupon DCNT-SPA-500-฿500");
    expect(receipt.textContent).toContain("Subtotal฿2,250");
    expect(receipt.textContent).toContain("Total฿1,750");
    expect(receipt.textContent).toContain("You saved ฿500 with DCNT-SPA-500");
  });

  it("puts the code and the saving in the shared text", async () => {
    const { view } = await paidOrder();
    const text = receiptText(view, "Auralis Cove Retreat");
    // Rows before the coupon, each share under its row, then subtotal less coupon is the total: counted once.
    expect(text).toContain("Thai massage 60  ฿1,200\n  Coupon DCNT-SPA-500  -฿333");
    expect(text).toContain("Foot spa 45  ฿600\n  Coupon DCNT-SPA-500  -฿167");
    expect(text).toContain("Subtotal  ฿2,250\nCoupon DCNT-SPA-500  -฿500\nTotal  ฿1,750");
    expect(text).toContain("You saved ฿500 with DCNT-SPA-500");
    expect(text).toContain("Cash  ฿2,000\nChange  ฿250");
  });
});

describe("order history", () => {
  it("names coupon events and their fields", async () => {
    const fixture = createFixtureBackend();
    const { orderId } = await spaOrder(fixture);
    await write(fixture.useActions().applyOrderCoupon({ orderId, code: "DCNT-SPA-500" }));
    await show(fixture, orderId);
    const history = [...document.querySelectorAll("summary")].find((el) => el.textContent?.includes("Order history"));
    await click(history);
    const entry = [...document.querySelectorAll('section[aria-label="Order history"] li')].find((li) => li.querySelector("p")?.textContent === "Coupon applied")!;
    expect(entry).toBeDefined();
    expect(entry.textContent).toContain("Coupon: DCNT-SPA-500");
    expect(entry.textContent).toContain("Coupon version: v1");
    expect(entry.textContent).toContain("Discount: ฿500");
  });

  it("formats a removed coupon", async () => {
    await render(createElement(HistoryValues, { value: { code: "DCNT-L-10", couponVersion: 2, discount: 180 } }));
    expect(document.body.textContent).toBe("Coupon: DCNT-L-10Coupon version: v2Discount: ฿180");
  });
});

describe("customer display", () => {
  const shared = { businessName: "Auralis Cove Retreat", customerFirstName: "Anna", orderNumber: 42, currency: "THB" };
  const intl = { locale: "en", messages, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
  const display = (state: DisplayOrderState) => render(createElement(NextIntlClientProvider, intl, createElement(Screen, { state })));
  const line = (name: string, total: number, couponDiscount: number, discount = couponDiscount) => ({ name, detail: "", qty: 1, unitPrice: total + discount, price: total + discount, discount, couponDiscount, total, deposit: 0 });

  it("shows each row's coupon share and the coupon in the totals, apart from discounts", async () => {
    await display({
      ...shared, state: "order", activeAt: Date.now(), subtotal: 2250, discount: 550, coupon: { code: "DCNT-SPA-500", saving: 500 }, deposit: 0, total: 1700, vat: 111.21, due: 1700,
      lines: [line("Thai massage 60", 867, 333), line("Foot spa 45", 433, 167), line("Breakfast basket", 400, 0, 50)],
    });
    const text = document.body.textContent ?? "";
    expect(text).toContain("Thai massage 60฿333 off with DCNT-SPA-500฿867");
    expect(text).toContain("Breakfast basket฿50 off฿400");
    expect(text).toContain("Discounts−฿50");
    expect(text).toContain("Coupon DCNT-SPA-500−฿500");
  });

  it("thanks the guest with what the coupon saved", async () => {
    await display({ ...shared, state: "paid", total: 1750, vat: 114.49, amountPaid: 1750, receiptNumber: 318, paidAt: Date.now(), coupon: { code: "DCNT-SPA-500", saving: 500 } });
    expect(document.querySelector('[data-testid="display-coupon-saved"]')?.textContent).toBe("You saved ฿500 with DCNT-SPA-500");
    await display({ ...shared, state: "paid", total: 1750, vat: 114.49, amountPaid: 1750, receiptNumber: 318, paidAt: Date.now(), coupon: null });
    expect(document.querySelector('[data-testid="display-coupon-saved"]')).toBeNull();
  });
});
