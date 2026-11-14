// @vitest-environment happy-dom
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { ComponentProps as ReceiptProps } from "react";
import type { Id } from "convex/_generated/dataModel";
import { act, createElement, useEffect, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { historyTime } from "@/components/checkout/OrderHistory";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { DEFAULT_CASHIER_RULES } from "convex/lib/staffTypes";
import { pickReceiptAction, receiptActions } from "./receipt-menu";

/*
 * P4: the receipt screen's hierarchy. Print · Share · New sale and ⋯ (paper, Correct payment, Void…)
 * sit above the receipt; one closed History, with Items · Payments · Refunds, holds every ledger
 * and the current payment record, and loads only when opened.
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
  act(async () => root.render(provide(backend, createElement(ReceiptWithConfirm, { orderId, onNewSale, onOpenOrder: () => {} }))));
const record = () => document.querySelector<HTMLElement>('[aria-label="Payment record"]')!;
const paper = () => document.querySelector<HTMLElement>(".pos-receipt")!;
/** A fact in the visible record, by its label. */
const fact = (label: string) => [...record().querySelectorAll("dt")].find(dt => dt.textContent === label)?.nextElementSibling?.textContent;
const tab = (name: string) => act(async () => { [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === name)!.click(); });
const openMore = () => act(async () => {
  const details = document.querySelector<HTMLDetailsElement>('[data-testid="correct-payment"] details')!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
});
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

it("server-renders receipt paper hidden on phones until the viewport is known", async () => {
  const { backend, orderId } = await paidSale();
  const html = renderToString(provide(backend, createElement(ReceiptWithConfirm, { orderId, onNewSale: () => {}, onOpenOrder: () => {} })));
  const container = document.createElement("div");
  container.innerHTML = html;
  const preview = container.querySelector<HTMLDetailsElement>("details.receipt-preview")!;
  // Wide screens keep the paper open; phone CSS hides it before hydration can close details.
  expect(preview.open).toBe(true);
  expect(preview.classList.contains("max-sm:[&>div:not(:has([data-print-measure]))]:hidden")).toBe(true);
  expect(preview.querySelector(".pos-receipt")?.textContent).toContain("Tea");
});

it("puts Print · New sale and ⋯ above the receipt, outside what prints", async () => {
  const { backend, actions, orderId } = await paidSale();
  const onNewSale = vi.fn();
  await receipt(backend, orderId, onNewSale);
  const toolbar = document.querySelector<HTMLElement>('[role="toolbar"][aria-label="Receipt actions"]')!;
  expect([...toolbar.querySelectorAll("button")].map(b => b.textContent?.trim() || b.getAttribute("aria-label"))).toEqual(["Print", "New sale", "More receipt actions"]);
  for (const control of toolbar.querySelectorAll("button")) {
    // Before the receipt in reading and tab order, so it is reached without scrolling past it.
    expect(paper().compareDocumentPosition(control) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy();
    expect(control.closest(".pos-receipt")).toBeNull();
    expect(control.closest(".print\\:hidden"), "hidden when printing").toBeTruthy();
  }
  for (const gone of ["Checkout", "Copy", "58 mm", "80 mm", "Void…", "Correct payment recording", "No money was received…"]) expect(button(gone), gone).toBeUndefined();
  expect((await receiptActions()).map(i => i.label)).toEqual(["Share", "Use 58 mm paper", "Correct payment", "Void…"]);
  await click("New sale");
  expect(onNewSale).toHaveBeenCalledOnce();

  await run(actions.voidOrder({ orderId, reason: "Charged the wrong guest" }));
  await receipt(backend, orderId, onNewSale);
  expect((await receiptActions()).map(i => i.label)).toEqual(["Share", "Use 58 mm paper"]);
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
  expect(voided.textContent).toContain("order and receipt numbers stay on record");
  expect(voided.textContent).not.toContain("Entered by mistake");
  expect(voided.closest("details")).toBeNull();
  expect(paper().textContent).toContain("Void · Charged the wrong guest");

  const refunds = document.querySelector<HTMLElement>('[aria-label="Recorded refunds"]')!;
  expect(refunds.closest("details")).toBeNull();
  expect(refunds.textContent).toContain("Recorded · ฿50 · transfer");
  expect(refunds.textContent).toContain("Returned overpayment");
});

it("states a mistaken-entry void visibly, without calling the entry money received", async () => {
  const { backend, actions, orderId } = await paidSale();
  await run(actions.voidUnreceivedOrder({ orderId, idempotencyKey: "record-unreceived-01", expectedCorrectionRevision: 0, reason: "Bank transfer never arrived" }));
  await receipt(backend, orderId);
  const voided = document.querySelector<HTMLElement>('[data-testid="receipt-void-status"]')!;
  expect(voided.textContent).toContain("Entered by mistake · no money was received, no refund sent");
  expect(voided.closest("details")).toBeNull();
  await toggle("History"); await tab("Payments");
  expect(fact("Money received")).toBeUndefined();
  expect(fact("Entered as received")).toContain("Bangkok");
  expect(fact("Corrections")).toBe("1");
  expect((await receiptActions()).map(i => i.label)).not.toContain("Correct payment");
});

it("has one closed History, and each tab's ledgers load only when first shown", async () => {
  const { backend: base, orderId } = await paidSale();
  const hooks = ["useOrderHistory", "useCorrectionHistory", "useAuditHistory", "useBookingRefundHistory", "useAppointmentRefundHistory", "useBillRefundHistory"] as const;
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
  // One closed History plus the phone receipt preview; no repeated ledgers.
  expect([...document.querySelectorAll("summary")].map(s => s.textContent)).toEqual(["Receipt preview", "History"]);
  expect(document.querySelector('[aria-label="Payment record"]')).toBeNull();

  await toggle("History");
  expect([...document.querySelectorAll('[role="tab"]')].map(t => t.textContent)).toEqual(["Items", "Payments", "Refunds"]);
  expect(mounted.mock.calls.map(c => c[0]).sort()).toEqual(["useAuditHistory", "useOrderHistory"]);
  await tab("Payments");
  expect(mounted).toHaveBeenLastCalledWith("useCorrectionHistory");
  await tab("Refunds");
  expect(mounted).toHaveBeenLastCalledWith("useBillRefundHistory");
  // A plain sale paid for no stay or appointment: their ledgers don't load.
  expect(mounted).toHaveBeenCalledTimes(4);
  // Visited tabs stay mounted.
  await tab("Items"); await tab("Payments");
  expect(mounted).toHaveBeenCalledTimes(4);
});

it("updates the current record, its count and the open history together; the issued receipt stays the same", async () => {
  const { backend, actions, orderId } = await paidSale();
  const amend = vi.spyOn(actions, "amendOrderPayment");
  await receipt(backend, orderId);
  const issued = paper().textContent;
  await toggle("History"); await tab("Payments");
  expect(fact("Money received")).toBe(`${historyTime(Date.parse("2026-10-01T03:00:00Z"))} · Bangkok`);
  expect(fact("Payments")).toBe("As on the receipt");
  expect(fact("Corrections")).toBe("None");
  const ledger = () => document.querySelector<HTMLElement>('[aria-label="Payment corrections"]')!;
  expect(ledger().textContent).toContain("No entries recorded");

  // Close without saving changes nothing.
  await pickReceiptAction("Correct payment"); await openMore();
  await input("#correction-effective", "2026-10-03T08:45");
  await input("#payment-correction-reason", "Abandoned edit");
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Close Correct payment"]')!.click());
  expect(amend).not.toHaveBeenCalled();
  expect(fact("Corrections")).toBe("None");

  await pickReceiptAction("Correct payment"); await openMore();
  await input("#correction-effective", "2026-10-03T08:45");
  await input("#payment-correction-reason", "Guest paid on the 3rd");
  await click("Save · Card ฿100"); await tick();
  const corrected = historyTime(Date.parse("2026-10-03T01:45:00Z"));
  expect(fact("Money received")).toBe(`${corrected} · Bangkok`);
  expect(fact("Corrections")).toBe("1");
  expect(ledger().textContent).toContain(`Received date: ${historyTime(Date.parse("2026-10-01T03:00:00Z"))} → ${corrected}`);
  expect(paper().textContent).toBe(issued);

  // A second correction to the method: the record lists the corrected payment and the open ledger gains #2.
  await pickReceiptAction("Correct payment");
  await click("Transfer");
  await click("Wrong method picked");
  await click("Save · Transfer ฿100"); await tick();
  expect(amend.mock.calls[1][0]).toMatchObject({ expectedCorrectionRevision: 1, tenders: [{ method: "transfer", amount: 100 }] });
  expect(fact("Payments")).toBe("Transfer · ฿100 · corrected");
  expect(fact("Corrections")).toBe("2");
  expect(ledger().querySelectorAll("li")).toHaveLength(2);
  expect(ledger().textContent).toContain("Payment recording corrected · #2");
  expect(paper().textContent).toBe(issued);
  expect(paper().textContent).toContain("Card");
});

it("keeps line refunds separate from the payment correction count and history, and turns Void… off", async () => {
  const { backend, actions, orderId } = await paidSale();
  await run(actions.refundLine({
    orderId, lineId: current.lines[0]._id, amount: 2500, currency: "THB", method: "card",
    reason: "Returned part of the sale", idempotencyKey: "record-line-refund-01",
  }));
  await receipt(backend, orderId);
  expect(await receiptActions()).toContainEqual({ label: "Void… · not after a refund", disabled: true });
  await toggle("History"); await tab("Payments");
  expect(fact("Corrections")).toBe("None");
  expect(document.querySelector('[aria-label="Payment corrections"]')!.textContent).toContain("No entries recorded");
  await tab("Refunds");
  expect(document.querySelector('[aria-label="Line refunds"]')!.textContent).toContain("Returned part of the sale");
});

it("records a one-line refund with no typing, and a retry after a lost answer reuses the form's key", async () => {
  const { backend, actions, orderId } = await paidSale();
  const refund = vi.spyOn(actions, "refundLine").mockRejectedValueOnce(new Error("Connection lost"));
  await receipt(backend, orderId);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Refund Tea"]')!.click());
  expect(button("All")?.getAttribute("aria-pressed")).toBe("true");
  expect(button("Pick a reason")?.disabled).toBe(true);
  await click("Wrong charge");
  await click("Record refund ฿100"); await tick();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
  const form = document.querySelector('[data-refund-form]')!;
  expect(form.querySelector<HTMLInputElement>('input[id$="-amount"]')?.disabled).toBe(true);
  expect(form.querySelector<HTMLInputElement>('input[id$="-reason"]')?.disabled).toBe(true);
  for (const method of form.querySelectorAll<HTMLButtonElement>('[aria-labelledby$="-method"] button')) expect(method.disabled).toBe(true);
  await click("Retry same refund"); await tick();
  expect(refund).toHaveBeenCalledTimes(2);
  expect(refund.mock.calls[1][0]).toEqual(refund.mock.calls[0][0]);
  expect(refund.mock.calls[0][0]).toMatchObject({ amount: 10_000, method: "card", reason: "Wrong charge" });
  expect(document.querySelector("[data-line-note]")?.textContent?.trim()).toBe("Refunded ฿100 · Wrong charge");
});

it("Half refunds half of what is left; a new form is a new key", async () => {
  const { backend, actions, orderId } = await paidSale();
  const refund = vi.spyOn(actions, "refundLine");
  await receipt(backend, orderId);
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Refund Tea"]')!.click());
  await click("Half");
  await click("Guest complaint");
  await click("Record refund ฿50"); await tick();
  await act(async () => document.querySelector<HTMLButtonElement>('[aria-label="Refund Tea"]')!.click());
  expect(button("All")?.getAttribute("aria-pressed")).toBe("true");
  await click("Short treatment");
  await click("Record refund ฿50"); await tick();
  expect(refund.mock.calls.map(c => c[0].amount)).toEqual([5_000, 5_000]);
  expect(refund.mock.calls[1][0].idempotencyKey).not.toBe(refund.mock.calls[0][0].idempotencyKey);
});

it("shows cashiers no History; Correct payment and Void… stay, as requests", async () => {
  const { backend, orderId } = await paidSale();
  const cashier: StaffAccessView = {
    email: "mint@example.com", role: "cashier", pendingInvitation: null, marketingRole: null, cashierRules: DEFAULT_CASHIER_RULES,
    capabilities: { checkout: true, approve: false, operations: false, manageTeam: false, settings: false, bookings: false, services: false, customers: false, orders: false, chats: false, properties: false, roster: false, reports: false, marketing: false },
  };
  await act(async () => root.render(createElement(StaffAccessProvider, { access: cashier }, provide(backend, createElement(ReceiptWithConfirm, { orderId, onNewSale: () => {}, onOpenOrder: () => {} })))));
  expect(document.querySelector('[data-testid="receipt-history"]')).toBeNull();
  expect([...document.querySelectorAll("summary")].map(s => s.textContent)).toEqual(["Receipt preview"]);
  // Happy DOM's default viewport is wide: the paper must be natively open there.
  expect(document.querySelector<HTMLDetailsElement>("details.receipt-preview")?.open).toBe(true);
  expect(button("Link appointment")).toBeUndefined();
  expect((await receiptActions()).map(i => i.label)).toEqual(["Share", "Use 58 mm paper", "Correct payment", "Void…"]);
});

function ReceiptWithConfirm(props: ReceiptProps<typeof ReceiptView>) { return createElement(ConfirmProvider, null, createElement(ReceiptView, props)); }
