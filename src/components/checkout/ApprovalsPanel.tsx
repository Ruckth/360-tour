"use client";

import { useNow } from "@/lib/staff-bookings";
import { ShieldCheck } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Toast, useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useCheckoutBackend, type ApprovalId, type ApprovalQueueRow } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";

// The request list, its cards and the return and edit approvals load when the panel first opens.
const ApprovalsList = lazy(() => import("./ApprovalsList"));

const isTarget = (row: ApprovalQueueRow): row is Extract<ApprovalQueueRow, { kind: "adjustment" | "returnItems" }> => row.kind === "adjustment" || row.kind === "returnItems";

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

// Every control here is at least 44 × 44 px with any pointer (a mouse included), as at the till.
const PANEL_TARGETS = "[&_button]:min-h-11 [&_button]:min-w-11";
/** Requests per page, as staffApprovals.pendingPage allows. */
const APPROVAL_PAGE = 20;

/**
 * Whether a queue row can still be decided: the queue marks a request from before commerce whose
 * rules or business day have moved on `actionable: false`. It still lists, but isn't counted or opened first.
 */
export const isActionable = (row: ApprovalQueueRow) => row.actionable !== false;

/**
 * Pages read on their own while none of what's loaded can be approved: a manager's own requests
 * (a cashier who was promoted) never show to them, so a first page can hold none they may review.
 * Each page reads at most 21 requests; past this many, Show more requests keeps going.
 */
export const AUTO_PAGES = 5;

/**
 * The queue is one cursor-paged list of compact rows (staffApprovals.pendingPage), newest first.
 * Only the selected request reads its detail, so the panel never fans out to orders or details.
 * "Nothing waiting" shows only once the server says there are no more pages.
 */
function ApprovalsButton() {
  const backend = useCheckoutBackend();
  const page = backend.usePendingApprovals();
  // Returns and edits need the commerce readers; without them only today's requests show.
  const commerce = backend.commerce !== undefined;
  const rows = useMemo(() => (commerce ? page.results : page.results.filter((row) => !isTarget(row))), [commerce, page.results]);
  const [open, setOpen] = useState(false);
  const now = useNow(10_000);
  const candidates = useMemo(() => rows.filter(row => row.expiresAt > now && isActionable(row)), [rows, now]);
  const states = backend.useApprovalQueueStates?.(candidates);
  const history = backend.useExpiredApprovals?.(open);
  const checking = !!states && candidates.some(row => states[row._id] === undefined);
  const actionable = useMemo(() => candidates.filter(row => !states || states[row._id] === "pending"), [candidates, states]);
  const sortedRows = useMemo(() => {
    const eligible = new Set(actionable.map(row => row._id));
    return [...actionable, ...rows.filter(row => !eligible.has(row._id))];
  }, [rows, actionable]);
  const [notice, setNotice] = useState("");
  const [selectedId, setSelectedId] = useState<ApprovalId | null>(null);
  // The one open request: the one tapped, else the one that can be decided and expires first.
  const selected = rows.find((row) => row._id === selectedId) ?? actionable.reduce<ApprovalQueueRow | null>((soonest, row) => (!soonest || row.expiresAt < soonest.expiresAt ? row : soonest), null);
  // The last decision's result, shown as a toast once the panel has closed and the page is
  // readable again (the open sheet hides the rest of the page from screen readers).
  const closedWith = useRef("");
  const toast = useToast();
  const more = page.status === "CanLoadMore" || page.status === "LoadingMore";
  const count = actionable.length;

  // Nothing here can be approved but older pages exist: read the next one, a few times at most.
  const [autoPages, setAutoPages] = useState(0);
  const { status, loadMore } = page;
  useEffect(() => {
    if (status !== "CanLoadMore" || count || checking || autoPages >= AUTO_PAGES) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- counts pages this effect asked for, so it stops after AUTO_PAGES; the next page arrives from the server, not from render
    setAutoPages(autoPages + 1);
    loadMore(APPROVAL_PAGE);
  }, [status, count, checking, autoPages, loadMore]);
  const searching = !count && more && (page.status === "LoadingMore" || autoPages < AUTO_PAGES);

  // Read the queue as it is when the decision lands, not as it was when Approve was tapped.
  const rowsNow = useRef(rows);
  useEffect(() => { rowsNow.current = rows; }, [rows]);
  // Another manager can clear what's left while the panel shows a result: close then too.
  useEffect(() => {
    if (!open || rows.length || more || !notice) return;
    closedWith.current = notice;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the closing message lives in a ref (a decision landing after the queue empties overwrites it before onCloseAutoFocus reads it), and render can't write refs
    setNotice("");
    setOpen(false);
  }, [open, rows.length, more, notice]);

  function onDecided(requestId: string, result: string) {
    const others = rowsNow.current.filter((row) => row._id !== requestId).length;
    setSelectedId(null);
    // Older pages may still hold requests: keep the panel open on them.
    if (others || more) {
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
      <Dialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setNotice(""); setSelectedId(null); } }}>
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
                {count}{more ? "+" : ""}
                <span className="sr-only"> waiting</span>
              </span>
            ) : null}
          </Button>
        </DialogTrigger>
        <CheckoutDialogContent
          panel
          className={cn("gap-3 max-md:h-[85dvh] max-md:content-start", PANEL_TARGETS)}
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
          {page.status === "LoadingFirstPage" ? (
            <Spinner label="Loading approvals" />
          ) : (
            <Suspense fallback={<Spinner label="Loading approvals" />}>
              <ApprovalsList
                rows={sortedRows} states={states} history={history} verifying={checking} selectedId={selected?._id ?? null} count={count} more={more} searching={searching}
                loadingMore={page.status === "LoadingMore"} onMore={() => page.loadMore(APPROVAL_PAGE)} onSelect={setSelectedId} onDecided={onDecided}
              />
            </Suspense>
          )}
        </CheckoutDialogContent>
      </Dialog>
      <Toast {...toast} />
    </>
  );
}
