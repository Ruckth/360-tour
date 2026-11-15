import { act } from "../support/checkout-act";
// @vitest-environment happy-dom
import { createElement, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "../support/checkout-backend";

let root: Root;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(300); });
const order = () => document.querySelector<HTMLElement>('aside[aria-label="Order"]')!;
const button = (text: string) => [...order().querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim() === text);
const show = (backend: CheckoutBackend, orderId: OrderId, onPaid: (id: OrderId) => void) =>
  act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, createElement(CheckoutView, { orderId, onOrderChange: () => {}, onPaid }))));

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
  vi.restoreAllMocks();
});

/** A ฿100 order with a 100% discount: nothing left to pay. */
async function freeOrder() {
  const backend = await createFixtureBackend();
  const actions = backend.useActions();
  const adding = actions.addItem({ item: { kind: "extra", name: "Water", price: 10000 } });
  await settle();
  const { orderId, lineId } = await adding;
  const discounting = actions.updateLine({ lineId, discount: { type: "percent", value: 10000 } });
  await settle();
  await discounting;
  return { backend, actions, orderId };
}

it("closes an order with nothing due in one tap, with no tenders", async () => {
  const { backend, actions, orderId } = await freeOrder();
  const settleOrder = vi.spyOn(actions, "settleOrder");
  const onPaid = vi.fn();
  await show(backend, orderId, onPaid);
  await act(async () => button("Close order · nothing due")!.click());
  await settle();
  expect(settleOrder).toHaveBeenCalledOnce();
  expect(settleOrder.mock.calls[0][0]).toMatchObject({ orderId, expectedDue: 0, tenders: [], notifyGuest: false });
  expect(settleOrder.mock.calls[0][0].idempotencyKey).toBeTruthy();
  expect(onPaid).toHaveBeenCalledWith(orderId);
});

it("retries a failed close with the same attempt key and revision", async () => {
  const { backend, actions, orderId } = await freeOrder();
  const settleOrder = vi.spyOn(actions, "settleOrder").mockRejectedValueOnce(new Error("Connection lost. Try again."));
  const onPaid = vi.fn();
  await show(backend, orderId, onPaid);
  await act(async () => button("Close order · nothing due")!.click());
  await settle();
  expect(order().textContent).toContain("Connection lost");
  expect(onPaid).not.toHaveBeenCalled();
  await act(async () => button("Retry close")!.click());
  await settle();
  expect(settleOrder).toHaveBeenCalledTimes(2);
  expect(settleOrder.mock.calls[1][0]).toEqual(settleOrder.mock.calls[0][0]);
  expect(onPaid).toHaveBeenCalledWith(orderId);
});
