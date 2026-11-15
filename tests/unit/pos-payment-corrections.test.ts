import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { ComponentProps as ReceiptProps } from "react";
import type { Id } from "convex/_generated/dataModel";
import { createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type CustomerId, type OrderId, type OrderView } from "@/components/checkout/backend";
import { createFixtureBackend } from "../support/checkout-backend";
import { PayPanel } from "@/components/checkout/PayPanel";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { OrderHistory, OrderHistoryList } from "@/components/checkout/OrderHistory";
import { receiptText } from "@/components/checkout/checkout-ui";
import { paymentDateInput, paymentDateValue } from "@/components/checkout/payment-time";
import { pickReceiptAction } from "./receipt-menu";

let root: Root;
let current: OrderView;
const customerId = "fxcust000002" as CustomerId;
const buttons = () => [...document.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string) => buttons().find(b => b.textContent?.trim() === text)!;
const click = (text: string) => act(async () => { expect(button(text), text).toBeTruthy(); button(text).click(); });
const tick = (ms = 200) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });
const input = (selector: string, value: string) => act(async () => {
  const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector)!;
  expect(el, selector).toBeTruthy();
  Object.getOwnPropertyDescriptor(el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
const provide = (backend: CheckoutBackend, child: ReturnType<typeof createElement>) => createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child);
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
function Probe({ backend, orderId, paying = false, onPaid = () => {} }: { backend: CheckoutBackend; orderId: OrderId; paying?: boolean; onPaid?: () => void }) {
  const view = backend.useOrder(orderId);
  if (!view) return null;
  current = view;
  return paying ? createElement(PayPanel, { view, mode: "card", onBack: () => {}, onPaid }) : null;
}
const show = (backend: CheckoutBackend, orderId: OrderId, paying = false, onPaid?: () => void) => act(async () => root.render(provide(backend, createElement(Probe, { backend, orderId, paying, onPaid }))));
const receipt = (backend: CheckoutBackend, orderId: OrderId) => act(async () => root.render(provide(backend, createElement(ReceiptWithConfirm, { orderId, onNewSale: () => {}, onOpenOrder: () => {} }))));
async function sale(link = false, backend?: Awaited<ReturnType<typeof createFixtureBackend>>) {
  backend ??= await createFixtureBackend();
  const actions = backend.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "extra", name: "Tea", price: 10000 } }));
  if (link) await run(actions.linkCustomer({ orderId, customerId }));
  await show(backend, orderId);
  return { backend, actions, orderId };
}
async function paidSale(link = false) {
  const result = await sale(link);
  await run(result.actions.settleOrder({ orderId: result.orderId, idempotencyKey: "paid-original-01", expectedDue: 10000, expectedRevision: current.order.revision, expectedCustomerRevision: link ? 0 : undefined, effectiveAt: Date.parse("2026-10-01T03:00:34.567Z"), tenders: [{ method: "card", amount: 10000 }] }));
  return result;
}
const correctPayment = () => pickReceiptAction("Correct payment");
/** Opens "More" in the correction panel: the received date, amount, tenders, customer and own reason. */
const openMore = () => act(async () => {
  const details = document.querySelector<HTMLDetailsElement>('[data-testid="correct-payment"] details')!;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
});
const expandHistory = async (title: string) => act(async () => {
  const summary = [...document.querySelectorAll("summary")].find(el => el.textContent === title)!;
  const details = summary.parentElement as HTMLDetailsElement;
  details.open = true;
  details.dispatchEvent(new Event("toggle"));
});
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); vi.useFakeTimers(); vi.setSystemTime(new Date("2026-11-01T09:12:34Z"));
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => { await act(async () => root.unmount()); document.body.innerHTML = ""; vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("uses actual received date in Bangkok and freezes every attempt input after a lost response, even after a customer edit", async () => {
  const { backend, actions, orderId } = await sale(true);
  const original = actions.settleOrder;
  const settle = vi.spyOn(actions, "settleOrder").mockImplementationOnce(async args => { await original(args); throw new Error("Response lost"); });
  const onPaid = vi.fn();
  await show(backend, orderId, true, onPaid);
  await click("Edit time");
  await input("#payment-effective", "2026-10-02");
  await input("#payment-effective-time", "14:15");
  await click("Confirm ฿100 card"); await tick();
  expect(document.body.textContent).toContain("Response lost");
  expect(document.querySelector<HTMLInputElement>("#payment-effective")?.disabled).toBe(false); // disabled by its fieldset
  expect(document.querySelector("#payment-effective")?.closest("fieldset")?.disabled).toBe(true);
  expect(settle.mock.calls[0][0]).toMatchObject({ expectedCustomerRevision: 0, effectiveAt: Date.parse("2026-10-02T07:15:00Z"), notifyGuest: false });
  await run(actions.updateCustomer({ customerId, expectedRevision: 0, name: "Unseen correction" }));
  await click("Retry payment"); await tick();
  expect(settle.mock.calls[1][0]).toEqual(settle.mock.calls[0][0]);
  await expect(settle.mock.results[1].value).resolves.toMatchObject({ replayed: true });
  expect(onPaid).toHaveBeenCalledOnce();
  expect(current.receiptCustomer?.name).toBe("Somchai Prasert");
  expect(current.payments).toHaveLength(1);
  expect(current.order.paidAt).toBeGreaterThan(current.paymentRecord.effectiveAt!);
});

it("invalidates an unseen customer edit while payment is open without substituting the latest revision", async () => {
  const { backend, actions, orderId } = await sale(true);
  const settle = vi.spyOn(actions, "settleOrder");
  await show(backend, orderId, true);
  await run(actions.updateCustomer({ customerId, expectedRevision: 0, name: "Changed profile" }));
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("changed while payment was open");
  expect(button("Review updated order")).toBeTruthy();
  expect(settle).not.toHaveBeenCalled();
  const stale = actions.settleOrder({ orderId, idempotencyKey: "stale-fixture-01", expectedDue: 10000, expectedRevision: current.order.revision, expectedCustomerRevision: 0, tenders: [{ method: "card", amount: 10000 }] });
  const check = expect(stale).rejects.toThrow("customer changed"); await tick(); await check;
  expect(current.order.status).toBe("draft");
});

it("amends a wrong tender through the real control while preserving the original printed/shared receipt", async () => {
  const { backend, actions, orderId } = await paidSale(true);
  const originalText = receiptText(current, "Retreat");
  const originalPayments = current.payments;
  const amendment = vi.spyOn(actions, "amendOrderPayment");
  await receipt(backend, orderId);
  const originalPaper = document.querySelector('[aria-label="Receipt"]')!.textContent;
  await correctPayment();
  // The method is a chip: the other three methods, beside what was recorded.
  const panel = document.querySelector<HTMLElement>('[data-testid="correct-payment"]')!;
  expect(panel.textContent).toContain("Method · was Card");
  // Reason is labelled, its chips and own text up front; "Wrong amount typed" joins once an amount changes.
  expect([...panel.querySelectorAll<HTMLButtonElement>('[role="group"] button')].map(b => b.textContent)).toEqual(["Cash", "PromptPay", "Transfer", "Wrong method picked"]);
  expect(panel.querySelector<HTMLInputElement>("#payment-correction-reason")?.closest("details")).toBeNull();
  // Nothing changed yet: the button is a plain, disabled Save.
  expect(button("Save")?.disabled).toBe(true);
  await click("Transfer");
  await click("Wrong method picked");
  await click("Save · Transfer ฿100"); await tick();
  expect(amendment).toHaveBeenCalledOnce();
  expect(amendment.mock.calls[0][0]).toMatchObject({ expectedCorrectionRevision: 0, reason: "Wrong method picked", tenders: [{ method: "transfer", amount: 100 }] });
  expect(document.querySelector('[aria-label="Receipt"]')!.textContent).toBe(originalPaper);
  expect(document.querySelector('[role="status"]')!.textContent).toBe("Payment corrected · Transfer ฿100");
  expect(document.body.textContent).toContain("Paid by card · corrected");
  await expandHistory("History");
  await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(b => b.textContent === "Payments")!.click());
  expect(document.querySelector('[aria-label="Payment record"]')!.textContent).toContain("Transfer · ฿100 · corrected");
  await show(backend, orderId);
  expect(current.payments).toEqual(originalPayments);
  expect(current.paymentRecord.effectiveAt).toBe(Date.parse("2026-10-01T03:00:34.567Z"));
  expect(receiptText(current, "Retreat")).toBe(originalText);
  expect(current.corrections[0]).toMatchObject({ tendersBefore: [{ method: "card", amount: 10000 }], tendersAfter: [{ method: "transfer", amount: 10000 }], actor: "preview@example.com" });
});

it("retains correction inputs and key on response loss, and preserves original customer when correcting the payer", async () => {
  const { backend, actions, orderId } = await paidSale(true);
  const original = actions.amendOrderPayment;
  const amendment = vi.spyOn(actions, "amendOrderPayment").mockImplementationOnce(async args => { await original(args); throw new Error("Correction response lost"); });
  await receipt(backend, orderId); await correctPayment(); await openMore();
  await input("#corrected-payer", "Anna");
  await act(async () => buttons().find(b => b.textContent?.includes("Anna Schmidt · +49"))!.click());
  await input("#correction-effective", "2026-10-03T08:45");
  await input("#payment-correction-reason", "Correct payer and actual received date");
  await click("Save · Card ฿100"); await tick();
  await run(actions.updateCustomer({ customerId: "fxcust000001" as CustomerId, expectedRevision: 0, name: "Edited after recording" }));
  await click("Retry correction"); await tick();
  expect(amendment.mock.calls[1][0]).toEqual(amendment.mock.calls[0][0]);
  await expect(amendment.mock.results[1].value).resolves.toMatchObject({ replayed: true });
  await show(backend, orderId);
  expect(current.receiptCustomer?.name).toBe("Somchai Prasert");
  expect(current.paymentRecord.customer?.name).toBe("Anna Schmidt");
  expect(current.paymentRecord.effectiveAt).toBe(Date.parse("2026-10-03T01:45:00Z"));
  expect(current.corrections).toHaveLength(1);
});

it("says Saving… while the first correction save runs, and offers Retry only after it fails", async () => {
  const { backend, actions, orderId } = await paidSale(true);
  let fail!: (err: Error) => void;
  vi.spyOn(actions, "amendOrderPayment").mockImplementationOnce(() => new Promise((_, reject) => { fail = reject; }));
  await receipt(backend, orderId); await correctPayment();
  await click("Transfer");
  await click("Wrong method picked");
  await click("Save · Transfer ฿100");
  expect(button("Saving…")).toBeTruthy();
  expect(button("Saving…").disabled).toBe(true);
  expect(button("Retry correction")).toBeUndefined();
  await act(async () => fail(new Error("Network down")));
  expect(button("Saving…")).toBeUndefined();
  expect(button("Retry correction")).toBeTruthy();
});

it("asks whether money was received with no default, and voids a mistaken entry once, retrying with the same key", async () => {
  const { backend, actions, orderId } = await paidSale();
  // The first answer never arrives (the order stays paid, so the panel stays open on its error).
  const voidEntry = vi.spyOn(actions, "voidUnreceivedOrder").mockRejectedValueOnce(new Error("Connection lost"));
  const voidSale = vi.spyOn(actions, "voidOrder");
  await receipt(backend, orderId); await pickReceiptAction("Void…");
  const yes = document.querySelector<HTMLButtonElement>('[data-void-choice="received"]')!;
  const no = () => document.querySelector<HTMLButtonElement>('[data-void-choice="unreceived"]')!;
  expect(document.body.textContent).toContain("Money received?");
  expect(yes.textContent).toBe("YesNo refund sent");
  expect(no().textContent).toBe("NoEntered by mistake");
  // No default: neither runs without a reason.
  expect(yes.disabled).toBe(true); expect(no().disabled).toBe(true);
  await click("Duplicate sale");
  expect(no().disabled).toBe(false);
  await act(async () => no().click()); await tick();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Connection lost");
  // The attempt is frozen: the reason can't change and Yes can't run on top of it.
  expect(document.querySelector<HTMLInputElement>("#void-reason")!.disabled).toBe(true);
  expect(document.querySelector<HTMLButtonElement>('[data-void-choice="received"]')!.disabled).toBe(true);
  await act(async () => no().click()); await tick();
  expect(voidEntry).toHaveBeenCalledTimes(2);
  expect(voidEntry.mock.calls[1][0]).toEqual(voidEntry.mock.calls[0][0]);
  expect(voidEntry.mock.calls[0][0]).toMatchObject({ expectedCorrectionRevision: 0, reason: "Duplicate sale" });
  expect(voidSale).not.toHaveBeenCalled();
  expect(document.querySelector('[data-testid="receipt-void-status"]')!.textContent).toContain("Entered by mistake · no money was received, no refund sent");
  await show(backend, orderId);
  expect(current.order.status).toBe("void"); expect(current.payments).toHaveLength(1); expect(current.paymentRecord.voidUnreceived).toBe(true);
});

it("Void… · Yes voids the sale through pos.voidOrder, which takes no attempt key", async () => {
  const { backend, actions, orderId } = await paidSale();
  const voidSale = vi.spyOn(actions, "voidOrder");
  const voidEntry = vi.spyOn(actions, "voidUnreceivedOrder");
  await receipt(backend, orderId); await pickReceiptAction("Void…");
  await click("Wrong guest");
  await act(async () => document.querySelector<HTMLButtonElement>('[data-void-choice="received"]')!.click()); await tick();
  expect(voidSale).toHaveBeenCalledExactlyOnceWith({ orderId, reason: "Wrong guest" });
  expect(voidEntry).not.toHaveBeenCalled();
  await show(backend, orderId);
  expect(current.order.status).toBe("void"); expect(current.paymentRecord.voidUnreceived).toBeFalsy();
});

it("shows imported booking refunds with amount, actor and effective/recorded dates without presenting a send action", async () => {
  const orderId = "fxbill000002" as OrderId;
  const backend = await createFixtureBackend({ recordedRefunds: [{ sourceType: "booking", orderId: orderId, _id: "refund-1" as Id<"bookingRefunds">, bookingId: "fxbkg000001" as Id<"bookings">, amount: 5000, currency: "THB", method: "transfer", reason: "Returned overpayment", effectiveAt: Date.parse("2026-10-30T00:00:00Z"), recordedAt: Date.now(), recordedBy: "cashier@example.com" }] });
  await run(backend.useActions().settleOrder({ orderId, idempotencyKey: "refund-view-01", expectedDue: 78000, expectedRevision: 2, expectedCustomerRevision: 0, tenders: [{ method: "card", amount: 78000 }] }));
  await receipt(backend, orderId);
  const text = document.querySelector('[aria-label="Recorded refunds"]')!.textContent;
  expect(text).toContain("Recorded · ฿50 · transfer"); expect(text).toContain("cashier@example.com"); expect(text).toContain("Effective"); expect(text).toContain("Recorded");
  expect(document.querySelector('[aria-label="Recorded refunds"]')!.querySelector("button")).toBeNull();
});

it("shows paginated readable item history, cleared contents, actor and dates from actual fixture edits", async () => {
  const { backend, actions, orderId } = await sale();
  for (let i = 0; i < 25; i++) await run(actions.addItem({ orderId, item: { kind: "extra", name: `Item ${i}`, price: 1000 } }));
  await run(actions.clearOrder({ orderId }));
  await act(async () => root.render(provide(backend, createElement(OrderHistory, { orderId }))));
  await expandHistory("History");
  expect(document.querySelector('[aria-label="Order history"]')!.textContent).toContain("Before · removed contents");
  expect(document.body.textContent).toContain("Item 24"); expect(document.body.textContent).toContain("preview@example.com");
  expect(document.body.textContent).toContain("Effective"); expect(document.body.textContent).toContain("Recorded"); expect(document.body.textContent).not.toContain('"unitPrice"');
  expect(button("Load older order changes")).toBeTruthy();
  await click("Load older order changes");
  expect(button("Load older order changes")).toBeUndefined();
  expect(document.body.textContent).toContain("Item: Tea");
  const loaded = document.querySelector('[aria-label="Order history"]')!.textContent;
  await act(async () => { const details = document.querySelector('details')!; details.open = false; details.dispatchEvent(new Event('toggle')); });
  await expandHistory("History");
  expect(document.querySelector('[aria-label="Order history"]')!.textContent).toBe(loaded);
  expect(button("Load older order changes")).toBeUndefined();
});

it("recovers order history errors and displays loading, empty and continuation states", async () => {
  const { backend, orderId } = await sale();
  let fail = true;
  const loadMore = vi.fn();
  const broken: CheckoutBackend = { ...backend, useOrderHistory: () => { if (fail) throw new Error("History offline"); return { results: [], status: "LoadingFirstPage", loadMore }; } };
  vi.spyOn(console, "error").mockImplementation(() => {});
  await act(async () => root.render(provide(broken, createElement(OrderHistoryList, { orderId }))));
  expect(document.body.textContent).toContain("Couldn't load order history");
  fail = false; await click("Try again");
  expect(document.querySelector('[aria-label="Loading order history"]')).toBeTruthy();
  for (const status of ["Exhausted", "CanLoadMore", "LoadingMore"] as const) {
    const paged = { ...backend, useOrderHistory: () => ({ results: [], status, loadMore }) };
    await act(async () => root.render(provide(paged, createElement(OrderHistoryList, { orderId }))));
    if (status === "Exhausted") expect(document.body.textContent).toContain("No recorded item changes");
    if (status === "CanLoadMore") { await click("Load older order changes"); expect(loadMore).toHaveBeenCalledWith(20); }
    if (status === "LoadingMore") expect(button("Loading older changes…").disabled).toBe(true);
  }
});

it("parses received dates independently of the device timezone and rejects invalid dates", () => {
  const at = Date.parse("2026-10-01T03:45:00Z");
  expect(paymentDateInput(at)).toBe("2026-10-01T10:45"); expect(paymentDateValue("2026-10-01T10:45")).toBe(at);
  expect(paymentDateValue("2026-10-01T30:90")).toBeNull(); expect(paymentDateValue("")).toBeNull();
});

it("locks correction controls during a pending write and prevents duplicate submissions", async () => {
  const { backend, actions, orderId } = await paidSale();
  let done!: (value: { sequence: number; replayed: boolean }) => void;
  const amendment = vi.spyOn(actions, "amendOrderPayment").mockReturnValueOnce(new Promise(resolve => { done = resolve; }));
  await receipt(backend, orderId); await correctPayment();
  await click("Cash");
  await click("Wrong method picked");
  await click("Save · Cash ฿100");
  // The toolbar's Close waits for the write.
  expect(document.querySelector<HTMLButtonElement>('[aria-label="Close Correct payment"]')!.disabled).toBe(true);
  expect(document.querySelector("#payment-correction-reason")?.closest("fieldset")?.disabled).toBe(true);
  await act(async () => document.querySelector('[data-testid="correct-payment"]')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));
  expect(amendment).toHaveBeenCalledOnce();
  await act(async () => done({ sequence: 1, replayed: false }));
  expect(document.querySelector('[data-testid="correct-payment"]')).toBeNull();
  expect(document.querySelector('[aria-label="More receipt actions"]')).toBeTruthy();
});

it("reopens only the fixture order’s proven linked payment on a mistaken entry and preserves the online deposit", async () => {
  const backend = await createFixtureBackend(); const actions = backend.useActions();
  const { orderId } = await run(actions.openOrderFor({ bookingId: "fxbkg000001" as NonNullable<Parameters<typeof actions.openOrderFor>[0]["bookingId"]> }));
  await show(backend, orderId);
  expect(current.totals.due).toBe(2600000);
  await run(actions.settleOrder({ orderId, idempotencyKey: "stay-paid-fixture", expectedDue: 2600000, expectedRevision: current.order.revision, tenders: [{ method: "card", amount: 2600000 }] }));
  await run(actions.voidUnreceivedOrder({ orderId, idempotencyKey: "stay-void-fixture", expectedCorrectionRevision: 0, reason: "Mistaken entry; no money received" }));
  const replacement = await run(actions.openOrderFor({ bookingId: "fxbkg000001" as NonNullable<Parameters<typeof actions.openOrderFor>[0]["bookingId"]> }));
  await show(backend, replacement.orderId);
  expect(current.totals).toMatchObject({ deposit: 1000000, due: 2600000, total: 3600000 });
});

function ReceiptWithConfirm(props: ReceiptProps<typeof ReceiptView>) { return createElement(ConfirmProvider, null, createElement(ReceiptView, props)); }
