"use client";

import { InlineErrorBoundary } from "./ErrorBoundary";
import { CheckoutBackendProvider } from "./backend";
import { CheckoutStaffControls } from "./ApprovalsPanel";
import { convexCheckoutBackend } from "./convex-backend";

/** The admin header's checkout controls (Cashier badge, approvals), on the live Convex backend. */
export function CheckoutHeaderStaff() {
  return (
    <InlineErrorBoundary message="Approvals didn’t load.">
      <CheckoutBackendProvider backend={convexCheckoutBackend}>
        <CheckoutStaffControls />
      </CheckoutBackendProvider>
    </InlineErrorBoundary>
  );
}
