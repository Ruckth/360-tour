"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Disclosure } from "@/components/ui/disclosure";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REASON_CHIPS } from "@/components/ui/reason-chips";
import { ReasonField } from "@/components/ui/reason-field";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { TENDER_METHODS, formatReceiptNumber, round2, type TenderMethod } from "convex/lib/billMath";
import {
  newAttemptKey,
  useCheckoutBackend,
  type CheckoutActions,
  type Customer,
  type OrderView,
} from "./backend";
import { TOUCH_TARGETS, amountInput, TENDER_LABELS } from "./checkout-ui";
import { useSendApproval } from "./ApprovalRequest";
import { needsApproval } from "./staff-approvals";
import { answeredRefusal, checkoutErrorText } from "./refunds";
import { historyTime } from "./OrderHistory";
import { paymentDateInput, paymentDateValue } from "./payment-time";
import { InlineErrorBoundary } from "./ErrorBoundary";

/*
 * The payment as it stands now (History › Payments) and the two ways to fix a sale from the
 * receipt's ⋯: Correct payment and Void…. All of it sits outside .pos-receipt, so printing and
 * sharing stay original. Every write keeps its attempt key and the reviewed correction revision.
 */

/** The current payment record: when the money came in, its tenders and customer if corrected, and how many corrections (listed just below it). */
export function PaymentFacts({ view }: { view: OrderView }) {
  const { paymentRecord: record } = view;
  return (
    <section aria-label="Payment record" className="grid gap-2">
      <dl className="grid gap-1.5 text-sm [overflow-wrap:anywhere]">
        <Fact label={record.voidUnreceived ? "Entered as received" : "Money received"}>
          {record.effectiveAt === null ? "Unknown" : `${historyTime(record.effectiveAt)} · Bangkok`}
        </Fact>
        <Fact label="Payments">
          {record.tendersAmended ? (
            <ul>
              {record.tenders.map((tender, i) => (
                <li key={i}>
                  {TENDER_LABELS[tender.method].long} · {formatMoney(tender.amount)}
                  {tender.received !== undefined ? ` · cash handed over ${formatMoney(tender.received)}` : ""}
                  {" · corrected"}
                </li>
              ))}
            </ul>
          ) : (
            "As on the receipt"
          )}
        </Fact>
        {/* The receipt names the customer it was issued to; only a correction is worth repeating. */}
        {record.customerAmended ? <Fact label="Customer">{record.customer?.name ?? "No named customer"} · corrected</Fact> : null}
        <Fact label="Corrections">
          {/* Refunds also advance correctionRevision; count actual corrections, with a capped history labelled honestly. */}
          {!view.corrections.length ? "None" : view.corrections.length >= 20 ? "20 or more" : view.corrections.length}
        </Fact>
      </dl>
    </section>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0">{children}</dd>
    </div>
  );
}

/** Refunds recorded on the stays and appointments this receipt paid for: money returned there, not here. */
export function LinkedRefunds({ view, className }: { view: OrderView; className?: string }) {
  if (!view.refunds.length) return null;
  return (
    <div role="group" aria-label="Recorded refunds" className={cn("grid gap-1 text-sm print:hidden", className)}>
      <p className="font-semibold">Refunds on linked bookings</p>
      <ul className="grid gap-1">
        {view.refunds.map((refund) => (
          <li key={refund._id} className="[overflow-wrap:anywhere]">
            Recorded · {formatMoney(refund.amount, refund.currency)} · {refund.method} · <RefundSource refund={refund} sources={view.sources} /> · {refund.reason}
            <span className="block text-xs text-muted-foreground">Effective {historyTime(refund.effectiveAt)} · Recorded {historyTime(refund.recordedAt)} by {refund.recordedBy}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function RefundSource({ refund, sources }: { refund: { sourceType?: "booking" | "appointment"; bookingId?: string; appointmentId?: string }; sources: OrderView["sources"] }) {
  const appointment = refund.sourceType === "appointment" || Boolean(refund.appointmentId);
  const id = appointment ? refund.appointmentId : refund.bookingId;
  return <>{appointment ? "Appointment " : "Stay "}{sources.find(source => source.id === id)?.reference ?? id ?? "Unknown source"}</>;
}

/** A task panel opened from the receipt's ⋯; the toolbar's Close ends it (refused while a write runs). */
type TaskProps = {
  view: OrderView;
  /** Closed after a write, with the line that says what happened. */
  onDone: (notice: string) => void;
  /** True while a write runs, so the toolbar can't close the panel under it. */
  onBusyChange: (busy: boolean) => void;
};

/** Opening a panel brings it, its button included, into view and puts focus on its title. */
function usePanelFocus<T extends HTMLElement>() {
  const panel = useRef<T>(null);
  const title = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => {
    panel.current?.scrollIntoView?.({ block: "nearest" });
    title.current?.focus({ preventScroll: true });
  }, []);
  return { panel, title };
}

type TenderRow = { method: TenderMethod; amount: number; received?: number; amountInput: string; receivedInput: string };

/**
 * Correct payment: what usually changes (the method) and the reason (chips and its own text) up
 * front; the received date, the amount, another tender and the customer fold into More. The issued receipt
 * and the money stay as they are. One attempt key per opened panel; a retry resends the frozen
 * attempt. A cashier whose rules keep payment fixes for managers sends the change as a request.
 */
export function CorrectPayment({ view, onDone, onBusyChange }: TaskProps) {
  const actions = useCheckoutBackend().useActions();
  const access = useStaffAccess();
  const send = useSendApproval();
  const { panel, title } = usePanelFocus<HTMLFormElement>();
  const [refused, setRefused] = useState(false);
  const ask = access.role === "cashier" && (refused || access.cashierRules.paymentFix === "manager");
  const [reviewedRecord] = useState(view.paymentRecord);
  const [revision] = useState(view.paymentRecord.correctionRevision);
  const recorded = reviewedRecord.tenders[0]?.method ?? null;
  const single = reviewedRecord.tenders.length === 1;
  const [initialDate] = useState(() => paymentDateInput(view.paymentRecord.effectiveAt ?? Date.now()));
  const [date, setDate] = useState(initialDate);
  const [tenders, setTenders] = useState<TenderRow[]>(() =>
    view.paymentRecord.tenders.map((t) => ({ ...t, amountInput: String(t.amount), receivedInput: t.received === undefined ? "" : String(t.received) })),
  );
  const [payer, setPayer] = useState<Customer | null | undefined>(undefined);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [attempted, setAttempted] = useState(false);
  const attempt = useRef<Parameters<CheckoutActions["amendOrderPayment"]>[0] | null>(null);
  const lock = useRef(false);
  useEffect(() => onBusyChange(saving), [saving, onBusyChange]);
  const setRow = (index: number, patch: Partial<TenderRow>) => setTenders((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const chips = single && tenders.length === 1 && recorded;
  const locked = saving || attempted;
  // Save only once something differs from the recorded payment: the server refuses "Nothing changed."
  const changed =
    payer !== undefined ||
    date !== initialDate ||
    tenders.length !== reviewedRecord.tenders.length ||
    tenders.some((row, i) => {
      const was = reviewedRecord.tenders[i];
      return row.method !== was.method || Number(row.amountInput) !== was.amount || (row.receivedInput === "" ? undefined : Number(row.receivedInput)) !== was.received;
    });

  async function submit() {
    if (lock.current) return;
    if (!attempt.current) {
      const effectiveAt = paymentDateValue(date);
      if (effectiveAt === null || effectiveAt > Date.now()) {
        setError("Enter a received date no later than now, in Bangkok time.");
        return;
      }
      if (!reason.trim()) return;
      attempt.current = {
        orderId: view.order._id,
        idempotencyKey: newAttemptKey(),
        expectedCorrectionRevision: revision,
        reason,
        effectiveAt: date === paymentDateInput(reviewedRecord.effectiveAt ?? Date.now()) ? (reviewedRecord.effectiveAt ?? effectiveAt) : effectiveAt,
        ...(tenders.length
          ? { tenders: tenders.map((t) => ({ method: t.method, amount: Number(t.amountInput), ...(t.method === "cash" && t.receivedInput ? { received: Number(t.receivedInput) } : {}) })) }
          : {}),
        ...(payer !== undefined ? { customer: { customerId: payer?._id ?? null, expectedCustomerRevision: payer?.revision } } : {}),
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
        { kind: "paymentFix", action: "amendOrderPayment", ...(effectiveAt !== undefined ? { effectiveAt } : {}), ...(corrected ? { tenders: corrected } : {}), ...(customer ? { customer } : {}) },
        reason.trim(),
      );
      lock.current = false;
      setSaving(false);
      if (failed) setError(failed);
      else onDone("Sent to a manager · payment correction");
      return;
    }
    try {
      await actions.amendOrderPayment(attempt.current);
      const after = attempt.current.tenders ?? [];
      onDone(`Payment corrected${after.length === 1 ? ` · ${TENDER_LABELS[after[0].method].short} ${formatMoney(after[0].amount)}` : ""}`);
    } catch (err) {
      if (access.role === "cashier" && needsApproval(err)) {
        // Nothing was written; the same panel becomes a request.
        attempt.current = null;
        setAttempted(false);
        setRefused(true);
        setError("This needs a manager. Send it as a request.");
        return;
      }
      // A clear refusal (e.g. nothing changed) wrote nothing: let them fix it instead of retrying.
      if (answeredRefusal(err)) {
        attempt.current = null;
        setAttempted(false);
      }
      setError(checkoutErrorText(err, "Couldn't save the correction. Retry this attempt or close and review the latest recording."));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  // The money button says the money once something changed: "Save · PromptPay ฿1,800".
  const money = changed && tenders.length ? tenders.map((t) => `${TENDER_LABELS[t.method].short} ${formatMoney(Number(t.amountInput) || 0)}`).join(" + ") : "";
  const label = saving
    ? ask ? "Sending…" : "Saving…"
    : attempted
      ? "Retry correction"
      : ask
        ? money ? `Send ${money} to manager` : "Send to manager"
        : money ? `Save · ${money}` : "Save";
  // "Wrong amount typed" joins the quick reasons once an amount (under More) differs; the method is what usually changes.
  const amountChanged = tenders.some((row, i) => Number(row.amountInput) !== reviewedRecord.tenders[i]?.amount);
  const reasonChips = chips && !amountChanged ? REASON_CHIPS.correct.filter((chip) => chip !== "Wrong amount typed") : REASON_CHIPS.correct;

  return (
    <form
      ref={panel}
      aria-labelledby="correct-payment-title"
      data-testid="correct-payment"
      className={cn("grid scroll-my-4 gap-3 rounded-xl border border-border bg-card p-4 print:hidden", TOUCH_TARGETS)}
      onSubmit={(e) => { e.preventDefault(); void submit(); }}
    >
      <div className="grid gap-0.5">
        <h3 id="correct-payment-title" ref={title} tabIndex={-1} aria-describedby="correct-payment-help" className="rounded font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{ask ? "Ask a manager to correct the payment" : "Correct payment"}</h3>
        {/* The paper beside it shows the receipt unchanged; screen readers still hear it. */}
        <p id="correct-payment-help" className="sr-only">Fixes the record; the receipt and the money stay as issued.</p>
      </div>
      <fieldset disabled={locked} className="grid gap-3">
        {chips ? (
          <div className="grid gap-2">
            <p id="correct-payment-method" className="text-sm font-medium">
              Method · was {TENDER_LABELS[recorded].short}
            </p>
            <div role="group" aria-labelledby="correct-payment-method" className="flex flex-wrap gap-2">
              {TENDER_METHODS.filter((method) => method !== recorded).map((method) => {
                const pressed = tenders[0].method === method;
                return (
                  <button
                    key={method}
                    type="button"
                    aria-pressed={pressed}
                    onClick={() => setRow(0, { method: pressed ? recorded : method })}
                    className={cn(
                      "inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
                      pressed ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-foreground hover:border-input",
                    )}
                  >
                    {TENDER_LABELS[method].short}
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
        <ReasonField value={reason} onChange={setReason} chips={reasonChips} disabled={locked} id="payment-correction-reason" />
        <Disclosure label="More" open={!chips} className="border-t border-border" contentClassName="pb-0">
          <div className="grid gap-3 pb-3">
            <div className="grid gap-1.5">
              <Label htmlFor="correction-effective">Received at · Bangkok time</Label>
              <Input id="correction-effective" type="datetime-local" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {tenders.map((t, index) => (
              <div key={index} className="grid gap-2">
                {chips ? null : (
                  <Select value={t.method} onValueChange={(method) => setRow(index, { method: method as TenderMethod })}>
                    <SelectTrigger aria-label={`Corrected payment ${index + 1} method`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {TENDER_METHODS.map((method) => <SelectItem key={method} value={method}>{TENDER_LABELS[method].long}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Label htmlFor={`corrected-amount-${index}`}>{tenders.length > 1 ? `Payment ${index + 1} amount` : "Amount"}</Label>
                <Input id={`corrected-amount-${index}`} aria-label={`Corrected payment ${index + 1} amount`} inputMode="decimal" value={t.amountInput} onChange={(e) => setRow(index, { amountInput: amountInput(e.target.value) })} />
                {t.method === "cash" ? (
                  <Input aria-label={`Corrected payment ${index + 1} cash received`} placeholder="Cash handed over (optional)" inputMode="decimal" value={t.receivedInput} onChange={(e) => setRow(index, { receivedInput: amountInput(e.target.value) })} />
                ) : null}
                {tenders.length > 1 ? (
                  <Button type="button" variant="ghost" onClick={() => setTenders((rows) => rows.filter((_, i) => i !== index))}>Remove payment {index + 1}</Button>
                ) : null}
              </div>
            ))}
            {tenders.length > 0 && tenders.length < 3 ? (
              <Button type="button" variant="outline" onClick={() => setTenders((rows) => [...rows, { method: "card", amount: 0, amountInput: "", receivedInput: "" }])}>
                Add another tender
              </Button>
            ) : null}
            <InlineErrorBoundary message="Couldn't load customer choices. Retry before selecting the payer.">
              <PayerChoice selected={payer} onSelect={setPayer} />
            </InlineErrorBoundary>
          </div>
        </Disclosure>
      </fieldset>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {attempted && !saving ? <p className="text-xs text-muted-foreground">Retry sends this same correction; close to start over.</p> : null}
      <Button type="submit" disabled={saving || (!attempted && (!reason.trim() || !changed))}>
        {saving ? <Spinner /> : null}
        {label}
      </Button>
    </form>
  );
}

function PayerChoice({ selected, onSelect }: { selected: Customer | null | undefined; onSelect: (customer: Customer | null | undefined) => void }) {
  const [query, setQuery] = useState("");
  const page = useCheckoutBackend().useCustomerPage(query, false);
  return (
    <div className="grid gap-2">
      <Label htmlFor="corrected-payer">Customer</Label>
      <p className="text-xs text-muted-foreground">
        {selected === undefined
          ? "Keeps the current customer"
          : selected === null
            ? "No named customer"
            : `Reviewed: ${selected.name} · ${selected.phone || selected.email || "No contact details"}`}
      </p>
      <Input id="corrected-payer" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find by name, phone or email" />
      <div className="flex flex-wrap gap-2">
        {selected !== undefined ? <Button type="button" variant="outline" onClick={() => onSelect(undefined)}>Keep current customer</Button> : null}
        {selected !== null ? <Button type="button" variant="outline" onClick={() => onSelect(null)}>No named customer</Button> : null}
      </div>
      {query.trim().length >= 2 ? (
        <>
          <ul className="grid max-h-40 gap-1 overflow-y-auto">
            {page.results.filter((c) => !c.archivedAt && !c.mergedInto).map((c) => (
              <li key={c._id}>
                <Button type="button" variant="outline" className="h-auto min-h-11 w-full justify-start whitespace-normal text-left" onClick={() => onSelect(c)}>
                  {c.name} · {c.phone || c.email || "No contact details"}
                </Button>
              </li>
            ))}
          </ul>
          {page.status === "LoadingFirstPage" ? <Spinner label="Finding customers" /> : null}
          {!page.results.length && page.status === "Exhausted" ? <p className="text-xs">No matching customers.</p> : null}
          {page.status === "CanLoadMore" || page.status === "LoadingMore" ? (
            <Button type="button" variant="outline" disabled={page.status === "LoadingMore"} onClick={() => page.loadMore(20)}>Load more customers</Button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** What a mistaken-entry void reopens: the attached or linked stays and appointments this receipt paid. */
export function voidReopens(view: Pick<OrderView, "lines" | "links">) {
  const linked = new Set(view.links.filter((link) => link.status === "active").map((link) => link.lineId));
  const rows = view.lines.filter((line) => line.bookingId || line.appointmentId || linked.has(line._id));
  return { attached: rows.length > 0, amount: round2(rows.reduce((sum, line) => sum + line.net - (line.deposit ?? 0), 0)) };
}

type VoidChoice = "received" | "unreceived";

/**
 * One Void…: a reason, then "Money received?" with no default. Yes voids the sale
 * (pos.voidOrder; its stays and appointments stay paid). No voids it as entered by mistake
 * (pos.voidUnreceivedOrder, which reopens their balances), with one attempt key and the reviewed
 * correction revision, reused by a retry. Each choice says what it does. A cashier whose rules keep
 * that choice for managers sends it as a request instead.
 */
export function VoidPanel({ view, waiting, onDone, onBusyChange }: TaskProps & { waiting: boolean }) {
  const actions = useCheckoutBackend().useActions();
  const access = useStaffAccess();
  const send = useSendApproval();
  const { panel, title } = usePanelFocus<HTMLElement>();
  const cashier = access.role === "cashier";
  const [refused, setRefused] = useState<Record<VoidChoice, boolean>>({ received: false, unreceived: false });
  const ask = (choice: VoidChoice) =>
    cashier && (refused[choice] || (choice === "received" ? access.cashierRules.voidPaidSale : access.cashierRules.paymentFix) === "manager");
  const [revision] = useState(view.paymentRecord.correctionRevision);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState<VoidChoice | null>(null);
  const [error, setError] = useState("");
  // A mistaken-entry void that may have reached the server: its retry resends the same attempt.
  const unreceived = useRef<Parameters<CheckoutActions["voidUnreceivedOrder"]>[0] | null>(null);
  const [frozen, setFrozen] = useState(false);
  const lock = useRef(false);
  useEffect(() => onBusyChange(busy !== null), [busy, onBusyChange]);
  const { attached } = voidReopens(view);
  const receipt = `${formatReceiptNumber(view.order.receiptNumber ?? 0)} · ${formatMoney(view.totals.total)}`;

  async function choose(choice: VoidChoice) {
    const clean = reason.trim();
    if (lock.current || !clean) return;
    lock.current = true;
    setBusy(choice);
    setError("");
    try {
      if (ask(choice)) {
        const failed = await send(
          view.order._id,
          choice === "received" ? { kind: "voidPaidSale" } : { kind: "paymentFix", action: "voidUnreceivedOrder" },
          clean,
        );
        if (failed) setError(failed);
        else onDone(`Sent to a manager · void ${receipt}`);
        return;
      }
      if (choice === "received") {
        await actions.voidOrder({ orderId: view.order._id, reason: clean });
        onDone(attached ? "Sale voided · bookings stay paid" : "Sale voided · no refund sent");
        return;
      }
      unreceived.current ??= { orderId: view.order._id, idempotencyKey: newAttemptKey(), expectedCorrectionRevision: revision, reason: clean };
      setFrozen(true);
      await actions.voidUnreceivedOrder(unreceived.current);
      onDone(attached ? "Entered by mistake · their balances reopen" : "Entered by mistake · voided, nothing received");
    } catch (err) {
      if (cashier && needsApproval(err)) {
        // Nothing was written; this choice becomes a request.
        if (choice === "unreceived") { unreceived.current = null; setFrozen(false); }
        setRefused((was) => ({ ...was, [choice]: true }));
        setError("This needs a manager. Send it as a request.");
        return;
      }
      setError(checkoutErrorText(err, "Couldn't void the receipt."));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  const blocked = (choice: VoidChoice) => busy !== null || !reason.trim() || (ask(choice) && waiting) || (frozen && choice === "received");
  const option = (choice: VoidChoice, answer: string, text: string) => (
    <button
      type="button"
      data-void-choice={choice}
      disabled={blocked(choice)}
      onClick={() => void choose(choice)}
      className="grid min-h-14 w-full gap-0.5 rounded-xl border border-border bg-background px-4 py-2.5 text-left text-sm transition-colors hover:border-destructive/60 hover:bg-destructive/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
    >
      <span className="flex items-center gap-2 font-semibold">{busy === choice ? <Spinner className="text-current" /> : null}{answer}</span>
      <span className="text-muted-foreground">{text}</span>
    </button>
  );

  return (
    <section
      ref={panel}
      aria-labelledby="void-title"
      data-testid="void-panel"
      className={cn("grid scroll-my-4 gap-3 rounded-xl border border-destructive/40 bg-card p-4 print:hidden", TOUCH_TARGETS)}
    >
      {/* The receipt number and total are in the header right above. */}
      <h3 id="void-title" ref={title} tabIndex={-1} aria-label={`Void ${receipt}`} className="rounded font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">Void</h3>
      <ReasonField value={reason} onChange={setReason} chips={REASON_CHIPS.void} disabled={busy !== null || frozen} id="void-reason" />
      <div role="group" aria-labelledby="void-question" className="grid gap-2">
        <p id="void-question" className="text-sm font-semibold">Money received?</p>
        {option("received", ask("received") ? "Yes · ask a manager" : "Yes", attached ? "Bookings stay paid" : "No refund sent")}
        {option("unreceived", ask("unreceived") ? "No · ask a manager" : "No", attached ? "Balances reopen" : "Entered by mistake")}
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : (ask("received") || ask("unreceived")) && waiting ? <p className="text-sm text-muted-foreground">A request is already waiting.</p> : null}
    </section>
  );
}
