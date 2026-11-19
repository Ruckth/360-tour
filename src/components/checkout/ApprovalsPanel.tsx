"use client";

import { ShieldCheck } from "lucide-react";
import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Toast, useToast } from "@/components/ui/toast";
import { useNow } from "@/lib/staff-bookings";
import { ApprovalDecisionButtons, useApprovalDecision } from "./ApprovalRequest";
import { useCheckoutBackend, useCommerce, type ApprovalRequest, type CommerceBackend } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { approvalAsk, minutesLeft, personName } from "./staff-approvals";
import type { TargetApproval } from "./TargetApproval";

// Loaded only when a return or edit request is waiting, so today's panel costs nothing more.
const TargetApprovalItem = lazy(() => import("./TargetApproval"));

/**
 * Target-scoped requests (returns of items, edits to sold or catalogue items) as a commerce backend
 * reads them. Not in CommerceBackend yet: a backend without the reader has none, as today.
 */
export type TargetApprovalReader = { useTargetApprovals(): TargetApproval[] | undefined };
const NONE: TargetApproval[] = [];
const noTargetApprovals = () => NONE;
function useTargetApprovals(): TargetApproval[] {
  const read = (useCommerce() as CommerceBackend & Partial<TargetApprovalReader>).useTargetApprovals ?? noTargetApprovals;
  return read() ?? NONE;
}

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
  const targets = useTargetApprovals();
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState("");
  // The last decision's result, shown as a toast once the panel has closed and the page is
  // readable again (the open sheet hides the rest of the page from screen readers).
  const closedWith = useRef("");
  const toast = useToast();
  const count = (queue?.count ?? 0) + targets.length;

  // Read the queue as it is when the decision lands, not as it was when Approve was tapped.
  const queueNow = useRef(queue);
  const targetsNow = useRef(targets.length);
  useEffect(() => {
    queueNow.current = queue;
    targetsNow.current = targets.length;
  }, [queue, targets.length]);
  // Another manager can clear what's left while the panel shows a result: close then too.
  useEffect(() => {
    if (!open || count || !notice) return;
    closedWith.current = notice;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the closing message lives in a ref (a decision landing after the queue empties overwrites it before onCloseAutoFocus reads it), and render can't write refs
    setNotice("");
    setOpen(false);
  }, [open, count, notice]);

  function onDecided(requestId: string, result: string) {
    const others = (queueNow.current?.list.filter((request) => request._id !== requestId).length ?? 0) + targetsNow.current;
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
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) setNotice(""); }}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            className="shrink-0 border-gold/60 text-gold-text hover:bg-gold/10 hover:text-gold-text"
            data-testid="approvals-button"
            {...{ [APPROVALS_AREA]: "" }}
          >
            <ShieldCheck aria-hidden className="size-4" />
            Approvals
            {count ? (
              <span data-approval-count="" className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-semibold text-navy font-sans tabular-nums">
                {count}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </Button>
        </DialogTrigger>
        <CheckoutDialogContent
          panel
          className="gap-3"
          {...{ [APPROVALS_AREA]: "" }}
          // Focus the title, not the first control: that would open an ⓘ tip or arm Decline.
          onCloseAutoFocus={() => {
            if (closedWith.current) toast.show(closedWith.current);
            closedWith.current = "";
          }}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.querySelector<HTMLElement>("[data-approvals-title]")?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle data-approvals-title="" tabIndex={-1} className="outline-none">Approvals</DialogTitle>
            <DialogDescription className="sr-only">Requests from cashiers waiting for a manager.</DialogDescription>
          </DialogHeader>
          <p role="status" className={notice ? "rounded-lg bg-muted/60 px-3 py-2 text-sm" : "sr-only"}>{notice}</p>
          {queue === undefined ? (
            <Spinner label="Loading approvals" />
          ) : queue.list.length || targets.length ? (
            <ul className="grid gap-3" aria-label="Requests">
              {queue.list.map((request) => <ApprovalItem key={request._id} request={request} onResult={(result) => onDecided(request._id, result)} />)}
              {targets.length ? (
                <Suspense fallback={<li><Spinner label="Loading approvals" /></li>}>
                  {targets.map((request) => <TargetApprovalItem key={request._id} request={request} />)}
                </Suspense>
              ) : null}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Nothing waiting.</p>
          )}
        </CheckoutDialogContent>
      </Dialog>
      <Toast {...toast} />
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
  // Display only: the server decides expiry (and drops expired requests), so a fast device clock never blocks a decision.
  const expiring = now >= request.expiresAt;
  const soon = request.expiresAt - now <= 2 * 60_000;

  return (
    <li data-testid="approval-request">
    <Card className="grid gap-2 p-4">
      <p className="text-xs text-muted-foreground text-pretty [overflow-wrap:anywhere]">{lineName ?? (request.payload.kind === "customPrice" && request.payload.action === "addCustomItem" ? request.payload.name : null)}{lineName || (request.payload.kind === "customPrice" && request.payload.action === "addCustomItem") ? " · " : ""}{title}</p>
      <p className="text-[15px] font-semibold text-balance [overflow-wrap:anywhere]">{personName(request.requesterEmail)} {approvalAsk(request)}</p>
      {/* The cashier's own words, not an explanation. */}
      <blockquote data-sentence-budget="ignore" className="border-l-2 border-gold/60 pl-3 text-sm text-muted-foreground italic [overflow-wrap:anywhere]">“{refund?.reason ?? request.reason}”</blockquote>
      <p className="text-sm text-muted-foreground font-sans tabular-nums">
        {refund ? "Net received" : "Total"} {formatMoney(request.totalBefore)} → <span className="font-semibold text-foreground">{formatMoney(request.totalAfter)}</span>
      </p>
      <p className={soon ? "flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300" : "flex items-center gap-1.5 text-xs text-muted-foreground"}>
        {expiring ? "Expiring now" : `Expires in ${minutesLeft(request.expiresAt, now)} min`}
        <InfoTip label="About approvals" className="pointer-coarse:-my-3 pointer-coarse:-ml-2">Works once, for this order as it is now.</InfoTip>
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      <ApprovalDecisionButtons busy={busy} onDecide={(choice) => { void decide(choice).then((result) => { if (result) onResult(result); }); }} />
    </Card>
    </li>
  );
}
