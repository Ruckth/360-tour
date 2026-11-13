"use client";

import { useMemo, useState } from "react";
import { CheckoutBackendProvider, type OrderId } from "./backend";
import { CheckoutView } from "./CheckoutView";
import { checkoutDesignStates, createFixtureBackend, type CheckoutDesignState } from "./fixture-backend";
import { ReceiptView } from "./ReceiptView";

/**
 * Dev-only: the real checkout and receipt on canned view states, no sign-in or Convex needed.
 * `embedded` drops the preview banner so it can sit in the admin shell like the real page.
 */
export function CheckoutPreview({ embedded = false }: { embedded?: boolean }) {
  const [state, setState] = useState<CheckoutDesignState>("empty");
  const backend = useMemo(() => createFixtureBackend(state), [state]);
  const [orderId, setOrderId] = useState<OrderId | null>(null);
  const [receiptId, setReceiptId] = useState<OrderId | null>(null);

  return (
    <CheckoutBackendProvider key={state} backend={backend}>
      {/* Checkout and receipt follow the app's light or dark theme, as under the admin shell. */}
      <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "flex h-dvh flex-col bg-background text-foreground"}>
        {embedded ? null : (
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 text-sm print:hidden">
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Preview · sample data</span>
            <span className="font-semibold">{receiptId ? "Receipt" : "Checkout"}</span>
          </header>
        )}
        <label className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2 text-sm print:hidden">
          Design state
          <select value={state} onChange={(event) => {
            const design = checkoutDesignStates.find(({ key }) => key === event.target.value);
            if (!design) return;
            setState(design.key);
            setOrderId(design.orderId);
            setReceiptId(null);
          }}>
            {checkoutDesignStates.map(({ key }) => <option key={key} value={key}>{key}</option>)}
          </select>
          <span className="text-muted-foreground">Read only · use local checkout for interactions</span>
        </label>
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
