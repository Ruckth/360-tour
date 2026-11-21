"use client";

import { ArrowLeft, Check, Plus, X } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useEffect, useId, useRef, useState, type FocusEvent, type MouseEvent } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { parseMoneyInput } from "@/lib/money-input";
import { cn } from "@/lib/utils";
import { satangToBaht } from "convex/shared/money";
import { MAX_TENDERS, TENDER_METHODS } from "convex/shared/orderMath";
import {
  newAttemptKey,
  useCheckoutBackend,
  useCommerce,
  type ExternalMethod,
  type LegOutcome,
  type OrderId,
  type OrderView,
  type PayLegPlan,
  type PaymentAttemptView,
  type PaymentLeg,
  type RecoveryPreview,
  type RecoveryStep,
} from "./backend";
import { amountInput, cashNotes } from "./checkout-ui";
import { collected, deskStep, isUnchecked, methodsWithinRows, reviewedCustomers, showsInstruction, stillToCharge, todayBusinessDate } from "./pay-desk-rules";
import { instruction, methodName, payCopy, payRefusalText } from "./pay-desk-copy";
import { CashChange, CheckPrevious, ConnectionNotice, DeskButton, HandOver, InProgressElsewhere, Notice, ProblemNotice, payProblem, type Problem } from "./PayRecovery";

/*
 * The pay panel once payments go through attempts (paymentsMode "attempts"). The order is quoted,
 * the attempt is started and each part armed on the server before any instruction shows, so a
 * reload or a lost answer comes back to the same attempt: Check previous payment, never a second
 * charge. Card in two taps: Card (here the panel opens, starts and arms) → Confirm.
 */

const { t, money } = payCopy;
type Mode = ExternalMethod | "split" | "none";
const ROW: (ExternalMethod | "split")[] = ["cash", "promptpay", "card", "transfer", "split"];

const selectAll = {
  onFocus: (e: FocusEvent<HTMLInputElement>) => { e.currentTarget.select(); e.currentTarget.dataset.selected = ""; },
  onMouseUp: (e: MouseEvent<HTMLInputElement>) => { if (e.currentTarget.dataset.selected === undefined) return; e.preventDefault(); delete e.currentTarget.dataset.selected; },
};

// A same-tab reload can interrupt the write. Keep a draft scoped to this leg and owner revision.
const cashDraftKey = (attempt: PaymentAttemptView, leg: PaymentLeg) => `checkout.cash.${attempt.attemptId}.${attempt.ownerRevision}.${leg.key}`;
function readCashDraft(attempt: PaymentAttemptView, leg: PaymentLeg) {
  if (leg.method !== "cash" || leg.direction !== "collect") return;
  try {
    const value = sessionStorage.getItem(cashDraftKey(attempt, leg));
    if (value !== null) return value === "" ? null : Number(value);
  } catch { /* The server keeps the last saved tender. */ }
}

export default function PayDeskPanel({ mode: opened, view, onBack, onPaid, onSubmittingChange, onOpenOrder }: {
  mode: Mode;
  view: OrderView;
  onBack: () => void;
  onPaid: (orderId: OrderId) => void;
  onSubmittingChange?: (submitting: boolean) => void;
  onOpenOrder?: (orderId: OrderId) => void;
}) {
  const commerce = useCommerce();
  const actions = commerce.useActions();
  const orderId = view.order._id;
  const active = view.paymentAttempt?._id;
  const live = commerce.usePaymentAttempt(active ? orderId : null, active);
  const attempt = active ? live ?? null : null;
  // An attempt already running (a reload, the sheet reopening) shows once the server's copy is in,
  // so a split reopens exactly as planned rather than as a fresh one.
  const loadingAttempt = Boolean(active) && live === undefined;
  const connected = commerce.useConnected();
  const [mode, setMode] = useState<Mode>(opened);
  const [businessDate, setBusinessDate] = useState(todayBusinessDate);
  const [dateOpen, setDateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [retry, setRetry] = useState<(() => void) | null>(null);
  const [armedHere, setArmedHere] = useState<ReadonlySet<string>>(() => new Set());
  // The part this panel is arming right now: until the server answers it shows neither a fresh
  // instruction nor Check previous payment.
  const [arming, setArming] = useState<string | null>(null);
  const [roomSplit, setRoomSplit] = useState<{ shopOrderId: OrderId } | null>(null);
  // The booking payment confirmation email, as on the direct panel: the cashier's choice, kept on the
  // attempt (so a reload or the till it is handed to shows it) and sent with settlement. A choice made
  // here counts only for the owner revision it was made under; after a handover the server's stands.
  // Before any attempt the choice belongs to the one about to start (owner revision 0).
  const [emailChoice, setEmailChoice] = useState<{ value: boolean; revision: number } | null>(null);
  const booking = view.sources.some((source) => source.kind === "booking");
  const lock = useRef(false);
  const mounted = useRef(true);
  const keys = useRef({ base: newAttemptKey(), n: 0 });
  const nextKey = () => `${keys.current.base}-${++keys.current.n}`;
  // One client key per start: a retry after a lost answer sends the same quote under it.
  const startKey = useRef<string | null>(null);
  // One key per Pay the room first, kept until it is answered, so Retry replays the same split.
  const roomKey = useRef<string | null>(null);

  const localEmail = emailChoice && emailChoice.revision === (attempt?.ownerRevision ?? 0) ? emailChoice.value : null;
  const notifyGuest = localEmail ?? attempt?.notifyGuest ?? false;
  useEffect(() => {
    if (!attempt?.mine || localEmail === null) return;
    if ((attempt.notifyGuest ?? false) === localEmail) return;
    void actions.setEmailChoice({ attemptId: attempt.attemptId, ownerRevision: attempt.ownerRevision, notifyGuest: localEmail }).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once per attempt, owner revision and choice
  }, [attempt?.attemptId, attempt?.ownerRevision, attempt?.mine, attempt?.notifyGuest, localEmail]);
  const step = attempt ? deskStep(attempt, armedHere) : null;
  const moneyHeld = attempt ? attempt.legs.some((leg) => leg.state === "taken" || isUnchecked(leg)) : false;
  const instructing = step?.kind === "instruct";
  const remaining = stillToCharge(attempt, view.totals.due);
  const submitting = busy || moneyHeld || instructing || step?.kind === "settle";
  useEffect(() => {
    onSubmittingChange?.(submitting);
    return () => onSubmittingChange?.(false);
  }, [onSubmittingChange, submitting]);

  // Leaving with nothing taken releases the order for the other tills (best effort; the panel
  // reopens the same attempt if this answer is lost).
  const release = useRef<(() => void) | null>(null);
  release.current = attempt?.mine && !moneyHeld && !instructing && step?.kind !== "settle" && attempt.status === "collecting"
    ? () => void actions.cancelAttempt({ attemptId: attempt.attemptId, ownerRevision: attempt.ownerRevision }).catch(() => undefined)
    : null;
  useEffect(() => () => {
    mounted.current = false;
    if (!lock.current) release.current?.();
  }, []);

  /** Runs one server step under the panel's lock. No answer keeps it retryable with the same keys. */
  async function run(work: () => Promise<unknown>) {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setProblem(null);
    setRetry(null);
    try {
      await work();
    } catch (err) {
      if (!mounted.current) return;
      const failed = payProblem(err);
      setProblem(failed);
      if ("lost" in failed) setRetry(() => () => void run(work));
    } finally {
      lock.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const ref = (current: PaymentAttemptView) => ({ attemptId: current.attemptId, ownerRevision: current.ownerRevision });

  /**
   * Arms one part. Only this call's own "instruct" answer shows a fresh instruction; any other
   * answer (another tab or till armed it first, a retried lost answer) shows Check previous payment.
   */
  async function arm(legKey: string, call: () => Promise<boolean>) {
    setArming(legKey);
    try {
      if (await call() && mounted.current) setArmedHere((armed) => new Set(armed).add(legKey));
    } finally {
      if (mounted.current) setArming(null);
    }
  }

  /** Quote, start (which locks the order everywhere), then arm: only then is the instruction shown. */
  async function charge(plan: PayLegPlan[], legKey: string) {
    let current = attempt;
    if (!current) {
      startKey.current ??= newAttemptKey();
      try {
        current = await actions.startAttempt({
          clientKey: startKey.current, orderId, orderRevision: view.order.revision, due: view.totals.due, businessDate,
          customers: reviewedCustomers(view), legs: plan, vouchers: [],
        });
      } catch (err) {
        if (!("lost" in payProblem(err))) startKey.current = null;
        throw err;
      }
      startKey.current = null;
    } else {
      const planned = collected(current.legs).filter((leg) => leg.state === "planned");
      const same = planned.length === plan.length && planned.every((leg, i) => leg.key === plan[i].key && leg.method === plan[i].method && leg.amount === plan[i].amount);
      if (!same) current = await actions.changePlan({ ...ref(current), legs: plan });
    }
    if (!legKey) return;
    const armed = current;
    await arm(legKey, async () => (await actions.armLeg({ ...ref(armed), legKey })).instructed);
  }

  /** One method for the rest: Card → the instruction, then Confirm. */
  function chooseMethod(method: ExternalMethod, amount = remaining) {
    setMode(method);
    if (!connected) return;
    if (amount <= 0) return;
    const key = nextKey();
    void run(() => charge([{ key, method, amount }], key));
  }

  // Opening the panel on a method is the method tap (v27 Legs): start and arm at once.
  const opening = useRef(false);
  useEffect(() => {
    if (opening.current || active || opened === "split" || opened === "none") return;
    opening.current = true;
    chooseMethod(opened);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the method the panel opened on
  }, []);

  // After Pay the room first the room order is re-quoted: charge its new total by the same method.
  const recharge = useRef<number | null>(null);
  useEffect(() => {
    if (recharge.current === null || recharge.current === view.order.revision || attempt || busy) return;
    recharge.current = null;
    if (mode === "split" || mode === "none" || view.totals.due <= 0) return;
    const key = nextKey();
    void run(() => charge([{ key, method: mode, amount: view.totals.due }], key));
  });

  function saveCashTendered(leg: PaymentLeg, tendered: number | null) {
    if (!attempt) return;
    try { sessionStorage.setItem(cashDraftKey(attempt, leg), tendered?.toString() ?? ""); } catch { /* Use the server copy. */ }
    void actions.saveCashTendered({ ...ref(attempt), legKey: leg.key, tendered }).catch(() => undefined);
  }

  async function record(leg: PaymentLeg, outcome: LegOutcome, extra: { received?: number; reference?: string } = {}) {
    if (!attempt) return;
    await run(async () => {
      await actions.recordLeg({ ...ref(attempt), legKey: leg.key, direction: leg.direction, outcome, ...extra });
      if (outcome !== "unknown" && leg.method === "cash") {
        try { sessionStorage.removeItem(cashDraftKey(attempt, leg)); } catch { /* Storage is optional. */ }
      }
      if (outcome !== "taken") setArmedHere((armed) => { const next = new Set(armed); next.delete(leg.key); return next; });
    });
  }

  // Everything is taken: settle, once per attempt. A lost answer retries the same settle.
  const settled = useRef<string | null>(null);
  useEffect(() => {
    if (step?.kind !== "settle" || !attempt || busy || problem) return;
    if (settled.current === attempt.attemptId) return;
    settled.current = attempt.attemptId;
    void run(async () => {
      const result = await actions.settleAttempt({ ...ref(attempt), orderId, notifyGuest });
      if (!mounted.current) return;
      if (result.status === "settled") onPaid(orderId);
      else setProblem({ refusal: result.refusal });
    });
  });

  async function back() {
    if (busy || moneyHeld || instructing) return;
    if (attempt) {
      await run(async () => {
        await actions.cancelAttempt(ref(attempt));
        if (mounted.current) onBack();
      });
      return;
    }
    onBack();
  }

  // Escape leaves the panel when nothing is in flight, as the direct panel does.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || submitting) return;
      if (!root.current?.contains(document.activeElement)) return;
      if (document.querySelector('[data-info-tip][data-state$="open"]')) return;
      event.preventDefault();
      void back();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  });

  const refusal = problem && "refusal" in problem ? problem.refusal : null;
  const roomFirst = refusal?.code === "SERVER" && refusal.reason === "pay_room_first";
  async function payRoomFirst() {
    roomKey.current ??= newAttemptKey();
    await run(async () => {
      let split;
      try {
        split = await actions.payRoomFirst({ clientKey: roomKey.current!, orderId, orderRevision: view.order.revision });
      } catch (err) {
        if (!("lost" in payProblem(err))) roomKey.current = null;
        throw err;
      }
      roomKey.current = null;
      if (!mounted.current) return;
      recharge.current = view.order.revision;
      setRoomSplit({ shopOrderId: split.shopOrderId });
    });
  }

  const elsewhere = step?.kind === "elsewhere";
  // Nothing new starts while disconnected: the banner says why, and what was sent is kept.
  const tenderLocked = busy || moneyHeld || step?.kind === "recovery" || elsewhere || attempt?.status === "recovering" || !connected || loadingAttempt;
  // A give-back part, and a recovery child's part, show on their own; a split's parts show in place.
  const ownInstruction = instructing && (mode !== "split" || step.leg.direction === "giveBack" || attempt?.status === "recovering");
  return (
    <div ref={root} className="flex min-h-0 min-w-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] @container" data-testid="pay-panel" data-pay-desk="">
      <ConnectionNotice lost={problem !== null && "lost" in problem} busy={busy} onRetry={retry ?? undefined} />
      {mode === "none" ? (
        <button type="button" onClick={() => void back()} disabled={submitting} className="inline-flex min-h-11 items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
          <ArrowLeft aria-hidden className="size-4" /> {t("pay.backToOrder")}
        </button>
      ) : (
        <div role="group" aria-label={t("pay.takePaymentBy")} className="grid min-w-0 grid-cols-2 rounded-xl bg-muted p-0.5 @min-[18rem]:grid-cols-[1fr_1.5fr_1fr_1.2fr_1fr] @min-[18rem]:rounded-full">
          {ROW.map((item) => (
            <Button key={item} variant="ghost" aria-label={item === "split" ? t("pay.splitPayment") : undefined} aria-pressed={item === mode} disabled={tenderLocked}
              className={cn("h-11 min-w-0 rounded-full px-1 text-sm", item === mode && "bg-foreground text-background hover:bg-foreground hover:text-background disabled:opacity-100")}
              onClick={() => { if (item === "split") setMode("split"); else chooseMethod(item); }}>
              {item === "split" ? t("pay.split") : methodName(item)}
            </Button>
          ))}
        </div>
      )}

      {loadingAttempt ? <div className="grid min-h-28 place-items-center" data-testid="pay-loading"><Spinner /></div> : null}
      {roomSplit ? <LinkedShop shopOrderId={roomSplit.shopOrderId} onOpenOrder={onOpenOrder} /> : null}
      {elsewhere && attempt ? <InProgressElsewhere attempt={attempt} /> : null}
      {step?.kind === "checkPrevious" && step.leg.key !== arming ? <CheckPrevious key={step.leg.key} leg={step.leg} draft={attempt ? readCashDraft(attempt, step.leg) : undefined} busy={busy} onRecord={(outcome, extra) => void record(step.leg, outcome, extra)} onTendered={(tendered) => saveCashTendered(step.leg, tendered)} /> : null}
      {step?.kind === "recovery" && attempt ? (
        <Recovery attempt={attempt} view={view} busy={busy} run={run} nextKey={nextKey} arm={arm} onLeave={onBack} />
      ) : null}

      {roomFirst ? <Notice title={t("pay.payRoomFirst")}><p>{t("pay.payRoomFirstHint")}</p></Notice> : elsewhere && attempt && refusal?.code === "SERVER" && refusal.reason === "in_progress_elsewhere" ? null : <ProblemNotice problem={problem} />}

      {ownInstruction ? (
        <Instruction key={step.leg.key} leg={step.leg} busy={busy} onTendered={saveCashTendered} onRecord={(outcome, extra) => void record(step.leg, outcome, extra)} />
      ) : mode === "split" && !loadingAttempt && (step === null || step.kind === "plan" || step.kind === "instruct") ? (
        <SplitParts attempt={attempt} armedHere={armedHere} remaining={remaining} busy={busy || !connected} nextKey={nextKey} onTendered={saveCashTendered}
          onCharge={(plan, key) => void run(() => charge(plan, key))} onRecord={(leg, outcome, extra) => void record(leg, outcome, extra)} />
      ) : step?.kind === "settle" ? (
        <p role="status" className="text-sm text-muted-foreground">{t("pay.saving")}</p>
      ) : null}

      {booking && !elsewhere ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" className="size-5" checked={notifyGuest} disabled={step?.kind === "settle" || !connected} onChange={(e) => setEmailChoice({ value: e.target.checked, revision: attempt?.ownerRevision ?? 0 })} />
          {t("pay.notifyGuest")}
        </label>
      ) : null}
      {roomFirst ? <DeskButton busy={busy} className="mt-auto" onClick={() => void payRoomFirst()}>{t("pay.payRoomFirst")}</DeskButton> : null}
      {attempt?.mine && !elsewhere && (attempt.status === "collecting" || attempt.status === "recovering") && step?.kind !== "settle" ? (
        <HandOver key={attempt.ownerRevision} attempt={attempt} disabled={busy || !connected} />
      ) : null}
      {mode === "none" && !attempt && !loadingAttempt ? (
        <DeskButton busy={busy} disabled={!connected} className="mt-auto" onClick={() => void run(() => charge([], ""))}>{t("pay.closeNothingDue", { amount: money(0) })}</DeskButton>
      ) : null}
      <ReceivedOn value={businessDate} open={dateOpen} locked={moneyHeld || instructing} onToggle={() => setDateOpen(!dateOpen)}
        onChange={(date) => {
          setBusinessDate(date);
          // A started attempt froze its date: release it (nothing is held) so the next one uses the new one.
          if (attempt && !moneyHeld) void run(() => actions.cancelAttempt(ref(attempt)));
        }} />
    </div>
  );
}

/** "Charge ฿4,900 on the terminal": shown only after the part is armed. Confirm, or Not taken. */
type TenderEntry = { onTendered: (leg: PaymentLeg, tendered: number | null) => void };

function Instruction({ leg, busy, onTendered, onRecord }: TenderEntry & { leg: PaymentLeg; busy: boolean; onRecord: (outcome: LegOutcome, extra?: { received?: number }) => void }) {
  const cash = leg.method === "cash";
  const confirm = useRef<HTMLButtonElement>(null);
  // Once the part is armed (the button is enabled), Confirm takes focus.
  useEffect(() => { if (!cash && !busy) confirm.current?.focus({ preventScroll: true }); }, [cash, busy]);
  if (cash) return <CashParts leg={leg} busy={busy} onRecord={onRecord} onTendered={onTendered} />;
  return (
    <section data-testid="pay-instruction" className="grid gap-3">
      <p role="status" className="rounded-xl bg-muted/50 p-4 text-[15px] font-medium tabular-nums">{instruction(leg.method, leg.amount, leg.direction)}</p>
      <div className="sticky bottom-0 z-10 grid gap-2 bg-card py-1">
        <Button ref={confirm} className="h-14 min-h-14 w-full text-base font-sans tabular-nums" disabled={busy} data-testid="pay-confirm" onClick={() => onRecord("taken")}>
          {leg.direction === "giveBack" ? t("pay.givenBack") : t("pay.confirmAmount", { amount: money(leg.amount) })}
        </Button>
        <Button variant="outline" className="h-12 bg-transparent" disabled={busy} onClick={() => onRecord("notTaken")}>{leg.direction === "giveBack" ? t("pay.notGivenBack") : t("pay.notTaken")}</Button>
      </div>
    </section>
  );
}

/** "Collect ฿600 cash", what was handed over, the change, then "Confirm · ฿600 cash received". */
function CashParts({ leg, busy, onTendered, onRecord }: TenderEntry & { leg: PaymentLeg; busy: boolean; onRecord: (outcome: LegOutcome, extra?: { received?: number }) => void }) {
  const id = useId();
  const [received, setReceived] = useState(() => amountInput(String(satangToBaht(leg.amount))));
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    const reveal = () => { if (document.activeElement === input.current) input.current?.scrollIntoView({ block: "center" }); };
    viewport?.addEventListener("resize", reveal);
    return () => viewport?.removeEventListener("resize", reveal);
  }, []);
  const value = parseMoneyInput(received) || 0;
  const giveBack = leg.direction === "giveBack";
  const notes = giveBack ? [] : cashNotes(leg.amount);
  function enterCash(input: string) {
    const text = amountInput(input);
    setReceived(text);
    const tendered = parseMoneyInput(text);
    onTendered(leg, tendered >= leg.amount ? tendered : null);
  }
  return (
    <section data-testid="pay-instruction" className="grid gap-3">
      <p role="status" className="rounded-xl bg-muted/50 p-4 text-[15px] font-medium tabular-nums">{instruction("cash", leg.amount, leg.direction)}</p>
      {giveBack ? null : (
        <>
          <div className="grid gap-2">
            <Label htmlFor={`${id}-cash`} className="text-xs text-muted-foreground">{t("pay.cashReceived")}</Label>
            <div className="relative">
              <span aria-hidden className="pointer-events-none absolute inset-y-0 left-4 flex items-center font-sans text-2xl text-muted-foreground">฿</span>
              <Input id={`${id}-cash`} ref={input} inputMode="decimal" autoComplete="off" className="h-14 min-w-0 pr-3 pl-8 text-right font-sans text-2xl tabular-nums" {...selectAll}
                onFocus={(e) => { selectAll.onFocus(e); input.current?.scrollIntoView({ block: "center" }); }} value={received} onChange={(e) => enterCash(e.target.value)} placeholder="0" />
            </div>
          </div>
          {notes.length ? (
            <div role="group" aria-label={t("pay.notesHandedOver")} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,5rem),1fr))] gap-2">
              <Button variant="outline" aria-pressed={value === leg.amount} className="h-11 px-2 font-sans tabular-nums aria-pressed:bg-foreground/5 aria-pressed:ring-2 aria-pressed:ring-foreground" onClick={() => enterCash(String(satangToBaht(leg.amount)))}>{t("pay.exact")}</Button>
              {notes.map((note) => (
                <Button key={note} variant="outline" aria-pressed={value === note} className="h-11 px-2 font-sans tabular-nums aria-pressed:bg-foreground/5 aria-pressed:ring-2 aria-pressed:ring-foreground" onClick={() => enterCash(String(satangToBaht(note)))}>{formatMoney(note)}</Button>
              ))}
            </div>
          ) : null}
          <CashChange received={value} due={leg.amount} />
        </>
      )}
      <div className="sticky bottom-0 z-10 grid gap-2 bg-card py-1">
        <Button className="h-14 min-h-14 w-full whitespace-normal text-base font-sans tabular-nums" disabled={busy || (!giveBack && value < leg.amount)} data-testid="pay-confirm"
          onClick={() => onRecord("taken", giveBack ? {} : { received: value })}>
          {giveBack ? t("pay.givenBack") : value < leg.amount ? t("pay.short", { amount: money(leg.amount - value) }) : t("buttons.confirmCashReceived", { amount: money(leg.amount) })}
        </Button>
        <Button variant="outline" className="h-12 bg-transparent" disabled={busy} onClick={() => onRecord("notTaken")}>{giveBack ? t("pay.notGivenBack") : t("pay.notTaken")}</Button>
      </div>
    </section>
  );
}

type Part = { method: ExternalMethod; amount: string; key: string | null };

/**
 * Split payment: parts stay planned and editable until each part's own Charge or Collect. A taken
 * part never changes; the untouched rest stays editable. The last part takes whatever is left.
 * A part marked Not taken comes back editable under a new key.
 */
function SplitParts({ attempt, armedHere, remaining, busy, nextKey, onCharge, onTendered, onRecord }: TenderEntry & {
  attempt: PaymentAttemptView | null; armedHere: ReadonlySet<string>; remaining: number; busy: boolean; nextKey: () => string;
  onCharge: (plan: PayLegPlan[], legKey: string) => void; onRecord: (leg: PaymentLeg, outcome: LegOutcome, extra?: { received?: number }) => void;
}) {
  const id = useId();
  const legs = attempt ? collected(attempt.legs) : [];
  const held = legs.filter((leg) => leg.state === "taken" || isUnchecked(leg));
  const [parts, setParts] = useState<Part[]>(() => {
    const planned = legs.filter((leg) => leg.state === "planned");
    return planned.length
      ? planned.map((leg) => ({ method: leg.method, amount: String(satangToBaht(leg.amount)), key: leg.key }))
      : [{ method: "cash", amount: "", key: null }, { method: "promptpay", amount: "", key: null }];
  });
  const heldKeys = new Set(held.map((leg) => leg.key));
  const declinedKeys = new Set(legs.filter((leg) => leg.state === "declined").map((leg) => leg.key));
  const open = parts.filter((part) => !part.key || !heldKeys.has(part.key))
    .map((part) => (part.key && declinedKeys.has(part.key) ? { ...part, key: null } : part))
    .slice(0, Math.max(1, MAX_TENDERS - held.length));
  const instructed = held.find((leg) => showsInstruction(leg, armedHere));
  const typed = open.slice(0, -1);
  const rest = remaining - typed.reduce((sum, part) => sum + (parseMoneyInput(part.amount) || 0), 0);
  const amounts = [...typed.map((part) => parseMoneyInput(part.amount) || 0), Math.max(0, rest)];
  const ready = amounts.every((amount) => amount > 0) && !instructed;
  const emptyPart = typed.findIndex((part) => !(parseMoneyInput(part.amount) > 0));
  const validation = emptyPart >= 0 ? t("pay.enterPartAmount", { n: held.length + emptyPart + 1 }) : rest <= 0 && remaining > 0 ? t("pay.leaveRest") : "";
  const update = (index: number, patch: Partial<Part>) => setParts(open.map((part, i) => (i === index ? { ...part, ...patch, key: null } : part)));
  const unused = () => TENDER_METHODS.find((method) => !open.some((part) => part.method === method) && !held.some((leg) => leg.method === method)) ?? "card";
  const editable = !busy && !instructed;

  function chargePart(index: number) {
    // Keys stay with unchanged parts, so re-sending the same plan changes nothing on the server.
    const plan = open.map((part, i) => ({ key: part.key ?? nextKey(), method: part.method, amount: amounts[i] }));
    setParts(plan.map((leg) => ({ method: leg.method, amount: String(satangToBaht(leg.amount)), key: leg.key })));
    onCharge(plan, plan[index].key);
  }

  return (
    <>
      <ul className="grid gap-2" aria-label={t("pay.splitPayment")}>
        {held.map((leg, index) => (
          <li key={leg.key} className="grid gap-2 rounded-xl bg-muted/40 p-3" data-testid="split-part" data-state={leg.state}>
            <h3 className="flex items-center gap-1.5 text-sm font-medium tabular-nums">
              {leg.state === "taken" ? <Check aria-hidden className="size-4 shrink-0 text-emerald-700 dark:text-emerald-400" /> : null}
              {t("pay.part", { n: index + 1 })} · {leg.state === "taken" ? t("pay.partTaken", { method: methodName(leg.method), amount: money(leg.amount) }) : `${methodName(leg.method)} ${money(leg.amount)}`}
            </h3>
            {leg === instructed ? <Instruction leg={leg} busy={busy} onTendered={onTendered} onRecord={(outcome, extra) => onRecord(leg, outcome, extra)} /> : null}
          </li>
        ))}
        {remaining > 0 ? open.map((part, index) => {
          const n = held.length + index + 1;
          const isLast = index === open.length - 1;
          const amount = amounts[index];
          return (
            <li key={index} data-testid="split-part" data-state="planned" className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-muted/40 p-3 @min-[18rem]:grid-cols-[minmax(0,1fr)_minmax(6rem,8rem)_auto]">
              <h3 className="col-start-1 row-start-1 text-sm font-medium">{isLast ? t("pay.partRest", { n }) : t("pay.part", { n })}</h3>
              <div className="relative col-span-2 row-start-2 min-w-0 @min-[18rem]:col-span-1 @min-[18rem]:col-start-2 @min-[18rem]:row-start-1">
                <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-sans text-muted-foreground">฿</span>
                {isLast ? (
                  <output id={`${id}-${index}`} aria-label={t("pay.partAmount", { n })} className="flex h-11 items-center justify-end rounded-lg border border-dashed border-input pr-3 pl-7 font-sans text-sm tabular-nums">{money(Math.max(0, rest)).replace(/^฿/, "")}</output>
                ) : (
                  <Input id={`${id}-${index}`} inputMode="decimal" autoComplete="off" aria-label={t("pay.partAmount", { n })} aria-describedby={`${id}-validation`} disabled={!editable}
                    className="h-11 min-w-0 pl-7 text-right font-sans tabular-nums" value={part.amount} {...selectAll} onChange={(e) => update(index, { amount: amountInput(e.target.value) })} placeholder="0" />
                )}
              </div>
              {open.length > 1 && held.length + open.length > 2 ? (
                <Button size="icon" variant="ghost" className="col-start-2 row-start-1 size-11 shrink-0 @min-[18rem]:col-start-3" aria-label={t("pay.removePart", { n })} disabled={!editable} onClick={() => setParts(open.filter((_, i) => i !== index))}><X aria-hidden className="size-4" /></Button>
              ) : <span className="col-start-2 row-start-1 @min-[18rem]:col-start-3" />}
              <ToggleGroup variant="segmented" tone="subtle" value={part.method} onValueChange={(method: ExternalMethod) => { if (method) update(index, { method }); }} aria-label={t("pay.partMethod", { n })} disabled={!editable}
                className="col-span-2 row-start-3 grid min-w-0 grid-cols-2 @min-[18rem]:col-span-3 @min-[18rem]:row-start-2 @min-[18rem]:grid-cols-[1fr_1.5fr_1fr_1.2fr]">
                {TENDER_METHODS.map((method) => <ToggleGroupItem key={method} value={method} className="min-w-0 px-1 text-sm group-data-[variant=segmented]/toggle:h-11">{methodName(method)}</ToggleGroupItem>)}
              </ToggleGroup>
              <Button className="col-span-2 row-start-4 h-11 font-sans tabular-nums @min-[18rem]:col-span-3 @min-[18rem]:row-start-3" disabled={!ready || busy} onClick={() => chargePart(index)}>
                {t(part.method === "cash" ? "pay.collectPart" : "pay.chargePart", { amount: money(amount) })}
              </Button>
            </li>
          );
        }) : null}
      </ul>
      {remaining > 0 && rest > 0 && ready ? (
        <p data-testid="split-remaining" role="status" className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 font-sans text-sm font-medium tabular-nums text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300">
          <Check aria-hidden className="size-4 shrink-0" />{t("pay.covered", { amount: money(remaining + held.filter((leg) => leg.state === "taken").reduce((sum, leg) => sum + leg.amount, 0)), count: held.length + open.length })}
        </p>
      ) : rest < 0 ? <p role="status" className="rounded-xl bg-destructive/5 p-3 text-sm text-destructive">{t("pay.over", { amount: money(-rest) })}</p> : null}
      {remaining > 0 && held.length + open.length < MAX_TENDERS ? (
        <Button variant="ghost" className="h-11 min-w-11 self-start px-2" disabled={!editable} onClick={() => setParts([...typed, { method: unused(), amount: "", key: null }, open[open.length - 1]])}>
          <Plus aria-hidden className="size-4" /> {t("pay.addPart")}
        </Button>
      ) : null}
      <p id={`${id}-validation`} aria-live="polite" className="text-xs text-amber-800 empty:hidden dark:text-amber-300">{validation}</p>
    </>
  );
}

/**
 * Money taken · sale not saved (D18). The server works out what was kept and what is still due;
 * the panel offers its one next step, or only Swap or Give back while the refusal still applies.
 */
function Recovery({ attempt, view, busy, run, nextKey, arm, onLeave }: {
  attempt: PaymentAttemptView; view: OrderView; busy: boolean; run: (work: () => Promise<unknown>) => Promise<void>;
  nextKey: () => string; arm: (legKey: string, call: () => Promise<boolean>) => Promise<void>; onLeave: () => void;
}) {
  const actions = useCommerce().useActions();
  const [preview, setPreview] = useState<RecoveryPreview | null>(() => attempt.recovery ? fromView(attempt) : null);
  const [choosing, setChoosing] = useState(false);
  const review = { orderRevision: view.order.revision, customers: reviewedCustomers(view), vouchers: attempt.vouchers.map(({ voucherId, paid, goodwill }) => ({ voucherId, paid, goodwill })) };
  const ref = { attemptId: attempt.attemptId, ownerRevision: attempt.ownerRevision };
  const recoveryKey = useRef(newAttemptKey());
  const tag = `${attempt.attemptId}:${attempt.legs.map((leg) => `${leg.key}=${leg.state}`).join()}:${view.order.revision}`;
  const loaded = useRef<string | null>(attempt.recovery ? tag : null);
  useEffect(() => {
    if (busy || loaded.current === tag) return;
    loaded.current = tag;
    void run(async () => setPreview(await actions.previewRecovery({ ...ref, ...review })));
  });

  async function act(step: RecoveryStep) {
    await run(async () => {
      if (step.action === "giveBack") {
        await arm(step.leg.key, async () => (await actions.recover({ clientKey: recoveryKey.current, ...ref, ...review, ...step })).instructed);
        return;
      }
      const { child } = await actions.recover({ clientKey: recoveryKey.current, ...ref, ...review, ...step });
      if (step.action === "swap") onLeave();
      if (step.action === "collectRest" && child) {
        const [leg] = step.legs;
        await arm(leg.key, async () => (await actions.armLeg({ attemptId: child.attemptId, ownerRevision: child.ownerRevision, legKey: leg.key })).instructed);
      }
    });
  }

  const kept = preview?.kept ?? [];
  const keptTotal = kept.reduce((sum, tender) => sum + tender.amount, 0);
  // Money taken and then given back: both facts and the ฿0 kept, so the next person can check the terminal.
  const givenBack = attempt.legs.filter((leg) => leg.direction === "giveBack" && leg.state === "taken");
  const reason = preview?.refusal ?? attempt.refusal;
  const swap = attempt.refusal?.code === "SERVER" && attempt.refusal.reason === "swap_requested";
  const giveBackLeg = (amount: number, cancelSale = false): RecoveryStep | null => {
    const from = kept.find((tender) => tender.amount >= amount) ?? kept[0];
    return from ? { action: "giveBack", leg: { key: nextKey(), method: from.method, amount: Math.min(amount, from.amount) }, cancelSale } : null;
  };
  return (
    <section data-testid="pay-recovery" className="grid gap-3">
      {keptTotal ? (
        <Notice tone="danger" title={t("buttons.moneyTakenSaleNotSaved")}>
          {reason && !swap ? <p>{t("pay.whatChanged", { reason: payRefusalText(reason) })}</p> : null}
          <ul className="mt-1 grid gap-0.5 tabular-nums">{kept.map((tender) => <li key={tender.method}>{methodName(tender.method)} · {t("pay.kept", { amount: money(tender.amount) })}</li>)}</ul>
        </Notice>
      ) : givenBack.length ? (
        <Notice testId="money-given-back" title={t("pay.moneyGivenBack")}>
          {reason && !swap ? <p>{t("pay.whatChanged", { reason: payRefusalText(reason) })}</p> : null}
          <ul className="mt-1 grid gap-0.5 tabular-nums">
            {collected(attempt.legs).filter((leg) => leg.state === "taken").map((leg) => <li key={leg.key}>{t("pay.takenAmount", { method: methodName(leg.method), amount: money(leg.amount) })}</li>)}
            {givenBack.map((leg) => <li key={leg.key}>{t("pay.givenBackAmount", { method: methodName(leg.method), amount: money(leg.amount) })}</li>)}
            <li className="font-semibold">{t("pay.keptTotal", { amount: money(keptTotal) })}</li>
          </ul>
          <p className="mt-1">{t("pay.reviewThenPay")}</p>
        </Notice>
      ) : reason && !swap ? <Notice title={payRefusalText(reason)}><p>{t("pay.nothingTaken")}</p></Notice> : null}
      {!preview ? null : !keptTotal && (givenBack.length > 0 || preview.next !== "finish") ? (
        <DeskButton variant="outline" busy={busy} onClick={() => void run(async () => { await actions.cancelAttempt(ref); onLeave(); })}>{t("pay.reviewOrder")}</DeskButton>
      ) : preview.next === "collect" ? (
        choosing ? (
          <div role="group" aria-label={t("pay.payRestBy")} className="grid gap-2">
            <p className="text-sm font-medium">{t("pay.payRestBy")}</p>
            <div className="grid grid-cols-2 gap-2">
              {methodsWithinRows(kept, attempt.vouchers.filter((voucher) => voucher.paid > 0).length, TENDER_METHODS).map((method) => (
                <Button key={method} variant="outline" className="h-12 bg-transparent" disabled={busy}
                  onClick={() => void act({ action: "collectRest", legs: [{ key: nextKey(), method, amount: preview.balance }] })}>{methodName(method)}</Button>
              ))}
            </div>
          </div>
        ) : <DeskButton busy={busy} onClick={() => setChoosing(true)}>{t("pay.collectRest", { amount: money(preview.balance) })}</DeskButton>
      ) : preview.next === "finish" ? (
        <DeskButton busy={busy} onClick={() => void act({ action: "finishSale" })}>{t(swap ? "pay.finishSwap" : "pay.finishSale")}</DeskButton>
      ) : preview.next === "giveBack" ? (
        <DeskButton busy={busy} onClick={() => { const step = giveBackLeg(-preview.balance); if (step) void act(step); }}>{t("pay.giveBack", { amount: money(-preview.balance) })}</DeskButton>
      ) : (
        <div className="grid gap-2">
          <DeskButton busy={busy} onClick={() => void act({ action: "swap" })}>{t("pay.swapItem")}</DeskButton>
          <DeskButton variant="outline" busy={busy} onClick={() => { const step = giveBackLeg(keptTotal, true); if (step) void act(step); }}>{t("pay.giveAllBack")}</DeskButton>
        </div>
      )}
    </section>
  );
}

/** A canned view (the design fixture) already carries its recovery. */
function fromView(attempt: PaymentAttemptView): RecoveryPreview {
  const recovery = attempt.recovery!;
  const kept = collected(attempt.legs).filter((leg) => leg.state === "taken").map(({ method, amount }) => ({ method, amount }));
  const action = recovery.action;
  return {
    kept, balance: action.kind === "giveBack" ? -action.amount : recovery.stillDue,
    next: action.kind === "collectRest" ? "collect" : action.kind === "giveBack" ? "giveBack" : action.kind === "swapOrGiveBack" ? "swapOrGiveBack" : "finish",
    refusal: action.kind === "swapOrGiveBack" ? action.reason : null,
  };
}

/** "Received today · Change date": a past business date, frozen once a part is armed. */
function ReceivedOn({ value, open, locked, onToggle, onChange }: { value: string; open: boolean; locked: boolean; onToggle: () => void; onChange: (date: string) => void }) {
  const id = useId();
  const today = todayBusinessDate();
  return (
    <div className="grid min-w-0 gap-2">
      <p className="flex min-h-11 flex-wrap items-center justify-center gap-x-1.5 text-center text-[13px] text-muted-foreground">
        <span>{value === today ? t("pay.receivedToday") : t("pay.receivedOn", { date: value })}</span>
        <span aria-hidden>·</span>
        <Button type="button" variant="link" aria-expanded={open} aria-controls={id} disabled={locked} className="min-h-11 px-0 text-[13px] text-muted-foreground underline underline-offset-4" onClick={onToggle}>{t("pay.changeDate")}</Button>
      </p>
      {locked && open ? <p className="text-center text-xs text-muted-foreground">{t("pay.dateLocked")}</p> : null}
      {open && !locked ? (
        <div id={id} className="grid gap-2 rounded-xl border border-border/70 px-2 py-3">
          <Label htmlFor={`${id}-date`}>{t("pay.dateLabel")}</Label>
          <Input id={`${id}-date`} type="date" max={today} className="min-w-0 max-w-full" value={value} onChange={(e) => { if (e.target.value && e.target.value <= today) onChange(e.target.value); }} />
        </div>
      ) : null}
    </div>
  );
}

/** After Pay the room first: the stay's Shop & spa balance, one tap away. */
function LinkedShop({ shopOrderId, onOpenOrder }: { shopOrderId: OrderId; onOpenOrder?: (orderId: OrderId) => void }) {
  const shop = useCheckoutBackend().useOrder(shopOrderId);
  if (!shop) return null;
  return (
    <div data-testid="linked-shop" className="flex min-h-11 items-center justify-between gap-3 rounded-xl border border-border/70 px-3 py-2 text-sm">
      <span className="font-medium tabular-nums">{t("pay.shopAndSpa", { amount: money(shop.totals.due) })}</span>
      {onOpenOrder ? <Button variant="outline" className="h-11 bg-transparent" onClick={() => onOpenOrder(shopOrderId)}>{t("pay.open")}</Button> : null}
    </div>
  );
}
