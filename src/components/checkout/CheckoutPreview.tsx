"use client";

import { useMemo, useState } from "react";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/button";
import commerceEn from "../../../messages/commerce/en.json";
import { CheckoutStaffControls, type TargetApprovalReader } from "./ApprovalsPanel";
import { CheckoutBackendProvider, type CheckoutBackend, type OrderId } from "./backend";
import { CheckoutView } from "./CheckoutView";
import { CommerceMessages } from "./commerce-messages";
import { COMMERCE_RECEIPT_ID, commerceReceipt } from "./design/commerce-receipt";
import { previewApprovals, previewTargetApprovals } from "./design/commerce-approvals";
import { checkoutDesignStates, commerceDesignStates, createFixtureBackend, type CheckoutDesignState, type CommerceDesignState } from "./fixture-backend";
import { ReceiptView } from "./ReceiptView";

/**
 * Dev-only: the real checkout and receipt on canned view states, no sign-in or Convex needed.
 * `embedded` drops the preview banner so it can sit in the admin shell like the real page.
 * Commerce picks one of the plan's commerce states (every switch Off in the dark state, as production
 * ships); without one the backend has no commerce, exactly as today's checkout.
 */
export function CheckoutPreview({ embedded = false }: { embedded?: boolean }) {
  const [state, setState] = useState<CheckoutDesignState>("empty");
  const [commerce, setCommerce] = useState<CommerceDesignState | null>(null);
  const backend = useMemo(() => previewBackend(state, commerce), [state, commerce]);
  const [orderId, setOrderId] = useState<OrderId | null>(null);
  const [receiptId, setReceiptId] = useState<OrderId | null>(null);

  return (
    // ReceiptView guards refund drafts with a confirm dialog, so the standalone preview needs the provider too.
    <CommerceMessages messages={commerceEn}>
    <ConfirmProvider>
    <CheckoutBackendProvider backend={backend}>
      {/* Checkout and receipt follow the app's light or dark theme, as under the admin shell. */}
      <div className={embedded ? "flex min-h-0 flex-1 flex-col" : "flex h-dvh flex-col bg-background text-foreground"}>
        {embedded ? null : (
          <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-4 text-sm print:hidden">
            <span className="rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Preview · sample data</span>
            <span className="font-semibold">{receiptId ? "Receipt" : "Checkout"}</span>
          </header>
        )}
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-4 py-2 text-sm print:hidden">
          <label className="flex items-center gap-2">
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
          </label>
          <label className="flex items-center gap-2">
            Commerce
            <select data-testid="commerce-state" value={commerce ?? ""} onChange={(event) => {
              const next = commerceDesignStates.find((key) => key === event.target.value) ?? null;
              setCommerce(next);
              if (!next && receiptId === COMMERCE_RECEIPT_ID) setReceiptId(null);
            }}>
              <option value="">none (today)</option>
              {commerceDesignStates.map((key) => <option key={key} value={key}>{key}</option>)}
            </select>
          </label>
          {commerce ? (
            <>
              <Button type="button" variant="outline" size="sm" className="h-11" onClick={() => setReceiptId(COMMERCE_RECEIPT_ID)}>Commerce receipt</Button>
              <CheckoutStaffControls />
            </>
          ) : null}
          <span className="text-muted-foreground">Read only · use local checkout for interactions</span>
        </div>
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
    </ConfirmProvider>
    </CommerceMessages>
  );
}

/**
 * The fixture backend, plus (with a commerce state) the commerce receipt and approvals of both
 * shapes, until W1·L1 and W1·L3's readers land in the fixture itself.
 */
export function previewBackend(state: CheckoutDesignState, commerce: CommerceDesignState | null): CheckoutBackend {
  const base = createFixtureBackend(state, commerce ?? undefined);
  if (!commerce || !base.commerce) return base;
  const reader: TargetApprovalReader = { useTargetApprovals: () => previewTargetApprovals };
  return {
    ...base,
    useOrder: (id, view) => (id === COMMERCE_RECEIPT_ID ? commerceReceipt : base.useOrder(id, view)),
    usePendingApprovals: () => previewApprovals,
    commerce: { ...base.commerce, ...reader },
  };
}
