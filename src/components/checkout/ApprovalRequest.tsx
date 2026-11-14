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
import { approvalDecisionWhat, approvalOutcome, approvalResultText, approvalWhat, shownRequest } from "./staff-approvals";

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
 * Approve or decline one request, exactly once at a time. `decide` resolves to the result line
 * ("Approved 15% discount on #1042"), or null when the call failed and `error` says why. The
 * server checks the approver, the order's revision and the expiry, and writes the audit trail.
 */
export function useApprovalDecision(request: Pick<ApprovalRequest, "_id" | "payload" | "amount">, lineName?: string, title = "Order") {
  const actions = useCheckoutBackend().useActions();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  async function decide(choice: "approve" | "decline"): Promise<string | null> {
    if (lock.current) return null;
    lock.current = true;
    setBusy(choice);
    setError("");
    const what = approvalDecisionWhat(request, lineName);
    try {
      if (choice === "approve") {
        const result = await actions.approveApproval({ requestId: request._id });
        return approvalResultText(result.status, result.replayed, what, title);
      }
      const result = await actions.rejectApproval({ requestId: request._id });
      return approvalResultText(result.status, false, what, title);
    } catch (err) {
      setError(checkoutErrorText(err, choice === "approve" ? "Couldn’t approve. Nothing changed." : "Couldn’t decline. Try again."));
      return null;
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }
  return { decide, busy, error };
}

/** Decline and Approve, with a spinner on the one running. */
export function ApprovalDecisionButtons({ busy, disabled = false, onDecide, size, className }: { busy: "approve" | "decline" | null; disabled?: boolean; onDecide: (choice: "approve" | "decline") => void; size?: "sm"; className?: string }) {
  return (
    <div className={cn("flex flex-wrap justify-end gap-2", className)}>
      <Button type="button" size={size} variant="outline" disabled={disabled || busy !== null} onClick={() => onDecide("decline")}>
        {busy === "decline" ? <Spinner label="Declining" className="text-current" /> : null}
        Decline
      </Button>
      <Button type="button" size={size} disabled={disabled || busy !== null} onClick={() => onDecide("approve")}>
        {busy === "approve" ? <Spinner label="Approving" className="text-current" /> : null}
        Approve
      </Button>
    </div>
  );
}

/**
 * The compact inline request: one line with what is waiting and its status, for an order row, a
 * line or the receipt. While it is pending, approvers get Decline and Approve, and the cashier who
 * asked gets Withdraw. Once settled it shows the outcome ("Approved by Ploy").
 *
 * - `request`: a staffApprovals.forOrder or staffApprovals.pending row.
 * - `lineName`: the line it is on, so a refund reads "refund ฿300 · Foot spa".
 * - `orderTitle`: "Order #1042", for the result line passed to `onDecided`.
 * - `decide`: show Decline and Approve to approvers (default true). Pass false where only the status belongs.
 * - `onDecided`: called with the result line after a decision, e.g. to show a toast.
 */
export function ApprovalInline({
  request,
  lineName,
  orderTitle,
  decide = true,
  onDecided,
  className,
}: {
  request: ApprovalRequest;
  lineName?: string;
  orderTitle?: string;
  decide?: boolean;
  onDecided?: (result: string) => void;
  className?: string;
}) {
  const access = useStaffAccess();
  const actions = useCheckoutBackend().useActions();
  const decision = useApprovalDecision(request, lineName, orderTitle);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const pending = request.status === "pending";
  const mine = Boolean(access.email) && request.requesterEmail === access.email;
  const canDecide = pending && decide && access.capabilities.approve && !mine;
  async function cancel() {
    setCancelling(true);
    setCancelError("");
    try {
      await actions.cancelApproval({ requestId: request._id });
    } catch (err) {
      setCancelError(checkoutErrorText(err, "Couldn’t withdraw the request."));
    } finally {
      setCancelling(false);
    }
  }
  const error = cancelError || decision.error;
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
        {pending ? <><span className="font-semibold">Waiting for a manager</span> · {approvalWhat(request, lineName)}</> : approvalOutcome(request)}
      </span>
      {pending && mine ? (
        <Button type="button" size="sm" variant="ghost" className="h-8" disabled={cancelling} onClick={() => void cancel()}>Withdraw</Button>
      ) : null}
      {canDecide ? (
        <ApprovalDecisionButtons
          size="sm"
          busy={decision.busy}
          onDecide={(choice) => void decision.decide(choice).then((result) => { if (result) onDecided?.(result); })}
        />
      ) : null}
      {error ? <span role="alert" className="w-full text-destructive">{error}</span> : null}
    </div>
  );
}

/**
 * The order's request, one line: "Waiting for a manager · ฿150 discount" with Withdraw for the
 * cashier who asked, then its outcome for a few minutes. `decide` adds Approve and Decline for
 * approvers (off by default).
 */
export function OrderApprovalStatus({ requests, lines, decide = false, className }: { requests: ApprovalRequest[] | undefined; lines?: { _id: string; name: string }[]; decide?: boolean; className?: string }) {
  const now = useNow(15_000);
  const request = shownRequest(requests, now);
  if (!request) return null;
  return <ApprovalInline key={request._id} request={request} lineName={lines?.find((line) => line._id === request.lineId)?.name} decide={decide} className={className} />;
}
