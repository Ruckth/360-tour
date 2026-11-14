"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { newAttemptKey, useCheckoutBackend, type OrderLine, type OrderView } from "./backend";
import { TOUCH_TARGETS, amountInput } from "./checkout-ui";
import {
  REFUND_METHODS, answeredRefusal, checkoutErrorText, defaultRefundMethod, refundAmountSatang, refundButtonLabel, remainingFromError, satangInput, satangMoney, type RefundMethod,
} from "./refunds";
import { needsApproval } from "./staff-approvals";

// Applied once to all pressed-state chips: amount presets, methods, and ReasonField's buttons.
const REFUND_CHIPS = "[&_button[aria-pressed]]:h-11 [&_button[aria-pressed]]:min-w-0 [&_button[aria-pressed]]:justify-center [&_button[aria-pressed]]:rounded-full [&_button[aria-pressed]]:border [&_button[aria-pressed=false]]:border-border [&_button[aria-pressed=false]]:bg-background [&_button[aria-pressed]]:px-3 [&_button[aria-pressed]]:text-sm [&_button[aria-pressed]]:font-medium [&_button[aria-pressed=true]]:border-foreground [&_button[aria-pressed=true]]:bg-foreground [&_button[aria-pressed=true]]:text-background";

/**
 * The inline refund form under one paid receipt line. It opens ready to send: the amount is what is
 * left (All), the method is the original tender, and a reason chip finishes it, so a refund takes no
 * typing. Owners and managers record it (pos.refundLine); a cashier whose rules keep refunds for
 * managers sends the same refund as a request (staffApprovals.create). One attempt key per opened
 * form, reused by every retry, so a lost response never records the refund twice.
 */
export function RefundForm({ view, line, waiting, onDone, onCancel, onDraftChange, onBusyChange }: {
  view: OrderView;
  line: OrderLine;
  /** A request is already waiting on this order, so a cashier can't send another. */
  waiting: boolean;
  onDone: (notice: string) => void;
  onCancel: () => void;
  onDraftChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const id = useId();
  const actions = useCheckoutBackend().useActions();
  const access = useStaffAccess();
  const cashier = access.role === "cashier";
  const [refused, setRefused] = useState(false);
  const ask = cashier && (refused || access.cashierRules.refund === "manager");
  const [key] = useState(newAttemptKey);
  // The server's latest remaining amount, when it refused more than that.
  const [serverCap, setServerCap] = useState<number | null>(null);
  // After an attempt whose answer was lost, the live remaining may already include it: the retry
  // replays with the same key, so only the server's own cap applies until it answers.
  const [uncertain, setUncertain] = useState(false);
  const left = line.remainingRefundableSatang ?? 0;
  const cap = Math.min(uncertain ? Number.POSITIVE_INFINITY : left, serverCap ?? Number.POSITIVE_INFINITY);
  const all = Math.max(0, Number.isFinite(cap) ? cap : left);
  const half = Math.round(all / 2);
  // Until staff pick Half or type, the amount follows what is left, so another till's refund lowers it.
  const [typed, setTyped] = useState<string | null>(null);
  const amount = typed ?? satangInput(all);
  const setAmount = setTyped;
  const [method, setMethod] = useState<RefundMethod>(() => defaultRefundMethod(view));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const attempt = useRef<{ amountSatang: number; method: RefundMethod; reason: string; ask: boolean } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);

  const [initialMethod] = useState(method);
  const dirty = typed !== null || method !== initialMethod || Boolean(reason.trim());
  // Cleared on unmount too (e.g. the order is voided on another till while the form is open).
  useEffect(() => { onDraftChange(dirty); return () => onDraftChange(false); }, [dirty, onDraftChange]);
  useEffect(() => { onBusyChange(saving); return () => onBusyChange(false); }, [saving, onBusyChange]);

  // Reveal the form in the page; the receipt paper stays alongside on wide screens.
  useLayoutEffect(() => {
    const form = formRef.current;
    const target = window.matchMedia("(width < 640px)").matches ? form?.closest("li") : form;
    target?.scrollIntoView?.({ block: "nearest" });
    titleRef.current?.focus({ preventScroll: true });
  }, []);

  const satang = refundAmountSatang(amount);
  const amountProblem = !amount.trim() ? null : satang === null ? "Enter an amount above ฿0." : satang > cap ? `Up to ${satangMoney(cap, line.currency)}.` : null;
  const ready = satang !== null && satang <= cap && Boolean(reason.trim()) && (uncertain || !(ask && waiting));
  const chosen = satang === null ? null : satang === all ? "all" : satang === half ? "half" : null;

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (lock.current || !ready || satang === null) return;
    lock.current = true;
    // An unknown response must replay exactly the same refund, including its method and reason.
    attempt.current ??= { amountSatang: satang, method, reason: reason.trim(), ask };
    const submitted = attempt.current;
    setTyped(amount);
    setSaving(true);
    setError("");
    const clean = submitted.reason;
    try {
      if (submitted.ask) {
        await actions.createApproval({
          orderId: view.order._id,
          payload: { kind: "refund", lineId: line._id, amountSatang: submitted.amountSatang, currency: line.currency, method: submitted.method, idempotencyKey: key, reason: clean },
          reason: clean,
        });
        onDone(`Sent to a manager · refund ${satangMoney(submitted.amountSatang, line.currency)} · ${clean}`);
      } else {
        const { refund } = await actions.refundLine({ orderId: view.order._id, lineId: line._id, amount: submitted.amountSatang, currency: line.currency, method: submitted.method, reason: clean, idempotencyKey: key });
        onDone(`Refunded ${satangMoney(refund.amount, refund.currency)} · ${clean}`);
      }
    } catch (err) {
      const refused = answeredRefusal(err);
      if (refused) attempt.current = null;
      setUncertain(!refused);
      if (cashier && !submitted.ask && needsApproval(err)) {
        // Nothing was written; the same form becomes a request.
        setRefused(true);
        setError("This needs a manager. Send it as a request.");
        return;
      }
      const remaining = remainingFromError(err);
      if (remaining !== null) {
        setServerCap(remaining);
        if (remaining > 0) setAmount(satangInput(remaining));
      }
      setError(checkoutErrorText(err, ask ? "Couldn’t send the request. Try again." : "Couldn’t record the refund. Try again."));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  const chip = (value: "all" | "half", label: string, satangValue: number) => (
    <button
      type="button"
      aria-pressed={chosen === value}
      disabled={saving || uncertain || satangValue <= 0}
      onClick={() => setAmount(value === "all" ? null : satangInput(satangValue))}
      className="inline-flex items-center font-sans tabular-nums focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45"
    >
      {label}
    </button>
  );

  return (
    <form
      ref={formRef}
      onSubmit={(event) => void submit(event)}
      onKeyDown={(event) => {
        // Not from the method list's popup, which portals out of the form and closes itself first.
        if (event.key === "Escape" && !saving && event.currentTarget.contains(event.target as Node)) {
          event.stopPropagation();
          onCancel();
        }
      }}
      noValidate
      aria-labelledby={`${id}-title`}
      data-screen-only=""
      data-refund-form={line._id}
      className={cn(
        "@container mt-3 grid scroll-mt-[calc(var(--admin-header,4rem)+3rem)] scroll-mb-4 lg:scroll-mb-0 gap-3 rounded-xl border p-3 font-sans text-sm leading-normal print:hidden",
        TOUCH_TARGETS,
        REFUND_CHIPS,
        ask ? "border-amber-300 bg-amber-50/70 dark:border-amber-400/40 dark:bg-amber-400/10" : "border-border bg-background",
      )}
    >
      <p id={`${id}-title`} ref={titleRef} tabIndex={-1} className="rounded text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{ask ? "Ask a manager" : "Refund"}</p>
      <p className="text-sm text-muted-foreground">Records money already returned to the guest.</p>
      <div className="grid gap-2">
        <div role="group" aria-label="Refund amount" className="grid grid-cols-[1fr_1fr_6rem] items-center gap-2">
          {chip("all", "All", all)}
          {half > 0 && half < all ? chip("half", "Half", half) : null}
          <Label htmlFor={`${id}-amount`} className="sr-only">Amount (฿)</Label>
          <div className="relative">
            <span aria-hidden className="pointer-events-none absolute inset-y-0 left-3 flex items-center font-sans text-muted-foreground">฿</span>
            <Input
              id={`${id}-amount`}
              inputMode="decimal"
              autoComplete="off"
              onFocus={(event) => event.currentTarget.select()}
              value={amount}
              // After a lost answer the retry must send the same amount.
              disabled={saving || uncertain}
              onChange={(event) => setAmount(amountInput(event.target.value))}
              aria-invalid={amountProblem ? true : undefined}
              aria-describedby={`${id}-amount-hint`}
              className="h-11 w-full bg-background pl-7 text-right font-sans tabular-nums"
            />
          </div>
        </div>
        <p id={`${id}-amount-hint`} className={cn("text-xs", amountProblem ? "text-destructive" : "sr-only")}>
          {amountProblem ?? (cap === Number.POSITIVE_INFINITY ? "" : cap > 0 ? `Up to ${satangMoney(cap, line.currency)}` : "Nothing left to refund.")}
        </p>
      </div>
      <div className="grid gap-1.5">
        <p id={`${id}-method`} className="text-xs text-muted-foreground">Refund to</p>
        <div role="group" aria-labelledby={`${id}-method`} className="grid grid-cols-3 gap-2 @md:grid-cols-5">
          {REFUND_METHODS.map((option) => (
            <button key={option.value} type="button" aria-pressed={method === option.value} disabled={saving || uncertain} onClick={() => setMethod(option.value)} className="inline-flex items-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-45">
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <ReasonField label="Reason" placeholder="Or type a reason" value={reason} onChange={setReason} chips={["Short treatment", "Guest complaint", "Wrong charge"]} disabled={saving || uncertain} id={`${id}-reason`} className="[&_label]:text-xs [&_label]:text-muted-foreground" />
      {uncertain ? <p role="status" className="text-xs text-muted-foreground">Retry sends the same refund, so it is never recorded twice.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : ask && waiting ? <p className="text-sm text-muted-foreground">A request is already waiting.</p> : null}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button type="button" variant="ghost" className="h-11" disabled={saving} onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="outline" className="h-auto min-h-11 w-full whitespace-normal border-destructive/50 text-destructive hover:bg-destructive/5 hover:text-destructive disabled:opacity-100 disabled:border-border disabled:text-muted-foreground" disabled={!ready || saving}>
          {saving ? <Spinner label={ask ? "Sending" : "Recording"} className="text-current" /> : null}
          {uncertain ? "Retry same refund" : !reason.trim() ? "Pick a reason" : refundButtonLabel(ask, satang !== null && satang <= cap ? satangMoney(satang, line.currency) : null)}
        </Button>
      </div>
    </form>
  );
}
