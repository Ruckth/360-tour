// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminCheckoutPage from "@/app/admin/checkout/page";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn(), notice: undefined as string | undefined, orderId: null as string | null }));
const openOrderFor = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.params,
}));
vi.mock("@/components/checkout/convex-backend", () => {
  const actions = { openOrderFor };
  return { convexCheckoutBackend: { useActions: () => actions } };
});
vi.mock("@/components/checkout/CheckoutView", () => ({
  CheckoutView: ({ notice, orderId }: { notice?: string; orderId: string | null }) => {
    nav.notice = notice;
    nav.orderId = orderId;
    return null;
  },
}));

let root: Root;
const show = (query: string) =>
  act(async () => {
    nav.params = new URLSearchParams(query);
    root.render(createElement(AdminCheckoutPage));
  });

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  nav.replace.mockReset();
  openOrderFor.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("checkout page links", () => {
  it("opens the booking's order", async () => {
    openOrderFor.mockResolvedValue({ orderId: "order-a" });
    await show("booking=k17booking0001");
    expect(openOrderFor).toHaveBeenCalledWith({ bookingId: "k17booking0001" });
    expect(nav.replace).toHaveBeenCalledWith("/admin/checkout?order=order-a");
  });

  it("opens an appointment's order", async () => {
    openOrderFor.mockResolvedValue({ orderId: "order-b" });
    await show("appointment=k17appoint0001");
    expect(openOrderFor).toHaveBeenCalledWith({ appointmentId: "k17appoint0001" });
    expect(nav.replace).toHaveBeenCalledWith("/admin/checkout?order=order-b");
  });

  it("stays on the order the cashier opened while the booking link was still loading (C4-08)", async () => {
    let resolve!: (value: { orderId: string }) => void;
    openOrderFor.mockReturnValue(new Promise((done) => (resolve = done)));
    await show("booking=k17booking0001");
    await show("order=k17orderbb0001");
    await act(async () => resolve({ orderId: "order-a" }));
    expect(nav.replace).not.toHaveBeenCalled();
    expect(nav.orderId).toBe("k17orderbb0001");
  });

  it("drops a refused link's error once another order is opened (K6-01)", async () => {
    openOrderFor.mockRejectedValue(new Error("This booking has nothing left to pay"));
    await show("booking=k17booking0001");
    expect(nav.notice).toBe("This booking has nothing left to pay");
    await show("order=k17orderbb0001");
    expect(nav.notice).toBeUndefined();
  });

  it("opens an old ?bill= link as the same order and moves it to ?order=", async () => {
    await show("bill=k17billbbb0001");
    expect(nav.orderId).toBe("k17billbbb0001");
    expect(nav.replace).toHaveBeenCalledWith("/admin/checkout?order=k17billbbb0001");
    expect(openOrderFor).not.toHaveBeenCalled();
  });
});
