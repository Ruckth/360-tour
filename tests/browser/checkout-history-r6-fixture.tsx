import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { CheckoutBackendProvider, type FinancialRows, type OrderId } from "@/components/checkout/backend";
import { createFixtureBackend } from "@/components/checkout/fixture-backend";
import { ReceiptView } from "@/components/checkout/ReceiptView";
import type { Id } from "convex/_generated/dataModel";
import en from "../../messages/en.json";
import "@/app.css";

// Populated, local-only ledger evidence: missing source and customer lookups.
const orderId = "fxbill000002" as OrderId;
const now = Date.parse("2026-11-15T03:00:00Z");
const stay: FinancialRows["bookingRefunds"] = {
  _id: "r6-stay-return" as Id<"bookingRefunds">, billId: orderId, bookingId: "fxbkg000001" as Id<"bookings">,
  amount: 50, currency: "THB", method: "transfer", reason: "One night cut short", effectiveAt: now,
  recordedAt: now, recordedBy: "ploy@auraliscove.co", netBefore: 780, netAfter: 730, providerRefundId: "internal-provider-reference",
};
const appointment: FinancialRows["appointmentRefunds"] = {
  _id: "r6-appointment-return" as Id<"appointmentRefunds">, _creationTime: now, billId: orderId,
  appointmentId: "internal-appointment-reference" as Id<"serviceAppointments">,
  amount: 20, currency: "THB", method: "cash", reason: "Service cut short", effectiveAt: now,
  recordedAt: now, recordedBy: "ploy@auraliscove.co", idempotencyKey: "r6-ledger-appointment", netBefore: 100, netAfter: 80,
};
const audit: FinancialRows["audit"] = {
  _id: "r6-customer-activity" as Id<"billAudit">, _creationTime: now, billId: orderId, at: now,
  kind: "customer_linked", actor: "ploy@auraliscove.co", note: "Customer selected", customerId: "internal-customer-reference" as Id<"customers">,
};
const backend = createFixtureBackend({ financialHistory: { bookingRefunds: [stay], appointmentRefunds: [appointment], audit: [audit] } });
await backend.useActions().settleOrder({ orderId, idempotencyKey: "r6-ledger-paid", expectedDue: 780, expectedRevision: 2, expectedCustomerRevision: 0, tenders: [{ method: "card", amount: 780 }] });
createRoot(document.getElementById("root")!).render(
  <NextIntlClientProvider locale="en" timeZone="Asia/Bangkok" messages={en}>
    <ConfirmProvider><CheckoutBackendProvider backend={backend}>
      <div className="min-h-dvh bg-background text-foreground" data-fixture-ready="">
        <ReceiptView orderId={orderId} onNewSale={() => {}} onOpenOrder={() => {}} />
      </div>
    </CheckoutBackendProvider></ConfirmProvider>
  </NextIntlClientProvider>,
);
