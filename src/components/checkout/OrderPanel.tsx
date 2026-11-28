"use client";

import { OrderLineRow } from "./OrderLineRow";
import { CloseNothingDue } from "./CloseNothingDue";
import { ArrowLeft, ChevronDown, ReceiptText, TicketPercent, X } from "lucide-react";
import { Suspense, lazy, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MoreMenu } from "@/components/ui/more-menu";
import { Spinner } from "@/components/ui/spinner";
import { useNow } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { roundMoney, type OrderTotals, type TenderMethod } from "convex/shared/orderMath";
import { ApprovalInline } from "./ApprovalRequest";
import { OrderLifecycle } from "./OrderLifecycle";
import { useCheckoutBackend, useCommerce, type Catalog, type OrderId, type OrderLine, type OrderView } from "./backend";
import { TENDER_LABELS, couponLabel } from "./checkout-ui";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { FinancialHistory } from "./FinancialHistory";
import { OrderCoupon, SHORT_SCREEN_ONLY, canAddCoupon } from "./OrderCoupon";
import { RecollectionTakeBack } from "./RecollectionTakeBack";
import { OrderHistory } from "./OrderHistory";
import { DiscardOrderDialog } from "./OrderLifecycle";
import { useCheckoutDraft, useCheckoutDraftState, useCheckoutDiscountNotice, useCheckoutPaymentSubmitting } from "./CheckoutDrafts";
import { preloadPayDesk } from "./pay-desk-backend";
import { payMode, resumeMode } from "./pay-desk";
import { shownRequest } from "./staff-approvals";
import type { Run } from "./useOrderWrites";

const PayPanel = lazy(() => import("./PayPanel").then((module) => ({ default: module.PayPanel })));
const OrderPayNotice = lazy(() => import("./PayDeskNotices").then((module) => ({ default: module.OrderPayNotice })));

const EMPTY_LINES: OrderLine[] = [];
const EMPTY_TOTALS: OrderTotals = { subtotal: 0, discount: 0, coupon: 0, total: 0, vat: 0, deposit: 0, due: 0 };

/** Whether the order can be paid now: rows, no changed booking, no unfit coupon, no pending request (settleOrder refuses these too). */
export function usePayState(view: OrderView | null | undefined) {
  const now = useNow();
  const lines = view?.lines ?? EMPTY_LINES;
  // Rows whose booking or appointment changed must be updated (or removed) before payment.
  const stale = lines.filter((line) => line.sourceIssue).length;
  // A coupon that no longer fits must be fixed or removed first; settleOrder refuses it too.
  const couponBlocked = Boolean(view?.promotion?.problem) && lines.length > 0;
  const approvals = useCheckoutBackend().useOrderApprovals(view?.order._id ?? null);
  const waiting = approvals?.some((request) => request.status === "pending") ?? false;
  // A payment in progress (on any till), the checkout pause, or a till that must reload first.
  const commerce = useCommerce();
  const mode = payMode(commerce.useAccess(), commerce);
  const connected = commerce.useConnected();
  useEffect(() => { if (mode === "attempts") preloadPayDesk(); }, [mode]);
  const attemptActive = Boolean(view?.paymentAttempt);
  const payDesk = attemptActive || mode === "paused" || mode === "reload" || mode === "loading";
  // On the new payments a payment starts on the server: nothing starts while disconnected.
  const offline = mode === "attempts" && !connected;
  const cannotPay = !lines.length || stale > 0 || couponBlocked || waiting || payDesk || offline;
  return { now, stale, couponBlocked, approvals, waiting, cannotPay, payMode: mode, attemptActive, payDesk, offline };
}

/**
 * The order: a compact list of rows with small photos (tap to edit inline; rooms and extras step
 * their quantity in the row), totals with the VAT included, and the tender buttons in the fixed
 * footer. Paying swaps the rows for the payment panel. Used beside the catalog on wide screens
 * and inside the bottom sheet on phones (which passes `onClose`).
 */
export function OrderPanel({
  view,
  title,
  catalog,
  run,
  busy = false,
  onPaid,
  onClose,
  initialPay,
  discountNotice,
  onOpenOrder,
}: {
  view: OrderView | null | undefined;
  title: string;
  catalog: Catalog | undefined;
  run: Run;
  /** Order writes are still saving (the coupon field waits for them). */
  busy?: boolean;
  onPaid: (orderId: OrderId) => void;
  onClose?: () => void;
  /** Open on this tender's panel instead of the rows (the phone's "Cash ฿X"). */
  initialPay?: TenderMethod;
  discountNotice?: ReactNode;
  /** Opens another order (the stay's Shop & spa bill after Pay the room first). */
  onOpenOrder?: (orderId: OrderId) => void;
}) {
  const { confirmDiscard } = useCheckoutDraft();
  const panelRef = useRef<HTMLDivElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);
  const [moreBelow, setMoreBelow] = useState(false);
  const backend = useCheckoutBackend();
  const actions = backend.useActions();
  const access = useStaffAccess();
  const [confirm, setConfirm] = useState<"clear" | "discard" | null>(null);
  const [expanded, setExpanded] = useCheckoutDraftState<string | null>(`${view?.order._id ?? "new"}:expanded`, null);
  const { discountNotice: pendingDiscount, setDiscountNotice } = useCheckoutDiscountNotice();
  const [reviewRestore, setReviewRestore] = useState(false);
  const [restorePending, setRestorePending] = useState(false);
  const [couponOpen, setCouponOpen] = useState(false);
  const { paymentSubmitting, setPaymentSubmitting } = useCheckoutPaymentSubmitting();
  const lines = view?.lines ?? EMPTY_LINES;
  const editingLine = lines.some((line) => line._id === expanded);
  const totals = view?.totals ?? EMPTY_TOTALS;
  const orderId = view?.order._id;
  const itemCount = lines.reduce((n, line) => n + line.qty, 0);
  const { now, stale, couponBlocked, approvals, waiting, cannotPay, payMode: mode, attemptActive, payDesk, offline } = usePayState(view);
  // Part of a split already taken: the header shows what is still to collect.
  const attemptTaken = view?.paymentAttempt?.status === "collecting"
    ? view.paymentAttempt.legs.reduce((sum, leg) => sum + (leg.state === "taken" ? leg.amount : 0), 0) : 0;
  // While a payment holds the order its rows can't change; a swap after a refusal reopens them for its owning tab only.
  const swapping = view?.paymentAttempt?.status === "refused" && view.paymentAttempt.refusal?.code === "swap_requested";
  const swapAttempt = useCommerce().usePaymentAttempt(swapping && view?.paymentAttempt ? view.order._id : null, view?.paymentAttempt?._id);
  const recollections = view?.order.status === "draft"
    ? view.commerce?.handovers.filter(handover =>
        handover.kind === "recollect" && handover.successorOrderId === orderId && handover.status === "open" &&
        !handover.pendingReturnId && handover.contents?.some(item => item.unpaid > 0 && item.withGuest > 0)) ?? []
    : [];
  const rowsLocked = attemptActive && !(swapping && swapAttempt?.mine);
  // A queued line edit (a discount applied on blur) would change the total under an open pay panel.
  const payLocked = cannotPay || busy;
  const payLockedRef = useRef(payLocked);
  useLayoutEffect(() => { payLockedRef.current = payLocked; }, [payLocked]);
  // Opened from the phone's "Cash ฿X": straight to the cash panel, if the order can be paid. Confirm is still required.
  const [paying, setPaying] = useState<TenderMethod | "split" | "none" | null>(() => (initialPay && !payLocked && totals.due > 0 ? initialPay : null));
  useEffect(() => {
    if (paymentSubmitting || busy || !pendingDiscount?.review || pendingDiscount.orderId !== orderId) return;
    if (!lines.some(line => line._id === pendingDiscount.lineId) || view?.order.state === "paid" || view?.order.state === "void" || view?.order.state === "discarded") {
      setDiscountNotice(null);
      return;
    }
    setExpanded(pendingDiscount.lineId);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- consumes a Review discount request handed over through checkout context once this (possibly just mounted) panel can act on it
    setPaying(null);
    setDiscountNotice(null);
  }, [pendingDiscount, orderId, setExpanded, setDiscountNotice, paymentSubmitting, busy, lines, view?.order.state]);
  // A request on a line shows on that line; any other (a custom item, a void) above the tenders.
  const shown = shownRequest(approvals, now);
  const shownLine = shown && lines.some((line) => line._id === shown.lineId) ? shown.lineId : null;
  const staffDiscount = roundMoney(totals.discount - totals.coupon);

  // Content and viewport changes both affect the continuation cue (expanded rows, live writes,
  // keyboard, or rotation). ResizeObserver watches the scroller and its content.
  useEffect(() => {
    const box = itemsRef.current;
    if (!box) return;
    const update = () => setMoreBelow(box.scrollHeight - box.clientHeight - box.scrollTop > 2);
    const observer = new ResizeObserver(update);
    observer.observe(box);
    for (const child of box.children) observer.observe(child);
    box.addEventListener("scroll", update, { passive: true });
    update();
    return () => { observer.disconnect(); box.removeEventListener("scroll", update); };
  }, [paying, lines.length]);

  async function openPayment(mode: TenderMethod | "split" | "none") {
    if (payLockedRef.current || !await confirmDiscard() || payLockedRef.current) return;
    setPaying(mode);
  }

  /** Reopens this till's own payment where it was (v27 Resume). */
  function resumePayment() {
    if (view?.paymentAttempt) setPaying(resumeMode(view.paymentAttempt.legs));
  }

  // The payment lock, pause or reload screen in place of the tenders (lazy: only when one applies).
  const payNotice = view ? (
    <Suspense fallback={<div className="grid h-14 place-items-center"><Spinner /></div>}>
      <OrderPayNotice view={view} mode={mode} onResume={resumePayment} autoResume={!swapping} onCheckPrevious={() => setPaying("card")} />
    </Suspense>
  ) : null;

  async function clear() {
    if (!await confirmDiscard()) return;
    setConfirm(null);
    if (orderId) await run(() => actions.clearOrder({ orderId }));
  }

  if (view?.order.state === "discarded") return <div className="grid gap-4 overflow-y-auto p-5">
    <h2 className="font-serif text-2xl">{title} · Discarded</h2>
    <p className="text-sm">Read only. Restore it to edit or take payment.</p>
    <ul className="grid gap-3">{lines.map(line => <li key={line._id}><p className="font-medium">{line.name} · {formatMoney(line.net)}</p><p className="text-xs text-muted-foreground">{line.detail} · Quantity {line.qty}</p></li>)}</ul>
    {access.capabilities.orders && onOpenOrder ? (reviewRestore
      ? <OrderLifecycle orderId={view.order._id} onPending={setRestorePending} onDone={() => setReviewRestore(false)} onOpen={(id) => { setReviewRestore(false); onOpenOrder(id); }} />
      : <Button variant="outline" onClick={() => setReviewRestore(true)}>Review restore</Button>) : null}
    <OrderHistory orderId={view.order._id} /><FinancialHistory orderId={view.order._id} view={view} />
    {onClose ? <Button variant="outline" disabled={restorePending} onClick={onClose}>Close order</Button> : null}
  </div>;

  // With enlarged text the header and footer can outgrow the screen. The rows keep a minimum
  // height (no more than they get at normal text, even in phone landscape) and the panel itself
  // scrolls, so every action stays reachable; at normal text only the rows scroll.
  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
      <div className="flex flex-wrap max-sm:flex-nowrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3 sm:px-5 lg:py-4 [@media(max-height:32rem)]:py-1">
        <div className="flex min-w-0 flex-1 sm:basis-40 items-center gap-3">
          {paying ? null : <span aria-hidden className="hidden sm:grid size-10 shrink-0 place-items-center rounded-full border border-border bg-muted/60 text-gold-text">
            <ReceiptText className="size-[18px]" strokeWidth={1.5} />
          </span>}
          <div className="min-w-0 flex-1">
            <h2 className={cn("min-w-0 truncate leading-tight font-semibold lining-nums", paying ? "text-xs font-normal text-muted-foreground" : "font-serif text-2xl")} data-testid="order-panel-title">{paying ? (attemptTaken ? "Still to collect" : "Balance due") : title}</h2>
            {paying ? <p className="mt-1 text-[40px] leading-tight font-semibold font-sans tabular-nums" data-testid="pay-header-due">{formatMoney(totals.due - attemptTaken)}</p> : null}
            <p className="text-[13px] text-muted-foreground">
              {paying ? `${title} · ` : ""}{itemCount} {itemCount === 1 ? "item" : "items"}
              {/* Beside the catalog the strip above already names the customer; the phone sheet covers the strip. */}
              {onClose && view?.customer ? ` · ${view.customer.name}` : ""}
              {busy ? <span role="status" className="ml-2 text-xs">Saving…</span> : null}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 max-w-full flex-wrap max-sm:flex-nowrap items-center justify-end gap-2">
        {paying ? (
          <Button variant="ghost" size="sm" className="min-h-11 text-sm" disabled={paymentSubmitting} onClick={() => {
            // The tender pressed in the panel; while the panel is still loading, the one it opened with.
            const active = panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="Take payment by"] [aria-pressed="true"]');
            const opened = paying === "split" ? "Split payment" : paying && paying !== "none" ? TENDER_LABELS[paying].short : undefined;
            const label = active ? active.getAttribute("aria-label") ?? active.textContent?.trim() : opened;
            setPaying(null);
            // While paused the tenders are replaced: back on the control that opened the panel (Check previous payment).
            setTimeout(() => ([...(panelRef.current?.querySelectorAll("button") ?? [])].find((button) => getComputedStyle(button).display !== "none" && ((button.getAttribute("aria-label") ?? button.textContent?.trim()) === label || (label === "Cash" && button.textContent?.trim().startsWith("Cash ฿")))) ?? panelRef.current?.querySelector<HTMLButtonElement>("[data-pay-return]"))?.focus());
          }}><ArrowLeft aria-hidden className="size-4" /> Order</Button>
        ) : (
          <>
            {canAddCoupon(view) && !couponOpen ? (
              <Button variant="ghost" className={cn("h-9 rounded-xl px-2", !editingLine && SHORT_SCREEN_ONLY)} data-add-coupon onClick={() => setCouponOpen(true)} aria-label="Add coupon" title="Coupon: code, QR or link">
                <TicketPercent aria-hidden className="size-4" /><span>Coupon</span>
              </Button>
            ) : null}
            <MoreMenu
              label="More order actions"
              className="size-9 rounded-xl"
              disabled={!orderId || !itemCount}
              items={[
                { label: "Clear order", onSelect: () => setConfirm("clear") },
                // Cashiers' Orders list only open orders, so they couldn't restore one they discard.
                { label: "Discard order…", destructive: true, hidden: !access.capabilities.orders, onSelect: () => { void confirmDiscard().then((discard) => { if (discard) setConfirm("discard"); }); } },
              ]}
            />
            {/* Local dialogs rather than useConfirm: on phones they nest in the order sheet, which a
                dialog from outside would dismiss, and they get the touch sizes. */}
            <Dialog open={confirm === "clear"} onOpenChange={(open) => setConfirm(open ? "clear" : null)}>
              <CheckoutDialogContent role="alertdialog" showCloseButton={false} className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Clear this order?</DialogTitle>
                  <DialogDescription>Removes every item. The order keeps its number, customer and booking; price changes stay in the audit log.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirm(null)}>Cancel</Button>
                  <Button variant="destructive" onClick={clear}>Clear order</Button>
                </DialogFooter>
              </CheckoutDialogContent>
            </Dialog>
            <Dialog open={confirm === "discard"} onOpenChange={(open) => { if (!open) setConfirm(null); }}>
              {confirm === "discard" && view ? <DiscardOrderDialog view={view} onClose={() => setConfirm(null)} /> : null}
            </Dialog>
          </>
        )}
        {onClose ? (
          <Button size="icon" variant="ghost" className="size-9" onClick={onClose} disabled={paymentSubmitting} aria-label="Close order">
            <X aria-hidden className="size-4" />
          </Button>
        ) : null}
        </div>
      </div>

      {discountNotice}
      {paying && view ? (
        <Suspense fallback={<div className="grid flex-1 place-items-center"><Spinner /></div>}>
          <PayPanel key={`${view.order._id}:${paying}`} mode={paying} view={view} onSubmittingChange={setPaymentSubmitting} onBack={() => setPaying(null)} onPaid={onPaid} onOpenOrder={onOpenOrder} />
        </Suspense>
      ) : (
        <>
          {/* Items first; their change history follows them. With no items the hint fills the space above it. */}
          <div className={cn("flex flex-1 flex-col", moreBelow
            ? "min-h-[calc(min(14rem,28dvh)+1.5rem)] [@media(max-height:36rem)]:min-h-[calc(max(3rem,14dvh)+1.5rem)]"
            : "min-h-[min(14rem,28dvh)] [@media(max-height:36rem)]:min-h-[max(3rem,14dvh)]")}>
          <div ref={itemsRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto" inert={rowsLocked || undefined}>
            {lines.length === 0 ? (
              <div className="grid flex-1 place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
                <div className="grid justify-items-center gap-2"><ReceiptText aria-hidden className="size-8 text-muted-foreground/60" /><p className="text-[15px] font-medium text-foreground">No items yet</p><p className="text-[13px] text-pretty">Choose an item to add it.</p></div>
              </div>
            ) : (
              <ul className="divide-y divide-border/70 px-1">
                {lines.map((line) => {
                  const recollection = recollections.find(handover => handover.successorLineId === line._id);
                  return <OrderLineRow
                    key={line._id}
                    line={line}
                    canEditProductQuantity={Boolean(view?.order.stockBranchId && !recollection)}
                    catalog={catalog}
                    open={expanded === line._id}
                    onToggle={() => { void confirmDiscard().then((discard) => { if (discard) setExpanded(expanded === line._id ? null : line._id); }); }}
                    run={run}
                    now={now}
                    waiting={waiting}
                    request={shownLine === line._id ? shown : null}
                    onSent={() => setExpanded(null)}
                    takeBack={recollection && access.capabilities.approve ? <RecollectionTakeBack handover={recollection} line={line}
                      disabled={attemptActive || paymentSubmitting || busy} /> : null}
                  />;
                })}
              </ul>
            )}
            {orderId && view && view.order.revision > 0 ? <div className="px-4"><OrderHistory orderId={orderId} /></div> : null}
          </div>

          {moreBelow ? <div className="pointer-events-none flex min-h-6 shrink-0 items-center justify-center py-1"><span className="flex items-center gap-1 rounded-full bg-card px-2 text-xs text-muted-foreground"><ChevronDown aria-hidden className="size-3" />More item options</span></div> : null}
          </div>

          {lines.length || attemptActive || (shown && !shownLine) ? <div className="@container shrink-0 border-t border-border/70 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 lg:pb-5 [@media(max-height:32rem)]:pt-1 [@media(max-height:32rem)]:pb-[calc(0.25rem+env(safe-area-inset-bottom))]">
            {/* Outside the empty-order branch: a request for the first custom item starts on an empty order. */}
            {shown && !shownLine ? <ApprovalInline key={shown._id} request={shown} className="mb-2" /> : null}
            {lines.length ? <>
              {view ? <OrderCoupon view={view} run={run} busy={busy} open={couponOpen} onOpenChange={setCouponOpen} hideAdd={editingLine} /> : null}
              <dl className="space-y-1 text-sm">
                <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
                {staffDiscount ? <TotalRow label="Discounts" value={formatMoney(-staffDiscount)} /> : null}
                {totals.coupon ? (
                  <div className="flex justify-between gap-3 text-foreground" data-testid="order-coupon-total">
                    <dt className="flex min-w-0 items-center gap-1.5">
                      <TicketPercent aria-hidden className="size-3.5 shrink-0 text-gold-text" />
                      <span className="[overflow-wrap:anywhere]">{couponLabel(view ?? {})}</span>
                    </dt>
                    <dd className="text-right font-medium font-sans tabular-nums">{formatMoney(-totals.coupon)}</dd>
                  </div>
                ) : null}
                <TotalRow label="VAT 7% included" value={formatMoney(totals.vat)} muted />
                {totals.deposit ? <TotalRow label="Paid in advance" value={formatMoney(-totals.deposit)} /> : null}
              </dl>
              <div className="mt-2 mb-3 flex flex-wrap items-baseline justify-between gap-x-2 border-t border-border/70 pt-2 [@media(max-height:32rem)]:mb-2 [@media(max-height:32rem)]:pt-1">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Balance due</span>
                {/* Never wider than the panel: shrinks with it, and wraps under "Balance due" if it must. */}
                <span className="ml-auto min-w-0 text-right text-[min(2.5rem,11cqi)] leading-none font-semibold lining-nums font-sans tabular-nums [overflow-wrap:anywhere] [@media(max-height:32rem)]:text-[min(1.875rem,10cqi)]" data-testid="order-due">{formatMoney(totals.due)}</span>
              </div>
              {stale ? (
                <p role="status" className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                  {stale === 1 ? "A booking row changed" : `${stale} booking rows changed`}. Update {stale === 1 ? "it" : "them"} before taking payment.
                </p>
              ) : null}
              {offline && !payDesk ? (
                <p role="status" data-testid="pay-offline-order" className="mb-2 text-xs text-amber-800 dark:text-amber-300">Offline. Payments start again once the connection is back.</p>
              ) : null}
              {couponBlocked ? (
                <p role="status" className="mb-2 text-xs text-amber-800 dark:text-amber-300">Fix or remove the coupon before taking payment.</p>
              ) : null}
              {/* The request sits on its line, which may be scrolled away: say why the tenders are off. */}
              {waiting && shownLine ? (
                <p role="status" className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                  Waiting for a manager · {lines.find((line) => line._id === shownLine)?.name}
                </p>
              ) : null}
              {/* A waiting request shows once, on its bar (the line's, or the one above); the tenders stay off meanwhile. */}
              {payDesk && view ? payNotice : lines.length && totals.due === 0 ? (
                <CloseNothingDue view={view!} disabled={payLocked} onPaid={onPaid} onReview={() => { void openPayment("none"); }} />
              ) : (
                <>
                  <Button className="h-auto min-h-14 w-full whitespace-normal py-3 text-base font-sans tabular-nums" disabled={payLocked} onClick={() => { void openPayment("cash"); }}>Cash {formatMoney(totals.due)}</Button>
                  <div className="mt-2 grid grid-cols-2 gap-2 @min-[28rem]:grid-cols-4 lg:grid-cols-4">
                    {(["promptpay", "card", "transfer"] as const).map((method) => (
                      <Button key={method} className="h-auto min-h-11 min-w-0 whitespace-normal px-2 py-2 text-sm text-balance lg:px-1 lg:text-[13px]" variant="outline" disabled={payLocked} onClick={() => { void openPayment(method); }}>{TENDER_LABELS[method].short}</Button>
                    ))}
                    <Button variant="outline" aria-label="Split payment" className="h-auto min-h-11 min-w-0 px-2 py-2 text-sm lg:px-1 lg:text-[13px]" disabled={payLocked} onClick={() => { void openPayment("split"); }}>Split</Button>
                  </div>
                </>
              )}
            </> : attemptActive ? payNotice : null /* a swap that removed every row: the money taken stays reachable */}
          </div> : null}
        </>
      )}
    </div>
  );
}

/**
 * Closes an order with nothing left to pay (a deposit or coupon covers it) in one tap: settles it
 * with no tenders, one attempt key per try, so a retry after a lost answer closes it once. An order
 * with a stay offers the guest's booking confirmation email right beside it (off, as on the pay step).
 */
/** A typed amount that is a number: "" and a lone "." are not. */
function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted ? "text-xs text-muted-foreground" : "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="text-right font-sans tabular-nums">{value}</dd>
    </div>
  );
}
