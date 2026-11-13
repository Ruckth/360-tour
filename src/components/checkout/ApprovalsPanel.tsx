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
import { Toast, useToast } from "@/components/ui/toast";
import { useNow } from "@/lib/staff-bookings";
import { ApprovalDecisionButtons, useApprovalDecision } from "./ApprovalRequest";
import { useCheckoutBackend, type ApprovalRequest } from "./backend";
import { CheckoutSheetContent } from "./CheckoutLayers";
import { approvalAsk, minutesLeft, personName } from "./staff-approvals";

/**
 * Marks the approvals button and panel. A checkout sheet stays open when they are used, so a
 * manager can approve over an open order on a phone (CheckoutLayers).
 */
export const APPROVALS_AREA = "data-approvals";

/**
 * The admin header's staff controls: a Cashier badge for cashiers; for managers and owners, the
 * Approvals button with the number waiting, which opens the approvals panel over the current page.
 */
export function CheckoutStaffControls() {
  const access = useStaffAccess();
  if (access.role === "cashier") return <Badge variant="outline" data-testid="cashier-badge">Cashier</Badge>;
  if (access.capabilities.approve) return <ApprovalsButton />;
  return null;
}

function ApprovalsButton() {
  const queue = useCheckoutBackend().usePendingApprovals();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  // The last decision's result, shown as a toast once the panel has closed and the page is
  // readable again (the open sheet hides the rest of the page from screen readers).
  const closedWith = useRef("");
  const { message: toastMessage, show: showToast } = useToast();
  const count = queue?.count ?? 0;

  function onDecided(requestId: string, result: string) {
    const others = queue?.list.filter((request) => request._id !== requestId).length ?? 0;
    if (others) {
      setNotice(result);
      return;
    }
    // That was the last one: close, and say what happened.
    setNotice("");
    closedWith.current = result;
    setOpen(false);
  }

  return (
    <>
      <Sheet open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNotice(""); }}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            className="shrink-0 border-gold/60 text-gold-text hover:bg-gold/10 hover:text-gold-text"
            data-testid="approvals-button"
            {...{ [APPROVALS_AREA]: "" }}
          >
            <ShieldCheck aria-hidden className="size-4" />
            Approvals
            {count ? (
              <span data-approval-count="" className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-semibold text-navy tabular-nums">
                {count}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </Button>
        </SheetTrigger>
        <CheckoutSheetContent
          side="right"
          className="w-full gap-3 sm:max-w-md"
          {...{ [APPROVALS_AREA]: "" }}
          // Focus the title, not the first control: that would open an ⓘ tip or arm Decline.
          onCloseAutoFocus={() => {
            if (closedWith.current) showToast(closedWith.current);
            closedWith.current = "";
          }}
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
              {queue.list.map((request) => <ApprovalItem key={request._id} request={request} onResult={(result) => onDecided(request._id, result)} />)}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          )}
        </CheckoutSheetContent>
      </Sheet>
      <Toast message={toastMessage} />
    </>
  );
}

function ApprovalItem({ request, onResult }: { request: ApprovalRequest; onResult: (text: string) => void }) {
  const order = useCheckoutBackend().useOrder(request.orderId);
  const now = useNow(10_000);
  const title = order?.order.title ?? "Order";
  const refund = request.payload.kind === "refund" ? request.payload : null;
  const lineName = order?.lines.find((line) => line._id === request.lineId)?.name;
  const { decide, busy, error } = useApprovalDecision(request, lineName, title);

  return (
    <li className="grid gap-2 rounded-xl border border-border bg-card p-4" data-testid="approval-request">
      <p className="text-sm font-semibold [overflow-wrap:anywhere]">{personName(request.requesterEmail)} {approvalAsk(request, lineName)}</p>
      {/* The cashier's own words, not an explanation. */}
      <blockquote data-sentence-budget="ignore" className="border-l-2 border-gold/60 pl-3 text-sm text-muted-foreground italic [overflow-wrap:anywhere]">“{refund?.reason ?? request.reason}”</blockquote>
      <p className="text-sm text-muted-foreground tabular-nums">
        {title} · {refund ? "Net received" : "Total"} {formatMoney(request.totalBefore)} → <span className="font-semibold text-foreground">{formatMoney(request.totalAfter)}</span>
      </p>
      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
        Expires in {minutesLeft(request.expiresAt, now)} min
        <InfoTip label="About approvals">Works once, for this order as it is now.</InfoTip>
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ApprovalDecisionButtons busy={busy} onDecide={(choice) => void decide(choice).then((result) => { if (result) onResult(result); })} />
    </li>
  );
}
