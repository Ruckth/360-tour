import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import commerceEn from "../../messages/commerce/en.json";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { COMMERCE_OFF, CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import { createFixtureBackend } from "../support/checkout-backend";

/*
 * PR #93 round-1 audit, major 9: the payments cutover leaves staff on the just-paid receipt and
 * asks each till to reload once. Reloading that receipt must acknowledge the till, as opening the
 * checkout workspace does: the receipt reads commerce access (cutoverAccess acknowledges there).
 */

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

let root: Root;
let view: OrderView | null | undefined;
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
function Probe({ backend, orderId }: { backend: CheckoutBackend; orderId: OrderId }) { view = backend.useOrder(orderId); return null; }
function Copy({ children }: { children: ReactNode }) {
  return createElement(NextIntlClientProvider, { locale: "en", timeZone: "Asia/Bangkok", messages: commerceEn } as unknown as ComponentProps<typeof NextIntlClientProvider>, children);
}
const show = (backend: CheckoutBackend, child: ReactElement) => act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(Copy, null, createElement(ConfirmProvider, null, child)))));

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it("reads commerce access on the receipt, so a reloaded till acknowledges from where the cutover leaves staff", async () => {
  const fixture = await createFixtureBackend();
  const actions = fixture.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "extra", name: "Massage", price: 65000 } }));
  await show(fixture, createElement(Probe, { backend: fixture, orderId }));
  await run(actions.settleOrder({ orderId, expectedRevision: view!.order.revision, expectedDue: 65000, idempotencyKey: "ack-receipt-0001", tenders: [{ method: "card", amount: 65000 }] }));

  const useAccess = vi.fn(COMMERCE_OFF.useAccess);
  const backend: CheckoutBackend = { ...fixture, commerce: { ...COMMERCE_OFF, useAccess } };
  await show(backend, createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
  await tick();
  expect(document.querySelector('[aria-label="Receipt"]')).not.toBeNull();
  expect(useAccess).toHaveBeenCalled();
});
