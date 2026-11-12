"use client";

import { ShieldCheck } from "lucide-react";
import { useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { InfoTip } from "@/components/ui/info-tip";
import { Sheet, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { errorText, useNow } from "@/lib/staff-bookings";
import { useCheckoutBackend, type ApprovalRequest } from "./backend";
import { CheckoutSheetContent } from "./CheckoutLayers";
import { approvalAsk, minutesLeft, personName, type ApprovalStatus } from "./staff-approvals";

/**
 * The checkout header's staff controls: a Cashier badge for cashiers; for managers and owners, an
 * "N approvals" button (only while requests wait) that opens the approvals panel.
 */
export function CheckoutStaffControls() {
  const access = useStaffAccess();
  if (access.role === "cashier") return <Badge variant="outline" data-testid="cashier-badge">Cashier</Badge>;
  if (access.capabilities.approve) return <ApprovalsButton />;
  return null;
}

function resultText(status: ApprovalStatus, replayed: boolean, title: string) {
  if (replayed) return `${title}: already handled.`;
  switch (status) {
    case "applied":
      return `Approved · ${title}`;
    case "rejected":
      return `Declined · ${title}`;
    case "stale":
      return `${title} changed, so the request no longer applies.`;
    case "expired":
      return `The request on ${title} expired.`;
    case "cancelled":
      return `The request on ${title} was cancelled.`;
    case "pending":
      return `${title} is still waiting.`;
  }
}

function ApprovalsButton() {
  const queue = useCheckoutBackend().usePendingApprovals();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  const count = queue?.count ?? 0;
  // The panel stays open after the last request is handled, so its result can be read.
  if (!count && !open) return null;
  return (
    <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNotice(""); }}>
      <SheetTrigger asChild>
        <Button variant="outline" className="shrink-0 border-gold/60 text-gold-text hover:bg-gold/10 hover:text-gold-text" data-testid="approvals-button">
          <ShieldCheck aria-hidden className="size-4" />
          {count} {count === 1 ? "approval" : "approvals"}
        </Button>
      </SheetTrigger>
      <CheckoutSheetContent
        side="right"
        className="w-full gap-3 sm:max-w-md"
        // Focus the title, not the first control: that would open an ⓘ tip or arm Decline.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-approvals-title]")?.focus();
        }}
      >
        <SheetHeader>
          <SheetTitle data-approvals-title="" tabIndex={-1} className="outline-none">Approvals</SheetTitle>
          <SheetDescription className="sr-only">Requests from cashiers waiting for a manager.</SheetDescription>
        </SheetHeader>
        <p role="status" className={notice ? "rounded-lg bg-muted/60 px-3 py-2 text-sm" : "sr-only"}>{notice}</p>
        {queue === undefined ? (
          <Spinner label="Loading approvals" />
        ) : queue.list.length ? (
          <ul className="grid gap-3" aria-label="Requests">
            {queue.list.map((request) => <ApprovalItem key={request._id} request={request} onResult={setNotice} />)}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No requests waiting.</p>
        )}
      </CheckoutSheetContent>
    </Sheet>
  );
}

function ApprovalItem({ request, onResult }: { request: ApprovalRequest; onResult: (text: string) => void }) {
  const backend = useCheckoutBackend();
  const actions = backend.useActions();
  const order = backend.useOrder(request.orderId);
  const now = useNow(10_000);
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const title = order?.order.title ?? "Order";

  async function decide(choice: "approve" | "decline") {
    if (lock.current) return;
    lock.current = true;
    setBusy(choice);
    setError("");
    try {
      if (choice === "approve") {
        const result = await actions.approveApproval({ requestId: request._id });
        onResult(resultText(result.status, result.replayed, title));
      } else {
        const result = await actions.rejectApproval({ requestId: request._id });
        onResult(resultText(result.status, false, title));
      }
    } catch (err) {
      setError(errorText(err, choice === "approve" ? "Couldn’t approve. Nothing changed." : "Couldn’t decline. Try again."));
    } finally {
      lock.current = false;
      setBusy(null);
    }
  }

  return (
    <li className="grid gap-2 rounded-xl border border-border bg-card p-4" data-testid="approval-request">
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{personName(request.requesterEmail)} {approvalAsk(request)}</p>
      <blockquote className="border-l-2 border-gold/60 pl-3 text-sm text-muted-foreground italic [overflow-wrap:anywhere]">“{request.reason}”</blockquote>
      <p className="text-sm text-muted-foreground tabular-nums">
        {title} · Total {formatMoney(request.totalBefore)} → <span className="font-semibold text-foreground">{formatMoney(request.totalAfter)}</span>
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Expires in {minutesLeft(request.expiresAt, now)} min
        <InfoTip label="About approvals">Works once, for this order as it is now.</InfoTip>
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="outline" disabled={busy !== null} onClick={() => void decide("decline")}>
          {busy === "decline" ? <Spinner label="Declining" className="text-current" /> : null}
          Decline
        </Button>
        <Button disabled={busy !== null} onClick={() => void decide("approve")}>
          {busy === "approve" ? <Spinner label="Approving" className="text-current" /> : null}
          Approve
        </Button>
      </div>
    </li>
  );
}
