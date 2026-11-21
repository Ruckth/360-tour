"use client";
import { parseMoneyInput } from "@/lib/money-input";
import { satangToBaht } from "convex/shared/money";


import { ArrowLeft, Check, Plus, TicketPercent, TriangleAlert, X } from "lucide-react";
import { Suspense, lazy, useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from "react";
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
import { deviceKey, newPanelKey, payMode, serverTillId } from "./pay-desk";
import { cn } from "@/lib/utils";
import {
  MAX_TENDERS,
  TENDER_METHODS,
  roundMoney,
  type Tender,
  type TenderMethod,
} from "convex/shared/orderMath";
import {
  COMMERCE_OFF,
  newAttemptKey,
  useCheckoutBackend,
  useCommerce,
  useOrderCouponRefusal,
  type CheckoutActions,
  type DirectInstruction,
  type DirectPanelPrevious,
  type DirectPanelRegistration,
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
type PayPanelProps = {
  mode: PayMode | "none";
  view: OrderView;
  onBack: () => void;
  onPaid: (orderId: OrderId) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  /** Opens another order (the stay's Shop & spa bill after Pay the room first). */
  onOpenOrder?: (orderId: OrderId) => void;
};

// The attempt flow and its words load only once a till is on the new payments.
const PayDeskPanel = lazy(() => import("./PayDeskPanel"));

const TillReload = lazy(() => import("./PayRecovery").then((module) => ({ default: module.TillReload })));

/**
 * Takes the payment. Until the owner's cutover (paymentsMode "direct") this is the direct panel,
 * exactly as before; afterwards every payment goes through a server attempt (PayDeskPanel). An
 * open direct panel finishes during the checkout pause; a till that loaded before the cutover
 * reloads first.
 */
export function PayPanel(props: PayPanelProps) {
  const commerce = useCommerce();
  const access = commerce.useAccess();
  const mode = payMode(access, commerce);
  if (mode === "direct" || mode === "paused") return commerce === COMMERCE_OFF ? <DirectPayPanel {...props} /> : <RegisteredDirectPanel key={props.view.order._id} paused={mode === "paused"} started={mode === "paused" || Boolean(access?.cutoverStarted)} {...props} />;
  const fallback = <div className="grid flex-1 place-items-center"><Spinner /></div>;
  if (mode === "loading") return fallback;
  return (
    <Suspense fallback={fallback}>
      {mode === "attempts" ? <PayDeskPanel {...props} /> : <div className="px-4 py-3"><TillReload /></div>}
    </Suspense>
  );
}

// Shown only when the registration fails or continues an earlier panel: loads on demand.
const PanelProblem = lazy(() => import("./PayRecovery").then((module) => ({ default: module.DirectPanelProblem })));
const PanelPrevious = lazy(() => import("./PayRecovery").then((module) => ({ default: module.DirectCheckPrevious })));
const RecordPrevious = lazy(() => import("./PayRecovery").then((module) => ({ default: module.DirectRecordPrevious })));
const ReceivedNow = lazy(() => import("./PayRecovery").then((module) => ({ default: module.DirectReceivedNow })));
const InstructionSaving = lazy(() => import("./PayRecovery").then((module) => ({ default: module.InstructionSaving })));

type Registered = { registration: DirectPanelRegistration; previous?: DirectPanelPrevious };
type Checked = "taken" | "notTaken" | "answering" | "manager" | null;

/** What a panel opened on `mode` shows first: one tender for the whole amount (a split's parts come later). */
function openingInstruction(mode: PayMode | "none", view: OrderView): DirectInstruction | undefined {
  const { revision } = view.order;
  const { due } = view.totals;
  if (mode === "split") return undefined;
  return { revision, due, tenders: mode === "none" ? [] : [{ method: mode, amount: due }] };
}
const instructionKey = (i?: DirectInstruction) => i ? `${i.revision}|${i.due}|${i.tenders.map(({ method, amount }) => `${method}:${amount}`).join(",")}` : "";
const sameInstruction = (a?: DirectInstruction, b?: DirectInstruction) => instructionKey(a) === instructionKey(b);
/** From the cutover's first pause on, the panel shows an instruction only once its registration saved it. */
type InstructionGuard = { saved: (instruction: DirectInstruction) => boolean; failed: unknown; retry: () => void };

/**
 * Register with the instruction before showing it; the registration belongs to this till and tab.
 * Before the cutover starts the panel is today's at once and its registration runs alongside: a
 * slow, lost or refused registration never holds up or refuses the payment. Reopening an order
 * whose earlier panel this tab left unrecorded continues that registration; from the cutover's
 * first pause on, Check previous payment comes first and Taken records exactly what it
 * instructed. A different answer, or an order changed since, goes to a manager. From then on too,
 * each instruction the panel shows (another tender, a split's parts, a fresh one after Not taken)
 * is saved on the registration before it is shown, so a later check names exactly it.
 */
function RegisteredDirectPanel({ paused, started, ...props }: PayPanelProps & { paused: boolean; started: boolean }) {
  const actions = useCommerce().useActions();
  const orderId = props.view.order._id;
  // Settled once per panel: the pause starting meanwhile doesn't take today's panel away.
  const [dormant] = useState(!started);
  const [state, setState] = useState<"opening" | Registered | { error: unknown }>("opening");
  const [checked, setChecked] = useState<Checked>(null);
  const latest = useRef(actions);
  useEffect(() => { latest.current = actions; });
  const [tries, setTries] = useState(0);
  // One key per panel, kept for its retries.
  const [panelKey] = useState(newPanelKey);
  const [opening] = useState(() => openingInstruction(props.mode, props.view));
  // The registration as sent (before its answer).
  const sent = useRef<DirectPanelRegistration | null>(null);
  // The instruction the panel shows now, and what its registration is known to hold (null: unknown).
  const [shown, setShown] = useState(opening);
  const [saved, setSaved] = useState<{ instruction?: DirectInstruction } | null>(null);
  const [saveFailed, setSaveFailed] = useState<unknown>(null);
  const [saveTries, setSaveTries] = useState(0);
  const current = () => (typeof state === "object" && "registration" in state ? state.registration : sent.current);
  useEffect(() => {
    let live = true;
    (async () => {
      const { claimTabKey } = await import("./pay-desk-tab");
      const tabKey = await claimTabKey();
      if (!live) return;
      sent.current = { panelKey, tabKey };
      const opened = await latest.current.openDirectPanel({ orderId, panelKey, tabKey, ...(opening ? { instruction: opening } : {}) });
      if (!live) return;
      const previous = opened?.previous;
      const registration = previous ? { panelKey: previous.panelKey, tillId: previous.tillId, tabKey } : { panelKey, tabKey };
      setState(previous?.check ? { registration, previous } : { registration });
      // The server saved the opening instruction on the registration (a continued one too), or keeps the one to check.
      setSaved({ instruction: previous?.check ? previous.instruction : opening });
    })().catch((error) => {
      if (!live) return;
      // Today's panel stays; it settles as today (the server can't refuse it before the cutover).
      if (dormant) setState({ registration: sent.current ?? { panelKey } });
      else setState({ error });
    });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per panel and retry
  }, [orderId, panelKey, tries]);
  const previous = typeof state === "object" && "registration" in state ? state.previous : undefined;
  // Between the check and Taken nothing new is shown; recording shows only the instruction already saved.
  const instructing = typeof state === "object" && "registration" in state && (!previous || checked === "notTaken");
  // Saves what the panel shows (best effort before the cutover starts, debounced for a split's typing).
  useEffect(() => {
    const reg = current();
    if (!instructing || !reg || (saved ? sameInstruction(saved.instruction, shown) : !shown)) return;
    let live = true;
    const timer = setTimeout(() => {
      setSaveFailed(null);
      latest.current.instructDirectPanel({ orderId, ...reg, instruction: shown ?? null }).then(
        () => { if (live) setSaved({ instruction: shown }); },
        (error) => { if (live) setSaveFailed(error); },
      );
    }, started ? 0 : 300);
    return () => { live = false; clearTimeout(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- current() follows state
  }, [instructing, shown, saved, started, saveTries]);
  // Back and Escape leave Check previous payment as they leave the panel.
  const checkRoot = useRef<HTMLDivElement>(null);
  const leaveCheck = () => backToTender(checkRoot.current, props.mode, props.onBack);
  useEscapeBack(checkRoot, leaveCheck, true);
  const spinner = <div className="grid flex-1 place-items-center"><Spinner /></div>;
  const retry = () => { setState("opening"); setChecked(null); setTries(tries + 1); };
  if (state === "opening" && !dormant) return spinner;
  if (typeof state === "object" && "error" in state) return <Suspense fallback={<Spinner />}><PanelProblem error={state.error} orderId={orderId} onRetry={retry} onBack={props.onBack} /></Suspense>;
  // Settle names this registration on this device and tab, so a panel open when checkout pauses can still finish.
  const registration = () => {
    const reg = current();
    if (!reg) return undefined;
    const tillId = reg.tillId ?? serverTillId();
    return { ...reg, ...(tillId ? { tillId } : {}), deviceKey: deviceKey() };
  };
  async function answer(outcome: "taken" | "notTaken" | "manager") {
    // During the pause Not taken leaves the panel to a manager.
    if (outcome !== "notTaken" || paused) return setChecked(outcome === "notTaken" ? "manager" : outcome);
    setChecked("answering");
    try {
      await latest.current.answerDirectPanel({ orderId, ...current()! });
      // Not taken cleared the earlier instruction: the next one is saved before it is shown.
      setSaved({});
      setChecked("notTaken");
    } catch (error) {
      setState({ error });
    }
  }
  if (previous && checked !== "taken" && checked !== "notTaken") {
    return (
      <div ref={checkRoot} className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
        <Suspense fallback={spinner}>
          <PanelPrevious previous={previous} paused={paused} manager={checked === "manager"} busy={checked === "answering"} onChecked={(outcome) => void answer(outcome)} onBack={leaveCheck} />
        </Suspense>
      </div>
    );
  }
  const recording = checked === "taken" ? previous?.instruction : undefined;
  const onInstruct = recording ? undefined : (instruction?: DirectInstruction) => {
    setShown((last) => (sameInstruction(last, instruction) ? last : instruction));
  };
  const guard: InstructionGuard | undefined = started && !recording ? {
    saved: (instruction) => saved !== null && sameInstruction(saved.instruction, instruction),
    failed: saveFailed,
    retry: () => setSaveTries((n) => n + 1),
  } : undefined;
  // The booking email choice goes with the registration, so a panel reopened after the cutover started keeps it.
  const onNotifyGuest = (notifyGuest: boolean) => {
    const reg = current();
    if (reg) latest.current.instructDirectPanel({ orderId, ...reg, notifyGuest }).catch(() => undefined);
  };
  return <DirectPayPanel {...props} registration={registration} recording={recording} onInstruct={onInstruct} guard={guard} notifyGuest={previous?.notifyGuest} onNotifyGuest={onNotifyGuest} notice={recording ? <Suspense fallback={null}><RecordPrevious /></Suspense> : null} />;
}

/**
 * Leaves the panel, putting focus back on the order's tender it was opened from; while checkout is
 * paused the tenders are replaced, so on the control that opened it (Check previous payment).
 */
function backToTender(panel: HTMLElement | null, mode: PayMode | "none", onBack: () => void) {
  const host = panel?.parentElement;
  const label = mode === "none" ? null : mode === "split" ? "Split payment" : TENDER_LABELS[mode].short;
  onBack();
  if (!host) return;
  setTimeout(() => {
    const usable = (el: HTMLButtonElement) => !el.disabled && getComputedStyle(el).display !== "none";
    const tender = label ? [...host.querySelectorAll("button")].find((el) => usable(el) && ((el.getAttribute("aria-label") ?? el.textContent?.trim()) === label || (label === "Cash" && el.textContent?.trim().startsWith("Cash ฿")))) : undefined;
    const opener = (scope: ParentNode) => [...scope.querySelectorAll<HTMLButtonElement>("[data-pay-return]")].find(usable);
    (tender ?? opener(host) ?? opener(document))?.focus();
  });
}

/**
 * Escape leaves the panel first, not the phone order sheet around it: this runs before the
 * sheet's own (document) listener, which skips a handled event. An open ⓘ tip closes first.
 */
function useEscapeBack(root: RefObject<HTMLElement | null>, back: () => void, enabled: boolean) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !enabled) return;
      if (!root.current?.contains(document.activeElement)) return;
      if (document.querySelector('[data-info-tip][data-state$="open"]')) return;
      event.preventDefault();
      back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });
}

type DirectPanelOptions = {
  /** The rollout registration this panel settles under (RegisteredDirectPanel). */
  registration?: () => (DirectPanelRegistration & { deviceKey: string }) | undefined;
  /** Recording money an earlier panel's instruction already took: exactly this, no instruction shown. */
  recording?: DirectInstruction;
  /** The instruction the panel shows now (none: a split whose parts don't cover the bill), for its registration. */
  onInstruct?: (instruction?: DirectInstruction) => void;
  /** From the cutover's first pause on: an instruction shows only once saved. */
  guard?: InstructionGuard;
  /** The registration's booking email choice (a continued panel), and each change to it. */
  notifyGuest?: boolean;
  onNotifyGuest?: (notifyGuest: boolean) => void;
  notice?: ReactNode;
};

/** The mode that records `instruction`: its one tender, or its parts. */
const recordingMode = (instruction: DirectInstruction): PayMode | "none" =>
  instruction.tenders.length === 0 ? "none" : instruction.tenders.length === 1 ? instruction.tenders[0].method : "split";

/**
 * The direct pay panel. Another tender switches modes; the active tender keeps its attempt.
 * Each mode is its own attempt (PayAttempt, keyed by mode). Back and Escape return to the order.
 */
function DirectPayPanel({
  mode: opened,
  view,
  onBack,
  onPaid,
  onSubmittingChange,
  registration,
  recording,
  onInstruct,
  guard,
  notifyGuest,
  onNotifyGuest,
  notice,
}: PayPanelProps & DirectPanelOptions) {
  const [mode, setMode] = useState(recording ? recordingMode(recording) : opened);
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
    backToTender(root.current, mode, onBack);
  }
  useEscapeBack(root, back, !submitting);

  return (
    <div ref={root} className={cn("flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 @container", mode === "split" && "gap-2 py-2")} data-testid="pay-panel">
      {notice}
      <PayAttempt
        key={mode}
        mode={mode}
        recording={recording}
        view={view}
        onSubmitting={setSubmitting}
        onPick={(next) => { if (next !== mode) setMode(next); }}
        onBack={back}
        onPaid={onPaid}
        registration={registration}
        onInstruct={onInstruct}
        guard={guard}
        initialNotifyGuest={notifyGuest}
        onNotifyGuest={onNotifyGuest}
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
  registration,
  recording,
  onInstruct,
  guard,
  initialNotifyGuest,
  onNotifyGuest,
}: Omit<DirectPanelOptions, "notice" | "notifyGuest"> & {
  initialNotifyGuest?: boolean;
  mode: PayMode | "none";
  view: OrderView;
  onSubmitting: (submitting: boolean) => void;
  onPick: (mode: PayMode) => void;
  onBack: () => void;
  onPaid: (orderId: OrderId) => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const reportRefusal = useOrderCouponRefusal(view.order._id);
  // Recording an earlier instruction: exactly the order and amount it was shown for.
  const [due] = useState(recording?.due ?? view.totals.due);
  const [attemptKey] = useState(newAttemptKey);
  // The order as it was when this panel opened; a change made since (even at the same total, or only
  // its customer) is refused, and so is a booking row whose source changed meanwhile.
  const [revision] = useState(recording?.revision ?? view.order.revision);
  // Each instruction shown, for the panel's registration (a split's parts once they cover the bill).
  const instruction = (tenders: Tender[]): DirectInstruction => ({ revision, due, tenders: tenders.map(({ method, amount }) => ({ method, amount })) });
  const instruct = (tenders?: Tender[]) => onInstruct?.(tenders && instruction(tenders));
  // An instruction not yet saved on the registration (from the cutover's first pause on) isn't shown or confirmed.
  const unsaved = (tenders: Tender[]) => Boolean(guard && !guard.saved(instruction(tenders)));
  const shownTenders: Tender[] | undefined = mode === "split" ? undefined : mode === "none" ? [] : [{ method: mode, amount: due }];
  const saving = guard ? <Suspense fallback={<Spinner />}><InstructionSaving failed={guard.failed} onRetry={guard.retry} /></Suspense> : null;
  useEffect(() => {
    if (mode !== "split") instruct(mode === "none" ? [] : [{ method: mode, amount: due }]);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per mode (this attempt)
  }, []);
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
  const [notifyGuest, setNotifyGuest] = useState(initialNotifyGuest ?? false);
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
    if (lock.current || (!attempt.current && (orderChanged || unsaved(tenders)))) return;
    if (!attempt.current) {
      // A recovered payment is received now: the server dates it at settlement, never at mount.
      const effectiveAt = recording ? undefined : paymentDateValue(effectiveInput);
      if (effectiveAt === null || (effectiveAt !== undefined && effectiveAt > Date.now())) {
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
        ...(effectiveAt !== undefined ? { effectiveAt } : {}),
        notifyGuest,
        ...registration?.(),
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
      {mode === "none" || recording ? (
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
              disabled={Boolean(recording)}
              onChange={(e) => { setNotifyGuest(e.target.checked); onNotifyGuest?.(e.target.checked); }}
            />
            Send booking payment confirmation email
          </label>
        ) : null}
        {shownTenders && unsaved(shownTenders) && !attempted ? saving : mode === "cash" ? (
          <CashForm due={due} submitting={submitting} onPay={pay} />
        ) : mode === "split" && recording ? (
          <PayButton submitting={submitting} onClick={() => pay(recording.tenders)}>
            {`Confirm ${tendersText(recording.tenders)}`}
          </PayButton>
        ) : mode === "split" ? (
          <SplitForm due={due} submitting={submitting} onPay={pay} onTenders={instruct} unsaved={guard ? unsaved : undefined} saving={saving} />
        ) : mode === "none" ? (
          <PayButton submitting={submitting} onClick={() => pay([])}>
            Close order · nothing due
          </PayButton>
        ) : (
          <>
            {recording ? null : (
              <p className="text-sm text-muted-foreground">
                {TENDER_LABELS[mode].hint}
              </p>
            )}
            <PayButton
              submitting={submitting}
              onClick={() => pay([{ method: mode, amount: due }])}
            >
              {tenderConfirmLabel(mode, due)}
            </PayButton>
          </>
        )}
        {mode === "none" ? null : recording ? (
          <p className="flex min-h-11 items-center justify-center text-center text-[13px] text-muted-foreground"><Suspense fallback={null}><ReceivedNow /></Suspense></p>
        ) : (
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
  const [received, setReceived] = useState(() => amountInput(String(satangToBaht(due))));
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
  const value = parseMoneyInput(received) || 0;
  const displayed = focused || !received ? received : new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(satangToBaht(value));
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
          <Button variant="outline" className="h-11 px-2 font-sans tabular-nums aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:bg-foreground/5" aria-pressed={value === due} onClick={() => setReceived(String(satangToBaht(due)))}>Exact</Button>
          {notes.map((note) => (
            <Button
              key={note}
              variant="outline"
              aria-pressed={value === note}
              className="h-11 px-2 font-sans tabular-nums aria-pressed:ring-2 aria-pressed:ring-foreground aria-pressed:bg-foreground/5"
              onClick={() => setReceived(String(satangToBaht(note)))}
            >
              {formatMoney(note)}
            </Button>
          ))}
        </div>
      ) : null}
      {value > due ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
          <span className="text-sm">Change</span>
          <output className="text-[32px] leading-none font-semibold text-emerald-700 font-sans tabular-nums dark:text-emerald-400">{formatMoney(roundMoney(value - due))}</output>
        </div>
      ) : value < due ? (
        <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-amber-50 p-4 text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">
          <span className="text-sm">Short</span>
          <output className="text-[32px] leading-none font-semibold font-sans tabular-nums">{formatMoney(roundMoney(due - value))}</output>
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
  onTenders,
  unsaved,
  saving,
}: {
  due: number;
  submitting: boolean;
  onPay: (tenders: Tender[]) => void;
  /** The parts as they stand once they cover the bill (the panel's instruction), else none. */
  onTenders?: (tenders?: Tender[]) => void;
  /** Covering parts not yet saved on the registration can't be confirmed; `saving` says so. */
  unsaved?: (tenders: Tender[]) => boolean;
  saving?: ReactNode;
}) {
  const validationId = useId();
  const [rows, setRows] = useState<SplitRow[]>([
    { method: "cash", amount: "" },
    { method: "promptpay", amount: "" },
  ]);
  const typed = rows.slice(0, -1);
  const last = rows[rows.length - 1];
  const rest = roundMoney(due - typed.reduce((total, row) => total + (parseMoneyInput(row.amount) || 0), 0));
  const tenders: Tender[] = [
    ...typed.map((row) => ({ method: row.method, amount: parseMoneyInput(row.amount) || 0 })),
    { method: last.method, amount: Math.max(0, rest) },
  ];
  const remaining = roundMoney(due - tenders.reduce((total, tender) => total + tender.amount, 0));
  const ready = tenders.every((tender) => tender.amount > 0);
  const parts = ready && remaining === 0 ? JSON.stringify(tenders) : "";
  useEffect(() => {
    onTenders?.(parts ? JSON.parse(parts) as Tender[] : undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- each covering set of parts once
  }, [parts]);
  const emptyPayment = typed.findIndex((row) => !(parseMoneyInput(row.amount) > 0));
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
                <h3 className="text-sm font-medium">Payment {index + 1}{isLast ? " · rest" : ""}</h3>
                <Label htmlFor={`split-${validationId}-${index}`} className="sr-only">Amount</Label>
              </div>
              {isLast ? <div className="relative col-span-2 row-start-2 min-w-0 @min-[18rem]:col-span-1 @min-[18rem]:col-start-2 @min-[18rem]:row-start-1">
                <output id={`split-${validationId}-${index}`} aria-label={`Payment ${index + 1} amount`} className="relative flex h-11 items-center justify-end rounded-lg border border-dashed border-input pr-3 pl-7 font-sans text-sm tabular-nums"><span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-sans text-muted-foreground">฿</span>{formatMoney(Math.max(0, rest)).replace(/^฿/, "")}</output>
              </div> : (
                <div className="relative col-span-2 row-start-2 min-w-0 @min-[18rem]:col-span-1 @min-[18rem]:col-start-2 @min-[18rem]:row-start-1">
                  <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-sans text-muted-foreground">฿</span>
                  <Input id={`split-${validationId}-${index}`} inputMode="decimal" autoComplete="off" aria-label={`Payment ${index + 1} amount`} className="h-11 min-w-0 pl-7 text-right font-sans tabular-nums" aria-invalid={!(parseMoneyInput(row.amount) > 0) || remaining < 0 ? true : undefined} aria-describedby={validationId} value={row.amount} {...selectAll} onChange={(e) => update(index, { amount: amountInput(e.target.value) })} placeholder="0" />
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
      {parts && unsaved?.(tenders) ? saving : null}
      <PayButton
        submitting={submitting}
        disabled={!ready || Boolean(parts && unsaved?.(tenders))}
        onClick={() => onPay(tenders)}
      >
        {ready ? `Confirm ${tendersText(tenders)}` : "Confirm split"}
      </PayButton>
    </>
  );
}
