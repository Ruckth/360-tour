// @vitest-environment happy-dom
import { act, createElement, type ComponentProps, type ReactElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId, type OrderView } from "@/components/checkout/backend";
import { orderTime, receiptText } from "@/components/checkout/checkout-ui";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import type { Id } from "convex/_generated/dataModel";
import { ReceiptView } from "@/components/checkout/ReceiptView";

/** H1-08: receipts and the Orders list show resort (Bangkok) time on a device set to another zone. */

vi.mock("@/i18n/navigation", () => ({ Link: ({ children, ...props }: { children: ReactNode }) => createElement("a", props, children) }));

const deviceZone = process.env.TZ;
// A manager's laptop left on UTC. Bangkok is UTC+7 all year.
beforeAll(() => {
  process.env.TZ = "UTC";
});
afterAll(() => {
  process.env.TZ = deviceZone;
});

let root: Root;
let view: OrderView | null | undefined;
const tick = () => act(async () => { await vi.advanceTimersByTimeAsync(200); });
async function run<T>(promise: Promise<T>) { await tick(); return await promise; }
function Probe({ backend, orderId }: { backend: CheckoutBackend; orderId: OrderId }) { view = backend.useOrder(orderId); return null; }
const show = (backend: CheckoutBackend, child: ReactElement) => act(async () => root.render(createElement(CheckoutBackendProvider, { backend } as ComponentProps<typeof CheckoutBackendProvider>, child)));

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

it("runs on a device whose zone is not Bangkok", () => {
  expect(new Date("2026-11-01T22:30:00Z").getTimezoneOffset()).toBe(0);
  expect(new Date("2026-11-01T22:30:00Z").getHours()).toBe(22);
});

it("prints the receipt, its share text and the void note in Bangkok time", async () => {
  // 05:30 on 2 Nov in Bangkok is still 1 Nov on the device.
  vi.setSystemTime(new Date("2026-11-01T22:30:00Z"));
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "extra", name: "Massage", price: 120000 } }));
  await show(backend, createElement(Probe, { backend, orderId }));
  await run(actions.settleOrder({ orderId, expectedRevision: view!.order.revision, expectedDue: 120000, idempotencyKey: "tz-receipt-0001", tenders: [{ method: "cash", amount: 120000 }] }));

  await show(backend, createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
  expect(document.querySelector('[aria-label="Receipt"]')!.textContent).toContain("Issued 2 Nov 2026, 05:30");

  await show(backend, createElement(Probe, { backend, orderId }));
  expect(receiptText(view!, "Resort").split("\n")).toContain("2 Nov 2026, 05:30");

  vi.setSystemTime(new Date("2026-11-01T22:45:00Z"));
  await run(actions.voidOrder({ orderId, reason: "Wrong guest" }));
  await show(backend, createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
  expect(document.body.textContent).toContain(" on 2 Nov, 05:45. The order and receipt numbers stay on record.");
});

it("lists today's orders by the Bangkok day, with the date on other days", () => {
  const now = Date.parse("2026-11-01T22:50:00Z"); // 05:50 on 2 Nov in Bangkok
  expect(orderTime(Date.parse("2026-11-01T17:30:00Z"), now)).toBe("00:30");
  expect(orderTime(Date.parse("2026-11-01T16:30:00Z"), now)).toBe("1 Nov, 23:30");
});

it("keeps coupon savings and Bangkok issue time together on the receipt and shared text", async () => {
  vi.setSystemTime(new Date("2026-11-01T22:30:00Z"));
  const backend = createFixtureBackend();
  const actions = backend.useActions();
  const { orderId } = await run(actions.addItem({ item: { kind: "service", serviceId: "fxsvc000001" as Id<"services"> } }));
  await run(actions.addItem({ orderId, item: { kind: "service", serviceId: "fxsvc000007" as Id<"services"> } }));
  await run(actions.applyOrderCoupon({ orderId, code: "DCNT-SPA-500" }));
  await show(backend, createElement(Probe, { backend, orderId }));
  expect(view!.totals).toMatchObject({ total: 130000, coupon: 50000 });
  await run(actions.settleOrder({ orderId, expectedRevision: view!.order.revision, expectedDue: 130000, idempotencyKey: "tz-coupon-receipt", tenders: [{ method: "cash", amount: 130000 }] }));
  await show(backend, createElement(ReceiptView, { orderId, onNewSale: vi.fn(), onOpenOrder: vi.fn() }));
  const receipt = document.querySelector('[aria-label="Receipt"]')!.textContent;
  expect(receipt).toContain("Issued 2 Nov 2026, 05:30");
  expect(receipt).toContain("Coupon DCNT-SPA-500");
  expect(receipt).toContain("1,300");
  await show(backend, createElement(Probe, { backend, orderId }));
  expect(receiptText(view!, "Resort")).toContain("2 Nov 2026, 05:30");
  expect(receiptText(view!, "Resort")).toContain("Coupon DCNT-SPA-500");
});
