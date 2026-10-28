"use client";

import { ArrowLeft, Plus, X } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { MAX_TENDERS, TENDER_METHODS, round2, type Tender, type TenderMethod } from "convex/lib/billMath";
import { newAttemptKey, useCheckoutBackend, type BillId, type BillView } from "./backend";
import { TENDER_LABELS, TOUCH_TARGETS, amountInput } from "./checkout-ui";

const CASH_STEPS = [100, 500, 1000];

/**
 * Takes the payment. One idempotency key per attempt (this panel's lifetime): a retry after a
 * dropped connection settles once. The lock ignores double taps while a payment is in flight.
 */
export function PayPanel({
  mode,
  view,
  onBack,
  onPaid,
}: {
  mode: TenderMethod | "split" | "none";
  view: BillView;
  onBack: () => void;
  onPaid: (billId: BillId) => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const due = view.totals.due;
  const [attemptKey] = useState(newAttemptKey);
  const lock = useRef(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function pay(tenders: Tender[]) {
    if (lock.current) return;
    lock.current = true;
    setSubmitting(true);
    setError("");
    try {
      await actions.settleBill({ billId: view.bill._id, idempotencyKey: attemptKey, expectedDue: due, tenders });
      // Stay locked: the page moves on to the receipt.
      onPaid(view.bill._id);
    } catch (err) {
      lock.current = false;
      setSubmitting(false);
      setError(errorText(err, "The payment didn't go through. Try again."));
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 py-4">
      <button type="button" onClick={onBack} disabled={submitting} className="inline-flex items-center gap-1.5 self-start text-sm font-medium text-muted-foreground hover:text-foreground disabled:opacity-50">
        <ArrowLeft aria-hidden className="size-4" /> Back to bill
      </button>
      <div className="rounded-xl bg-muted p-4">
        <p className="text-xs font-medium text-muted-foreground">{mode === "split" ? "Split payment" : mode === "none" ? "Nothing due" : TENDER_LABELS[mode].long} · due</p>
        <p className="text-3xl font-bold tabular-nums">{formatMoney(due)}</p>
      </div>

      {mode === "cash" ? (
        <CashForm due={due} submitting={submitting} onPay={pay} />
      ) : mode === "split" ? (
        <SplitForm due={due} submitting={submitting} onPay={pay} />
      ) : mode === "none" ? (
        <>
          <p className="text-sm text-muted-foreground">Everything on this bill was paid before checkout. Close it to issue the receipt.</p>
          <PayButton submitting={submitting} onClick={() => pay([])}>Close bill</PayButton>
        </>
      ) : (
        <>
          <p className="text-sm text-muted-foreground">{TENDER_LABELS[mode].hint}</p>
          <PayButton submitting={submitting} onClick={() => pay([{ method: mode, amount: due }])}>
            Confirm {formatMoney(due)} received
          </PayButton>
        </>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
    </div>
  );
}

function PayButton({ submitting, disabled, onClick, className, children }: { submitting: boolean; disabled?: boolean; onClick: () => void; className?: string; children: ReactNode }) {
  return (
    <Button className={cn("h-12 w-full text-base", className)} disabled={submitting || disabled} onClick={onClick}>
      {submitting ? <Spinner className="text-current" /> : null}
      {children}
    </Button>
  );
}

function CashForm({ due, submitting, onPay }: { due: number; submitting: boolean; onPay: (tenders: Tender[]) => void }) {
  const [received, setReceived] = useState("");
  const value = Number(received) || 0;
  const change = round2(value - due);

  return (
    <>
      <div className="grid gap-2">
        <Label htmlFor="cash-received">Cash received</Label>
        <Input id="cash-received" inputMode="decimal" className="h-12 text-lg tabular-nums" value={received} onChange={(e) => setReceived(amountInput(e.target.value))} placeholder="0" />
      </div>
      <div className="grid grid-cols-4 gap-2">
        <Button variant="secondary" onClick={() => setReceived(String(due))}>Exact</Button>
        {CASH_STEPS.map((step) => (
          <Button key={step} variant="secondary" onClick={() => setReceived(String(round2(value + step)))}>+{formatMoney(step)}</Button>
        ))}
      </div>
      <div className={cn("flex items-baseline justify-between rounded-xl border p-3", value >= due && change > 0 ? "border-primary" : "border-border")} aria-live="polite">
        <span className="text-sm font-medium">{value >= due ? "Change" : "Still short"}</span>
        <span className="text-2xl font-bold tabular-nums">{formatMoney(value >= due ? change : round2(due - value))}</span>
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" onClick={() => setReceived("")} disabled={!received}>Clear</Button>
        <PayButton className="w-auto flex-1" submitting={submitting} disabled={value < due} onClick={() => onPay([{ method: "cash", amount: due, received: value }])}>
          Confirm cash
        </PayButton>
      </div>
    </>
  );
}

function SplitForm({ due, submitting, onPay }: { due: number; submitting: boolean; onPay: (tenders: Tender[]) => void }) {
  const [rows, setRows] = useState<{ method: TenderMethod; amount: string }[]>([
    { method: "cash", amount: "" },
    { method: "promptpay", amount: "" },
  ]);
  const paid = round2(rows.reduce((total, row) => total + (Number(row.amount) || 0), 0));
  const remaining = round2(due - paid);
  const ready = remaining === 0 && rows.every((row) => Number(row.amount) > 0);
  const update = (index: number, patch: Partial<(typeof rows)[number]>) => setRows(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  return (
    <>
      <ul className="grid gap-2">
        {rows.map((row, index) => (
          <li key={index} className="flex items-center gap-2">
            <Select value={row.method} onValueChange={(method) => update(index, { method: method as TenderMethod })}>
              <SelectTrigger className="w-32" aria-label={`Payment ${index + 1} method`}><SelectValue /></SelectTrigger>
              <SelectContent className={TOUCH_TARGETS}>
                {/* Short labels: the long ones ("PromptPay QR") truncate in the narrow trigger. */}
                {TENDER_METHODS.map((method) => <SelectItem key={method} value={method}>{TENDER_LABELS[method].short}</SelectItem>)}
              </SelectContent>
            </Select>
            <Input inputMode="decimal" aria-label={`Payment ${index + 1} amount`} className="min-w-0 flex-1 tabular-nums" value={row.amount} onChange={(e) => update(index, { amount: amountInput(e.target.value) })} placeholder="0" />
            <Button size="sm" variant="outline" disabled={remaining <= 0} onClick={() => update(index, { amount: String(round2((Number(row.amount) || 0) + remaining)) })}>
              Rest
            </Button>
            {rows.length > 1 ? (
              <Button size="icon" variant="ghost" className="size-9" aria-label={`Remove payment ${index + 1}`} onClick={() => setRows(rows.filter((_, i) => i !== index))}>
                <X aria-hidden className="size-4" />
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      {rows.length < MAX_TENDERS ? (
        <Button variant="ghost" className="justify-self-start" onClick={() => setRows([...rows, { method: "card", amount: "" }])}>
          <Plus aria-hidden className="size-4" /> Add payment
        </Button>
      ) : null}
      <div className="flex items-baseline justify-between rounded-xl border border-border p-3" aria-live="polite">
        <span className="text-sm font-medium">{remaining >= 0 ? "Remaining" : "Over by"}</span>
        <span className={cn("text-xl font-bold tabular-nums", remaining < 0 && "text-destructive")}>{formatMoney(Math.abs(remaining))}</span>
      </div>
      <p className="text-xs text-muted-foreground">Up to {MAX_TENDERS} payments. Confirm each one (QR, card, transfer) before taking the next.</p>
      <PayButton submitting={submitting} disabled={!ready} onClick={() => onPay(rows.map((row) => ({ method: row.method, amount: Number(row.amount) })))}>
        Confirm split
      </PayButton>
    </>
  );
}
