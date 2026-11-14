// @vitest-environment happy-dom
import { act, createElement, useState, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StaffAccessView } from "@/components/admin/admin-access";
import { StaffAccessProvider } from "@/components/admin/staff-access";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderRow, type OrdersPage } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { OpenOrders } from "@/components/checkout/OrderStrip";
import { DEFAULT_CASHIER_RULES } from "convex/lib/staffTypes";

/*
 * P2b: a cashier's Orders is the open orders list (pos.listOpenOrders), one tap per order, plus a
 * small "Order number" for today's receipts. Save & close is gone.
 */

const CASHIER: StaffAccessView = {
  email: "mint@example.com", role: "cashier", pendingInvitation: null, marketingRole: null, cashierRules: DEFAULT_CASHIER_RULES,
  capabilities: {
    checkout: true, approve: false, operations: false, manageTeam: false, settings: false, bookings: false, services: false,
    customers: false, orders: false, chats: false, properties: false, roster: false, reports: false, marketing: false,
  },
};

let root: Root;
const provide = (backend: CheckoutBackend, child: ReturnType<typeof createElement>) =>
  createElement(StaffAccessProvider, { access: CASHIER }, createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child));
const buttons = (scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")];
const button = (text: string, scope?: ParentNode) => buttons(scope).find((el) => el.textContent?.trim() === text);
const list = () => document.querySelector<HTMLElement>('ul[aria-label="Open orders"]');
const settle = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });

function row(n: number, extra: Partial<OrderRow> = {}): OrderRow {
  return {
    _id: `bill${n}` as OrderId, orderNumber: n, title: `Order #${n}`, state: "unpaid", itemCount: 2, total: 500, due: 500, currency: "THB",
    updatedAt: Date.now() - n, receiptNumber: undefined, customerName: undefined, discarded: undefined, bookingReference: undefined, otherBookings: 0,
    refundedAmountSatang: 0, ...extra,
  } as OrderRow;
}

/** The list on a backend whose open orders page is whatever the test sets. */
async function showList(page: OrdersPage, currentId?: OrderId) {
  const onOpen = vi.fn();
  const backend: CheckoutBackend = { ...createFixtureBackend(), useOpenOrders: () => page };
  await act(async () => root.render(provide(backend, createElement(OpenOrders, { currentId, onOpen }))));
  return onOpen;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("open orders list", () => {
  it("shows a spinner while the first page loads", async () => {
    await showList({ results: [], status: "LoadingFirstPage", loadMore: vi.fn() });
    expect(document.querySelector('[role="status"][aria-label="Loading orders"]')).toBeTruthy();
    expect(list()).toBeNull();
    expect(button("Load more")).toBeUndefined();
  });

  it("says so in one short line when there are none", async () => {
    await showList({ results: [], status: "Exhausted", loadMore: vi.fn() });
    expect(list()).toBeNull();
    expect(document.body.textContent).toContain("No open orders.");
    // The receipt lookup stays, for today's paid orders.
    expect(document.querySelector('label[for="order-lookup"]')?.textContent).toBe("Order number");
  });

  it("lists each order with its customer or booking, item count and due, in the order given, and opens one in a tap", async () => {
    const rows = [
      row(1045, { customerName: "Somchai Prasert", bookingReference: "CONF-A", itemCount: 3, due: 780 }),
      row(1044, { bookingReference: "CONF-B", otherBookings: 1, itemCount: 1, due: 26000 }),
      row(1043),
    ];
    const onOpen = await showList({ results: rows, status: "Exhausted", loadMore: vi.fn() }, rows[1]._id);
    const items = [...list()!.querySelectorAll("li")];
    expect(items.map((li) => li.querySelector("span span")?.textContent)).toEqual(["Order #1045", "Order #1044 · on screen", "Order #1043"]);
    expect(items[0].textContent).toContain("Somchai Prasert · 3 items");
    expect(items[0].textContent).toContain("฿780");
    expect(items[1].textContent).toContain("CONF-B +1 · 1 item");
    expect(items[1].textContent).toContain("฿26,000");
    expect(items[1].querySelector("button")?.getAttribute("aria-current")).toBe("true");
    expect(items[2].textContent).toContain("No customer · 2 items");
    expect(button("Load more")).toBeUndefined();

    await act(async () => items[0].querySelector("button")!.click());
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("bill1045");
  });

  it("offers Load more while there are more, and disables it while they load", async () => {
    const loadMore = vi.fn();
    await showList({ results: [row(1050)], status: "CanLoadMore", loadMore });
    await act(async () => button("Load more")!.click());
    expect(loadMore).toHaveBeenCalledExactlyOnceWith(20);

    await showList({ results: [row(1050)], status: "LoadingMore", loadMore });
    const more = buttons().find((el) => el.textContent?.includes("Load more"))!;
    expect(more.disabled).toBe(true);
    expect(more.querySelector('[aria-label="Loading more orders"]')).toBeTruthy();
  });
});

describe("a cashier's checkout", () => {
  function Page() {
    const [orderId, setOrderId] = useState<OrderId | null>(null);
    return createElement(CheckoutView, { orderId, onOrderChange: setOrderId, onPaid: () => {} });
  }
  const title = () => document.querySelector('[data-testid="order-panel-title"]')?.textContent;

  it("reopens an earlier open order from Orders in one tap, with no Save & close", async () => {
    vi.useFakeTimers();
    const backend = createFixtureBackend({ staff: { role: "cashier", email: CASHIER.email!, rules: DEFAULT_CASHIER_RULES } });
    await act(async () => root.render(provide(backend, createElement(Page))));
    await act(async () => buttons().find((el) => el.textContent?.trim().startsWith("Foot spa 45"))!.click());
    await settle();
    expect(title()).toBe("Order #1043");
    expect(button("Save & close")).toBeUndefined();

    await act(async () => button("Orders")!.click());
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    // No status filters: those are the managers' Orders.
    expect(button("Paid", dialog)).toBeUndefined();
    const rows = [...list()!.querySelectorAll("li")].map((li) => li.querySelector("span span")?.textContent);
    expect(rows).toEqual(["Order #1043 · on screen", "Order #1042"]);

    await act(async () => buttons(list()!).find((el) => el.textContent?.startsWith("Order #1042"))!.click());
    await settle();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(title()).toBe("Order #1042");
  });
});
