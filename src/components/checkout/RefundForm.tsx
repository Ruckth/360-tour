"use client";

import { useId, useRef, useState, type FormEvent } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { newAttemptKey, useCheckoutBackend, type OrderLine, type OrderView } from "./backend";
import { TOUCH_TARGETS, amountInput } from "./checkout-ui";
import {
  REFUND_METHODS, answeredRefusal, checkoutErrorText, defaultRefundMethod, refundAmountSatang, remainingFromError, satangInput, satangMoney, type RefundMethod,
} from "./refunds";
import { needsApproval } from "./staff-approvals";

/**
 * The inline refund form under one paid receipt line: amount (prefilled with what is left), method
 * and a required reason. Owners and managers record it (pos.refundLine); a cashier whose rules keep
 * refunds for managers sends the same refund as a request (staffApprovals.create). One attempt key
 * per opened form, reused by every retry, so a lost response never records the refund twice.
 */
export function RefundForm({ view, line, waiting, onDone, onCancel }: {
  view: OrderView;
  line: OrderLine;
  /** A request is already waiting on this order, so a cashier can't send another. */
  waiting: boolean;
  onDone: (notice: string) => void;
  onCancel: () => void;
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
  const cap = Math.min(uncertain ? Number.POSITIVE_INFINITY : line.remainingRefundableSatang ?? 0, serverCap ?? Number.POSITIVE_INFINITY);
  // Until staff type or submit, the amount follows what is left, so another till's refund lowers it.
  const [typed, setTyped] = useState<string | null>(null);
  const amount = typed ?? satangInput(Math.max(0, Number.isFinite(cap) ? cap : line.remainingRefundableSatang ?? 0));
  const setAmount = setTyped;
  const [method, setMethod] = useState<RefundMethod>(() => defaultRefundMethod(view));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  const satang = refundAmountSatang(amount);
  const amountProblem = !amount.trim() ? null : satang === null ? "Enter an amount above ฿0." : satang > cap ? `Up to ${satangMoney(cap, line.currency)}.` : null;
  const ready = satang !== null && satang <= cap && Boolean(reason.trim()) && !(ask && waiting);

  async function submit(event?: FormEvent) {
    event?.preventDefault();
    if (lock.current || !ready || satang === null) return;
    lock.current = true;
    // Freeze the amount: a retry must resend exactly what this key was first sent with.
    setTyped(amount);
    setSaving(true);
    setError("");
    const clean = reason.trim();
    try {
      if (ask) {
        await actions.createApproval({
          orderId: view.order._id,
          payload: { kind: "refund", lineId: line._id, amountSatang: satang, currency: line.currency, method, idempotencyKey: key, reason: clean },
          reason: clean,
        });
        onDone("Sent to a manager.");
      } else {
        const { refund } = await actions.refundLine({ orderId: view.order._id, lineId: line._id, amount: satang, currency: line.currency, method, reason: clean, idempotencyKey: key });
        onDone(`Refunded ${satangMoney(refund.amount, refund.currency)}.`);
      }
    } catch (err) {
      if (cashier && !ask && needsApproval(err)) {
        // Nothing was written; the same form becomes a request.
        setRefused(true);
        setError("This needs a manager. Send it as a request.");
        return;
      }
      setUncertain(!answeredRefusal(err));
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
        "mt-2 grid gap-3 rounded-lg border p-3 font-sans text-sm leading-normal print:hidden",
        ask ? "border-amber-300 bg-amber-50/70 dark:border-amber-400/40 dark:bg-amber-400/10" : "border-border bg-background",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p id={`${id}-title`} className="font-semibold">{ask ? "Ask a manager" : "Refund"}</p>
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={saving} onClick={onCancel}>Cancel</Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-amount`}>Amount (฿)</Label>
          <Input
            id={`${id}-amount`}
            inputMode="decimal"
            autoComplete="off"
            autoFocus
            onFocus={(event) => event.currentTarget.select()}
            value={amount}
            disabled={saving}
            onChange={(event) => setAmount(amountInput(event.target.value))}
            aria-invalid={amountProblem ? true : undefined}
            aria-describedby={`${id}-amount-hint`}
            className="h-10 text-right tabular-nums"
          />
        </div>
        <div className="grid min-w-0 gap-1.5">
          <Label htmlFor={`${id}-method`}>Method</Label>
          <Select value={method} disabled={saving} onValueChange={(value) => setMethod(value as RefundMethod)}>
            <SelectTrigger id={`${id}-method`} className="h-10 w-full bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className={TOUCH_TARGETS}>
              {REFUND_METHODS.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <p id={`${id}-amount-hint`} className={cn("col-span-2 text-xs", amountProblem ? "text-destructive" : "text-muted-foreground")}>
          {amountProblem ?? (cap === Number.POSITIVE_INFINITY ? "" : cap > 0 ? `Up to ${satangMoney(cap, line.currency)}` : "Nothing left to refund.")}
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-reason`}>Reason</Label>
        <Textarea id={`${id}-reason`} value={reason} maxLength={500} required disabled={saving} onChange={(event) => setReason(event.target.value)} placeholder="e.g. Shortened treatment" className="min-h-16 bg-background text-sm" />
      </div>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : ask && waiting ? <p className="text-sm text-muted-foreground">A request is already waiting.</p> : null}
      <Button type="submit" className="w-full" disabled={!ready || saving}>
        {saving ? <Spinner label={ask ? "Sending" : "Recording"} className="text-current" /> : null}
        {ask ? "Send request" : "Record refund"}
      </Button>
    </form>
  );
}
