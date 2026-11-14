"use client";

import { ArrowLeft, Check, Plus, TicketPercent, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { couponRefusalDetails } from "@/lib/booking/coupon-refusals";
import { errorText } from "@/lib/staff-bookings";
import { paymentDateInput, paymentDateValue } from "./payment-time";
import { cn } from "@/lib/utils";
import {
  MAX_TENDERS,
  TENDER_METHODS,
  round2,
  type Tender,
  type TenderMethod,
} from "convex/lib/billMath";
import {
  newAttemptKey,
  useCheckoutBackend,
  useOrderCouponRefusal,
  type CheckoutActions,
  type OrderId,
  type OrderView,
} from "./backend";
import {
  TENDER_LABELS,
  amountInput,
  cashConfirmLabel,
  cashNotes,
  couponRefusal,
  tenderConfirmLabel,
  tendersText,
} from "./checkout-ui";

type PayMode = TenderMethod | "split";

/**
 * Takes the payment. Another tender switches modes; the active tender keeps its attempt.
 * Each mode is its own attempt (PayAttempt, keyed by mode). Back and Escape return to the order.
 */
export function PayPanel({
  mode: opened,
  view,
  onBack,
  onPaid,
  onSubmittingChange,
}: {
  mode: PayMode | "none";
  view: OrderView;
  onBack: () => void;
  onPaid: (orderId: OrderId) => void;
  onSubmittingChange?: (submitting: boolean) => void;
}) {
  const [mode, setMode] = useState(opened);
  const root = useRef<HTMLDivElement>(null);
  // While a payment is in flight the panel can't be left (as Back was disabled).
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => {
    onSubmittingChange?.(submitting);
    return () => onSubmittingChange?.(false);
  }, [onSubmittingChange, submitting]);

  /** Leaves the panel, putting focus back on the order's tender it was opened from. */
  function back() {
    if (submitting) return;
    const host = root.current?.parentElement;
    const label = mode === "none" ? null : mode === "split" ? "Split payment" : TENDER_LABELS[mode].short;
    onBack();
    if (host && label) setTimeout(() => [...host.querySelectorAll("button")].find((el) => getComputedStyle(el).display !== "none" && ((el.getAttribute("aria-label") ?? el.textContent?.trim()) === label || (label === "Cash" && el.textContent?.trim().startsWith("Cash ฿"))))?.focus());
  }

  // Escape leaves the panel first, not the phone order sheet around it: this runs before the
  // sheet's own (document) listener, which skips a handled event. An open ⓘ tip closes first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || submitting) return;
      if (!root.current?.contains(document.activeElement)) return;
      if (document.querySelector('[data-info-tip][data-state$="open"]')) return;
      event.preventDefault();
      back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  return (
    <div ref={root} className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 @container", mode === "split" && "gap-2 py-2")} data-testid="pay-panel">
      <PayAttempt
        key={mode}
        mode={mode}
        view={view}
        onSubmitting={setSubmitting}
        onPick={(next) => { if (next !== mode) setMode(next); }}
        onBack={back}
        onPaid={onPaid}
      />
    </div>
  );
}

/**
 * One payment attempt. One idempotency key per attempt (this component's lifetime): a retry after
 * a dropped connection settles once. The lock ignores double taps while a payment is in flight.
 */
function PayAttempt({
  mode,
  view,
  onSubmitting,
  onPick,
  onBack,
  onPaid,
}: {
  mode: PayMode | "none";
  view: OrderView;
  onSubmitting: (submitting: boolean) => void;
  onPick: (mode: PayMode) => void;
  onBack: () => void;
  onPaid: (orderId: OrderId) => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const reportRefusal = useOrderCouponRefusal(view.order._id);
  const [due] = useState(view.totals.due);
  const [attemptKey] = useState(newAttemptKey);
  // The order as it was when this panel opened; a change made since (even at the same total, or only
  // its customer) is refused, and so is a booking row whose source changed meanwhile.
  const [revision] = useState(view.order.revision);
  const [customerId] = useState(view.order.customerId);
  const [customerRevision] = useState(
    view.customer && "revision" in view.customer
      ? view.customer.revision
      : undefined,
  );
  const [effectiveInput, setEffectiveInput] = useState(() =>
    paymentDateInput(Date.now()),
  );
  const [timeOpen, setTimeOpen] = useState(false);
  const [timeEdited, setTimeEdited] = useState(false);
  const [notifyGuest, setNotifyGuest] = useState(false);
  const attempt = useRef<Parameters<CheckoutActions["settleOrder"]>[0] | null>(
    null,
  );
  const [attempted, setAttempted] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const lock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  useEffect(() => onSubmitting(submitting), [onSubmitting, submitting]);
  const [error, setError] = useState("");
  // Settle refused the coupon (sold out, or its saving changed): nothing was recorded.
  const [couponProblem, setCouponProblem] = useState("");
  const [couponFix, setCouponFix] = useState<{ working: boolean; error: string }>({ working: false, error: "" });
  const orderChanged =
    view.order.revision !== revision ||
    view.totals.due !== due ||
    view.lines.some((line) => line.sourceIssue) ||
    view.order.customerId !== customerId ||
    (view.customer && "revision" in view.customer
      ? view.customer.revision
      : undefined) !== customerRevision ||
    Boolean(
      view.customer &&
      "mergedInto" in view.customer &&
      view.customer.mergedInto,
    );

  // Focus starts on the active tender, inside the panel, where Escape returns to the order.
  const active = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    (active.current ?? backButton.current)?.focus({ preventScroll: true });
  }, []);

  async function pay(tenders: Tender[]) {
    if (lock.current || (!attempt.current && orderChanged)) return;
    if (!attempt.current) {
      const effectiveAt = paymentDateValue(effectiveInput);
      if (effectiveAt === null || effectiveAt > Date.now()) {
        setTimeOpen(true);
        setError(
          "Enter when the money was received, in Bangkok time, no later than now.",
        );
        return;
      }
      attempt.current = {
        orderId: view.order._id,
        idempotencyKey: attemptKey,
        expectedDue: due,
        expectedRevision: revision,
        expectedCustomerRevision: customerRevision,
        tenders,
        effectiveAt,
        notifyGuest,
      };
      setAttempted(true);
    }
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await actions.settleOrder(attempt.current);
      // Stay locked: the page moves on to the receipt.
      if (mounted.current) onPaid(attempt.current.orderId);
    } catch (err) {
      lock.current = false;
      setSubmitting(false);
      const detail = couponRefusalDetails(err);
      if (detail) reportRefusal(view.promotion?.code ?? "", detail.problem);
      const refusal = couponRefusal(err);
      if (refusal) setCouponProblem(refusal.message);
      else setError(errorText(err, "The payment didn't go through. Try again."));
    }
  }

  /** Checks the coupon again (or removes it), then goes back so the new total is reviewed before a new attempt. */
  async function fixCoupon(how: "recheck" | "remove") {
    setCouponFix({ working: true, error: "" });
    try {
      if (how === "recheck") await actions.recheckOrderCoupon({ orderId: view.order._id });
      else await actions.removeOrderCoupon({ orderId: view.order._id });
      if (mounted.current) onBack();
    } catch (err) {
      if (mounted.current) setCouponFix({ working: false, error: couponRefusal(err)?.message ?? errorText(err, "That didn't save. Try again.") });
    }
  }

  if (orderChanged && !submitting && !attempted) {
    return (
      <div className="grid gap-4">
        <p role="alert" className="text-sm text-destructive">
          The order changed while payment was open.
        </p>
        <Button className="h-12" onClick={onBack} autoFocus>
          Review updated order
        </Button>
      </div>
    );
  }

  const panelName =
    mode === "split" ? "Split payment" : mode === "none" ? "Close order" : `${TENDER_LABELS[mode].long} payment`;

  return (
    <>
      {mode === "none" ? (
        <button
          ref={backButton}
          type="button"
          onClick={onBack}
          disabled={submitting}
          className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50"
        >
          <ArrowLeft aria-hidden className="size-4" /> Back to order
        </button>
      ) : (
        <TenderRow active={mode} activeRef={active} disabled={submitting} onPick={onPick} />
      )}

      <fieldset
        aria-label={panelName}
        disabled={submitting || attempted}
        className={cn("flex min-w-0 flex-1 flex-col disabled:opacity-70", mode === "split" ? "gap-2" : "gap-4")}
      >
        {view.promotion && !view.promotion.problem && view.totals.coupon ? (
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TicketPercent aria-hidden className="size-3.5 shrink-0 text-gold-text" />
            <span className="min-w-0 [overflow-wrap:anywhere]">
              Includes coupon <span className="font-mono font-semibold">{view.promotion.code}</span> · {formatMoney(-view.totals.coupon)}
            </span>
          </p>
        ) : null}
        {view.sources.some((source) => source.kind === "booking") ? (
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={notifyGuest}
              onChange={(e) => setNotifyGuest(e.target.checked)}
            />
            Send booking payment confirmation email
          </label>
        ) : null}
        {mode === "cash" ? (
          <CashForm due={due} submitting={submitting} onPay={pay} />
        ) : mode === "split" ? (
          <SplitForm due={due} submitting={submitting} onPay={pay} />
        ) : mode === "none" ? (
          <PayButton submitting={submitting} onClick={() => pay([])}>
            Close order · nothing due
          </PayButton>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">
              {TENDER_LABELS[mode].hint}
            </p>
            <PayButton
              submitting={submitting}
              onClick={() => pay([{ method: mode, amount: due }])}
            >
              {tenderConfirmLabel(mode, due)}
            </PayButton>
          </>
        )}
        {mode === "none" ? null : (
          <ReceivedAt
            value={effectiveInput}
            edited={timeEdited}
            open={timeOpen}
            onToggle={() => setTimeOpen(!timeOpen)}
            onChange={(value) => {
              setEffectiveInput(value);
              setTimeEdited(true);
            }}
          />
        )}
      </fieldset>
      {couponProblem ? (
        <div role="alert" data-testid="pay-coupon-problem" className="grid gap-3 rounded-xl border border-amber-300/80 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
          <div className="flex items-start gap-2">
            <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
            <div className="min-w-0 [overflow-wrap:anywhere]">
              <p className="font-semibold">Payment not recorded.</p>
              <p className="mt-0.5">{couponProblem}</p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {view.promotion ? (
              <Button className="flex-[1_1_10rem]" disabled={couponFix.working} onClick={() => void fixCoupon("recheck")}>
                {couponFix.working ? <Spinner className="text-current" /> : null}
                Check coupon again
              </Button>
            ) : null}
            <Button variant="outline" className="flex-[1_1_10rem] bg-transparent" disabled={couponFix.working} onClick={() => void fixCoupon("remove")}>
              Remove coupon
            </Button>
          </div>
          {couponFix.error ? <p className="text-sm font-medium">{couponFix.error}</p> : null}
        </div>
      ) : null}
      {attempted && !submitting && !couponProblem ? (
        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            Retry sends the same payment, so it is never recorded twice.
          </p>
          <Button onClick={() => void pay([])}>Retry payment</Button>
          <Button variant="outline" onClick={onBack}>
            Review order before a new attempt
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}

const TENDER_ROW: PayMode[] = ["cash", "promptpay", "card", "transfer", "split"];

/** The order's tender row, kept on top of the panel: pressed is the one being taken. */
function TenderRow({
  active,
  activeRef,
  disabled,
  onPick,
}: {
  active: PayMode;
  activeRef: RefObject<HTMLButtonElement | null>;
  disabled: boolean;
  onPick: (mode: PayMode) => void;
}) {
  return (
    <div role="group" aria-label="Take payment by" className="grid min-w-0 grid-cols-2 rounded-xl bg-muted p-0.5 @min-[18rem]:grid-cols-[1fr_1.5fr_1fr_1.2fr_1fr] @min-[18rem]:rounded-full">
      {TENDER_ROW.map((mode) => (
        <Button key={mode} ref={mode === active ? activeRef : undefined} variant="ghost" aria-label={mode === "split" ? "Split payment" : undefined} aria-pressed={mode === active} disabled={disabled}
          className={cn("h-9 pointer-coarse:h-11 min-w-0 rounded-full px-1 text-sm", mode === active && "bg-foreground text-background hover:bg-foreground hover:text-background")}
          onClick={() => onPick(mode)}>{mode === "split" ? "Split" : TENDER_LABELS[mode].short}</Button>
      ))}
    </div>
  );
}

/**
 * "Received now · Change": when the money came in. Usually now; Change opens the Bangkok date and
 * time, so the amount and Confirm fit above a phone keyboard.
 */
function ReceivedAt({
  value,
  edited,
  open,
  onToggle,
  onChange,
}: {
  value: string;
  edited: boolean;
  open: boolean;
  onToggle: () => void;
  onChange: (value: string) => void;
}) {
  const [day, time = ""] = value.split("T");
  return (
    <div className="grid min-w-0 gap-2">
      <p className="flex min-h-11 flex-wrap items-center justify-center gap-x-1.5 text-center text-[13px]">
        <span className="text-muted-foreground">
          {edited ? <>Received <span className="tabular-nums">{day} · {time}</span> Bangkok</> : "Received now"}
        </span>
        <span aria-hidden className="text-muted-foreground">·</span>
        <Button
          type="button"
          variant="link"
          aria-expanded={open}
          aria-controls="payment-received-at"
          aria-label="Edit payment time"
          className="min-h-11 px-0 text-[13px] text-muted-foreground underline underline-offset-4"
          onClick={onToggle}
        >
          Edit time
        </Button>
      </p>
      {open ? (
        <div id="payment-received-at" className="grid min-w-0 grid-cols-1 gap-2 rounded-xl border border-border/70 px-2 py-3">
          <Label htmlFor="payment-effective">Money received date · Bangkok time</Label>
          <Input
            id="payment-effective"
            type="date"
            className="min-w-0 max-w-full"
            value={day}
            onChange={(e) => onChange(`${e.target.value}T${time}`)}
          />
          <Label htmlFor="payment-effective-time">Money received time · Bangkok time</Label>
          <Input
            id="payment-effective-time"
            type="time"
            className="min-w-0 max-w-full"
            value={time}
            onChange={(e) => onChange(`${day}T${e.target.value}`)}
          />
          <p className="text-xs text-muted-foreground">The receipt keeps its own issue time.</p>
        </div>
      ) : null}
    </div>
  );
}

function PayButton({
  submitting,
  disabled,
  onClick,
  className,
  label,
  children,
}: {
  submitting: boolean;
  disabled?: boolean;
  onClick: () => void;
  className?: string;
  label?: string;
  children: ReactNode;
}) {
  return (
    <Button
      className={cn(
        "mt-auto h-14 min-h-14 w-full text-base font-sans tabular-nums whitespace-normal",
        className,
      )}
      aria-label={label}
      disabled={submitting || disabled}
      onClick={onClick}
    >
      {submitting ? <Spinner className="text-current" /> : null}
      {children}
    </Button>
  );
}

/**
 * Selects the whole amount once focused, so typing replaces it. The tap that focused the field
 * would otherwise drop the selection on its mouseup, so that one mouseup is skipped.
 */
const selectAll = {
  onFocus: (e: FocusEvent<HTMLInputElement>) => {
    e.currentTarget.select();
    e.currentTarget.dataset.selected = "";
  },
  onMouseUp: (e: MouseEvent<HTMLInputElement>) => {
    if (e.currentTarget.dataset.selected === undefined) return;
    e.preventDefault();
    delete e.currentTarget.dataset.selected;
  },
  onKeyDown: (e: ReactKeyboardEvent<HTMLInputElement>) => {
    delete e.currentTarget.dataset.selected;
  },
};

function CashForm({
  due,
  submitting,
  onPay,
}: {
  due: number;
  submitting: boolean;
  onPay: (tenders: Tender[]) => void;
}) {
  // Opens at the amount due, so an exact cash sale is one tap; a note chip sets what was handed over.
  const [received, setReceived] = useState(() => amountInput(String(due)));
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  // Keyboard viewport changes keep the focused amount clear of the pinned confirmation bar.
  useEffect(() => {
    const viewport = window.visualViewport;
    const reveal = () => {
      if (document.activeElement === inputRef.current)
        inputRef.current?.scrollIntoView({ block: "center" });
    };
    viewport?.addEventListener("resize", reveal);
    return () => viewport?.removeEventListener("resize", reveal);
  }, []);
  const value = Number(received) || 0;
  const displayed = focused || !received ? received : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
  const label = cashConfirmLabel(due, value);
  const notes = cashNotes(due);

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="cash-received" className="text-xs text-muted-foreground">Cash received</Label>
        <div className="relative">
          <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-sans text-2xl text-muted-foreground">฿</span>
          <Input
            disabled={submitting}
            id="cash-received"
            ref={inputRef}
            inputMode="decimal"
            autoComplete="off"
            className="h-14 min-w-0 pr-3 pl-8 text-right font-sans tabular-nums"
            // Keep long, grouped amounts inside the field at enlarged text sizes.
            style={{ fontSize: `${Math.min(1.5, 9 / Math.max(1, displayed.length))}rem` }}
            {...selectAll}
            onFocus={(e) => {
              // Remove grouping before selecting: changing a controlled value clears selection.
              flushSync(() => setFocused(true));
              selectAll.onFocus(e);
              inputRef.current?.scrollIntoView({ block: "center" });
            }}
            onBlur={() => setFocused(false)}
            value={displayed}
            onChange={(e) => setReceived(amountInput(e.target.value))}
            placeholder="0"
          />
        </div>
      </div>
      {notes.length ? (
        <div role="group" aria-label="Notes handed over" className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2">
          <Button variant="outline" className="h-11 px-2 font-sans tabular-nums aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:bg-foreground/5" aria-pressed={value === due} onClick={() => setReceived(String(due))}>Exact</Button>
          {notes.map((note) => (
            <Button
              key={note}
              variant="outline"
              aria-pressed={value === note}
              className="h-11 px-2 font-sans tabular-nums aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:bg-foreground/5"
              onClick={() => setReceived(String(note))}
            >
              {formatMoney(note)}
            </Button>
          ))}
        </div>
      ) : null}
      {value > due ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
          <span className="text-sm">Change</span>
          <output className="text-[32px] leading-none font-semibold text-emerald-700 font-sans tabular-nums dark:text-emerald-400">{formatMoney(round2(value - due))}</output>
        </div>
      ) : value < due ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="text-sm">Short</span>
          <output className="text-[32px] leading-none font-semibold font-sans tabular-nums">{formatMoney(round2(due - value))}</output>
        </div>
      ) : null}
      {/* Keep the action in view when the phone keyboard reduces the viewport. */}
      <div aria-live="polite" className="mt-auto max-md:[@media(max-height:36rem)]:sticky max-md:[@media(max-height:36rem)]:bottom-0 max-md:[@media(max-height:36rem)]:z-10 max-md:[@media(max-height:36rem)]:bg-card max-md:[@media(max-height:36rem)]:py-2">
        <PayButton
          submitting={submitting}
          disabled={!label.ready}
          label={label.ready ? label.text : "Confirm cash"}
          onClick={() =>
            onPay([{ method: "cash", amount: due, received: value }])
          }
        >
          <span data-testid="cash-confirm-label" className="font-sans tabular-nums">Confirm cash</span>
        </PayButton>
      </div>
    </>
  );
}

type SplitRow = { method: TenderMethod; amount: string };

/**
 * Up to MAX_TENDERS payments, a method chip row each. The last row takes whatever is left, so a
 * two-way split is one typed amount.
 */
function SplitForm({
  due,
  submitting,
  onPay,
}: {
  due: number;
  submitting: boolean;
  onPay: (tenders: Tender[]) => void;
}) {
  const validationId = useId();
  const [rows, setRows] = useState<SplitRow[]>([
    { method: "cash", amount: "" },
    { method: "promptpay", amount: "" },
  ]);
  const typed = rows.slice(0, -1);
  const last = rows[rows.length - 1];
  const rest = round2(due - typed.reduce((total, row) => total + (Number(row.amount) || 0), 0));
  const tenders: Tender[] = [
    ...typed.map((row) => ({ method: row.method, amount: Number(row.amount) || 0 })),
    { method: last.method, amount: Math.max(0, rest) },
  ];
  const remaining = round2(due - tenders.reduce((total, tender) => total + tender.amount, 0));
  const ready = tenders.every((tender) => tender.amount > 0);
  const emptyPayment = typed.findIndex((row) => !(Number(row.amount) > 0));
  const validation = emptyPayment >= 0
    ? `Enter an amount for payment ${emptyPayment + 1}.`
    : rest <= 0 ? "Leave an amount for the final payment, or use a single payment." : "";
  const update = (index: number, patch: Partial<SplitRow>) =>
    setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const unused = () => TENDER_METHODS.find((method) => !rows.some((row) => row.method === method)) ?? "card";

  return (
    <>
      <ul className="grid gap-2">
        {rows.map((row, index) => {
          const isLast = index === rows.length - 1;
          return (
            <li key={index} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-y-2 @min-[18rem]:grid-cols-[minmax(0,1fr)_minmax(6rem,8rem)_auto] rounded-xl bg-muted/40 p-3">
              <div className="col-start-1 row-start-1 grid gap-1">
                <h3 className="text-sm font-medium">Payment {index + 1}</h3>
                <Label htmlFor={`split-${validationId}-${index}`} className="text-xs text-muted-foreground">{isLast ? "Rest" : "Amount"}</Label>
              </div>
              {isLast ? <output id={`split-${validationId}-${index}`} aria-label={`Payment ${index + 1} amount`} className="col-span-2 row-start-2 flex h-11 items-center justify-end rounded-lg border border-dashed border-input px-3 font-sans text-sm tabular-nums @min-[18rem]:col-span-1 @min-[18rem]:col-start-2 @min-[18rem]:row-start-1">{formatMoney(Math.max(0, rest))}</output> : (
                <div className="relative col-span-2 row-start-2 min-w-0 @min-[18rem]:col-span-1 @min-[18rem]:col-start-2 @min-[18rem]:row-start-1">
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-sans text-muted-foreground">฿</span>
                  <Input id={`split-${validationId}-${index}`} inputMode="decimal" autoComplete="off" aria-label={`Payment ${index + 1} amount`} className="h-11 min-w-0 pl-7 text-right font-sans tabular-nums" aria-invalid={!(Number(row.amount) > 0) || remaining < 0 ? true : undefined} aria-describedby={validationId} value={row.amount} {...selectAll} onChange={(e) => update(index, { amount: amountInput(e.target.value) })} placeholder="0" />
                </div>
              )}
              {rows.length > 2 ? <Button size="icon" variant="ghost" className="col-start-2 row-start-1 ml-1 size-11 shrink-0 @min-[18rem]:col-start-3" aria-label={`Remove payment ${index + 1}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}><X aria-hidden className="size-4" /></Button> : <span className="col-start-2 row-start-1 @min-[18rem]:col-start-3" />}
              <ToggleGroup variant="segmented" tone="subtle" value={row.method} onValueChange={(method: TenderMethod) => update(index, { method })} aria-label={`Payment ${index + 1} method`} className="col-span-2 row-start-3 grid min-w-0 grid-cols-2 @min-[18rem]:col-span-3 @min-[18rem]:row-start-2 @min-[18rem]:grid-cols-[1fr_1.5fr_1fr_1.2fr]">
                {TENDER_METHODS.map((method) => (
                  <ToggleGroupItem key={method} value={method} className="min-w-0 px-1 text-sm">{TENDER_LABELS[method].short}</ToggleGroupItem>
                ))}
              </ToggleGroup>
            </li>
          );
        })}
      </ul>
      {/* Every payment must have an amount before this can claim coverage. */}
      {ready || remaining < 0 ? (
        <p data-testid="split-remaining" role="status" className={cn("flex items-center gap-2 rounded-xl p-3 font-sans text-sm font-medium tabular-nums text-pretty", remaining < 0 ? "bg-destructive/5 text-destructive" : "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300")}>
          {remaining < 0 ? `Over by ${formatMoney(Math.abs(remaining))}` : <><Check aria-hidden className="size-4 shrink-0" />Covered · {formatMoney(due)} in {rows.length} payments</>}
        </p>
      ) : null}
      <div className="flex items-center justify-between gap-3">
      {rows.length < MAX_TENDERS ? (
        <Button
          variant="ghost"
          className="shrink-0 self-start px-2"
          // A new row goes before the last, which keeps taking the rest.
          onClick={() => setRows([...typed, { method: unused(), amount: "" }, last])}
        >
          <Plus aria-hidden className="size-4" /> Add payment
        </Button>
      ) : null}
      </div>
      <p id={validationId} aria-live="polite" className="text-xs text-amber-800 empty:hidden dark:text-amber-300">{validation}</p>
      <PayButton
        submitting={submitting}
        disabled={!ready}
        onClick={() => onPay(tenders)}
      >
        {ready ? `Confirm ${tendersText(tenders)}` : "Confirm split"}
      </PayButton>
    </>
  );
}
