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

const backend = createFixtureBackend();

async function seed() {
  const actions = backend.useActions();
  let orderId: OrderId | undefined;
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
