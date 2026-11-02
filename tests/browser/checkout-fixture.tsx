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
 */
const params = new URLSearchParams(location.search);
document.documentElement.classList.toggle("dark", params.get("theme") === "dark");

const backend = createFixtureBackend({ appointments: params.get("scenario") === "fee" ? [{ appointmentId: "fxappt000002" as Id<"serviceAppointments">, status: "no_show" }] : [] });

async function seed() {
  const actions = backend.useActions();
  let orderId: OrderId | undefined;
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
  const [receiptId, setReceiptId] = useState<OrderId | null>(null);
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
