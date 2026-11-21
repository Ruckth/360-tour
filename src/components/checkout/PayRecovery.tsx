"use client";

import { CircleAlert, CloudOff, RefreshCw, TriangleAlert } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { parseMoneyInput } from "@/lib/money-input";
import { satangToBaht } from "convex/shared/money";
import { cn } from "@/lib/utils";
import { errorText } from "@/lib/staff-bookings";
import type { Id } from "convex/_generated/dataModel";
import { useCommerce, type DirectPanelPrevious, type LegOutcome, type OrderId, type OrderView, type PaymentAttemptView, type PaymentLeg } from "./backend";
import { amountInput } from "./checkout-ui";
import { payProblem, type Problem } from "./pay-desk-problem";
import { methodName, payCopy, payRefusalText } from "./pay-desk-copy";

/*
 * Recovery layers for the attempt flow (v27 Paying, D18): check a previous instruction, another
 * till's payment, money taken but the sale not saved, the checkout pause and the reload screen.
 * Each offers one next step and never a fresh instruction for money that may already be taken.
 */

const { t, money } = payCopy;
export { payProblem, type Problem };

/** A full-width money action, the panel's main control. */
export function DeskButton({ busy, disabled, onClick, children, variant = "default", className, ...rest }: {
  busy?: boolean; disabled?: boolean; onClick: () => void; children: ReactNode; variant?: "default" | "outline"; className?: string; "aria-label"?: string; "data-testid"?: string;
}) {
  return (
    <Button variant={variant} className={cn("h-14 min-h-14 w-full whitespace-normal text-base font-sans tabular-nums", variant === "outline" && "h-12 min-h-12 bg-transparent", className)} disabled={busy || disabled} onClick={onClick} {...rest}>
      {busy ? <Spinner className="text-current" /> : null}
      {children}
    </Button>
  );
}

export function Notice({ tone = "warning", title, children, testId }: { tone?: "warning" | "danger" | "info"; title: ReactNode; children?: ReactNode; testId?: string }) {
  const Icon = tone === "danger" ? TriangleAlert : CircleAlert;
  return (
    <div role={tone === "info" ? "status" : "alert"} data-testid={testId} className={cn("grid gap-1 rounded-xl border p-3 text-sm",
      tone === "danger" ? "border-destructive/30 bg-destructive/5 text-destructive" : tone === "info" ? "border-border bg-muted/50 text-foreground" : "border-amber-300/80 bg-amber-50 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200")}>
      <p className="flex items-start gap-2 font-semibold"><Icon aria-hidden className="mt-0.5 size-4 shrink-0" /><span className="min-w-0 [overflow-wrap:anywhere]">{title}</span></p>
      {children ? <div className="min-w-0 pl-6 [overflow-wrap:anywhere]">{children}</div> : null}
    </div>
  );
}

/**
 * Offline, or a step that got no answer. Offline, nothing new can start; a step already sent waits
 * and goes through once the connection is back. A step with no answer offers Retry, which repeats
 * the same keyed step.
 */
export function ConnectionNotice({ lost, busy, onRetry }: { lost: boolean; busy: boolean; onRetry?: () => void }) {
  const online = useCommerce().useConnected();
  if (online && !lost) return null;
  const text = online ? t("pay.noAnswer") : busy ? t("pay.offlineSending") : lost ? t("pay.offlineRetry") : t("pay.offline");
  return (
    <div role="alert" data-testid="pay-offline" className="grid gap-2 rounded-xl border border-amber-300/80 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
      <p className="flex items-start gap-2"><CloudOff aria-hidden className="mt-0.5 size-4 shrink-0" />{text}</p>
      {lost && onRetry ? <Button variant="outline" className="h-11 bg-transparent" disabled={busy || !online} onClick={onRetry}>{busy ? <Spinner className="text-current" /> : <RefreshCw aria-hidden className="size-4" />}{t("pay.retry")}</Button> : null}
    </div>
  );
}

/** A refusal in place: the pause and reload screens for the cutover's two, a sentence otherwise. */
export function ProblemNotice({ problem }: { problem: Problem | null }) {
  if (!problem || "lost" in problem) return null;
  if (problem.refusal.code === "CHECKOUT_PAUSED") return <CheckoutPaused />;
  if (problem.refusal.code === "TILL_NEEDS_RELOAD") return <TillReload />;
  return <p role="alert" className="text-sm text-destructive [overflow-wrap:anywhere]">{payRefusalText(problem.refusal)}</p>;
}

/** "Change ฿500" once more cash was handed over than is due. */
export function CashChange({ received, due }: { received: number; due: number }) {
  if (received <= due) return null;
  return (
    <div role="status" className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 p-4">
      <span className="text-sm">{t("pay.change", { amount: "" }).trim()}</span>
      <output data-testid="cash-change" className="text-[32px] leading-none font-semibold text-emerald-700 font-sans tabular-nums dark:text-emerald-400">{money(received - due)}</output>
    </div>
  );
}

/**
 * Check previous payment: an instruction this panel didn't show (a reload, another device, a
 * takeover). It names the earlier payment or give-back by method, amount and time and asks what
 * the terminal or drawer shows; it never repeats the instruction, so nothing is charged or
 * refunded twice from here.
 */
export function CheckPrevious({ leg, draft, busy, onRecord, onTendered }: {
  leg: PaymentLeg; draft?: number | null; busy: boolean;
  onRecord: (outcome: LegOutcome, extra: { received?: number; reference?: string }) => void;
  /** Keeps a corrected cash entry (or none, while short) for the next interruption. */
  onTendered?: (tendered: number | null) => void;
}) {
  const id = useId();
  const cash = leg.method === "cash";
  const tendered = draft === undefined ? leg.tendered : draft;
  const [received, setReceived] = useState(() => tendered == null ? "" : amountInput(String(satangToBaht(tendered))));
  const [reference, setReference] = useState(leg.reference ?? "");
  const value = parseMoneyInput(received) || 0;
  const giveBack = leg.direction === "giveBack";
  const at = leg.instructedAt ?? 0;
  const title = giveBack ? (cash ? "pay.checkPreviousCashBack" : "pay.checkPreviousRefund") : cash ? "pay.checkPreviousCash" : "pay.checkPreviousPayment";
  return (
    <section aria-labelledby={`${id}-title`} data-testid="check-previous" className="grid gap-3">
      <div className="grid gap-1 rounded-xl border border-amber-300/80 bg-amber-50 p-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><TriangleAlert aria-hidden className="size-4 shrink-0" />{t(title)}</h3>
        <p className="pl-6 text-[15px] font-medium tabular-nums">{t("pay.previousLeg", { method: methodName(leg.method), amount: money(leg.amount), time: at ? payCopy.time(at) : "" }).replace(/ · $/, "")}</p>
        {giveBack ? <p className="pl-6 text-sm">{t("pay.previousGiveBackHint")}</p> : null}
        <p className="pl-6 text-sm">{t(cash ? "pay.drawerShows" : "pay.terminalShows")}</p>
        {leg.state === "unknown" ? <p className="pl-6 text-xs">{t("pay.unknownHint")}</p> : null}
      </div>
      {cash && !giveBack ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-cash`} className="text-xs text-muted-foreground">{t("pay.cashReceived")}</Label>
          <Input id={`${id}-cash`} inputMode="decimal" autoComplete="off" className="h-12 text-right font-sans text-lg tabular-nums" value={received} onChange={(e) => {
            const text = amountInput(e.target.value);
            setReceived(text);
            const tendered = parseMoneyInput(text);
            onTendered?.(tendered >= leg.amount ? tendered : null);
          }} />
          <CashChange received={value} due={leg.amount} />
        </div>
      ) : !cash ? (
        <div className="grid gap-1.5">
          <Label htmlFor={`${id}-ref`} className="text-xs text-muted-foreground">{t("pay.referenceOptional")}</Label>
          <Input id={`${id}-ref`} autoComplete="off" maxLength={160} className="h-11" value={reference} onChange={(e) => setReference(e.target.value)} />
        </div>
      ) : null}
      <div className="grid gap-2">
        <DeskButton busy={busy} disabled={cash && !giveBack && value < leg.amount} data-testid="previous-taken" onClick={() => onRecord("taken", cash ? (giveBack ? {} : { received: value }) : { reference: reference.trim() || undefined })}>
          {giveBack ? t("pay.givenBack") : cash && value < leg.amount ? t("pay.short", { amount: money(leg.amount - value) }) : t("pay.legTaken")}
        </DeskButton>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="outline" className="h-12 bg-transparent" disabled={busy} onClick={() => onRecord("notTaken", {})}>{giveBack ? t("pay.notGivenBack") : t("pay.notTaken")}</Button>
          <Button variant="outline" className="h-12 bg-transparent" disabled={busy} onClick={() => onRecord("unknown", {})}>{t("pay.legUnknown")}</Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Hand over (v27 Handover): the owner picks another admitted till; the payment continues there once
 * that till accepts. This till's own label is shown so staff can tell the tills apart.
 */
export function HandOver({ attempt, disabled }: { attempt: PaymentAttemptView; disabled?: boolean }) {
  const commerce = useCommerce();
  const actions = commerce.useActions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const tills = commerce.useHandoverTills(open);
  async function handOver(nextTillId: string) {
    setBusy(true);
    setProblem(null);
    try {
      await actions.handOver({ attemptId: attempt.attemptId, ownerRevision: attempt.ownerRevision, nextTillId });
    } catch (err) {
      setProblem(payProblem(err));
    } finally {
      setBusy(false);
    }
  }
  if (!open) {
    return (
      <Button variant="ghost" className="h-11 self-start px-3 text-sm text-muted-foreground" disabled={disabled} onClick={() => setOpen(true)} data-testid="pay-hand-over">
        {t("pay.handOver")}
      </Button>
    );
  }
  return (
    <section className="grid gap-2 rounded-xl border border-border p-3 text-sm" aria-label={t("pay.handOver")} data-testid="pay-hand-over-picker">
      <p className="text-muted-foreground">{t("pay.handOverHint")}</p>
      {tills?.thisTill ? <p className="text-xs text-muted-foreground">{t("pay.thisTill", { till: tills.thisTill })}</p> : null}
      {tills === undefined ? <Spinner /> : tills.tills.length ? (
        <div className="grid gap-2">
          {tills.tills.map((till) => (
            <Button key={till.tillId} variant="outline" className="h-12 bg-transparent" disabled={busy || disabled} onClick={() => void handOver(till.tillId)}>
              {busy ? <Spinner className="text-current" /> : null}{t("pay.handOverTo", { till: till.label })}
            </Button>
          ))}
        </div>
      ) : <p>{t("pay.noOtherTill")}</p>}
      <Button variant="ghost" className="h-11 justify-self-start px-3" disabled={busy} onClick={() => setOpen(false)}>{t("pay.keepPayment")}</Button>
      <ConnectionNotice lost={problem !== null && "lost" in problem} busy={busy} />
      <ProblemNotice problem={problem} />
    </section>
  );
}

/**
 * Another till is taking this order's payment. A manager can take over after checking the terminal;
 * a payment handed over to this till is accepted here by anyone at it.
 */
export function InProgressElsewhere({ attempt, compact, onTakenOver }: { attempt: PaymentAttemptView; compact?: boolean; onTakenOver?: () => void }) {
  const actions = useCommerce().useActions();
  const manager = useStaffAccess().capabilities.approve;
  const handed = attempt.handedOverTo ?? null;
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const id = useId();
  const staff = attempt.staffName || t("pay.anotherTill");
  async function takeOver() {
    setBusy(true);
    setProblem(null);
    try {
      await actions.takeOver({ orderId: attempt.orderId, ownerRevision: attempt.ownerRevision, stoppedPreviousOperator: stopped });
      onTakenOver?.();
    } catch (err) {
      setProblem(payProblem(err));
    } finally {
      setBusy(false);
    }
  }
  if (handed?.here) {
    return (
      <div className={cn("grid gap-2", compact && "text-sm")} data-testid="payment-handed-here">
        <Notice tone="info" title={t("pay.handedOverHere")}><p>{t("pay.acceptHint")}</p></Notice>
        <DeskButton busy={busy} onClick={() => void takeOver()}>{t("pay.acceptHandover")}</DeskButton>
        <ConnectionNotice lost={problem !== null && "lost" in problem} busy={busy} onRetry={() => void takeOver()} />
        <ProblemNotice problem={problem} />
      </div>
    );
  }
  return (
    <div className={cn("grid gap-2", compact && "text-sm")} data-testid="payment-elsewhere">
      <Notice title={handed ? t("pay.handedOverTo", { till: handed.label || t("pay.anotherTill") }) : t("pay.inProgressOn", { till: attempt.tillLabel || t("pay.anotherTill"), staff: attempt.staffName || "" }).replace(/ · $/, "")}>
        {manager ? null : <p>{t("pay.managerTakesOver")}</p>}
      </Notice>
      {manager ? (
        <>
          <label htmlFor={`${id}-stopped`} className="flex min-h-11 items-center gap-3 text-sm">
            <input id={`${id}-stopped`} type="checkbox" className="size-5" checked={stopped} onChange={(e) => setStopped(e.target.checked)} />
            {t("pay.operatorStopped", { staff })}
          </label>
          <Button variant="outline" className="h-12 bg-transparent" disabled={busy || !stopped} onClick={() => void takeOver()}>{busy ? <Spinner className="text-current" /> : null}{t("pay.takeOver")}</Button>
        </>
      ) : null}
      <ConnectionNotice lost={problem !== null && "lost" in problem} busy={busy} onRetry={() => void takeOver()} />
      <ProblemNotice problem={problem} />
    </div>
  );
}

/** The direct panel couldn't register: Retry after a lost answer, another till's panel, or the refusal; Back to order either way. */
export function DirectPanelProblem({ error, orderId, onRetry, onBack }: { error: unknown; orderId: OrderId; onRetry: () => void; onBack: () => void }) {
  const problem = payProblem(error);
  const data = (error as { data?: unknown } | null)?.data;
  const elsewhere = problem && "refusal" in problem && problem.refusal.code === "SERVER" && problem.refusal.reason === "PAY_PANEL_ELSEWHERE"
    ? data as { tillKey?: string; openedAt?: number; tillId?: Id<"tills">; panelKey?: string } : null;
  return (
    <div className="grid gap-3 px-4 py-3">
      {elsewhere ? <DirectPanelElsewhere {...elsewhere} orderId={orderId} onTakenOver={onRetry} /> : "lost" in problem ? (
        <>
          <p role="alert" className="text-sm text-destructive">{t("pay.panelDidNotOpen")}</p>
          <Button className="h-12" onClick={onRetry}>{t("pay.retry")}</Button>
        </>
      ) : <ProblemNotice problem={problem} />}
      <Button variant="outline" className="h-12 bg-transparent" onClick={onBack}>{t("pay.backToOrder")}</Button>
    </div>
  );
}

/**
 * Another till or tab holds this order's open direct panel (from the cutover's first pause on). A
 * manager can take it over here after checking the terminal and drawer; this till then checks it.
 */
function DirectPanelElsewhere({ orderId, tillKey, openedAt, tillId, panelKey, onTakenOver }: {
  orderId: OrderId; tillKey?: string; openedAt?: number; tillId?: Id<"tills">; panelKey?: string; onTakenOver: () => void;
}) {
  const actions = useCommerce().useActions();
  const manager = useStaffAccess().capabilities.approve && tillId !== undefined && panelKey !== undefined;
  const [stopped, setStopped] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const id = useId();
  async function takeOver() {
    setBusy(true);
    setProblem(null);
    try {
      const { claimTabKey } = await import("./pay-desk-tab");
      await actions.takeOverDirectPanel({ orderId, tillId: tillId!, panelKey: panelKey!, tabKey: await claimTabKey(), stoppedPreviousOperator: stopped });
      onTakenOver();
    } catch (err) {
      setProblem(payProblem(err));
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-2" data-testid="payment-elsewhere">
      <Notice title={t("pay.inProgressOn", { till: tillKey || t("pay.anotherTill"), staff: openedAt ? payCopy.time(openedAt) : "" }).replace(/ · $/, "")}>
        {manager ? null : <p>{t("pay.managerTakesOver")}</p>}
      </Notice>
      {manager ? (
        <>
          <label htmlFor={`${id}-stopped`} className="flex min-h-11 items-center gap-3 text-sm">
            <input id={`${id}-stopped`} type="checkbox" className="size-5" checked={stopped} onChange={(e) => setStopped(e.target.checked)} />
            {t("pay.operatorStopped", { staff: tillKey || t("pay.anotherTill") })}
          </label>
          <Button variant="outline" className="h-12 bg-transparent" disabled={busy || !stopped} onClick={() => void takeOver()}>{busy ? <Spinner className="text-current" /> : null}{t("pay.takeOver")}</Button>
        </>
      ) : null}
      <ConnectionNotice lost={problem !== null && "lost" in problem} busy={busy} onRetry={() => void takeOver()} />
      <ProblemNotice problem={problem} />
    </div>
  );
}

/**
 * Check previous payment for a direct panel this tab left unrecorded: its instruction may have been
 * paid, so nothing is charged from here. It names what was asked for. Taken records exactly that
 * (also while checkout is paused); Not taken opens the usual panel, or during the pause leaves the
 * panel to a manager. Anything else (another method or amount, an order changed since, or an
 * instruction that wasn't saved) goes to a manager.
 */
export function DirectCheckPrevious({ previous, paused, manager, busy, onChecked, onBack }: {
  previous: DirectPanelPrevious; paused: boolean; manager: boolean; busy: boolean;
  onChecked: (outcome: "taken" | "notTaken" | "manager") => void; onBack: () => void;
}) {
  const id = useId();
  const root = useRef<HTMLElement>(null);
  // Focus starts inside the panel, on the first answer.
  useEffect(() => { root.current?.querySelector("button")?.focus({ preventScroll: true }); }, [manager]);
  const { instruction, matches } = previous;
  if (manager) {
    return (
      <section ref={root} data-testid="pay-panel" className="grid flex-1 content-start gap-3 px-4 py-3">
        {paused ? <CheckoutPaused /> : null}
        <Notice tone="info" title={t("pay.askManagerReconcile")} />
        <Button variant="outline" className="h-12 bg-transparent" onClick={onBack}>{t("pay.backToOrder")}</Button>
      </section>
    );
  }
  const time = payCopy.time(instruction?.at ?? previous.openedAt);
  return (
    <section ref={root} aria-labelledby={`${id}-title`} data-testid="pay-panel" className="grid flex-1 content-start gap-3 px-4 py-3">
      <div data-testid="check-previous" className="grid gap-1 rounded-xl border border-amber-300/80 bg-amber-50 p-3 text-amber-900 dark:border-amber-400/30 dark:bg-amber-400/10 dark:text-amber-200">
        <h3 id={`${id}-title`} className="flex items-center gap-2 text-sm font-semibold"><TriangleAlert aria-hidden className="size-4 shrink-0" />{t("pay.checkPreviousPayment")}</h3>
        {instruction?.tenders.length ? instruction.tenders.map((tender, index) => (
          <p key={index} className="pl-6 text-[15px] font-medium tabular-nums">{t("pay.previousLeg", { method: methodName(tender.method), amount: money(tender.amount), time })}</p>
        )) : <p className="pl-6 text-[15px] font-medium tabular-nums">{t("pay.previousPanel", { time })}</p>}
        <p className="pl-6 text-sm">{t("pay.previousPanelHint")}</p>
        {!matches ? <p data-testid="previous-unmatched" className="pl-6 text-sm">{t(instruction ? "pay.orderChangedSinceShown" : "pay.instructionNotSaved")} {t("pay.askManagerReconcile")}</p> : null}
      </div>
      {matches ? <DeskButton busy={busy} data-testid="previous-taken" onClick={() => onChecked("taken")}>{t("pay.legTaken")}</DeskButton> : null}
      <div className="grid grid-cols-2 gap-2">
        <Button variant="outline" className="h-12 bg-transparent" disabled={busy} onClick={() => onChecked("notTaken")}>{t("pay.notTaken")}</Button>
        <Button variant="outline" className="h-12 bg-transparent" disabled={busy} data-testid="previous-other" onClick={() => onChecked("manager")}>{t(matches ? "pay.differentOrUnsure" : "buttons.askManager")}</Button>
      </div>
    </section>
  );
}

/** Above the direct panel while it records an earlier panel's payment. */
export function DirectRecordPrevious() {
  return <Notice tone="info" testId="record-previous" title={t("pay.recordPrevious")} />;
}

/** "Checkout paused for update": open panels finish; new payments wait for the switch. */
export function CheckoutPaused() {
  return <Notice testId="checkout-paused" title={t("pay.pausedForUpdate")}><p>{t("pay.pausedBody")}</p></Notice>;
}

/** The till loaded before the cutover: it reloads before it can take payments again. */
export function TillReload() {
  return (
    <div className="grid gap-2" data-testid="till-reload">
      <Notice title={t("pay.reloadToContinue")}><p>{t("pay.reloadBody")}</p></Notice>
      <Button className="h-12" onClick={() => window.location.reload()}><RefreshCw aria-hidden className="size-4" />{t("pay.reload")}</Button>
    </div>
  );
}

/** What the order panel shows instead of its pay buttons while an attempt holds the order. */
export function PaymentLock({ view, attempt, onResume }: { view: OrderView; attempt: PaymentAttemptView | null | undefined; onResume: () => void }) {
  if (attempt === undefined) return <div className="grid h-14 place-items-center"><Spinner /></div>;
  if (!attempt || !attempt.mine) {
    const fallback: PaymentAttemptView = attempt ?? {
      attemptId: view.paymentAttempt!._id, orderId: view.order._id, status: view.paymentAttempt!.status, ownerRevision: view.paymentAttempt!.ownerRevision,
      tillLabel: "", staffName: "", mine: false, due: view.paymentAttempt!.due, legs: [], vouchers: [], refusal: null, recovery: null, startedAt: 0,
    };
    return <InProgressElsewhere attempt={fallback} compact onTakenOver={onResume} />;
  }
  const refused = attempt.status === "refused" && attempt.legs.some((leg) => leg.state === "taken");
  return (
    <div className="grid gap-2" data-testid="payment-lock">
      {refused ? <Notice tone="danger" title={t("buttons.moneyTakenSaleNotSaved")} /> : null}
      <DeskButton onClick={onResume}>{t("pay.resumePayment")}</DeskButton>
    </div>
  );
}

/** An instruction waiting to be saved on the panel's registration, or one that wasn't saved, with Try again. */
export function InstructionSaving({ failed, onRetry }: { failed: unknown; onRetry: () => void }) {
  if (!failed) {
    return (
      <p role="status" data-testid="instruction-saving" className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner className="size-4" label="Saving" /> {t("pay.savingPayment")}
      </p>
    );
  }
  return (
    <div role="alert" data-testid="instruction-unsaved" className="grid gap-3 text-sm">
      <p className="text-destructive [overflow-wrap:anywhere]">{errorText(failed, t("pay.paymentNotSavedYet"))}</p>
      <Button variant="outline" className="h-12" onClick={onRetry}>{t("pay.tryAgain")}</Button>
    </div>
  );
}
