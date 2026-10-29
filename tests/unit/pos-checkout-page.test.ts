// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminCheckoutPage from "@/app/admin/checkout/page";

const nav = vi.hoisted(() => ({ params: new URLSearchParams(), replace: vi.fn(), push: vi.fn(), notice: undefined as string | undefined }));
const openFor = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: nav.replace, push: nav.push }),
  useSearchParams: () => nav.params,
}));
vi.mock("@/components/checkout/convex-backend", () => {
  const actions = { openFor };
  return { convexCheckoutBackend: { useActions: () => actions } };
});
vi.mock("@/components/checkout/CheckoutView", () => ({
  CheckoutView: ({ notice }: { notice?: string }) => {
    nav.notice = notice;
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
  openFor.mockReset();
  root = createRoot(document.body.appendChild(document.createElement("div")));
});
afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("checkout page source links", () => {
  it("opens the booking's bill", async () => {
    openFor.mockResolvedValue({ billId: "bill-a" });
    await show("booking=k17booking0001");
    expect(openFor).toHaveBeenCalledWith({ bookingId: "k17booking0001" });
    expect(nav.replace).toHaveBeenCalledWith("/admin/checkout?bill=bill-a");
  });

  it("stays on the bill the cashier opened while the booking link was still loading (C4-08)", async () => {
    let resolve!: (value: { billId: string }) => void;
    openFor.mockReturnValue(new Promise((done) => (resolve = done)));
    await show("booking=k17booking0001");
    await show("bill=k17billbbb0001");
    await act(async () => resolve({ billId: "bill-a" }));
    expect(nav.replace).not.toHaveBeenCalled();
  });

  it("drops a refused link's error once another bill is opened (K6-01)", async () => {
    openFor.mockRejectedValue(new Error("This booking has nothing left to pay"));
    await show("booking=k17booking0001");
    expect(nav.notice).toBe("This booking has nothing left to pay");
    await show("bill=k17billbbb0001");
    expect(nav.notice).toBeUndefined();
  });
});
