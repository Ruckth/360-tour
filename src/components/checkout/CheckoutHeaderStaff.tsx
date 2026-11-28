"use client";

import { useRef } from "react";
import { useOpenHoldLabel } from "@/components/stock/open-hold-count";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { InlineErrorBoundary } from "./ErrorBoundary";
import { CheckoutBackendProvider, type CheckoutBackend } from "./backend";
import { CheckoutStaffControls } from "./ApprovalsPanel";
import { convexCheckoutBackend } from "./convex-backend";

function unavailable(retry: () => void) {
  return (
    <Popover>
      <span role="status" className="sr-only">Approvals are unavailable.</span>
      <PopoverTrigger asChild>
        <Button variant="ghost" aria-label="Approvals unavailable" data-approvals="" className="shrink-0">
          <ShieldAlert aria-hidden className="size-4 text-gold-text" /> Approvals
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" aria-label="Approvals unavailable" data-approvals="">
        <p className="text-sm">The approval queue could not be loaded.</p>
        <Button type="button" size="sm" className="mt-2" onClick={retry}>Try again</Button>
      </PopoverContent>
    </Popover>
  );
}

/** The admin header's staff controls (Cashier badge, Approvals), on the live Convex backend by default. */
export function CheckoutHeaderStaff({ backend = convexCheckoutBackend }: { backend?: CheckoutBackend }) {
  const holds = useOpenHoldLabel();
  const header = useRef<HTMLSpanElement>(null);
  function retryFromHeader(retry: () => void) {
    retry();
    requestAnimationFrame(() => header.current?.querySelector<HTMLButtonElement>("[data-approvals]")?.focus());
  }
  return (
    <span className="contents" ref={header}>
      <InlineErrorBoundary message="Approvals didn’t load." renderFallback={retry => unavailable(() => retryFromHeader(retry))}>
        <CheckoutBackendProvider backend={backend}>
          <CheckoutStaffControls heldGoods={holds} />
        </CheckoutBackendProvider>
      </InlineErrorBoundary>
    </span>
  );
}
