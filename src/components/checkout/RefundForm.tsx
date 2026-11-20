"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { newAttemptKey, useCheckoutBackend, type OrderLine, type OrderView } from "./backend";
import { TOUCH_TARGETS, amountInput } from "./checkout-ui";
import {
  REFUND_METHODS, answeredRefusal, checkoutErrorText, defaultRefundMethod, refundAmountSatang, refundButtonLabel, remainingFromError, satangInput, satangMoney, type RefundMethod,
} from "./refunds";
import { needsApproval } from "./staff-approvals";
import { returnRefusal } from "./returnable-parts";
import { MovedToReturns } from "./ReturnItemsEntry";

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
  // The receipt became a commerce receipt, or has an open return: its money goes through Return items.
  const [movedToReturns, setMovedToReturns] = useState<string | null>(null);

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
  const ready = satang !== null && satang <= cap && Boolean(reason.trim()) && (uncertain || !(ask && waiting)) && !movedToReturns;
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
      const moved = returnRefusal(err);
      if (moved && (moved.code === "USE_RETURN_ITEMS" || moved.code === "RETURN_IN_PROGRESS")) {
        // Nothing was written; this receipt's refunds belong to Return items now.
        attempt.current = null;
        setUncertain(false);
        setMovedToReturns(moved.code);
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
        "@container mt-3 grid scroll-mt-[calc(var(--admin-header,4rem)+3rem)] scroll-mb-4 lg:scroll-mb-0 gap-3 rounded-xl border p-3 font-sans text-sm leading-normal pointer-coarse:[&_button[type=submit]]:min-h-12 print:hidden",
        TOUCH_TARGETS,
        ask ? "border-amber-300 bg-amber-50/70 dark:border-amber-400/40 dark:bg-amber-400/10" : "border-border bg-background",
      )}
    >
      <div className="grid gap-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p id={`${id}-title`} ref={titleRef} tabIndex={-1} className="rounded text-[15px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring">{ask ? "Ask a manager" : "Refund"}</p>
          <p className="min-w-0 text-xs text-muted-foreground text-pretty [overflow-wrap:anywhere]">{view.order.title} · {line.name}</p>
        </div>
        <p className="text-sm text-muted-foreground">Records money already returned to the guest.</p>
      </div>
      <div className="grid gap-2">
        <div role="group" aria-label="Refund amount" className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-2">
          <ToggleGroup variant="segmented" tone="subtle" value={chosen ?? ""} onValueChange={(value) => setAmount(value === "all" ? null : satangInput(half))} aria-label="Amount presets" disabled={saving || uncertain}>
            <ToggleGroupItem value="all" disabled={all <= 0} onClick={() => setAmount(null)} className="disabled:opacity-45">All</ToggleGroupItem>
            {half > 0 && half < all ? <ToggleGroupItem value="half" className="disabled:opacity-45">Half</ToggleGroupItem> : null}
          </ToggleGroup>
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
        <ToggleGroup variant="segmented" tone="subtle" value={method} onValueChange={setMethod} disabled={saving || uncertain} aria-labelledby={`${id}-method`} className="grid min-w-0 grid-cols-[1fr_1.5fr_1fr_1.2fr_1fr]">
          {REFUND_METHODS.map((option) => (
            <ToggleGroupItem key={option.value} value={option.value} className="min-w-0 px-1 font-medium disabled:opacity-45 group-data-[variant=segmented]/toggle:text-[13px] @md:group-data-[variant=segmented]/toggle:text-sm">
              {option.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${id}-reason`} className="text-xs text-muted-foreground">Reason</Label>
        <ToggleGroup variant="segmented" tone="subtle" value={reason.trim()} onValueChange={setReason} disabled={saving || uncertain} aria-label="Quick reason" className="grid min-w-0 grid-cols-[1fr_1fr_1.2fr]">
          {[["Short treatment", "Cut short"], ["Guest complaint", "Complaint"], ["Wrong charge", "Wrong charge"]].map(([value, label]) => (
            <ToggleGroupItem key={value} value={value} className="min-w-0 px-2 font-medium disabled:opacity-45 group-data-[variant=segmented]/toggle:text-[13px] @md:group-data-[variant=segmented]/toggle:text-sm">{label}</ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Input id={`${id}-reason`} placeholder="Or type a reason" value={reason} onChange={(event) => setReason(event.target.value)} required aria-required="true" disabled={saving || uncertain} autoComplete="off" />
      </div>
      {uncertain ? <p role="status" className="text-xs text-muted-foreground">Retry sends the same refund, so it is never recorded twice.</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : ask && waiting ? <p className="text-sm text-muted-foreground">A request is already waiting.</p> : null}
      {movedToReturns ? <MovedToReturns view={view} line={line} code={movedToReturns} /> : null}
      <div className="grid grid-cols-[auto_1fr] gap-2">
        <Button type="button" variant="ghost" className="h-11" disabled={saving} onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="outline" className="h-auto min-h-12 w-full whitespace-normal text-[15px] border-destructive/50 text-destructive hover:bg-destructive/5 hover:text-destructive disabled:opacity-100 disabled:border-border disabled:text-muted-foreground" disabled={!ready || saving}>
          {saving ? <Spinner label={ask ? "Sending" : "Recording"} className="text-current" /> : null}
          {uncertain ? "Retry same refund" : !reason.trim() ? "Pick a reason" : refundButtonLabel(ask, satang !== null && satang <= cap ? satangMoney(satang, line.currency) : null)}
        </Button>
      </div>
    </form>
  );
}
