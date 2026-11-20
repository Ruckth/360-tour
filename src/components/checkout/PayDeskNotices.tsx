"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { newAttemptKey, useCommerce, type OrderId, type OrderView } from "./backend";
import type { PayMode } from "./pay-desk";
import { reviewedCustomers, todayBusinessDate } from "./pay-desk-rules";
import { payCopy } from "./pay-desk-copy";
import { CheckoutPaused, ConnectionNotice, PaymentLock, ProblemNotice, TillReload, payProblem, type Problem } from "./PayRecovery";

/*
 * What the order panel shows in place of its pay buttons outside the direct flow: the payment
 * lock, the checkout pause and the reload screen, and the ฿0 close as a keyed attempt. Loaded
 * only when one of them applies, so the direct checkout carries none of it.
 */

const { t, money } = payCopy;

/**
 * This till's own payment reopens where it was as soon as the order shows (after a reload, or the
 * phone sheet reopening); another till's shows who is taking it.
 */
export function OrderPayNotice({ view, mode, onResume, autoResume, onCheckPrevious }: {
  view: OrderView; mode: PayMode; onResume: () => void; autoResume: boolean;
  /** During the pause: reopen a direct panel this cashier left, to record money it may have taken. */
  onCheckPrevious?: () => void;
}) {
  const active = view.paymentAttempt?._id;
  const attempt = useCommerce().usePaymentAttempt(active ? view.order._id : null, active);
  const resumed = useRef<string | null>(null);
  // Only money in flight reopens by itself: leaving a panel with nothing taken releases the order.
  const mine = Boolean(active && attempt?.mine && mode === "attempts" &&
    (attempt.status !== "collecting" || attempt.legs.some((leg) => leg.state !== "planned" && leg.state !== "declined")));
  useEffect(() => {
    if (!mine || !autoResume || resumed.current === active) return;
    resumed.current = active ?? null;
    onResume();
  }, [mine, autoResume, active, onResume]);
  if (active && mode === "attempts") return <PaymentLock view={view} attempt={attempt} onResume={onResume} />;
  if (mode === "paused") {
    return (
      <div className="grid gap-2">
        <CheckoutPaused />
        {onCheckPrevious ? <Button variant="outline" className="h-12 bg-transparent" data-pay-return onClick={onCheckPrevious}>{t("pay.checkPreviousPayment")}</Button> : null}
      </div>
    );
  }
  if (mode === "reload" || active) return <TillReload />;
  return <div className="grid h-14 place-items-center"><Spinner /></div>;
}

/** Close ฿0: one keyed attempt with no parts, settled at once. A retry closes it once. */
export function CloseWithAttempt({ view, disabled, onPaid, onReview, mode }: { view: OrderView; disabled: boolean; onPaid: (orderId: OrderId) => void; onReview: () => void; mode: PayMode }) {
  const actions = useCommerce().useActions();
  const key = useRef<{ key: string; revision: number } | null>(null);
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  if (mode === "reload") return <TillReload />;
  if (mode === "loading") return <Button className="h-12 w-full rounded-xl" disabled><Spinner className="text-current" /></Button>;
  async function close() {
    if (pending) return;
    // The order changed since the last try: a new close is a new attempt.
    if (key.current?.revision !== view.order.revision) key.current = { key: newAttemptKey(), revision: view.order.revision };
    setPending(true);
    setProblem(null);
    try {
      const attempt = await actions.startAttempt({
        clientKey: key.current.key, orderId: view.order._id, orderRevision: view.order.revision, due: 0,
        businessDate: todayBusinessDate(), customers: reviewedCustomers(view), legs: [], vouchers: [],
      });
      const result = await actions.settleAttempt({ attemptId: attempt.attemptId, ownerRevision: attempt.ownerRevision, orderId: view.order._id });
      if (result.status === "settled") onPaid(view.order._id);
      else setProblem({ refusal: result.refusal });
    } catch (err) {
      setProblem(payProblem(err));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <ConnectionNotice lost={problem !== null && "lost" in problem} busy={pending} onRetry={() => void close()} />
      <ProblemNotice problem={problem} />
      <Button className="h-12 w-full rounded-xl" disabled={disabled || pending} onClick={() => void close()}>
        {pending ? <Spinner label={t("pay.saving")} className="text-current" /> : null}
        {t("pay.closeNothingDue", { amount: money(0) })}
      </Button>
      <Button variant="link" size="sm" className="mt-1 h-auto min-h-11 w-full p-0 text-xs text-muted-foreground" disabled={disabled || pending} onClick={onReview}>
        {t("pay.changeDate")}
      </Button>
    </>
  );
}
