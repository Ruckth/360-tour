"use client";

import { InlineErrorBoundary } from "./ErrorBoundary";
import { CheckoutBackendProvider, type CheckoutBackend } from "./backend";
import { CheckoutStaffControls } from "./ApprovalsPanel";
import { convexCheckoutBackend } from "./convex-backend";

/** The admin header's staff controls (Cashier badge, Approvals), on the live Convex backend by default. */
export function CheckoutHeaderStaff({ backend = convexCheckoutBackend }: { backend?: CheckoutBackend }) {
  return (
    <InlineErrorBoundary message="Approvals didn’t load.">
      <CheckoutBackendProvider backend={backend}>
        <CheckoutStaffControls />
      </CheckoutBackendProvider>
    </InlineErrorBoundary>
  );
}
