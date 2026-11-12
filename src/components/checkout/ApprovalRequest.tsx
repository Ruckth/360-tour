"use client";

import { useId, useRef, useState } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useNow } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import type { ApprovalPayload } from "convex/lib/staffTypes";
import { useCheckoutBackend, type ApprovalRequest, type OrderId } from "./backend";
import { checkoutErrorText } from "./refunds";
import { approvalOutcome, approvalWhat, shownRequest } from "./staff-approvals";

/** Sends one cashier request; resolves to an error message, or null once it is waiting for a manager. */
export function useSendApproval() {
  const actions = useCheckoutBackend().useActions();
  return async (orderId: OrderId, payload: ApprovalPayload, reason: string): Promise<string | null> => {
    try {
      await actions.createApproval({ orderId, payload, reason });
      return null;
    } catch (err) {
      return checkoutErrorText(err, "Couldn’t send the request. Try again.");
    }
  };
}

/**
 * The compact "Ask a manager" form: a required reason, then Send request. Nothing on the order
 * changes until a manager approves.
 */
export function ApprovalRequestForm({
  what,
  initialReason = "",
  placeholder = "e.g. Guest service recovery",
  onSend,
  onCancel,
  className,
}: {
  /** "฿150 discount", "custom price": what is asked for. */
  what: string;
  initialReason?: string;
  placeholder?: string;
  onSend: (reason: string) => Promise<string | null>;
  onCancel: () => void;
  className?: string;
}) {
  const id = useId();
  const [reason, setReason] = useState(initialReason);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function send() {
    if (lock.current || !reason.trim()) return;
    lock.current = true;
    setSending(true);
    setError("");
    const failed = await onSend(reason.trim());
    lock.current = false;
    setSending(false);
    if (failed) setError(failed);
  }
  return (
    <div role="group" aria-labelledby={`${id}-title`} data-approval-form="" className={cn("grid gap-2 rounded-lg border border-amber-300 bg-amber-50/70 p-3 dark:border-amber-400/40 dark:bg-amber-400/10", className)}>
      <div className="flex items-center justify-between gap-2">
        <p id={`${id}-title`} className="text-sm font-semibold">Ask a manager · {what}</p>
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={sending} onClick={onCancel}>Cancel</Button>
      </div>
      <Label htmlFor={`${id}-reason`}>Reason</Label>
      <Textarea id={`${id}-reason`} value={reason} maxLength={500} required disabled={sending} onChange={(e) => setReason(e.target.value)} placeholder={placeholder} className="min-h-16 bg-background text-sm" autoFocus />
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <Button type="button" className="w-full" disabled={!reason.trim() || sending} onClick={() => void send()}>
        {sending ? <Spinner label="Sending" className="text-current" /> : null}
        Send request
      </Button>
    </div>
  );
}

/**
 * The order's request, one line: "Waiting for a manager · ฿150 discount" with Cancel for the
 * cashier who asked, then its outcome for a few minutes.
 */
export function OrderApprovalStatus({ requests, lines, className }: { requests: ApprovalRequest[] | undefined; lines?: { _id: string; name: string }[]; className?: string }) {
  const now = useNow(15_000);
  const access = useStaffAccess();
  const actions = useCheckoutBackend().useActions();
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState("");
  const request = shownRequest(requests, now);
  if (!request) return null;
  const pending = request.status === "pending";
  const mine = Boolean(access.email) && request.requesterEmail === access.email;
  async function cancel() {
    if (!request) return;
    setCancelling(true);
    setError("");
    try {
      await actions.cancelApproval({ requestId: request._id });
    } catch (err) {
      setError(checkoutErrorText(err, "Couldn’t cancel the request."));
    } finally {
      setCancelling(false);
    }
  }
  return (
    <div
      role="status"
      data-approval-status={request.status}
      className={cn(
        "flex flex-wrap items-center justify-between gap-x-3 gap-y-1 rounded-lg px-3 py-2 text-sm",
        pending ? "bg-amber-50 text-amber-900 dark:bg-amber-400/10 dark:text-amber-200" : request.status === "applied" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300" : "bg-muted/60 text-muted-foreground",
        className,
      )}
    >
      <span className="min-w-0">
        {pending ? <><span className="font-semibold">Waiting for a manager</span> · {approvalWhat(request, lines?.find((line) => line._id === request.lineId)?.name)}</> : approvalOutcome(request)}
      </span>
      {pending && mine ? (
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={cancelling} onClick={() => void cancel()}>Cancel</Button>
      ) : null}
      {error ? <span role="alert" className="w-full text-destructive">{error}</span> : null}
    </div>
  );
}
