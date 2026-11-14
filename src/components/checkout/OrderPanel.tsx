"use client";

import { ArrowLeft, ChevronDown, ChevronRight, Minus, Plus, ReceiptText, RefreshCw, TicketPercent, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { REASON_CHIPS } from "@/components/ui/reason-chips";
import { ReasonField } from "@/components/ui/reason-field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { isTimeValue } from "@/lib/dates/values";
import {
  errorText,
  resortIsoDate,
  resortTime24,
  useNow,
} from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { MAX_PRICE, MAX_QTY, MERGES_QTY, lineCouponDiscount, round2, type BillTotals, type TenderMethod } from "convex/lib/billMath";
import type { ApprovalPayload } from "convex/lib/staffTypes";
import { ApprovalInline, ApprovalRequestForm, useSendApproval } from "./ApprovalRequest";
import { newAttemptKey, useCheckoutBackend, type ApprovalRequest, type Catalog, type CheckoutActions, type OrderId, type OrderLine, type OrderView } from "./backend";
import { TENDER_LABELS, amountInput, couponLabel, scheduleLabel } from "./checkout-ui";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { CheckoutPhoto } from "./CheckoutPhoto";
import { discountText, parseDiscount } from "./discount-input";
import { FinancialHistory } from "./FinancialHistory";
import { OrderCoupon, SHORT_SCREEN_ONLY, canAddCoupon } from "./OrderCoupon";
import { OrderHistory } from "./OrderHistory";
import { DiscardOrderDialog } from "./OrderLifecycle";
import { useCheckoutDraft, useCheckoutDraftState, useCheckoutDiscountNotice, useCheckoutPaymentSubmitting } from "./CheckoutDrafts";
import { PayPanel } from "./PayPanel";
import { discountOverLimit, formatPercent, needsApproval, shownRequest } from "./staff-approvals";
import type { Run } from "./useOrderWrites";

/** A request the cashier is about to send: what it is, its exact payload, and a reason to start from. */
type Ask = { what: string; payload: ApprovalPayload; reason?: string };

const EMPTY_LINES: OrderLine[] = [];
const EMPTY_TOTALS: BillTotals = { subtotal: 0, discount: 0, coupon: 0, total: 0, vat: 0, deposit: 0, due: 0 };

/**
 * The date and time a service row's editor shows, in resort time (Bangkok). A legacy row with a
 * start shows its date and time, so editing one part keeps the other; a legacy "now" row and an
 * unscheduled row show both blank. Nothing is filled in from the clock.
 */
export function serviceScheduleValue(line: Pick<OrderLine, "schedule" | "startAt">): { date: string; time: string } {
  if (line.schedule) return { date: line.schedule.date ?? "", time: line.schedule.time ?? "" };
  return line.startAt !== undefined ? { date: resortIsoDate(line.startAt), time: resortTime24(line.startAt) } : { date: "", time: "" };
}

/** A legacy row's start: "14:00" today, "Mon 26 Oct, 14:00" on another day this year, with the year otherwise. */
export function serviceStartLabel(startAt: number, now: number) {
  const time = resortTime24(startAt);
  const day = resortIsoDate(startAt);
  const today = resortIsoDate(now);
  if (day === today) return time;
  return `${staffDate(startAt, { weekday: true, now })}, ${time}`;
}

/**
 * Whether the order can be paid now: it has rows, none whose booking changed, no coupon that stopped
 * fitting and no request waiting for a manager (settleOrder refuses all of these, whoever pays).
 */
export function usePayState(view: OrderView | null | undefined) {
  const now = useNow();
  const lines = view?.lines ?? EMPTY_LINES;
  // Rows whose booking or appointment changed must be updated (or removed) before payment.
  const stale = lines.filter((line) => line.sourceIssue).length;
  // A coupon that no longer fits must be fixed or removed first; settleOrder refuses it too.
  const couponBlocked = Boolean(view?.promotion?.problem) && lines.length > 0;
  const approvals = useCheckoutBackend().useOrderApprovals(view?.order._id ?? null);
  const waiting = approvals?.some((request) => request.status === "pending") ?? false;
  const cannotPay = !lines.length || stale > 0 || couponBlocked || waiting;
  return { now, stale, couponBlocked, approvals, waiting, cannotPay };
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
  const [couponOpen, setCouponOpen] = useState(false);
  const { paymentSubmitting, setPaymentSubmitting } = useCheckoutPaymentSubmitting();
  const lines = view?.lines ?? EMPTY_LINES;
  const editingLine = lines.some((line) => line._id === expanded);
  const totals = view?.totals ?? EMPTY_TOTALS;
  const orderId = view?.order._id;
  const itemCount = lines.reduce((n, line) => n + line.qty, 0);
  const { now, stale, couponBlocked, approvals, waiting, cannotPay } = usePayState(view);
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
    setPaying(null);
    setDiscountNotice(null);
  }, [pendingDiscount, orderId, setExpanded, setDiscountNotice, paymentSubmitting, busy, lines, view?.order.state]);
  // A request on a line shows on that line; any other (a custom item, a void) above the tenders.
  const shown = shownRequest(approvals, now);
  const shownLine = shown && lines.some((line) => line._id === shown.lineId) ? shown.lineId : null;
  const staffDiscount = round2(totals.discount - totals.coupon);

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

  async function clear() {
    if (!await confirmDiscard()) return;
    setConfirm(null);
    if (orderId) await run(() => actions.clearOrder({ orderId }));
  }

  if (view?.order.state === "discarded") return <div className="grid gap-4 overflow-y-auto p-5">
    <h2 className="font-serif text-2xl">{title} · Discarded</h2>
    <p className="text-sm">Read only. Restore it from Orders › Discarded to edit or take payment.</p>
    <ul className="grid gap-3">{lines.map(line => <li key={line._id}><p className="font-medium">{line.name} · {formatMoney(line.net)}</p><p className="text-xs text-muted-foreground">{line.detail} · Quantity {line.qty}</p></li>)}</ul>
    <OrderHistory orderId={view.order._id} /><FinancialHistory orderId={view.order._id} view={view} />
    {onClose ? <Button variant="outline" onClick={onClose}>Close order</Button> : null}
  </div>;

  // With enlarged text the header and footer can outgrow the screen. The rows keep a minimum
  // height (no more than they get at normal text, even in phone landscape) and the panel itself
  // scrolls, so every action stays reachable; at normal text only the rows scroll.
  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3 sm:px-5 lg:py-4 [@media(max-height:32rem)]:py-2">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
          {paying ? null : <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-muted/60 text-gold-text">
            <ReceiptText className="size-[18px]" strokeWidth={1.5} />
          </span>}
          <div className="min-w-0 flex-1">
            <h2 className={cn("leading-tight font-semibold lining-nums [overflow-wrap:anywhere]", paying ? "text-xs font-normal text-muted-foreground" : "font-serif text-2xl")} data-testid="order-panel-title">{paying ? "Balance due" : title}</h2>
            {paying ? <p className="mt-1 text-[40px] leading-tight font-semibold font-sans tabular-nums">{formatMoney(totals.due)}</p> : null}
            <p className="text-[13px] text-muted-foreground">
              {paying ? `${title} · ` : ""}{itemCount} {itemCount === 1 ? "item" : "items"}
              {/* Beside the catalog the strip above already names the customer; the phone sheet covers the strip. */}
              {onClose && view?.customer ? ` · ${view.customer.name}` : ""}
              {busy ? <span role="status" className="ml-2 text-xs">Saving…</span> : null}
            </p>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
        {paying ? (
          <Button variant="ghost" size="sm" className="min-h-11 text-sm" disabled={paymentSubmitting} onClick={() => {
            const active = panelRef.current?.querySelector<HTMLButtonElement>('[aria-label="Take payment by"] [aria-pressed="true"]');
            const label = active?.getAttribute("aria-label") ?? active?.textContent?.trim();
            setPaying(null);
            setTimeout(() => [...(panelRef.current?.querySelectorAll("button") ?? [])].find((button) => getComputedStyle(button).display !== "none" && ((button.getAttribute("aria-label") ?? button.textContent?.trim()) === label || (label === "Cash" && button.textContent?.trim().startsWith("Cash ฿"))))?.focus());
          }}><ArrowLeft aria-hidden className="size-4" /> Order</Button>
        ) : (
          <>
            {canAddCoupon(view) && !couponOpen ? (
              <Button variant="ghost" className={cn("size-9 rounded-xl sm:w-auto sm:px-2", !editingLine && SHORT_SCREEN_ONLY)} data-add-coupon onClick={() => setCouponOpen(true)} aria-label="Add coupon" title="Coupon: code, QR or link">
                <TicketPercent aria-hidden className="size-4" /><span className="max-sm:sr-only">Coupon</span>
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
        <PayPanel key={`${view.order._id}:${paying}`} mode={paying} view={view} onSubmittingChange={setPaymentSubmitting} onBack={() => setPaying(null)} onPaid={onPaid} />
      ) : (
        <>
          {/* Items first; their change history follows them. With no items the hint fills the space above it. */}
          <div className="relative flex min-h-[min(14rem,28dvh)] flex-1 flex-col [@media(max-height:36rem)]:min-h-[max(3rem,14dvh)]">
          <div ref={itemsRef} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {lines.length === 0 ? (
              <div className="grid flex-1 place-items-center px-6 py-8 text-center text-sm text-muted-foreground">
                <div className="grid justify-items-center gap-2"><ReceiptText aria-hidden className="size-8 text-muted-foreground/60" /><p className="text-[15px] font-medium text-foreground">No items yet</p><p className="text-[13px] text-pretty">Tap an item to add it.</p></div>
              </div>
            ) : (
              <ul className="divide-y divide-border/70 px-1">
                {lines.map((line) => (
                  <OrderLineRow
                    key={line._id}
                    line={line}
                    catalog={catalog}
                    open={expanded === line._id}
                    onToggle={() => { void confirmDiscard().then((discard) => { if (discard) setExpanded(expanded === line._id ? null : line._id); }); }}
                    run={run}
                    now={now}
                    waiting={waiting}
                    request={shownLine === line._id ? shown : null}
                    onSent={() => setExpanded(null)}
                  />
                ))}
              </ul>
            )}
            {orderId && view && view.order.revision > 0 ? <div className="px-4"><OrderHistory orderId={orderId} /></div> : null}
          </div>

          {moreBelow ? <div className="pointer-events-none absolute inset-x-0 bottom-0 flex h-12 items-end justify-center bg-linear-to-t from-card via-card/95 to-transparent pb-1.5"><span className="flex items-center gap-1 rounded-full bg-card px-2 text-xs text-muted-foreground"><ChevronDown aria-hidden className="size-3" />More item options</span></div> : null}
          </div>

          {lines.length || (shown && !shownLine) ? <div className="@container shrink-0 border-t border-border/70 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 lg:pb-5">
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
              {lines.length && totals.due === 0 ? (
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
            </> : null}
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
function CloseNothingDue({ view, disabled, onPaid, onReview }: { view: OrderView; disabled: boolean; onPaid: (orderId: OrderId) => void; onReview: () => void }) {
  const actions = useCheckoutBackend().useActions();
  const attempt = useRef<Parameters<CheckoutActions["settleOrder"]>[0] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const withStay = view.sources.some((source) => source.kind === "booking");
  const [notifyGuest, setNotifyGuest] = useState(false);
  async function close() {
    if (pending) return;
    // The order changed since the last try: a new close is a new attempt.
    if (attempt.current && attempt.current.expectedRevision !== view.order.revision) attempt.current = null;
    attempt.current ??= {
      orderId: view.order._id,
      idempotencyKey: newAttemptKey(),
      expectedDue: view.totals.due,
      expectedRevision: view.order.revision,
      expectedCustomerRevision: view.customer && "revision" in view.customer ? view.customer.revision : undefined,
      tenders: [],
      notifyGuest,
    };
    setPending(true);
    setError("");
    try {
      await actions.settleOrder(attempt.current);
      onPaid(attempt.current.orderId);
    } catch (err) {
      setError(errorText(err, "The order didn't close. Try again."));
      setPending(false);
    }
  }
  return (
    <>
      {error ? <p role="alert" className="mb-2 text-sm text-destructive">{error}</p> : null}
      {withStay ? (
        <label className="mb-2 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={notifyGuest} disabled={pending || Boolean(error)} onChange={(e) => setNotifyGuest(e.target.checked)} />
          Send booking payment confirmation email
        </label>
      ) : null}
      <Button className="h-12 w-full rounded-xl" disabled={disabled || pending} onClick={() => void close()}>
        {pending ? <Spinner label="Closing order" className="text-current" /> : null}
        {error ? "Retry close" : "Close order · nothing due"}
      </Button>
      {/* Staff entering an earlier sale set when it happened on the payment step. */}
      <Button variant="link" size="sm" className="mt-1 h-auto w-full p-0 text-xs text-muted-foreground" disabled={disabled || pending} onClick={onReview}>
        Happened earlier? Set the date
      </Button>
    </>
  );
}

/** A typed amount that is a number: "" and a lone "." are not. */
const isAmount = (text: string) => text !== "" && Number.isFinite(Number(text));

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted ? "text-xs text-muted-foreground" : "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="text-right font-sans tabular-nums">{value}</dd>
    </div>
  );
}

/** A service row's therapist and planned time: "Any therapist · Not scheduled", "Mint · Today, 14:00". */
function scheduleSummary(line: OrderLine, now: number) {
  const parts = [line.staffName ?? "Any therapist"];
  // Legacy rows (no schedule) keep their own meaning: a start, or "Now".
  if (line.kind === "service") parts.push(scheduleLabel(line.schedule, now) ?? (line.startAt ? serviceStartLabel(line.startAt, now) : "Now"));
  return parts.join(" · ");
}

function lineSubtitle(line: OrderLine, now: number) {
  const parts = [line.detail];
  if (line.kind === "service" || line.kind === "appointment") parts.push(scheduleLabel(line.schedule, now) === "Not scheduled" ? line.staffName ?? "Any therapist" : scheduleSummary(line, now));
  if (MERGES_QTY[line.kind] && line.qty > 1) parts.push(`${formatMoney(line.priceOverride?.price ?? line.unitPrice)} each`);
  return parts.filter(Boolean).join(" · ");
}

function OrderLineRow({ line, catalog, open, onToggle, run, now, waiting, request, onSent }: {
  line: OrderLine; catalog: Catalog | undefined; open: boolean; onToggle: () => void; run: Run; now: number; waiting: boolean;
  /** This line's request: waiting for a manager, or its recent outcome. */
  request: ApprovalRequest | null;
  /** A discount request was sent from the editor; it closes, and the request shows in its place. */
  onSent: () => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const send = useSendApproval();
  const cashier = useStaffAccess().role === "cashier";
  // A cashier updating a repriced booking row may need a manager (customPrice).
  const [ask, setAsk] = useState<Ask | null>(null);
  const updateSource = () => run(async () => {
    try {
      return await actions.updateSourceLine({ lineId: line._id });
    } catch (err) {
      if (!cashier || !needsApproval(err)) throw err;
      setAsk({ what: "price update", payload: { kind: "customPrice", action: "updateSourceLine", lineId: line._id } });
      return null;
    }
  });
  const listPrice = round2(line.unitPrice * line.qty);
  const issue = line.sourceIssue;
  // Already part of `net`: shown so staff can tell it from a line discount.
  const couponShare = line.couponDiscount ? lineCouponDiscount(line) : 0;
  return (
    <li className={cn("rounded-lg", issue && "bg-amber-50/60 dark:bg-amber-400/5")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full flex-wrap items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-4">
        <CheckoutPhoto src={line.imageUrl} kind={line.kind} className="size-11 sm:size-12" />
        {/* With enlarged text the name keeps a readable width and the price wraps below it. */}
        <span className="min-w-24 flex-1">
          <span className="block text-[15px] font-medium [overflow-wrap:anywhere]">
            {line.name}
          </span>
          <span className="block text-pretty text-xs leading-4 text-muted-foreground">{lineSubtitle(line, now)}</span>
          {!open && line.kind === "service" && scheduleLabel(line.schedule, now) === "Not scheduled" ? <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">Not scheduled</span> : null}
          {line.deposit ? <span className="block text-xs text-emerald-700 dark:text-emerald-300">{formatMoney(line.deposit)} paid in advance</span> : null}
          {line.priceOverride ? <span className="block truncate text-xs text-amber-700 dark:text-amber-300">Price changed: {line.priceOverride.note}</span> : null}
          {line.stayCoupon ? (
            <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <TicketPercent aria-hidden className="mt-px size-3.5 shrink-0 text-gold-text" />
              <span className="min-w-0 [overflow-wrap:anywhere]">Priced with <span className="font-mono font-semibold">{line.stayCoupon.code}</span> on the booking</span>
            </span>
          ) : null}
        </span>
        <span className="ml-auto shrink-0 text-right">
          <span className="block text-sm font-semibold font-sans tabular-nums">{formatMoney(line.net)}</span>
          {line.net !== listPrice ? <span className="block text-xs text-muted-foreground font-sans tabular-nums line-through">{formatMoney(listPrice)}</span> : null}
          {couponShare ? <span className="block text-xs font-medium whitespace-nowrap text-gold-text font-sans tabular-nums">Coupon {formatMoney(-couponShare)}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {line.fee ? <div className="px-4 pb-3 text-xs text-muted-foreground"><p>Appointment fee · service not given. Appointment status, price and payment are unchanged.</p>{line.fee.reason ? <p>{line.fee.reason}</p> : null}<Button size="sm" variant="ghost" onClick={() => run(() => actions.removeLine({ lineId: line._id }))}>Remove fee</Button></div> : null}
      {/* Only rooms and extras have a quantity; each service or appointment is its own scheduled row. */}
      {MERGES_QTY[line.kind] && !line.fee ? <QtyStepper line={line} run={run} /> : null}
      {issue ? (
        <div className="flex items-start gap-2 px-4 pb-2.5 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{issue.message}</span>
          {issue.kind === "online" ? null : (
            <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => void updateSource()}>
              {issue.kind === "changed" ? <><RefreshCw aria-hidden className="size-3.5" /> Update</> : <><Trash2 aria-hidden className="size-3.5" /> Remove</>}
            </Button>
          )}
        </div>
      ) : null}
      {ask ? (
        <ApprovalRequestForm
          className="mx-3 mb-3"
          what={ask.what}
          onCancel={() => setAsk(null)}
          onSend={async (reason) => {
            const failed = await send(line.billId, ask.payload, reason);
            if (!failed) setAsk(null);
            return failed;
          }}
        />
      ) : null}
      {request ? <ApprovalInline key={request._id} request={request} lineName={line.name} className="mx-3 mb-3" /> : null}
      {open && !line.fee ? <LineEditor line={line} catalog={catalog} run={run} waiting={waiting} onSent={onSent} /> : null}
    </li>
  );
}

/** How a stepper names its quantity: a room's nights, or a plain count for an extra. */
const STEPPER_WORDS = {
  room: { group: "Nights", fewer: "One night fewer", more: "One more night", unit: (qty: number) => (qty === 1 ? "night" : "nights") },
  extra: { group: "Quantity", fewer: "One less", more: "One more", unit: () => "" },
} as const;

/** A room's nights or an extra's quantity, stepped on the server so quick taps add up. Removing the row is in its editor. */
function QtyStepper({ line, run }: { line: OrderLine; run: Run }) {
  const actions = useCheckoutBackend().useActions();
  const words = STEPPER_WORDS[line.kind === "room" ? "room" : "extra"];
  const unit = words.unit(line.qty);
  const step = (qtyChange: 1 | -1) => run(() => actions.updateLine({ lineId: line._id, qtyChange }));
  return (
    <div role="group" aria-label={`${words.group} for ${line.name}`} className="-mt-1.5 flex items-center justify-end gap-1 px-3 pb-2.5 sm:px-4">
      <Button size="icon" variant="outline" className="size-8 rounded-full" aria-label={words.fewer} disabled={line.qty <= 1} onClick={() => step(-1)}>
        <Minus aria-hidden className="size-3.5" />
      </Button>
      <output aria-live="polite" className="min-w-14 text-center text-sm font-semibold font-sans tabular-nums">
        {line.qty}
        {unit ? <span className="font-normal text-muted-foreground"> {unit}</span> : null}
      </output>
      <Button size="icon" variant="outline" className="size-8 rounded-full" aria-label={words.more} disabled={line.qty >= MAX_QTY} onClick={() => step(1)}>
        <Plus aria-hidden className="size-3.5" />
      </Button>
    </div>
  );
}

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center gap-1 text-xs font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/**
 * A service row's optional time. A complete time is saved as it is entered; emptying the field (or
 * Clear) saves no time once the field is left, so a half-typed time never clears a saved one.
 */
function ServiceTimeInput({ value, onCommit }: { value: string; onCommit: (time: string) => Promise<boolean> }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  const persisted = useRef(value);
  const attempt = useRef(0);
  useEffect(() => { persisted.current = value; }, [value]);
  async function commit(time: string) {
    const current = ++attempt.current;
    if (!await onCommit(time) && current === attempt.current) setText(persisted.current);
  }
  // Follow a change saved elsewhere (another device, or this one) without remounting while typing.
  if (saved !== value) {
    setSaved(value);
    setText(value);
  }
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Input
        type="time"
        aria-label="Service time"
        className="h-9 w-32"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (isTimeValue(e.target.value) && e.target.value !== value) void commit(e.target.value);
        }}
        onBlur={(e) => { if (!e.target.value && value && !e.target.validity.badInput) void commit(""); }}
      />
      {value ? (
        <Button size="icon" variant="ghost" className="size-9" aria-label="Clear service time" onClick={() => { setText(""); void commit(""); }}>
          <X aria-hidden className="size-4" />
        </Button>
      ) : null}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}
    >
      {children}
    </button>
  );
}

/**
 * The nearest scrolling box around `el`, scrolled so `el` shows: whole if it fits, else its top
 * (or its bottom, where the action is) at the box's edge.
 */
function reveal(el: HTMLElement, oversized: "top" | "bottom" = "top") {
  let box = el.parentElement;
  while (box && !/(auto|scroll)/.test(getComputedStyle(box).overflowY)) box = box.parentElement;
  if (!box) return;
  const r = el.getBoundingClientRect();
  const b = box.getBoundingClientRect();
  if (r.height > b.height) box.scrollTop += oversized === "top" ? r.top - b.top : r.bottom - b.bottom;
  else if (r.top < b.top) box.scrollTop += r.top - b.top;
  else if (r.bottom > b.bottom) box.scrollTop += r.bottom - b.bottom;
}

/**
 * A service row's therapist, date and time, folded into one "Schedule" row that opens on tap: most
 * sales leave them as they are, so the discount and price stay in view. Each part saves on its own.
 */
function ScheduleRow({ line, eligible, catalogLoaded, run }: { line: OrderLine; eligible: Catalog["staff"]; catalogLoaded: boolean; run: Run }) {
  const actions = useCheckoutBackend().useActions();
  const now = useNow();
  const [open, setOpen] = useState(false);
  const id = useId();
  const lineId = line._id;
  const when = serviceScheduleValue(line);
  return (
    <div className="grid gap-3">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`${id}-schedule`}
        onClick={() => setOpen(!open)}
        className="flex min-h-12 w-full items-center justify-between gap-3 text-left text-sm hover:bg-muted/60 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <span className="text-sm">Schedule</span>
        <span className="min-w-0 flex-1 text-right text-[13px] text-muted-foreground">{scheduleSummary(line, now)}</span>
        <ChevronRight aria-hidden className={cn("size-4 shrink-0 text-muted-foreground transition motion-reduce:transition-none", open && "rotate-90")} />
      </button>
      {open ? (
        <div id={`${id}-schedule`} className="grid gap-4">
          <Field label="Therapist">
            <div className="flex flex-wrap gap-1.5">
              <Chip on={!line.staffId} onClick={() => run(() => actions.updateLine({ lineId, staffId: null }))}>Any</Chip>
              {eligible.map((person) => (
                <Chip key={person._id} on={line.staffId === person._id} onClick={() => run(() => actions.updateLine({ lineId, staffId: person._id }))}>
                  {person.name}
                </Chip>
              ))}
            </div>
            {catalogLoaded && !eligible.length ? <p className="text-xs text-muted-foreground">No one is set up for this service yet.</p> : null}
          </Field>
          {/* Each part is optional and saved on its own; a blank part stays unset, never "now". */}
          <div className="flex flex-wrap gap-3">
            <Field label="Date (optional)">
              <DatePicker
                aria-label="Service date"
                size="sm"
                className="h-9 w-40 text-sm"
                placeholder="No date"
                clearable
                value={when.date}
                onValueChange={(date) => { if (date !== when.date) void run(() => actions.updateLine({ lineId, serviceDate: date || null })); }}
              />
            </Field>
            <Field label="Time (optional)">
              <ServiceTimeInput value={when.time} onCommit={(time) => run(() => actions.updateLine({ lineId, serviceTime: time || null }))} />
            </Field>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function LineEditor({ line, catalog, run, waiting, onSent }: { line: OrderLine; catalog: Catalog | undefined; run: Run; waiting: boolean; onSent: () => void }) {
  const actions = useCheckoutBackend().useActions();
  const access = useStaffAccess();
  const cashier = access.role === "cashier";
  const send = useSendApproval();
  const [ask, setAsk] = useState<Ask | null>(null);
  const draftKey = `${line.billId}:${line._id}:price`;
  const [priceOpen, setPriceOpen] = useCheckoutDraftState(`${draftKey}:open`, false);
  const [price, setPrice] = useCheckoutDraftState(draftKey, "");
  const [note, setNote] = useCheckoutDraftState(`${draftKey}:reason`, "");
  const [approvalDirty, setApprovalDirty] = useState(false);
  const priceDirty = priceOpen && (price !== (line.priceOverride ? String(line.priceOverride.price) : "") || note !== (line.priceOverride?.note ?? ""));
  const { confirmDiscard } = useCheckoutDraft(priceDirty || approvalDirty, () => {
    setPriceOpen(false);
    setPrice("");
    setNote("");
    setAsk(null);
    setApprovalDirty(false);
  }, draftKey);
  const lineId = line._id;
  const service = catalog?.services.find((s) => s._id === line.serviceId);
  const eligible = catalog?.staff.filter((person) => service?.staffIds.includes(person._id)) ?? [];

  const priceNeedsManager = cashier && access.cashierRules.customPrice === "manager";

  /** Runs a write; a cashier refused with NEEDS_APPROVAL gets the request form instead of an error. */
  const orAsk = (write: () => Promise<unknown>, request: Ask) => run(async () => {
    try {
      return await write();
    } catch (err) {
      if (!cashier || !needsApproval(err)) throw err;
      setAsk(request);
      return null;
    }
  });

  async function applyPrice() {
    const request: Ask = { what: "custom price", payload: { kind: "customPrice", action: "overrideLinePrice", lineId, price: Number(price), note: note.trim() }, reason: note.trim() };
    if (priceNeedsManager) {
      setAsk(request);
      return;
    }
    if (await orAsk(() => actions.overrideLinePrice({ lineId, price: Number(price), note }), request)) {
      setPriceOpen(false);
      setPrice("");
      setNote("");
    }
  }

  // A changed price can be corrected (price or reason) in place, without restoring it first.
  function editPrice() {
    setPrice(line.priceOverride ? String(line.priceOverride.price) : "");
    setNote(line.priceOverride?.note ?? "");
    setPriceOpen(true);
  }
  // Opening a row brings its editor into the rows' view, so the discount is on screen.
  const editor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = editor.current?.closest("li");
    if (row) reveal(row);
  }, []);
  const unchangedPrice = line.priceOverride !== undefined && Number(price) === line.priceOverride.price && note.trim() === line.priceOverride.note;

  return (
    <div ref={editor} className="mx-3 mb-3 divide-y divide-border overflow-hidden rounded-xl bg-muted/50 px-3">
      {/* The discount first: it is what a cashier opens a row for most often. */}
      {line.kind === "booking" ? null : <DiscountField line={line} run={run} waiting={waiting} onSent={() => { if (!priceDirty && !approvalDirty) onSent(); }} />}
      {line.kind === "service" ? (
        <ScheduleRow line={line} eligible={eligible} catalogLoaded={Boolean(catalog)} run={run} />
      ) : null}

      {line.kind === "booking" ? (
        // The booking records the stay as paid in full, so its price is changed on the booking.
        <p className="text-xs text-muted-foreground">A stay is charged at its booked price. To change it, edit the booking, then update the row here.</p>
      ) : (
        <>
          <div className="grid min-h-12 items-center gap-2">
            {line.priceOverride && !priceOpen ? (
              <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-2 text-xs dark:bg-amber-400/10">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {formatMoney(line.priceOverride.price)} instead of {formatMoney(line.unitPrice)} · “{line.priceOverride.note}”
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" className="h-7" onClick={editPrice}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => void orAsk(() => actions.overrideLinePrice({ lineId, price: null, note: "" }), { what: "price restore", payload: { kind: "customPrice", action: "overrideLinePrice", lineId, price: null, note: "" } })}>
                    Restore
                  </Button>
                </span>
              </div>
            ) : priceOpen ? (
              <div className="grid gap-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor={`price-${lineId}`} className="sr-only">New unit price</Label>
                  <Input id={`price-${lineId}`} inputMode="decimal" className="h-9 w-28" value={price} onChange={(e) => setPrice(amountInput(e.target.value, MAX_PRICE))} placeholder={String(line.unitPrice)} autoFocus />
                  <span className="text-xs text-muted-foreground">was {formatMoney(line.unitPrice)}</span>
                </div>
                <Textarea aria-label="Reason for the price change" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why? (required, kept in the audit log)" className="min-h-16 text-sm" />
                <div className="flex gap-2">
                  <Button size="sm" disabled={!isAmount(price) || !note.trim() || unchangedPrice || (priceNeedsManager && waiting)} onClick={applyPrice}>{priceNeedsManager ? "Ask manager" : "Apply price"}</Button>
                  <Button size="sm" variant="ghost" onClick={() => { void confirmDiscard().then((discard) => { if (discard) { setPriceOpen(false); setPrice(""); setNote(""); } }); }}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="ghost" aria-label={`Price ${formatMoney(line.priceOverride?.price ?? line.unitPrice)}`} className="h-12 w-full justify-between px-0 text-sm font-normal" onClick={editPrice}>
                <span>Price</span><span className="ml-auto font-sans tabular-nums">{formatMoney(line.priceOverride?.price ?? line.unitPrice)}</span><ChevronRight aria-hidden className="size-4 text-muted-foreground" />
              </Button>
            )}
          </div>
        </>
      )}

      {ask ? (
        <ApprovalRequestForm
          what={ask.what}
          initialReason={ask.reason}
          onDraftChange={setApprovalDirty}
          onCancel={() => { void confirmDiscard().then((discard) => { if (discard) setAsk(null); }); }}
          onSend={async (reason) => {
            const failed = await send(line.billId, ask.payload, reason);
            if (!failed) {
              setAsk(null);
              setPriceOpen(false);
              setPrice("");
              setNote("");
            }
            return failed;
          }}
        />
      ) : null}

      <Button size="sm" variant="ghost" className="h-12 w-full justify-center rounded-none text-sm text-destructive" onClick={() => { void confirmDiscard().then((discard) => { if (discard) void run(() => actions.removeLine({ lineId })); }); }}>
        <Trash2 aria-hidden className="size-3.5" /> Remove item
      </Button>
    </div>
  );
}

/**
 * One field for a line discount: "15%" or "150", echoed as "15% = ฿180" before anything is sent.
 * Within the cashier's limit it applies; over it, a reason (quick chips or typed) and "Send 15%
 * (฿180) to manager" appear right under it, and nothing on the order changes until a manager
 * approves. The server's NEEDS_APPROVAL opens the same request.
 */
function DiscountField({ line, run, waiting, onSent }: { line: OrderLine; run: Run; waiting: boolean; onSent: () => void }) {
  const actions = useCheckoutBackend().useActions();
  const access = useStaffAccess();
  const cashier = access.role === "cashier";
  const send = useSendApproval();
  const id = useId();
  const draftKey = `${line.billId}:${line._id}:discount`;
  const { setDiscountNotice } = useCheckoutDiscountNotice();
  const [text, setText] = useCheckoutDraftState(draftKey, discountText(line.discount));
  const [syncedText, setSyncedText] = useCheckoutDraftState(`${draftKey}:synced`, discountText(line.discount));
  const [observedText, setObservedText] = useCheckoutDraftState(`${draftKey}:observed`, discountText(line.discount));
  // The server asked for a manager although the limit here allowed it (its rules are newer).
  const [serverAsk, setServerAsk] = useCheckoutDraftState(`${draftKey}:serverAsk`, false);
  const [reason, setReason] = useCheckoutDraftState(`${draftKey}:reason`, "");
  const [sending, setSending] = useState(false);
  const [saving, setSaving] = useCheckoutDraftState(`${draftKey}:saving`, false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const applying = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const lineId = line._id;

  const parsed = parseDiscount(text, line);
  const typed = parsed?.ok ? parsed.discount : null;
  // The discount already on the line (e.g. a manager approved it) is not a new request.
  const applied = typed !== null && line.discount?.type === typed.type && line.discount.value === typed.value;
  const currentText = discountText(line.discount);
  // A subscription update is not typing. Follow it while untouched, but retain a cashier's
  // draft (and its original baseline) if another till changes the line in the meantime.
  useLayoutEffect(() => {
    if (observedText !== currentText) {
      setObservedText(currentText);
      if (text === syncedText || applied) {
        setSyncedText(currentText);
        setText(currentText);
      }
    }
  }, [observedText, currentText, text, syncedText, applied, setObservedText, setSyncedText, setText]);
  // A cashier's limit, worked out as the server will (owners and managers have none).
  const over = cashier && typed && !applied ? discountOverLimit(line, typed, access.cashierRules) : null;
  const asking = Boolean(parsed?.ok && !applied && (over || serverAsk));
  useCheckoutDraft(!saving && ((text !== syncedText && !applied) || Boolean(reason.trim())), () => {
    setText(currentText);
    setSyncedText(currentText);
    setReason("");
    setServerAsk(false);
    setError("");
  }, draftKey);

  // The reason and Send appear under the field; keep them (and the field, if it fits) on screen.
  useEffect(() => {
    if (asking && root.current) reveal(root.current, "bottom");
  }, [asking]);

  function change(next: string) {
    setText(next);
    setServerAsk(false);
    setError("");
  }

  async function apply() {
    if (!typed || applied || asking || saving || applying.current) return;
    applying.current = true;
    // Blur runs before the next row/close action. This is now a save, not a discardable draft.
    flushSync(() => setSaving(true));
    let refused = false;
    try {
      const saved = await run(async () => {
        try {
          return await actions.updateLine({ lineId, discount: typed });
        } catch (err) {
          if (!cashier || !needsApproval(err)) throw err;
          refused = true;
          setServerAsk(true);
          if (!document.getElementById(`checkout-discount-${lineId}`)) setDiscountNotice(previous => ({
            orderId: line.billId,
            lineId,
            discount: discountText(line.discount),
            message: `${previous && previous.lineId !== lineId ? "Latest: " : ""}${discountText(typed)}${typed.type === "amount" ? " baht" : ""} off ${line.name} needs a manager — not applied.`,
          }));
          return null;
        }
      });
      if (saved && !refused) {
        const savedText = discountText(typed);
        setText(savedText);
        setSyncedText(savedText);
        setReason("");
      }
    } finally {
      applying.current = false;
      setSaving(false);
    }
  }

  async function sendRequest() {
    if (!typed || !reason.trim() || lock.current) return;
    lock.current = true;
    setSending(true);
    setError("");
    const failed = await send(line.billId, { kind: "discount", lineId, discount: typed }, reason.trim());
    lock.current = false;
    setSending(false);
    if (failed) setError(failed);
    else {
      setDiscountNotice(current => current?.lineId === lineId ? null : current);
      setText(discountText(line.discount));
      setReason("");
      setServerAsk(false);
      onSent();
    }
  }

  const status = parsed ? (parsed.ok ? parsed.echo : parsed.error) : "";
  return (
    <div ref={root} id={`checkout-discount-${lineId}`} className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2">
      <div className="grid gap-0.5 py-2 text-xs font-medium text-muted-foreground">
        <Label htmlFor={`${id}-discount`} className="text-sm font-normal text-foreground">Discount</Label>
        {/* A cashier's limit in plain sight, so learning it costs no tap. */}
        {cashier ? (
          <span id={`${id}-limit`} data-testid="discount-limit" className="text-[13px] font-normal">
            Up to {formatPercent(access.cashierRules.discountLimitPercent)}% without approval
          </span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          id={`${id}-discount`}
          aria-label="Discount"
          className="h-11 w-32 bg-background text-right font-sans tabular-nums"
          value={text}
          autoComplete="off"
          enterKeyHint="done"
          placeholder="0%"
          aria-describedby={cashier ? `${id}-limit ${id}-echo` : `${id}-echo`}
          aria-invalid={parsed && !parsed.ok ? true : undefined}
          readOnly={sending || saving}
          aria-busy={sending || saving}
          onChange={(e) => change(e.target.value)}
          onBlur={() => void apply()}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void apply(); } }}
        />
        {/* Shown once there is a new discount to apply; over the limit, Send takes its place. */}
        {parsed?.ok && !applied && !asking ? (
          <Button size="sm" variant="outline" onClick={() => void apply()}>
            Apply {parsed.what}
          </Button>
        ) : null}
        {line.discount ? (
          <Button size="sm" variant="ghost" disabled={sending} onClick={async () => { if (await run(() => actions.updateLine({ lineId, discount: null }))) change(""); }}>
            Remove
          </Button>
        ) : null}
      </div>
      <p id={`${id}-echo`} data-testid="discount-echo" className={cn("col-span-2 text-xs font-sans tabular-nums empty:hidden", parsed && !parsed.ok ? "text-destructive" : "text-muted-foreground")}>
        {status}
        {over ? (
          <span data-testid="discount-limit-hint" className="text-amber-800 dark:text-amber-300">
            {/* A price change on the line counts too, so then name the whole reduction. */}
            {parsed?.ok && Math.abs(over.amount - parsed.amount) >= 0.005
              ? ` · ${formatMoney(over.amount)} off in total is over your ${formatPercent(over.limitPercent)}% limit`
              : ` · Over your ${formatPercent(over.limitPercent)}% limit`}
          </span>
        ) : null}
      </p>
      {asking && parsed?.ok ? (
        <div role="group" aria-label="Ask a manager" className="col-span-2 grid gap-2">
          <ReasonField className="[&_button[aria-pressed=true]]:border-foreground [&_button[aria-pressed=true]]:bg-foreground [&_button[aria-pressed=true]]:text-background" compact value={reason} onChange={setReason} chips={REASON_CHIPS.discount} disabled={sending} />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {/* One request at a time per order: a second waits until the first is decided. */}
          <Button className="h-auto min-h-10 w-full whitespace-normal" disabled={!reason.trim() || sending || waiting} onClick={() => void sendRequest()}>
            {sending ? <Spinner label="Sending" className="text-current" /> : null}
            Send {parsed.what} to manager
          </Button>
        </div>
      ) : null}
    </div>
  );
}
