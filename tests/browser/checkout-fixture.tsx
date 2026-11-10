import type { Id } from "convex/_generated/dataModel";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import "@/app.css";

/*
 * The real checkout and receipt on the in-memory fixture backend, for layout and print checks.
 * Query parameters:
 *   lines=N      start on a new order holding N custom items (a long order with a large total)
 *   theme=dark   dark app theme (light otherwise)
 *   scenario=    fee, source-conflict, history, or a coupon state:
 *                coupon-entry    the spa order, no coupon yet
 *                coupon-applied  DCNT-SPA-500 split ฿333 + ฿167 (breakfast not covered)
 *                coupon-problem  the massage removed, so the coupon is below its minimum
 *                coupon-stay     Anna's stay priced with DCNT-F1-20, a massage with DCNT-L-10
 *                coupon-soldout  DCNT-L2-300 sold out by another till; paying is refused
 *                coupon-changed  DCNT-L-10 capped since it was applied; paying is refused
 *                coupon-paid     DCNT-SPA-500 paid by card, on the receipt
 *                unscheduled     Somchai's Thai massage 90 with no date or time, unpaid
 *                unscheduled-paid  the same, paid by cash, on the receipt (his appointment still unlinked)
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const scenario = params.get("scenario") ?? "";
const backend = createFixtureBackend({
  appointments: scenario === "fee" ? [{ appointmentId: "fxappt000002" as Id<"serviceAppointments">, status: "no_show" }] : [],
  bookings: scenario === "coupon-stay" ? [{ id: "fxbkg000001" as Id<"bookings">, promotion: { code: "DCNT-F1-20", discount: 3000 } }] : [],
});
const service = (n: number) => ({ kind: "service" as const, serviceId: `fxsvc${String(n).padStart(6, "0")}` as Id<"services"> });

/** Thai massage 60 (฿1,200), Foot spa 45 (฿600) and a breakfast basket (฿450), as in the marketing preview. */
async function spaOrder() {
  const actions = backend.useActions();
  const { orderId, lineId } = await actions.addItem({ item: service(1) });
  await actions.addItem({ orderId, item: service(7) });
  await actions.addItem({ orderId, item: { kind: "extra", name: "Breakfast basket", price: 450 } });
  return { orderId, massage: lineId };
}

async function couponSeed(): Promise<OrderId | null> {
  const actions = backend.useActions();
  if (scenario === "coupon-entry") return (await spaOrder()).orderId;
  if (scenario === "coupon-stay") {
    const { orderId } = await actions.openOrderFor({ bookingId: "fxbkg000001" as Id<"bookings"> });
    await actions.addItem({ orderId, item: service(1) });
    await actions.applyOrderCoupon({ orderId, code: "DCNT-L-10" });
    return orderId;
  }
  const { orderId, massage } = await spaOrder();
  if (scenario === "coupon-soldout" || scenario === "coupon-changed") {
    await actions.applyOrderCoupon({ orderId, code: scenario === "coupon-soldout" ? "DCNT-L2-300" : "DCNT-L-10" });
    // Another till used the last DCNT-L2-300; DCNT-L-10 was capped by its manager.
    backend.setCouponSnapshot(scenario === "coupon-soldout" ? "DCNT-L2-300" : "DCNT-L-10", scenario === "coupon-soldout" ? { used: 50 } : { maxSaving: 100 });
    return orderId;
  }
  const applied = await actions.applyOrderCoupon({ orderId, slug: "q1" });
  if (scenario === "coupon-problem") await actions.removeLine({ lineId: massage });
  if (scenario === "coupon-paid") {
    await actions.settleOrder({ orderId, expectedRevision: applied.revision, expectedDue: 2250 - applied.discount, idempotencyKey: "browser-pay-coupon", tenders: [{ method: "card", amount: 2250 - applied.discount }] });
  }
  return orderId;
}

async function seed() {
  const actions = backend.useActions();
  let orderId: OrderId | undefined;
  if (scenario.startsWith("coupon-")) return couponSeed();
  if (params.get("scenario") === "fee") {
    return (await actions.addAppointmentFee({ appointmentId: "fxappt000002" as Id<"serviceAppointments">, kind: "no_show", amount: 500, reason: "Guest did not attend" })).orderId;
  }
  if (params.get("scenario") === "source-conflict") {
    const appointmentId = "fxappt000002" as Id<"serviceAppointments">;
    ({ orderId } = await actions.openOrderFor({ appointmentId }));
    await actions.addItem({ orderId, item: { kind: "extra", name: "Retained tea", price: 50 } });
    // Fixture starts this new order at revision 0; attach and add each bump it once.
    await actions.discardOrder({ orderId, expectedRevision: 2, idempotencyKey: "browser-discard-source" });
    await actions.openOrderFor({ appointmentId });
    return orderId;
  }
  if (scenario === "unscheduled" || scenario === "unscheduled-paid") {
    // Somchai prepays a Thai massage 90 with no date or time; his unpaid appointment for it exists.
    ({ orderId } = await actions.addItem({ item: service(2) }));
    await actions.linkCustomer({ orderId, customerId: "fxcust000002" as Id<"customers"> });
    if (scenario === "unscheduled-paid") {
      await actions.settleOrder({ orderId, expectedRevision: 2, expectedDue: 1600, expectedCustomerRevision: 0, idempotencyKey: "browser-pay-unscheduled", tenders: [{ method: "cash", amount: 1600 }] });
    }
    return orderId;
  }
  if (params.get("scenario") === "history") {
    ({ orderId } = await actions.addItem({ item: { kind: "extra", name: "Original tea", price: 100 } }));
    await actions.settleOrder({ orderId, expectedRevision: 1, expectedDue: 100, idempotencyKey: "browser-pay-history", tenders: [{ method: "card", amount: 100 }] });
    for (let i = 0; i < 26; i++) await actions.amendOrderPayment({ orderId, expectedCorrectionRevision: i, idempotencyKey: `browser-correction-${i}`, reason: `Tender correction ${i + 1}`, tenders: [{ method: i % 2 ? "transfer" : "cash", amount: 100 }] });
    return orderId;
  }
  for (let i = 0; i < Number(params.get("lines") ?? 0); i += 1) {
    const name = `Layout check item ${i + 1} with a longer descriptive name`;
    ({ orderId } = await actions.addItem({ orderId, item: { kind: "extra", name, price: 77_692.3 + i } }));
  }
  return orderId ?? null;
}

function Harness({ initialOrder }: { initialOrder: OrderId | null }) {
  const [orderId, setOrderId] = useState(initialOrder);
  const [receiptId, setReceiptId] = useState<OrderId | null>(scenario === "coupon-paid" || scenario === "unscheduled-paid" ? initialOrder : null);
  return (
    <CheckoutBackendProvider backend={backend}>
      <div className="flex h-dvh flex-col bg-background text-foreground" data-fixture-ready="">
        {receiptId ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <ReceiptView orderId={receiptId} onNewSale={() => { setReceiptId(null); setOrderId(null); }} onOpenOrder={(id) => { setReceiptId(null); setOrderId(id); }} />
          </div>
        ) : (
          <CheckoutView orderId={orderId} onOrderChange={setOrderId} onPaid={setReceiptId} />
        )}
      </div>
    </CheckoutBackendProvider>
  );
}

void seed().then((initialOrder) => createRoot(document.getElementById("root")!).render(<Harness initialOrder={initialOrder} />));
