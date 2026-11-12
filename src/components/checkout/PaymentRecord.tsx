"use client";

import { parseMoneyInput } from '@/lib/money-input';

import { satangToBaht } from 'convex/shared/money';

import { ChevronRight } from "lucide-react";
import { useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { TENDER_METHODS, type TenderMethod } from "convex/lib/orderMath";
import {
  newAttemptKey,
  useCheckoutBackend,
  type CheckoutActions,
  type Customer,
  type OrderView,
} from "./backend";
import { amountInput, correctionTitle, TENDER_LABELS } from "./checkout-ui";
import { useSendApproval } from "./ApprovalRequest";
import { needsApproval } from "./staff-approvals";
import { checkoutErrorText, hasLineRefunds } from "./refunds";

import { historyTime } from "./OrderHistory";
import { paymentDateInput, paymentDateValue } from "./payment-time";
import { FinancialHistory } from "./FinancialHistory";
import { InlineErrorBoundary } from "./ErrorBoundary";


/** "Thai massage → SVC-123 · ฿1,200": which row a link correction applied, to what, and how much. */
function linkSummary(view: OrderView, change: OrderView["corrections"][number]) {
  const row = view.lines.find((line) => line._id === change.lineId)?.name ?? "A row";
  const link = view.links.find((item) => item._id === change.linkId);
  return `${row} → ${link?.target.reference ?? "its booking"}${change.amount !== undefined ? ` · ${formatMoney(change.amount)}` : ""}`;
}
/** Operational recording is deliberately outside .pos-receipt: printing/sharing stays original. */
export function PaymentRecord({ view }: { view: OrderView }) {
  const [editing, setEditing] = useState<"amend" | "unreceived" | null>(null);
  const { paymentRecord: record } = view;
  return (
    <section
      aria-label="Payment recording"
      className="grid w-full max-w-md gap-3 print:hidden"
    >
      <h2 className="font-semibold">Current payment recording</h2>
      <p className="text-xs text-muted-foreground">
        The issued receipt never changes. Corrections here update what was
        recorded; they do not move money.
      </p>
      <p className="text-sm">
        Money received:{" "}
        {record.effectiveAt === null
          ? "Unknown"
          : `${historyTime(record.effectiveAt)} · Bangkok`}
      </p>
      <p className="text-sm">
        Recorded customer: {record.customer?.name ?? "No named customer"}
        {record.customerAmended ? " · amended" : ""}
      </p>
      <ul className="text-sm">
        {record.tenders.map((tender, i) => (
          <li key={i}>
            {TENDER_LABELS[tender.method].long} · {formatMoney(tender.amount)}
            {tender.received !== undefined
              ? ` · cash handed over ${formatMoney(tender.received)}`
              : ""}
            {record.tendersAmended ? " · amended" : ""}
          </li>
        ))}
      </ul>
      {record.voidUnreceived ? (
        <p className="text-sm">
          Voided as a mistaken entry: no money was received. No refund was sent.
        </p>
      ) : null}
      {view.order.status === "paid" && !editing ? (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setEditing("amend")}>
            Correct payment recording
          </Button>
          {/* Refused after a line refund: money was received. */}
          {hasLineRefunds(view) ? null : (
            <Button variant="ghost" onClick={() => setEditing("unreceived")}>
              No money was received…
            </Button>
          )}
        </div>
      ) : null}
      {editing ? (
        <PaymentEditor
          key={`${view.order._id}:${editing}`}
          view={view}
          mode={editing}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {view.refunds.length ? (
        <section aria-label="Recorded refunds" className="grid gap-2">
          <h3 className="font-semibold">Refunds recorded on linked stays and appointments</h3>
          <p className="text-xs text-muted-foreground">
            Recent entries record money returned separately. Browse all financial history below for complete paginated records and per-source balances. This screen does not
            send refunds.
          </p>
          <ul className="grid gap-3">
            {view.refunds.map((refund) => (
              <li key={refund._id} className="text-sm">
                <p>
                  Recorded · {formatMoney(refund.amount, refund.currency)} ·{" "}
                  {refund.method}
                </p>
                <p>{refund.reason}</p>
                <p className="text-xs text-muted-foreground">
                  Effective {historyTime(refund.effectiveAt)} · Recorded{" "}
                  {historyTime(refund.recordedAt)} by {refund.recordedBy}
                </p>
                <p className="text-xs text-muted-foreground">
                  <RefundSource refund={refund} sources={view.sources} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <section aria-label="Payment amendments" className="grid gap-2">
        <h3 className="font-semibold">Payment amendments</h3>
        {!view.corrections.length ? (
          <p className="text-sm text-muted-foreground">
            No payment amendments recorded.
          </p>
        ) : null}
        <ol className="grid gap-3">
          {view.corrections.map((change) => (
            <li
              key={change._id}
              className="grid gap-1 border-b border-border pb-3 text-sm"
            >
              <p className="font-medium">
                {correctionTitle(change.kind)} · #{change.sequence}
              </p>
              {change.kind === "linked" || change.kind === "unlinked" ? (
                <p>
                  {linkSummary(view, change)}
                </p>
              ) : null}
              <p>{change.reason}</p>
              <p className="text-xs text-muted-foreground">
                Recorded {historyTime(change.recordedAt)} by {change.actor}
              </p>
              {change.tendersBefore ? (
                <p>
                  Before:{" "}
                  {change.tendersBefore
                    .map(
                      (t) =>
                        `${TENDER_LABELS[t.method].short} ${formatMoney(t.amount)}`,
                    )
                    .join(" + ")}
                </p>
              ) : null}
              {change.tendersAfter ? (
                <p>
                  After:{" "}
                  {change.tendersAfter
                    .map(
                      (t) =>
                        `${TENDER_LABELS[t.method].short} ${formatMoney(t.amount)}`,
                    )
                    .join(" + ")}
                </p>
              ) : null}
              {change.effectiveAtBefore !== undefined ? (
                <p>
                  Received date: {historyTime(change.effectiveAtBefore)} →{" "}
                  {historyTime(change.effectiveAtAfter!)}
                </p>
              ) : null}
              {change.customerBefore !== undefined ||
              change.customerAfter !== undefined ? (
                <p>
                  Customer: {change.customerBefore?.name ?? "No named customer"}{" "}
                  → {change.customerAfter?.name ?? "No named customer"}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
        {/* getOrder returns the latest 20. Refunds also advance correctionRevision, so it can't count amendments. */}
        {view.corrections.length >= 20 && record.correctionRevision > view.corrections.length ? (
          <p className="text-xs text-muted-foreground">
            Showing the latest {view.corrections.length} amendments. Earlier
            amendments are available in Browse all financial history below.
          </p>
        ) : null}
      </section>
      {view.audit.length ? (
        <details className="group/details border-t border-border text-sm">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded py-2 font-semibold hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open/details:rotate-90" />
            Receipt activity
          </summary>
          <ul className="grid gap-3">
            {view.audit.map((entry) => (
              <li key={entry._id} className="text-xs">
                <p className="capitalize">
                  {entry.kind.replaceAll("_", " ")}
                  {entry.fromPrice !== undefined
                    ? ` · ${formatMoney(entry.fromPrice)} → ${formatMoney(entry.toPrice ?? 0)}`
                    : ""}
                </p>
                <p>{entry.note}</p>
                <p className="text-muted-foreground">
                  {historyTime(entry.at)} · {entry.actor}
                </p>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            Latest {view.audit.length} receipt activity entries; item changes
            are in Order history.
          </p>
        </details>
      ) : null}
      <FinancialHistory orderId={view.order._id} view={view} />
    </section>
  );
}

function RefundSource({ refund, sources }: { refund: { sourceType?: "booking" | "appointment"; bookingId?: string; appointmentId?: string }; sources: OrderView["sources"] }) {
  const appointment = refund.sourceType === "appointment" || Boolean(refund.appointmentId);
  const id = appointment ? refund.appointmentId : refund.bookingId;
  return <>{appointment ? "Appointment: " : "Stay: "}{sources.find(source => source.id === id)?.reference ?? id ?? "Unknown source"}</>;
}

function PaymentEditor({
  view,
  mode,
  onClose,
}: {
  view: OrderView;
  mode: "amend" | "unreceived";
  onClose: () => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const access = useStaffAccess();
  const send = useSendApproval();
  // A cashier whose rules keep payment fixes for managers sends this as a request instead.
  const [refused, setRefused] = useState(false);
  const ask = access.role === "cashier" && (refused || access.cashierRules.paymentFix === "manager");
  const [reviewedRecord] = useState(view.paymentRecord);
  const [revision] = useState(view.paymentRecord.correctionRevision);
  const [date, setDate] = useState(() =>
    paymentDateInput(view.paymentRecord.effectiveAt ?? Date.now()),
  );
  const [tenders, setTenders] = useState(() =>
    view.paymentRecord.tenders.map((t) => ({
      ...t,
      amountInput: String(satangToBaht(t.amount)),
      receivedInput: t.received === undefined ? "" : String(satangToBaht(t.received)),
    })),
  );
  const [payer, setPayer] = useState<Customer | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [asserted, setAsserted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const attempt = useRef<
    Parameters<CheckoutActions["amendOrderPayment"]>[0] | null
  >(null);
  const lock = useRef(false);
  async function submit() {
    if (lock.current) return;
    if (!attempt.current) {
      const effectiveAt = paymentDateValue(date);
      if (
        mode === "amend" &&
        (effectiveAt === null || effectiveAt > Date.now())
      ) {
        setError("Enter a received date no later than now, in Bangkok time.");
        return;
      }
      if (!reason.trim() || (mode === "unreceived" && !asserted)) return;
      attempt.current = {
        orderId: view.order._id,
        idempotencyKey: newAttemptKey(),
        expectedCorrectionRevision: revision,
        reason,
        ...(mode === "amend"
          ? {
              effectiveAt:
                date ===
                paymentDateInput(reviewedRecord.effectiveAt ?? Date.now())
                  ? (reviewedRecord.effectiveAt ?? effectiveAt!)
                  : effectiveAt!,
              ...(tenders.length
                ? {
                    tenders: tenders.map((t) => ({
                      method: t.method,
                      amount: parseMoneyInput(t.amountInput),
                      ...(t.method === "cash" && t.receivedInput
                        ? { received: parseMoneyInput(t.receivedInput) }
                        : {}),
                    })),
                  }
                : {}),
              ...(payer !== undefined
                ? {
                    customer: {
                      customerId: payer?._id ?? null,
                      expectedCustomerRevision: payer?.revision,
                    },
                  }
                : {}),
            }
          : {}),
      };
      if (!ask) setAttempted(true);
    }
    lock.current = true;
    setSaving(true);
    setError("");
    if (ask) {
      // The request carries the exact change; the server adds the revision and attempt key.
      const { effectiveAt, tenders: corrected, customer } = attempt.current;
      attempt.current = null;
      const failed = await send(
        view.order._id,
        mode === "amend"
          ? { kind: "paymentFix", action: "amendOrderPayment", ...(effectiveAt !== undefined ? { effectiveAt } : {}), ...(corrected ? { tenders: corrected } : {}), ...(customer ? { customer } : {}) }
          : { kind: "paymentFix", action: "voidUnreceivedOrder" },
        reason.trim(),
      );
      lock.current = false;
      setSaving(false);
      if (failed) setError(failed);
      else onClose();
      return;
    }
    try {
      if (mode === "amend") await actions.amendOrderPayment(attempt.current);
      else {
        const { orderId, idempotencyKey, expectedCorrectionRevision, reason } =
          attempt.current;
        await actions.voidUnreceivedOrder({
          orderId,
          idempotencyKey,
          expectedCorrectionRevision,
          reason,
        });
      }
      onClose();
    } catch (err) {
      if (access.role === "cashier" && needsApproval(err)) {
        // Nothing was written; the same form becomes a request.
        attempt.current = null;
        setAttempted(false);
        setRefused(true);
        setError("This needs a manager. Send it as a request.");
        return;
      }
      setError(
        checkoutErrorText(
          err,
          "Couldn't save the correction. Retry this attempt or close and review the latest recording.",
        ),
      );
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }
  return (
    <form
      aria-label={
        mode === "amend"
          ? "Correct payment recording"
          : "Mistaken payment entry"
      }
      className="grid gap-3 rounded-xl border border-border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <p className="text-sm">
        {mode === "amend"
          ? "Correct the recording of money already received. The issued receipt, original tenders and receipt number stay unchanged."
          : "Use only when no money was ever received and the payment was entered by mistake. This reopens supported linked balances. It does not send a refund or reverse a provider payment."}
      </p>
      <fieldset disabled={saving || attempted} className="grid gap-3">
        {mode === "amend" ? (
          <>
            <Label htmlFor="correction-effective">
              Money received at · Bangkok time
            </Label>
            <Input
              id="correction-effective"
              type="datetime-local"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            {tenders.map((t, index) => (
              <div key={index} className="grid gap-2">
                <Label>Recorded payment {index + 1}</Label>
                <Select
                  value={t.method}
                  onValueChange={(method) =>
                    setTenders((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, method: method as TenderMethod }
                          : row,
                      ),
                    )
                  }
                >
                  <SelectTrigger
                    aria-label={`Corrected payment ${index + 1} method`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TENDER_METHODS.map((method) => (
                      <SelectItem key={method} value={method}>
                        {TENDER_LABELS[method].long}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  aria-label={`Corrected payment ${index + 1} amount`}
                  inputMode="decimal"
                  value={t.amountInput}
                  onChange={(e) =>
                    setTenders((rows) =>
                      rows.map((row, i) =>
                        i === index
                          ? { ...row, amountInput: amountInput(e.target.value) }
                          : row,
                      ),
                    )
                  }
                />
                {t.method === "cash" ? (
                  <Input
                    aria-label={`Corrected payment ${index + 1} cash received`}
                    placeholder="Cash handed over (optional)"
                    inputMode="decimal"
                    value={t.receivedInput}
                    onChange={(e) =>
                      setTenders((rows) =>
                        rows.map((row, i) =>
                          i === index
                            ? {
                                ...row,
                                receivedInput: amountInput(e.target.value),
                              }
                            : row,
                        ),
                      )
                    }
                  />
                ) : null}
                {tenders.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() =>
                      setTenders((rows) => rows.filter((_, i) => i !== index))
                    }
                  >
                    Remove recorded payment {index + 1}
                  </Button>
                ) : null}
              </div>
            ))}
            {tenders.length > 0 && tenders.length < 3 ? (
              <Button
                type="button"
                variant="outline"
                onClick={() =>
                  setTenders((rows) => [
                    ...rows,
                    {
                      method: "card",
                      amount: 0,
                      amountInput: "",
                      receivedInput: "",
                    },
                  ])
                }
              >
                Add recorded payment
              </Button>
            ) : null}
            <InlineErrorBoundary message="Couldn't load customer choices. Retry before selecting the payer.">
              <PayerChoice selected={payer} onSelect={setPayer} />
            </InlineErrorBoundary>
          </>
        ) : (
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              className="mt-1"
              type="checkbox"
              checked={asserted}
              onChange={(e) => setAsserted(e.target.checked)}
            />
            I confirm no money was received; this is a mistaken payment entry.
          </label>
        )}
        <Label htmlFor="payment-correction-reason">Reason for correction</Label>
        <Textarea
          id="payment-correction-reason"
          required
          maxLength={500}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </fieldset>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {attempted && !saving ? (
        <p className="text-xs text-muted-foreground">
          Retry preserves this attempt’s original inputs and reviewed revisions.
          To change them, close and review again.
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving}
          onClick={onClose}
        >
          Close correction
        </Button>
        <Button
          type="submit"
          disabled={
            saving ||
            (!attempted &&
              (!reason.trim() || (mode === "unreceived" && !asserted)))
          }
        >
          {saving ? <Spinner /> : null}
          {ask
            ? "Send request"
            : attempted
            ? "Retry correction"
            : mode === "amend"
              ? "Save recording correction"
              : "Void mistaken entry"}
        </Button>
      </div>
    </form>
  );
}
function PayerChoice({
  selected,
  onSelect,
}: {
  selected: Customer | null | undefined;
  onSelect: (customer: Customer | null | undefined) => void;
}) {
  const [query, setQuery] = useState("");
  const page = useCheckoutBackend().useCustomerPage(query, false);
  return (
    <div className="grid gap-2">
      <Label htmlFor="corrected-payer">Correct customer</Label>
      <p className="text-xs text-muted-foreground">
        {selected === undefined
          ? "Keep the current recorded customer"
          : selected === null
            ? "Remove the named customer"
            : `Reviewed: ${selected.name} · ${selected.phone || selected.email || "No contact details"}`}
      </p>
      <Input
        id="corrected-payer"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Find by name, phone or email"
      />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onSelect(undefined)}
        >
          Keep current customer
        </Button>
        <Button type="button" variant="outline" onClick={() => onSelect(null)}>
          No named customer
        </Button>
      </div>
      {query.trim().length >= 2 ? (
        <>
          <ul className="grid max-h-40 gap-1 overflow-y-auto">
            {page.results
              .filter((c) => !c.archivedAt && !c.mergedInto)
              .map((c) => (
                <li key={c._id}>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-auto min-h-11 w-full justify-start whitespace-normal text-left"
                    onClick={() => onSelect(c)}
                  >
                    {c.name} · {c.phone || c.email || "No contact details"}
                  </Button>
                </li>
              ))}
          </ul>
          {page.status === "LoadingFirstPage" ? (
            <Spinner label="Finding customers" />
          ) : null}
          {!page.results.length && page.status === "Exhausted" ? (
            <p className="text-xs">No matching customers.</p>
          ) : null}
          {page.status === "CanLoadMore" || page.status === "LoadingMore" ? (
            <Button
              type="button"
              variant="outline"
              disabled={page.status === "LoadingMore"}
              onClick={() => page.loadMore(20)}
            >
              Load more customers
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
