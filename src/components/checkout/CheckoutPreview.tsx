"use client";

import { useState } from "react";
import { CheckoutBackendProvider, type OrderId } from "./backend";
import { CheckoutView } from "./CheckoutView";
import { createFixtureBackend } from "./fixture-backend";
import { ReceiptView } from "./ReceiptView";

/** Dev-only: the real checkout and receipt on in-memory fixtures, no sign-in or Convex needed. */
export function CheckoutPreview() {
  const [backend] = useState(createFixtureBackend);
  const [orderId, setOrderId] = useState<OrderId | null>(null);
  const [receiptId, setReceiptId] = useState<OrderId | null>(null);

  return (
    <CheckoutBackendProvider backend={backend}>
      <div className="flex h-dvh flex-col bg-background text-foreground">
        <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 text-sm print:hidden">
          <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Preview · sample data</span>
          <span className="font-semibold">{receiptId ? "Receipt" : "Checkout"}</span>
        </header>
        {receiptId ? (
          <div className="flex min-h-0 flex-1 overflow-y-auto">
            <ReceiptView
              orderId={receiptId}
              onNewSale={() => { setReceiptId(null); setOrderId(null); }}
              onOpenOrder={(id) => { setReceiptId(null); setOrderId(id); }}
            />
          </div>
        ) : (
          <CheckoutView orderId={orderId} onOrderChange={setOrderId} onPaid={setReceiptId} />
        )}
      </div>
    </CheckoutBackendProvider>
  );
}
