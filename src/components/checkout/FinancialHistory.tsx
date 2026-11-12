"use client";

import { roundMoney } from "convex/lib/orderMath";
import type { ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useCheckoutBackend, type CustomerPage, type FinancialRows, type OrderId, type OrderView } from "./backend";
import { InlineErrorBoundary } from "./ErrorBoundary";
import { historyTime } from "./OrderHistory";
import { TENDER_LABELS, correctionTitle } from "./checkout-ui";
import { HistoryDetails } from "./HistoryDetails";
import { refundMethodName, satangMoney } from "./refunds";

/** These are separate ledgers with independent native cursors, never a merged/capped array. */
export function FinancialHistory({ orderId, view }: { orderId: OrderId; view?: OrderView }) {
  return <HistoryDetails orderId={orderId} title="Browse all financial history">
    <p className="mb-3 text-xs text-muted-foreground">Original receipt stays as issued. Each ledger pages independently. All times are Bangkok time. Refunds record money returned separately; this screen does not send refunds.</p>
    <div className="grid gap-5">
      <Ledger title="All payment amendments"><Corrections orderId={orderId} /></Ledger>
      <Ledger title="All receipt activity"><Audit orderId={orderId} /></Ledger>
      <Ledger title="All stay refunds"><BookingRefunds orderId={orderId} view={view} /></Ledger>
      <Ledger title="All appointment refunds"><AppointmentRefunds orderId={orderId} view={view} /></Ledger>
      <Ledger title="All line refunds"><LineRefunds orderId={orderId} view={view} /></Ledger>
    </div>
  </HistoryDetails>;
}
function Ledger({ title, children }: { title: string; children: ReactNode }) {
  return <section aria-label={title} className="grid gap-2"><h3 className="font-semibold">{title}</h3><InlineErrorBoundary message={`Couldn't load ${title.toLowerCase()}. Try again.`}>{children}</InlineErrorBoundary></section>;
}
function Page<T extends { _id: string }>({ page, label, render }: { page: CustomerPage<T>; label: string; render: (row: T) => ReactNode }) {
  return <>
    {page.status === "LoadingFirstPage" ? <Spinner label={`Loading ${label}`} /> : null}
    {!page.results.length && page.status === "Exhausted" ? <p className="text-xs text-muted-foreground">No entries recorded.</p> : null}
    <ol className="grid gap-3">{page.results.map(row => <li key={row._id} className="grid gap-1 border-b border-border pb-3 text-xs [overflow-wrap:anywhere]">{render(row)}</li>)}</ol>
    {page.status === "CanLoadMore" || page.status === "LoadingMore" ? <Button variant="outline" disabled={page.status === "LoadingMore"} onClick={() => page.loadMore(20)}>{page.status === "LoadingMore" ? "Loading older entries…" : `Load older ${label}`}</Button> : null}
  </>;
}
function Corrections({ orderId }: { orderId: OrderId }) {
  const page = useCheckoutBackend().useCorrectionHistory(orderId);
  return <Page page={page} label="payment amendments" render={r => <>
    <p className="font-medium">{correctionTitle(r.kind)} · #{r.sequence}</p>{r.amount !== undefined ? <p>Applied {formatMoney(r.amount)}</p> : null}<p>{r.reason}</p><p>Recorded {historyTime(r.recordedAt)} by {r.actor}</p>
    {r.tendersBefore ? <p>Before: {r.tendersBefore.map(t => `${TENDER_LABELS[t.method].short} ${formatMoney(t.amount)}${t.received !== undefined ? ` (handed over ${formatMoney(t.received)})` : ""}`).join(" + ")}</p> : null}
    {r.tendersAfter ? <p>After: {r.tendersAfter.map(t => `${TENDER_LABELS[t.method].short} ${formatMoney(t.amount)}${t.received !== undefined ? ` (handed over ${formatMoney(t.received)})` : ""}`).join(" + ")}</p> : null}
    {r.effectiveAtBefore !== undefined ? <p>Received date: {historyTime(r.effectiveAtBefore)} → {r.effectiveAtAfter !== undefined ? historyTime(r.effectiveAtAfter) : "Unknown"}</p> : null}
    {r.customerBefore !== undefined || r.customerAfter !== undefined ? <><p>Customer before: {r.customerBefore?.name ?? "No named customer"} · {r.customerBefore?.phone} · {r.customerBefore?.email}</p><p>Customer after: {r.customerAfter?.name ?? "No named customer"} · {r.customerAfter?.phone} · {r.customerAfter?.email}</p></> : null}
  </>} />;
}
function Audit({ orderId }: { orderId: OrderId }) {
  const page = useCheckoutBackend().useAuditHistory(orderId);
  return <Page page={page} label="receipt activity" render={r => <><p className="font-medium capitalize">{r.kind.replaceAll("_", " ")}</p><p>{r.note}</p>{r.fromPrice !== undefined ? <p>Before: {formatMoney(r.fromPrice)}</p> : null}{r.toPrice !== undefined ? <p>After: {formatMoney(r.toPrice)}</p> : null}{r.customerId ? <p>Customer reference: {r.customerId}</p> : null}<p>Recorded {historyTime(r.at)} by {r.actor}</p></>} />;
}
function Refund({ row }: { row: FinancialRows["bookingRefunds"] | FinancialRows["appointmentRefunds"] }) {
  return <><p className="font-medium">Recorded · {formatMoney(row.amount, row.currency)} · {row.method}</p><p>{row.reason}</p><p>Effective {historyTime(row.effectiveAt)} · Recorded {historyTime(row.recordedAt)} by {row.recordedBy}</p><p>{"bookingId" in row ? `Stay: ${row.bookingId}` : `Appointment: ${row.appointmentId}`}</p>{row.netBefore !== undefined && row.netAfter !== undefined ? <p>Net balance after this return: {formatMoney(row.netBefore, row.currency)} → {formatMoney(row.netAfter, row.currency)}</p> : null}{"providerRefundId" in row && row.providerRefundId ? <p>Provider refund: {row.providerRefundId}</p> : null}</>;
}
function BookingRefunds({ orderId, view }: { orderId: OrderId; view?: OrderView }) {
  const page = useCheckoutBackend().useBookingRefundHistory(orderId);
  return <><RefundBalances view={view} rows={page.results} complete={page.status === "Exhausted"} kind="booking" /><Page page={page} label="stay refunds" render={row => <Refund row={row} />} /></>;
}
function AppointmentRefunds({ orderId, view }: { orderId: OrderId; view?: OrderView }) {
  const page = useCheckoutBackend().useAppointmentRefundHistory(orderId);
  return <><RefundBalances view={view} rows={page.results} complete={page.status === "Exhausted"} kind="appointment" /><Page page={page} label="appointment refunds" render={row => <Refund row={row} />} /></>;
}

function RefundBalances({ view, rows, complete, kind }: { view?: OrderView; rows: Array<{ amount: number; currency: string; bookingId?: string; appointmentId?: string }>; complete: boolean; kind: "booking" | "appointment" }) {
  if (!view || !rows.length) return null;
  const groups = new Map<string, { amount: number; currency: string }>();
  for (const row of rows) {
    const id = kind === "booking" ? row.bookingId : row.appointmentId;
    if (id) groups.set(id, { amount: roundMoney((groups.get(id)?.amount ?? 0) + row.amount), currency: row.currency });
  }
  return <div className="grid gap-2 text-xs">{[...groups].map(([id, sum]) => {
    const lines = view.lines.filter(line => kind === "booking" ? line.bookingId === id : line.appointmentId === id);
    const gross = roundMoney(lines.reduce((n, line) => n + line.net - (line.deposit ?? 0), 0));
    const issued = view.order.state === "paid" || (view.order.state === "void" && !view.paymentRecord.voidUnreceived);
    return <p key={id}><span className="font-medium">{view.sources.find(s => s.id === id)?.reference ?? id}</span> · {complete ? "Refunded" : "Refunds shown"} {formatMoney(sum.amount, sum.currency)}{complete && issued && lines.length ? ` · Received on this receipt ${formatMoney(gross, sum.currency)} · Net retained ${formatMoney(roundMoney(gross - sum.amount), sum.currency)}` : ""}</p>;
  })}{!complete ? <p>Load older refunds to see complete per-source net balances.</p> : null}</div>;
}

/** POS line refunds (orderHistoryPages.orderRefunds): amounts in satang, dated by the Bangkok business day. */
function LineRefunds({ orderId, view }: { orderId: OrderId; view?: OrderView }) {
  const page = useCheckoutBackend().useOrderRefundHistory(orderId);
  return <Page page={page} label="line refunds" render={row => <>
    <p className="font-medium">Refunded · {satangMoney(row.amount, row.currency)} · {refundMethodName(row.method)}</p>
    <p>{view?.lines.find(line => line._id === row.lineId)?.name ?? "Receipt line"}</p>
    <p>{row.reason}</p>
    <p>Recorded {historyTime(row.createdAt)} by {row.createdByEmail}</p>
  </>} />;
}
