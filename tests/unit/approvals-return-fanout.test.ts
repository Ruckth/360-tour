// @vitest-environment happy-dom
import { act } from "../support/checkout-act";
import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApprovalsList from "@/components/checkout/ApprovalsList";

/*
 * PR 93 round 3 (sol major 2): Approvals with many return requests reads only the open one. The
 * rest render from pendingPage's compact stored summary: no order, detail or quote per row.
 */
const seen = vi.hoisted(() => ({ orders: [] as string[], details: [] as string[], previews: [] as string[] }));
vi.mock("@/components/admin/staff-access", () => ({ useStaffAccess: () => ({ role: "manager", capabilities: { approve: true } }) }));
vi.mock("@/components/checkout/backend", () => ({
  useCommerce: () => ({ useAccess: () => ({ paymentsMode: "attempts" }) }),
  useReturnsDesk: () => ({ useActions: () => ({ preview: (args: { clientKey: string }) => { seen.previews.push(args.clientKey); return new Promise(() => {}); } }) }),
  useCheckoutBackend: () => ({
    useOrder: (id: string) => { seen.orders.push(id); return { order: { _id: id, title: `#${id}`, revision: 1 }, paymentRecord: { correctionRevision: 0 }, lines: [] }; },
    useApprovalDetail: (id: string) => { seen.details.push(id); return { kind: "returnItems", request: { reason: "Changed mind", parts: [] } }; },
  }),
}));

const rows = Array.from({ length: 20 }, (_, i) => ({
  _id: `request${i}`, kind: "returnItems", orderId: `order${i}`, lineId: `line${i}`, label: "returnItems", requesterEmail: "mint@example.com",
  createdAt: 0, expiresAt: Date.now() + 600_000, status: "pending", actionable: true, summary: { amount: 25000 * (i + 1), partCount: 1 + (i % 3) },
}));

beforeEach(() => { seen.orders.length = 0; seen.details.length = 0; seen.previews.length = 0; vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true); });
afterEach(() => { vi.unstubAllGlobals(); document.body.innerHTML = ""; });

it("opens 20 return requests with one order, one detail and one quote: the selected request's", async () => {
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  const onSelect = vi.fn();
  const render = (selectedId: string) => act(async () => root.render(createElement(ApprovalsList, {
    rows: rows as never, selectedId: selectedId as never, count: 20, more: false, searching: false, loadingMore: false, onMore: () => {}, onSelect, onDecided: () => {},
  })));
  await render("request0");
  for (let n = 0; n < 200 && !document.querySelector("[data-return-request]"); n++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  for (let n = 0; n < 50 && !seen.previews.length; n++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(new Set(seen.orders)).toEqual(new Set(["order0"]));
  expect(new Set(seen.details)).toEqual(new Set(["request0"]));
  expect(seen.previews).toEqual(["approval:request0"]);
  // The other 19 are compact rows from their stored summary, each opening on a tap.
  const queued = [...document.querySelectorAll<HTMLElement>("[data-return-queued]")];
  expect(queued).toHaveLength(19);
  expect(queued[0].textContent).toBe("Return itemsMint asks to return 2 parts · ฿500Expires in 10 min");
  await act(async () => queued[0].querySelector("button")!.click());
  expect(onSelect).toHaveBeenCalledWith("request1");

  // Opening another request reads that one only.
  await render("request1");
  for (let n = 0; n < 50 && seen.previews.length < 2; n++) await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)); });
  expect(new Set(seen.orders)).toEqual(new Set(["order0", "order1"]));
  expect(new Set(seen.details)).toEqual(new Set(["request0", "request1"]));
  expect(document.querySelectorAll("[data-return-request]")).toHaveLength(1);
  await act(async () => root.unmount());
});
