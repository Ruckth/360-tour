"use client";

import { lazy, Suspense } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { InfoTip } from "@/components/ui/info-tip";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/lib/staff-bookings";
import { orderTitle } from "convex/shared/orderMath";
import { orderTime } from "./checkout-ui";
import { ApprovalDecisionButtons, useApprovalDecision } from "./ApprovalRequest";
import { useCheckoutBackend, useCommerce, useReturnsDesk, type ApprovalDetail, type ApprovalId, type ApprovalQueueRow, type ApprovalQueueStatus, type ApprovalRequest, type ExpiredApprovalQueueRow } from "./backend";
import { approvalAsk, minutesLeft, personName, queueAsk } from "./staff-approvals";

/*
 * The Approvals panel's request list (ApprovalsPanel), loaded when the panel first opens: the
 * header button and its count stay light on every admin page.
 */

// Loaded only when a return or edit request is waiting, so today's panel costs nothing more.
const TargetApprovalItem = lazy(() => import("./TargetApproval"));
const ReturnApprovalItem = lazy(() => import("./ReturnApproval"));
const ReturnQueueItem = lazy(() => import("./ReturnApproval").then((module) => ({ default: module.ReturnQueueItem })));

const isTarget = (row: ApprovalQueueRow): row is Extract<ApprovalQueueRow, { kind: "adjustment" | "returnItems" }> => row.kind === "adjustment" || row.kind === "returnItems";
type OrderRow = Exclude<ApprovalQueueRow, { kind: "adjustment" | "returnItems" }>;

/** The selected order request as its detail describes it; undefined while loading, null once it's gone. */
function orderRequest(detail: ApprovalDetail | null | undefined) {
  if (detail === undefined) return undefined;
  if (!detail || detail.kind === "adjustment" || detail.kind === "returnItems") return null;
  return { request: detail.request, lineName: detail.rows[0]?.label, title: orderTitle(detail.target?.orderNumber) };
}

/**
 * Whether this approver acts on Return items requests here: only once payments use attempts, since
 * before the cutover no commerce receipt, and so no return request, can exist. "loading" while the
 * till's access is still being read or admitted: neither live nor confirmed pre-cutover.
 */
function useReturnApprovalsLive(): boolean | "loading" {
  const desk = useReturnsDesk();
  const access = useStaffAccess();
  const mode = useCommerce().useAccess()?.paymentsMode;
  if (!desk || !access.capabilities.approve) return false;
  return mode === undefined ? "loading" : mode === "attempts";
}

export default function ApprovalsList({ rows, states, history, verifying, selectedId, count, more, searching, loadingMore, onMore, onSelect, onDecided }: {
  rows: ApprovalQueueRow[];
  states?: Record<string, ApprovalQueueStatus | Error | undefined>;
  history?: ExpiredApprovalQueueRow[];
  verifying?: boolean;
  selectedId: ApprovalId | null;
  count: number;
  more: boolean;
  searching: boolean;
  loadingMore: boolean;
  onMore: () => void;
  onSelect: (id: ApprovalId) => void;
  onDecided: (requestId: string, result: string) => void;
}) {
  // Once payments use attempts, a return request opens with Approve, which authorizes it (W2B returns desk).
  const returnsLive = useReturnApprovalsLive();
  const now = useNow(10_000);
  return (
    <>
      {rows.length ? (
        <ul className="grid gap-3" aria-label="Requests">
          {rows.map((row) => {
            const chosen = row._id === selectedId;
            if (!chosen && states && states[row._id] !== "pending") {
              const status = states[row._id];
              const label = status === "expired" || row.expiresAt <= now ? "Expired" : status === "revoked" ? "Access changed"
                : status === "stale" || !row.actionable ? "Request changed" : status === undefined ? "Checking eligibility" : "Unavailable";
              return <UnavailableQueueRow key={row._id} row={row} status={label} />;
            }
            if (row.kind === "returnItems" && returnsLive === "loading") {
              return <li key={row._id} data-testid="approval-request" data-approval-loading="true"><Spinner label="Loading approvals" /></li>;
            }
            // Only the open return reads its order, detail and quote; the rest show their stored summary.
            if (row.kind === "returnItems" && returnsLive) {
              return (
                <Suspense key={row._id} fallback={<li><Spinner label="Loading approvals" /></li>}>
                  {chosen
                    ? <ReturnApprovalItem request={row} onResult={(result) => onDecided(row._id, result)} />
                    : <ReturnQueueItem request={row} onSelect={() => onSelect(row._id)} />}
                </Suspense>
              );
            }
            if (isTarget(row)) {
              return (
                <Suspense key={row._id} fallback={<li><Spinner label="Loading approvals" /></li>}>
                  {chosen ? <SelectedTarget row={row} /> : <TargetApprovalItem row={row} detail={undefined} onSelect={() => onSelect(row._id)} />}
                </Suspense>
              );
            }
            return chosen
              ? <SelectedOrderRequest key={row._id} row={row} onResult={(result) => onDecided(row._id, result)} />
              : <QueueRow key={row._id} row={row} onSelect={() => onSelect(row._id)} />;
          })}
        </ul>
      ) : null}
      {verifying ? <Spinner label="Checking request eligibility" /> : null}
      {history?.some(row => !rows.some(active => active._id === row._id)) ? <section aria-label="Recent expired requests" className="grid gap-2">
        <h3 className="text-sm font-semibold">Recently expired</h3>
        <ul className="grid gap-2">{history.filter(row => !rows.some(active => active._id === row._id)).map(row => <UnavailableQueueRow key={row._id} row={row} status="Expired" />)}</ul>
      </section> : null}
      {searching ? <Spinner label="Checking older requests" /> : null}
      {!count && more && !searching ? <p className="text-sm text-muted-foreground" data-testid="approvals-none-loaded">None you can approve in the newest requests.</p> : null}
      {more && !searching ? (
        <Button type="button" variant="outline" className="w-full" disabled={loadingMore} onClick={onMore}>
          {loadingMore ? <Spinner label="Loading more" className="text-current" /> : null}
          Show more requests
        </Button>
      ) : null}
      {!rows.length && !more ? <p className="text-sm text-muted-foreground">Nothing waiting.</p> : null}
    </>
  );
}

function UnavailableQueueRow({ row, status }: { row: ApprovalQueueRow | ExpiredApprovalQueueRow; status: string }) {
  const title = row.kind === "returnItems" ? "Return items" : row.kind === "adjustment" ? "Adjustment" : queueAsk(row);
  return <li className="grid gap-0.5 rounded-xl border border-border px-4 py-3 text-sm">
    <span className="font-medium">{personName(row.requesterEmail)} · {title}</span>
    <span className="text-xs text-muted-foreground">{status} · {status === "Expired" ? "Expired at" : "Expires"} {orderTime(row.expiresAt)}</span>
    {"orderTitle" in row && row.orderTitle ? <span className="text-xs">{row.orderTitle}</span> : null}
  </li>;
}

/** A request that isn't open: who asks for what, and when it expires. Tap to open it. */
function QueueRow({ row, onSelect }: { row: OrderRow; onSelect: () => void }) {
  const now = useNow(10_000);
  return (
    <li data-testid="approval-request" data-approval-selected="false">
      <button type="button" onClick={onSelect} className="grid w-full gap-0.5 rounded-xl border border-border bg-card px-4 py-3 text-left transition-colors hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="text-[15px] font-semibold text-balance [overflow-wrap:anywhere]">{personName(row.requesterEmail)} {queueAsk(row)}</span>
        <span className="text-xs [overflow-wrap:anywhere]">{row.orderTitle ?? `Order reference ${row.orderId}`}</span>
        <span className="text-xs text-muted-foreground">{row.actionable !== false && now < row.expiresAt ? "Action required · " : "Unavailable · "}{now >= row.expiresAt ? "Expired" : `Expires in ${minutesLeft(row.expiresAt, now)} min`}</span>
      </button>
    </li>
  );
}

/** The open return or edit: its one detail read. */
function SelectedTarget({ row }: { row: Extract<ApprovalQueueRow, { kind: "adjustment" | "returnItems" }> }) {
  const detail = useCheckoutBackend().useApprovalDetail(row._id);
  return <TargetApprovalItem row={row} detail={detail} />;
}

/** The open order request: its one detail read, then the reason, totals and Decline · Approve. */
function SelectedOrderRequest({ row, onResult }: { row: OrderRow; onResult: (text: string) => void }) {
  const view = orderRequest(useCheckoutBackend().useApprovalDetail(row._id));
  if (view === undefined) return <li data-testid="approval-request" data-approval-selected="true"><Card className="grid gap-2 p-4"><Spinner label="Loading request" /></Card></li>;
  if (view === null) {
    return (
      <li data-testid="approval-request" data-approval-selected="true">
        <Card className="grid gap-1 p-4 text-sm"><p className="font-semibold">{personName(row.requesterEmail)} {queueAsk(row)}</p><p className="text-muted-foreground">No longer waiting.</p></Card>
      </li>
    );
  }
  return <ApprovalItem request={view.request} lineName={view.lineName} title={view.title} onResult={onResult} />;
}

function ApprovalItem({ request, lineName, title, onResult }: { request: ApprovalRequest; lineName?: string; title: string; onResult: (text: string) => void }) {
  const now = useNow(10_000);
  const refund = request.payload.kind === "refund" ? request.payload : null;
  const { decide, busy, error } = useApprovalDecision(request, lineName, title);
  // Display only: the server decides expiry (and drops expired requests), so a fast device clock never blocks a decision.
  const expiring = now >= request.expiresAt;
  const soon = request.expiresAt - now <= 2 * 60_000;
  const custom = request.payload.kind === "customPrice" && request.payload.action === "addCustomItem" ? request.payload.name : null;

  return (
    <li data-testid="approval-request" data-approval-selected="true">
    <Card className="grid gap-2 p-4">
      <p className="text-xs text-muted-foreground text-pretty [overflow-wrap:anywhere]">{lineName ?? custom}{lineName || custom ? " · " : ""}{title}</p>
      <p className="text-[15px] font-semibold text-balance [overflow-wrap:anywhere]">{personName(request.requesterEmail)} {approvalAsk(request)}</p>
      {/* The cashier's own words, not an explanation. */}
      <blockquote data-sentence-budget="ignore" className="border-l-2 border-gold/60 pl-3 text-sm text-muted-foreground italic [overflow-wrap:anywhere]">“{refund?.reason ?? request.reason}”</blockquote>
      <p className="text-sm text-muted-foreground font-sans tabular-nums">
        {refund ? "Net received" : "Total"} {formatMoney(request.totalBefore)} → <span className="font-semibold text-foreground">{formatMoney(request.totalAfter)}</span>
      </p>
      <p className={soon ? "flex items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300" : "flex items-center gap-1.5 text-xs text-muted-foreground"}>
        {expiring ? "Expiring now" : `Expires in ${minutesLeft(request.expiresAt, now)} min`}
        <InfoTip label="About approvals" className="-my-3 -ml-2">Works once, for this order as it is now.</InfoTip>
      </p>
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {request.status === "pending"
        ? <ApprovalDecisionButtons busy={busy} onDecide={(choice) => { void decide(choice).then((result) => { if (result) onResult(result); }); }} />
        : <p className="text-sm text-muted-foreground">No longer waiting.</p>}
    </Card>
    </li>
  );
}
