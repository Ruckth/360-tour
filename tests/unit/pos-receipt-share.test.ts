import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import type { ComponentProps as ReceiptProps } from "react";
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { receiptText } from "@/components/checkout/checkout-ui";
import { createFixtureBackend } from "../support/checkout-backend";
import { RECEIPT_PAPER_KEY, ReceiptView } from "@/components/checkout/ReceiptView";
import type { Id } from "convex/_generated/dataModel";
import { pickReceiptAction } from "./receipt-menu";

/** P4: Share shares where the device can and copies everywhere else; paper width lives in ⋯. K5: one "Paid in advance" term. */

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

let root: Root;
let view: OrderView | null | undefined;
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
function Probe({ backend, orderId }: { backend: CheckoutBackend; orderId: OrderId }) { view = backend.useOrder(orderId); return null; }
const show = (backend: CheckoutBackend, child: ReactElement) => act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child)));
const button = (name: string) => [...document.querySelectorAll("button")].find((el) => el.textContent?.trim() === name || el.getAttribute("aria-label") === name) as HTMLButtonElement | undefined;
const status = () => document.querySelector('[role="status"]')?.textContent ?? "";

/** A paid receipt for a massage, shown in ReceiptView. */
async function paidReceipt() {
  const backend = await createFixtureBackend();
  const actions = backend.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "extra", name: "Massage", price: 120000 } }));
  await show(backend, createElement(Probe, { backend, orderId }));
  await run(actions.settleOrder({ orderId, expectedRevision: view!.order.revision, expectedDue: 120000, idempotencyKey: "share-receipt-0001", tenders: [{ method: "cash", amount: 120000 }] }));
  await show(backend, createElement(ReceiptWithConfirm, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
}

const writeText = vi.fn<(text: string) => Promise<void>>();

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  Reflect.deleteProperty(navigator, "share");
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("receipt share and print", () => {
  it("always offers Share; without a share sheet it copies the receipt text", async () => {
    Reflect.deleteProperty(navigator, "share");
    await paidReceipt();
    expect(button("Copy receipt")).toBeUndefined();
    await pickReceiptAction("Share");
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain("Massage");
    expect(status()).toBe("Receipt copied.");
  });

  it("shares through the share sheet without copying, and a cancelled share says nothing", async () => {
    const share = vi.fn().mockRejectedValueOnce(Object.assign(new Error("cancelled"), { name: "AbortError" })).mockResolvedValueOnce(undefined);
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    await paidReceipt();
    await pickReceiptAction("Share");
    expect(share).toHaveBeenCalledOnce();
    expect(writeText).not.toHaveBeenCalled();
    expect(status()).toBe("");
    await pickReceiptAction("Share");
    expect(share).toHaveBeenCalledTimes(2);
    expect(writeText).not.toHaveBeenCalled();
    expect(status()).toBe("");
  });

  it("copies instead when the share sheet fails", async () => {
    Object.defineProperty(navigator, "share", { configurable: true, value: vi.fn().mockRejectedValue(new Error("NotAllowedError")) });
    await paidReceipt();
    await pickReceiptAction("Share");
    expect(writeText).toHaveBeenCalledOnce();
    expect(status()).toBe("Receipt copied.");
  });

  it("keeps the paper width in ⋯, remembered on this device, and describes Print for it", async () => {
    window.localStorage.removeItem(RECEIPT_PAPER_KEY);
    await paidReceipt();
    const print = button("Print")!;
    const hint = () => document.getElementById(print.getAttribute("aria-describedby")!)!;
    expect(hint().textContent).toBe("Prints 80 mm wide, as long as the receipt.");
    expect(hint().className).toContain("sr-only");
    expect(document.querySelector("details summary")?.textContent).not.toBe("Printing tips");
    await pickReceiptAction("Use 58 mm paper");
    expect(hint().textContent).toBe("Prints 58 mm wide, as long as the receipt.");
    expect(window.localStorage.getItem(RECEIPT_PAPER_KEY)).toBe("58");
    expect(status()).toBe("Prints on 58 mm paper · remembered on this device");
    // The next receipt on this device starts at 58 mm.
    await act(async () => root.unmount());
    root = createRoot(document.body.appendChild(document.createElement("div")));
    await paidReceipt();
    expect(document.getElementById(button("Print")!.getAttribute("aria-describedby")!)!.textContent).toBe("Prints 58 mm wide, as long as the receipt.");
    window.localStorage.removeItem(RECEIPT_PAPER_KEY);
  });
});

it("calls money paid before checkout Paid in advance on the receipt and its shared text", async () => {
  const backend = await createFixtureBackend();
  const actions = backend.useActions();
  // The fixture stay has a 10,000 deposit taken online.
  const { orderId } = await run(actions.openOrderFor({ bookingId: "fxbkg000001" as Id<"bookings"> }));
  await show(backend, createElement(Probe, { backend, orderId }));
  expect(view!.totals.deposit).toBe(1_000_000);
  const due = view!.totals.due;
  await run(actions.settleOrder({ orderId, expectedRevision: view!.order.revision, expectedDue: due, idempotencyKey: "deposit-receipt-01", tenders: [{ method: "cash", amount: due }] }));
  await show(backend, createElement(Probe, { backend, orderId }));
  const text = receiptText(view!, "Resort");
  expect(text).toContain("Paid in advance  -฿10,000");
  expect(text).not.toMatch(/before checkout|paid online/i);
  await show(backend, createElement(ReceiptWithConfirm, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
  const receipt = document.querySelector('[aria-label="Receipt"]')!.textContent!;
  expect(receipt).toContain("Paid in advance");
  expect(receipt).toContain("VAT 7% included");
  expect(receipt).not.toContain("Paid before checkout");
});

function ReceiptWithConfirm(props: ReceiptProps<typeof ReceiptView>) { return createElement(ConfirmProvider, null, createElement(ReceiptView, props)); }
