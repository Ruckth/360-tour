// @vitest-environment happy-dom
import { act } from '../support/checkout-act';
import { createElement, useSyncExternalStore, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { OrderId } from "@/components/checkout/backend";

/**
 * H1-10: the real checkout page and CheckoutView over the fixture backend, with a browser-like
 * history stack behind next/navigation. Back from a receipt the checkout redirected to must leave
 * the receipt, not land on the paid order's checkout URL that redirects straight back.
 */

const browser = vi.hoisted(() => {
  const state = { entries: ["/admin/bookings"], index: 0, listeners: new Set<() => void>() };
  const emit = () => state.listeners.forEach((listener) => listener());
  const router = {
    push: (url: string) => {
      state.entries = [...state.entries.slice(0, state.index + 1), url];
      state.index += 1;
      emit();
    },
    replace: (url: string) => {
      state.entries = state.entries.map((entry, i) => (i === state.index ? url : entry));
      emit();
    },
    back: () => {
      if (state.index > 0) state.index -= 1;
      emit();
    },
  };
  const url = () => state.entries[state.index];
  return { state, router, url, reset(entries: string[]) { state.entries = entries; state.index = entries.length - 1; } };
});

vi.mock("next/navigation", () => ({
  useRouter: () => browser.router,
  useSearchParams: () => new URLSearchParams(browser.url().split("?")[1] ?? ""),
}));
vi.mock("@/components/checkout/convex-backend", async () => {
  const { createFixtureBackend } = await import("../support/checkout-backend");
  return { convexCheckoutBackend: await createFixtureBackend() };
});
vi.mock("@/components/admin/useShowOrderOnDisplay", () => ({ useShowOrderOnDisplay: () => ({ error: null, retry: () => undefined }) }));
vi.mock("@/components/admin/CustomerDisplayDialog", () => ({ CustomerDisplayControl: () => null }));
vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

const { default: AdminCheckoutPage } = await import("@/app/admin/checkout/page");
const { convexCheckoutBackend: backend } = await import("@/components/checkout/convex-backend");

/** Which page the browser shows; the checkout page remounts whenever its entry comes back. */
function Browser() {
  const url = useSyncExternalStore(
    (listener) => {
      browser.state.listeners.add(listener);
      return () => browser.state.listeners.delete(listener);
    },
    browser.url,
  );
  if (url.startsWith("/admin/receipt/")) return createElement("p", { "data-receipt": url.slice("/admin/receipt/".length) });
  if (url.startsWith("/admin/checkout")) return createElement(AdminCheckoutPage, { key: `${browser.state.index}:${url}` });
  return createElement("p", { "data-page": url });
}

let root: Root;
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(500); });
const back = async () => {
  await act(async () => browser.router.back());
  await settle();
};
const receiptShown = () => document.querySelector("[data-receipt]")?.getAttribute("data-receipt") ?? null;

async function paidOrder() {
  const actions = backend.useActions();
  const added = actions.addItem({ item: { kind: "extra", name: "Massage", price: 120000 } });
  await settle();
  const { orderId } = await added;
  const settled = actions.settleOrder({ orderId, expectedRevision: 1, expectedDue: 120000, idempotencyKey: `nav-${orderId}`, tenders: [{ method: "cash", amount: 120000 }] });
  return { orderId, settled };
}

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

it("goes back from the receipt of an order paid at checkout to the page before checkout", async () => {
  const actions = backend.useActions();
  const added = actions.addItem({ item: { kind: "extra", name: "Massage", price: 120000 } });
  await settle();
  const { orderId } = await added;
  browser.reset(["/admin/bookings", `/admin/checkout?order=${orderId}`]);
  await act(async () => root.render(createElement(Browser)));
  await settle();
  expect(receiptShown()).toBeNull();

  // Taking payment turns the live order paid, and the checkout moves on to its receipt.
  const paid = actions.settleOrder({ orderId, expectedRevision: 1, expectedDue: 120000, idempotencyKey: `nav-pay-${orderId}`, tenders: [{ method: "cash", amount: 120000 }] });
  await settle();
  await paid;
  await settle();
  expect(receiptShown()).toBe(orderId);

  await back();
  expect(receiptShown()).toBeNull();
  expect(browser.url()).toBe("/admin/bookings");
});

it("goes back from a paid order's link to where it was opened, not into a loop", async () => {
  const { orderId, settled } = await paidOrder();
  await settle();
  await settled;
  browser.reset(["/admin/bookings", `/admin/checkout?order=${orderId as OrderId}`]);
  await act(async () => root.render(createElement(Browser)));
  await settle();
  expect(receiptShown()).toBe(orderId);

  for (let i = 0; i < 3 && receiptShown(); i++) await back();
  expect(receiptShown()).toBeNull();
  expect(browser.url()).toBe("/admin/bookings");
  expect(browser.state.entries).toEqual(["/admin/bookings", `/admin/receipt/${orderId}`]);
});
