// @vitest-environment happy-dom
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { historyTime } from "@/components/checkout/OrderHistory";

/*
 * K1: the receipt screen's hierarchy. New sale and Void… sit above the receipt; one Payment record
 * and corrections area states the current record; one lazily loaded history holds every ledger.
 */

let root: Root;
let current: OrderView;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find(b => b.textContent?.trim() === text);
const click = (text: string) => act(async () => { expect(button(text), text).toBeTruthy(); button(text)!.click(); });
const tick = (ms = 200) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
const input = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(el, selector).toBeTruthy();
  Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const provide = (backend: CheckoutBackend, child: ReturnType<typeof createElement>) =>
  createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child);
function Probe({ backend, orderId }: { backend: CheckoutBackend; orderId: OrderId }) {
  const view = backend.useOrder(orderId);
  if (view) current = view;
  return null;
}
const probe = (backend: CheckoutBackend, orderId: OrderId) => act(async () => root.render(provide(backend, createElement(Probe, { backend, orderId }))));
const receipt = (backend: CheckoutBackend, orderId: OrderId, onNewSale = () => {}) =>
  act(async () => root.render(provide(backend, createElement(ReceiptView, { orderId, onNewSale, onOpenOrder: () => {} }))));
const record = () => document.querySelector<HTMLElement>('[aria-label="Payment record and corrections"]')!;
const paper = () => document.querySelector<HTMLElement>(".pos-receipt")!;
/** A fact in the visible record, by its label. */
const fact = (label: string) => [...record().querySelectorAll("dt")].find(dt => dt.textContent === label)?.nextElementSibling?.textContent;
const toggle = (title: string, open = true) => act(async () => {
  const details = [...document.querySelectorAll("details")].find(d => d.querySelector("summary")?.textContent === title)!;
  expect(details, title).toBeTruthy();
  details.open = open;
  details.dispatchEvent(new Event("toggle"));
});

async function paidSale(backend = createFixtureBackend()) {
  const actions = backend.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "extra", name: "Tea", price: 100 } }));
  await probe(backend, orderId);
  await run(actions.settleOrder({ orderId, idempotencyKey: "record-paid-0001", expectedDue: 100, expectedRevision: current.order.revision, effectiveAt: Date.parse("2026-10-01T03:00:00Z"), tenders: [{ method: "card", amount: 100 }] }));
  return { backend, actions, orderId };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T09:12:34Z"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("puts New sale and Void… above the receipt, outside what prints", async () => {
  const { backend, actions, orderId } = await paidSale();
  const onNewSale = vi.fn();
  await receipt(backend, orderId, onNewSale);
  for (const label of ["New sale", "Void…"]) {
    const control = button(label)!;
    expect(control, label).toBeTruthy();
    // Before the receipt in reading and tab order, so it is reached without scrolling past the record.
    expect(paper().compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING, `${label} precedes the receipt`).toBeTruthy();
    expect(control.closest(".pos-receipt")).toBeNull();
    expect(control.closest(".print\\:hidden"), `${label} is hidden when printing`).toBeTruthy();
  }
  await click("New sale");
  expect(onNewSale).toHaveBeenCalledOnce();

  await run(actions.voidOrder({ orderId, reason: "Charged the wrong guest" }));
  await receipt(backend, orderId, onNewSale);
  expect(button("Void…")).toBeUndefined();
  expect(button("New sale")).toBeTruthy();
});

it("keeps void and refund meaning visible outside any collapsed disclosure", async () => {
  const orderId = "fxbill000002" as OrderId;
  const backend = createFixtureBackend({ recordedRefunds: [{ sourceType: "booking", billId: orderId, _id: "refund-1" as Id<"bookingRefunds">, bookingId: "fxbkg000001" as Id<"bookings">, amount: 50, currency: "THB", method: "transfer", reason: "Returned overpayment", effectiveAt: Date.parse("2026-10-30T00:00:00Z"), recordedAt: Date.now(), recordedBy: "cashier@example.com" }] });
  const actions = backend.useActions();
  await run(actions.settleOrder({ orderId, idempotencyKey: "record-refund-01", expectedDue: 780, expectedRevision: 2, expectedCustomerRevision: 0, tenders: [{ method: "card", amount: 780 }] }));
  await run(actions.voidOrder({ orderId, reason: "Charged the wrong guest" }));
  await receipt(backend, orderId);

  const voided = document.querySelector<HTMLElement>('[data-testid="receipt-void-status"]')!;
  expect(voided.textContent).toContain("Voided by preview@example.com on");
  expect(voided.textContent).toContain("The order and receipt numbers stay on record.");
  expect(voided.textContent).not.toContain("No refund was sent");
  expect(voided.closest("details")).toBeNull();
  expect(paper().textContent).toContain("Void · Charged the wrong guest");

  const refunds = document.querySelector<HTMLElement>('[aria-label="Recorded refunds"]')!;
  expect(refunds.closest("details")).toBeNull();
  expect(refunds.textContent).toContain("Recorded · ฿50 · transfer");
  expect(refunds.textContent).toContain("Returned overpayment");
  expect(refunds.textContent).toContain("does not send refunds");
});

it("states a mistaken-entry void visibly, without calling the entry money received", async () => {
  const { backend, actions, orderId } = await paidSale();
  await run(actions.voidUnreceivedOrder({ orderId, idempotencyKey: "record-unreceived-01", expectedCorrectionRevision: 0, reason: "Bank transfer never arrived" }));
  await receipt(backend, orderId);
  const voided = document.querySelector<HTMLElement>('[data-testid="receipt-void-status"]')!;
  expect(voided.textContent).toContain("Voided as a mistaken entry: no money was received. No refund was sent.");
  expect(voided.closest("details")).toBeNull();
  expect(fact("Money received")).toBeUndefined();
  expect(fact("Entered as received")).toContain("Bangkok");
  expect(fact("Corrections")).toBe("1");
  expect(button("Correct payment recording")).toBeUndefined();
});

it("has one history, loaded only when opened, and no inline copies of its ledgers", async () => {
  const { backend: base, orderId } = await paidSale();
  const hooks = ["useOrderHistory", "useCorrectionHistory", "useAuditHistory", "useBookingRefundHistory", "useAppointmentRefundHistory"] as const;
  const mounted = vi.fn();
  const backend: CheckoutBackend = { ...base };
  for (const hook of hooks) {
    const real = base[hook] as (id: OrderId) => unknown;
    (backend as Record<string, unknown>)[hook] = (id: OrderId) => {
      // eslint-disable-next-line react-hooks/rules-of-hooks -- a hook wrapper, called as a hook
      useEffect(() => { mounted(hook); }, []);
      return real(id);
    };
  }
  await receipt(backend, orderId);
  expect(mounted).not.toHaveBeenCalled();
  // Printing tips, the one financial history, and item history: nothing else is collapsed or repeated.
  expect([...document.querySelectorAll("summary")].map(s => s.textContent)).toEqual(["Printing tips", "Browse all financial history", "Order history"]);
  expect(document.body.textContent).not.toContain("Receipt activity");
  expect(document.querySelector('[aria-label="Payment amendments"]')).toBeNull();

  await toggle("Browse all financial history");
  expect(mounted.mock.calls.map(c => c[0]).sort()).toEqual(hooks.slice(1).toSorted());
  await toggle("Order history");
  expect(mounted).toHaveBeenCalledWith("useOrderHistory");
  expect(mounted).toHaveBeenCalledTimes(5);
});

it("updates the current record, its count and the open history together; the issued receipt stays the same", async () => {
  const { backend, actions, orderId } = await paidSale();
  const amend = vi.spyOn(actions, "amendOrderPayment");
  await receipt(backend, orderId);
  const issued = paper().textContent;
  expect(fact("Money received")).toBe(`${historyTime(Date.parse("2026-10-01T03:00:00Z"))} · Bangkok`);
  expect(fact("Payments")).toBe("As on the receipt");
  expect(fact("Corrections")).toBe("None");
  await toggle("Browse all financial history");
  const ledger = () => document.querySelector<HTMLElement>('[aria-label="Payment corrections"]')!;
  expect(ledger().textContent).toContain("No entries recorded");

  // Close without saving changes nothing.
  await click("Correct payment recording");
  await input("#correction-effective", "2026-10-03T08:45");
  await input("#payment-correction-reason", "Abandoned edit");
  await click("Close correction");
  expect(amend).not.toHaveBeenCalled();
  expect(fact("Corrections")).toBe("None");

  await click("Correct payment recording");
  await input("#correction-effective", "2026-10-03T08:45");
  await input("#payment-correction-reason", "Guest paid on the 3rd");
  await click("Save recording correction"); await tick();
  const corrected = historyTime(Date.parse("2026-10-03T01:45:00Z"));
  expect(fact("Money received")).toBe(`${corrected} · Bangkok`);
  expect(fact("Corrections")).toBe("1");
  expect(document.querySelector('[data-testid="latest-correction"]')!.textContent).toContain("#1 · Guest paid on the 3rd");
  expect(ledger().textContent).toContain(`Received date: ${historyTime(Date.parse("2026-10-01T03:00:00Z"))} → ${corrected}`);
  expect(paper().textContent).toBe(issued);

  // A second correction to the method: the record lists the corrected payment and the open ledger gains #2.
  await click("Correct payment recording");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Corrected payment 1 method"]')!.click());
  await act(async () => [...document.querySelectorAll<HTMLElement>('[role="option"]')].find(el => el.textContent?.includes("Bank transfer"))!.click());
  await input("#payment-correction-reason", "It was a transfer");
  await click("Save recording correction"); await tick();
  expect(amend.mock.calls[1][0]).toMatchObject({ expectedCorrectionRevision: 1, tenders: [{ method: "transfer", amount: 100 }] });
  expect(fact("Payments")).toBe("Bank transfer · ฿100 · corrected");
  expect(fact("Corrections")).toBe("2");
  expect(ledger().querySelectorAll("li")).toHaveLength(2);
  expect(ledger().textContent).toContain("Payment recording corrected · #2");
  expect(paper().textContent).toBe(issued);
  expect(paper().textContent).toContain("Card");
});

it("keeps line refunds separate from the payment correction count and history", async () => {
  const { backend, actions, orderId } = await paidSale();
  await run(actions.refundLine({
    orderId, lineId: current.lines[0]._id, amount: 2500, currency: "THB", method: "card",
    reason: "Returned part of the sale", idempotencyKey: "record-line-refund-01",
  }));
  await receipt(backend, orderId);
  expect(fact("Corrections")).toBe("None");
  expect(button("No money was received…")).toBeUndefined();
  expect(button("Void…")?.disabled).toBe(true);
  await toggle("Browse all financial history");
  expect(document.querySelector('[aria-label="Payment corrections"]')!.textContent).toContain("No entries recorded");
  expect(document.querySelector('[aria-label="All line refunds"]')!.textContent).toContain("Returned part of the sale");
});
