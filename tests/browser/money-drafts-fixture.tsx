// Real money dialogs on local records; no backend connection or writes.
import { useState, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { BookingFinancials } from "@/components/admin/BookingFinancials";
import { AppointmentMoneyDialog } from "@/components/admin/AppointmentFinancials";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { registerFixtureFunctions } from "./convex-mock";
import en from "../../messages/en.json";
import "@/app.css";

type Booking = NonNullable<FunctionReturnType<typeof api.bookings.admin.getForAdmin>>;
type Financials = NonNullable<FunctionReturnType<typeof api.bookings.admin.bookingFinancials>>;
const scenario = new URLSearchParams(location.search).get("scenario") ?? "stay-pay";
const now = Date.parse("2026-11-12T10:00:00+07:00");
const money = { total: 1700000, currency: "THB", gross: 2550000, refunded: 0, net: 2550000, owed: 0, credit: 850000, refundable: 850000, refundContext: "credit", legacyRefund: false };
const booking = {
  _id: "booking1", propertyId: "property1", guestName: "Mia", guestEmail: "mia@example.com", guestPhone: "+66 81",
  checkIn: "2026-11-10", checkOut: "2026-11-12", guests: 2, nights: 2, subtotal: 2000000, discountAmount: 300000,
  total: 1700000, currency: "THB", status: "completed", paymentStatus: "paid", source: "admin", revision: 7,
  propertyStatus: "active", hasStripePayment: false, checkoutLive: false, confirmationEmailed: false, notifyByDefault: false,
  money: scenario === "stay-pay" ? { ...money, owed: 400000, net: 1300000, credit: 0, refundable: 0 } : money,
} as unknown as Booking;
const payment = {
  _id: "payment1", origin: "manual", amount: 2550000, currency: "THB", method: "cash", effectiveAt: now - 86400000,
  recordedAt: now, recordedBy: "desk@example.com", refunded: 0, refundable: 2550000, status: "recorded", order: null,
  amendBlocker: null, cancelBlocker: null, note: "Desk receipt",
};
const financials = {
  revision: 7, money: booking.money, payments: scenario === "stay-legacy" ? [] : [payment],
  refunds: scenario === "stay-stripe" ? [{ _id: "refund1", amount: 50000, currency: "THB", method: "stripe", reason: "Returned online", effectiveAt: now, recordedBy: "desk@example.com", order: null }] : [],
  legacyOrders: [], unitemised: scenario === "stay-legacy" ? 25500 : 0,
  legacyManual: { cancellable: scenario === "stay-legacy", amount: 2550000 }, hasStripePayment: false, complete: true,
} as unknown as Financials;
registerFixtureFunctions({ queries: { "bookings/admin:bookingFinancials": () => financials } });
const appointment = { _id: "appointment1", price: 120000, currency: "THB", status: "completed", paymentStatus: "paid", revision: 4 } as Doc<"appointments">;
const appointmentPayment = { ...payment, amount: 120000 } as unknown as Doc<"appointmentPayments">;
const kind = scenario.replace("appointment-", "") as "pay" | "refund" | "amend" | "cancel" | "legacyCancel";
const dialog: ComponentProps<typeof AppointmentMoneyDialog>["dialog"] = kind === "refund" ? { kind, paymentId: appointmentPayment._id, max: 1000 }
  : kind === "amend" || kind === "cancel" ? { kind, payment: appointmentPayment }: { kind: "pay" };
function Fixture() {
  const [open, setOpen] = useState(true);
  return <NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Bangkok">
    <TooltipProvider><ConfirmProvider><main data-fixture-ready className="mx-auto grid max-w-xl gap-4 p-6">
      <h1 className="text-xl">{scenario.startsWith("stay") ? "Stay" : "Appointment"} payment record</h1>
      {scenario.startsWith("stay") ? <BookingFinancials booking={booking} /> : open ? <AppointmentMoneyDialog appointment={appointment} revision={4} dialog={dialog} onClose={() => setOpen(false)} /> : <p role="status">Saved or closed</p>}
    </main></ConfirmProvider></TooltipProvider>
  </NextIntlClientProvider>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
