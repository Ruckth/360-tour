// @vitest-environment happy-dom
import { act } from "../support/checkout-act";
import { NextIntlClientProvider } from "next-intl";
import { createElement, type ComponentProps, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { previewBackend } from "@/components/checkout/CheckoutPreview";
import { COMMERCE_RECEIPT_ID, COMMERCE_REDEMPTION_ID } from "@/components/checkout/design/commerce-receipt";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import en from "../../messages/en.json";
import commerceEn from "../../messages/commerce/en.json";

/*
 * Audit Minor 5: a return's "completed" notice belongs to the receipt it finished on. A payout
 * answer that arrives after the cashier moved to another receipt never shows on that one.
 */
const completions = vi.hoisted(() => new Map<string, (message: string) => void>());
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));
vi.mock("next/navigation", () => ({ useSearchParams: () => ({ get: () => null }) }));
vi.mock("@/components/checkout/ReturnItemsEntry", async (original) => ({
  ...await original<typeof import("@/components/checkout/ReturnItemsEntry")>(),
  // The open return's sheet, as the receipt wires it: keep the callback the receipt gave it.
  ReturnInProgressNotice: ({ view, onCompleted }: { view: { order: { _id: string } }; onCompleted?: (message: string) => void }) => {
    if (onCompleted) completions.set(view.order._id, onCompleted);
    return null;
  },
}));

let root: Root;
const gone = new Set<string>();
const intl = { locale: "en", messages: { ...en, ...commerceEn }, timeZone: "Asia/Bangkok" } as unknown as ComponentProps<typeof NextIntlClientProvider>;
const base = previewBackend("empty", "dark");
// Once its return finishes, a prior-day receipt is no longer readable by the cashier.
const backend: CheckoutBackend = { ...base, useOrder: (id, view) => { const read = base.useOrder(id, view); return id && gone.has(id) ? null : read; } };
const show = (orderId: OrderId) => act(async () => root.render(createElement(NextIntlClientProvider, intl, createElement(ConfirmProvider, null,
  createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>,
    createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }))))));
const notice = () => document.querySelector('[data-testid="receipt-return-completed"]');

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  completions.clear();
  gone.clear();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

it("never shows a late payout answer from receipt A on receipt B, and shows B's own", async () => {
  await show(COMMERCE_RECEIPT_ID);
  const finishA = completions.get(COMMERCE_RECEIPT_ID)!;
  expect(finishA).toBeTypeOf("function");
  await show(COMMERCE_REDEMPTION_ID);
  const finishB = completions.get(COMMERCE_REDEMPTION_ID)!;
  // A's payout answer arrives late, while B is open; then B's receipt leaves the cashier's reach.
  await act(async () => finishA("Return completed · refund recorded."));
  gone.add(COMMERCE_REDEMPTION_ID);
  await show(COMMERCE_REDEMPTION_ID);
  expect(notice()).toBeNull();
  // B's own completion shows on B.
  await act(async () => finishB("Return completed · refund recorded."));
  expect(notice()?.textContent).toContain("Return completed · refund recorded.");
});
