"use client";

import { Check, Plus, Printer, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent } from "react";
import { flushSync } from "react-dom";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Disclosure } from "@/components/ui/disclosure";
import { InfoTip } from "@/components/ui/info-tip";
import { MoreMenu } from "@/components/ui/more-menu";
import { Spinner } from "@/components/ui/spinner";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { useStoredState } from "@/lib/use-stored-state";
import { changeDue, formatReceiptNumber, lineCouponDiscount, lineGross, linePrice, lineStaffDiscount, roundMoney } from "convex/shared/orderMath";
import { cn } from "@/lib/utils";
import { OrderApprovalStatus } from "./ApprovalRequest";
import { useCheckoutBackend, type CommerceCopy, type OrderId } from "./backend";
import { RefundForm } from "./RefundForm";
import { hasLineRefunds, refundElsewhere, refundedSatang, satangMoney } from "./refunds";
import { TONES } from "@/components/admin/status-tones";
import type { Id } from "convex/_generated/dataModel";
import { CorrectPayment, LinkedRefunds, VoidPanel } from "./PaymentRecord";
import { ReceiptHistory } from "./FinancialHistory";
import { staffDateTime } from "@/lib/staff-time";
import { TENDER_LABELS, TOUCH_TARGETS, couponLabel, formatResort, receiptBookings, receiptCommerce, receiptName, receiptSchedule, receiptText } from "./checkout-ui";
import { CommerceReceiptRow, CommerceReceiptStatus, GoodwillTotals, NotTaxInvoice, RowHistory, ShareCopyBridge, VoucherTenderRows } from "./ReceiptCommerce";
import { LineLink, linkTarget, useCanLink } from "./AfterPayment";

type Paper = "58" | "80";
/** Paper width is a per-device setting: each till has one printer. */
export const RECEIPT_PAPER_KEY = "pos-receipt-paper";
type Task = "correct" | "void";

const PX_PER_MM = 96 / 25.4;
/** Extra paper after the receipt, so rounding never spills it onto a second page. */
const PAGE_SLACK_MM = 2;

/** The printed receipt's box, at the paper's width. Shared by print and by the on-screen measurement. */
const printBox = (paper: Paper) => `width: ${paper}mm !important; max-width: none !important; margin: 0 !important; padding: 3mm !important;
  border: 0 !important; font-size: ${paper === "58" ? 10 : 11.5}px !important;`;

/** Small rows (VAT, discounts, coupon shares) scale with the paper's base size, not the screen's rem. */
const smallPrint = "font-size: 0.9em !important; line-height: 1.35 !important;";

/*
 * Browsers accept a page size only as two lengths (or a named size); "58mm auto" is dropped. So the
 * page is the paper's width by the receipt's own length, measured at that width with print styles.
 * When printing, everything but the receipt is removed from layout (not just hidden), so the
 * rest of the screen can't add blank pages.
 */
function printCss(paper: Paper, lengthMm: number) {
  return `
    @media print {
      @page { size: ${paper}mm ${lengthMm}mm; margin: 0; }
      html, body { height: auto !important; min-height: 0 !important; overflow: visible !important; background: #fff !important; }
      body *:not(:has(.pos-receipt)):not(.pos-receipt):not(.pos-receipt *) { display: none !important; }
      body *:has(.pos-receipt) { display: block !important; position: static !important; width: auto !important; height: auto !important;
        min-height: 0 !important; max-height: none !important; margin: 0 !important; padding: 0 !important; border: 0 !important;
        overflow: visible !important; background: none !important; box-shadow: none !important; transform: none !important; }
      .pos-receipt { ${printBox(paper)} position: static !important; box-shadow: none !important; border-radius: 0 !important;
        background: #fff !important; color: #000 !important; }
      .pos-receipt * { color: #000 !important; }
      .pos-receipt .text-xs { ${smallPrint} }
      .pos-receipt [data-screen-only] { display: none !important; }
    }
    .pos-receipt[data-print-measure] { ${printBox(paper)} }
    .pos-receipt[data-print-measure] [data-screen-only] { display: none !important; }
    .pos-receipt[data-print-measure] .text-xs { ${smallPrint} }
  `;
}

const noSubscription = () => () => undefined;
/** Whether the system share sheet exists here; false on the server so hydration matches. */
const useCanShare = () =>
  useSyncExternalStore(noSubscription, () => typeof navigator.share === "function", () => false);

const receiptMedia = () => window.matchMedia("(width < 640px)");
const subscribeReceiptViewport = (changed: () => void) => {
  const media = receiptMedia();
  media.addEventListener("change", changed);
  return () => media.removeEventListener("change", changed);
};
const receiptViewport = () => receiptMedia().matches ? "phone" : "wide";
const serverReceiptViewport = () => "pending";

/**
 * Receipt after payment. The toolbar is Print · New sale; Share, the paper width (remembered on
 * this device), Correct payment and Void… sit in ⋯, and while one of those is open the toolbar is
 * just its Close (History steps aside too). Refund and Link sit in a separate Items card, and
 * one closed History holds every ledger. The printed receipt never changes.
 */
export function ReceiptView({ orderId, onNewSale, onOpenOrder }: { orderId: OrderId; onNewSale: () => void; onOpenOrder: (orderId: OrderId) => void }) {
  const backend = useCheckoutBackend();
  const view = backend.useOrder(orderId);
  const business = backend.useBusinessName() ?? "";
  const access = useStaffAccess();
  const cashier = access.role === "cashier";
  const canLink = useCanLink();
  const approvals = backend.useOrderApprovals(view ? view.order._id : null);
  const [storedPaper, setStoredPaper] = useStoredState(RECEIPT_PAPER_KEY, "80");
  const paper: Paper = storedPaper === "58" ? "58" : "80";
  const [notice, setNotice] = useState("");
  const canShare = useCanShare();
  const noticeRef = useRef<HTMLParagraphElement>(null);
  // The line whose refund form is open; one at a time.
  const [refunding, setRefunding] = useState<Id<"orderLines"> | null>(null);
  const [refundDirty, setRefundDirty] = useState(false);
  const [refundBusy, setRefundBusy] = useState(false);
  const [taskDirty, setTaskDirty] = useState(false);
  const { confirmDiscard } = useUnsavedGuard(refundDirty || taskDirty);
  // What a finished refund or request said, under its line.
  const [lineNotes, setLineNotes] = useState<Record<string, string>>({});
  // Correct payment or Void…, opened from ⋯; the toolbar's Close ends it.
  const [task, setTask] = useState<Task | null>(null);
  const [taskBusy, setTaskBusy] = useState(false);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const receiptRef = useRef<HTMLElement>(null);
  // Commerce copy for Share, set only while a commerce receipt is shown (ShareCopyBridge).
  const shareCopy = useRef<CommerceCopy | null>(null);
  const viewport = useSyncExternalStore(subscribeReceiptViewport, receiptViewport, serverReceiptViewport);
  const phone = viewport === "phone";
  const printPreview = useRef<{ element: HTMLDetailsElement; open: boolean } | null>(null);
  // Starts as an A4 length until the receipt has been measured.
  const [pageLengthMm, setPageLengthMm] = useState(297);

  // The receipt's printed length: its height with the print box applied, read before the browser paints.
  const measure = useCallback(() => {
    const receipt = receiptRef.current;
    if (!receipt) return;
    // A closed phone disclosure still prints every line. Measure its full paper synchronously,
    // then restore the staff member's disclosure state before the browser paints.
    const preview = receipt.closest("details");
    const wasClosed = preview instanceof HTMLDetailsElement && !preview.open;
    if (wasClosed) preview.open = true;
    receipt.setAttribute("data-print-measure", "");
    const height = receipt.getBoundingClientRect().height;
    receipt.removeAttribute("data-print-measure");
    if (wasClosed) preview.open = false;
    setPageLengthMm(Math.ceil(height / PX_PER_MM) + PAGE_SLACK_MM);
  }, []);
  useLayoutEffect(measure, [measure, paper, view, business, viewport]);
  // Native closed details hide their contents even in print on older browsers. Open the
  // disclosure before measuring/printing, then restore exactly how the cashier left it.
  const beforePrint = useCallback(() => {
    const preview = receiptRef.current?.closest("details");
    if (preview && !printPreview.current) {
      printPreview.current = { element: preview, open: preview.open };
      preview.open = true;
    }
    flushSync(measure);
  }, [measure]);
  const afterPrint = useCallback(() => {
    if (!printPreview.current) return;
    printPreview.current.element.open = printPreview.current.open;
    printPreview.current = null;
  }, []);
  useEffect(() => {
    // Also handles browser print emulation and engines that signal print media separately.
    const media = window.matchMedia("print");
    const onMedia = () => { if (media.matches) beforePrint(); else afterPrint(); };
    window.addEventListener("beforeprint", beforePrint);
    window.addEventListener("afterprint", afterPrint);
    media.addEventListener("change", onMedia);
    return () => {
      window.removeEventListener("beforeprint", beforePrint);
      window.removeEventListener("afterprint", afterPrint);
      media.removeEventListener("change", onMedia);
      afterPrint();
    };
  }, [beforePrint, afterPrint]);
  // Another order: nothing from the last one stays open.
  const [shownOrderId, setShownOrderId] = useState(orderId);
  if (shownOrderId !== orderId) {
    setShownOrderId(orderId);
    setTask(null); setTaskDirty(false); setRefunding(null); setRefundDirty(false); setRefundBusy(false); setLineNotes({}); setNotice("");
  }

  if (view === undefined) return <div className="grid flex-1 place-items-center p-10"><Spinner label="Loading receipt" className="size-6" /></div>;
  // Cashiers open today's receipts only; older ones come back as missing.
  if (view === null) return <p className="p-10 text-center text-sm text-muted-foreground">{cashier ? "Not available." : "Receipt not found."}</p>;
  if (view.order.state === "unpaid" || view.order.state === "discarded") {
    return (
      <div className="grid flex-1 place-items-center gap-3 p-10 text-center">
        <p className="text-sm text-muted-foreground">{view.order.title} {view.order.state === "discarded" ? "was discarded. Restore it from Orders before editing or payment." : "isn’t paid yet."}</p>
        <Button onClick={() => onOpenOrder(orderId)}>Open the order</Button>
      </div>
    );
  }

  const { order, lines, payments, totals } = view;
  const isVoid = order.status === "void";
  const customerName = receiptName(view);
  const bookings = receiptBookings(view);
  const change = changeDue(payments);
  const coupon = couponLabel(view);
  const staffDiscount = roundMoney(totals.discount - totals.coupon);
  // POS line refunds, in satang. Past the history limit the totals are lower bounds, so none are shown.
  const truncated = Boolean(view.refundHistoryTruncated);
  const refunded = truncated ? 0 : refundedSatang(view);
  const net = totals.total - refunded;
  const paid = order.status === "paid";
  const waiting = approvals?.some((r) => r.status === "pending") ?? false;
  // A cashier who must ask can't send a second request while one waits.
  const refundLocked = cashier && access.cashierRules.refund === "manager" && waiting;
  const refundsRecorded = hasLineRefunds(view);
  const shownTask = paid ? task : null;
  // Products, packages, vouchers, session cover or goodwill: null for every receipt from before commerce.
  const commerce = receiptCommerce(view);
  // Edit · History and payment or return status need the commerce readers; without them (every
  // sale switch Off) only the receipt's own rows show.
  const commerceReaders = backend.commerce !== undefined;

  /** Focus the notice once it renders, or the ⋯ / a fallback control. */
  function focusAfter(target: HTMLElement | null | undefined) {
    (target ?? toolbarRef.current?.querySelector<HTMLElement>('[aria-label="More receipt actions"]'))?.focus();
  }

  function say(message: string) {
    flushSync(() => setNotice(message));
    noticeRef.current?.focus();
  }

  /** Closes the form. Cancel returns focus to the line's Refund; a finished refund or request shows, focused, under its line. */
  function closeRefund(lineId: Id<"orderLines">, message?: string) {
    flushSync(() => {
      setRefunding(null);
      setRefundDirty(false);
      setRefundBusy(false);
      if (message) setLineNotes((notes) => ({ ...notes, [lineId]: message }));
    });
    const note = document.querySelector<HTMLElement>(`[data-line-note="${lineId}"]`);
    const trigger = document.querySelector<HTMLElement>(`[data-refund-trigger="${lineId}"]`);
    (message ? note ?? trigger : trigger)?.focus();
  }

  function openTask(next: Task) {
    setNotice("");
    setTask(next);
  }

  async function closeTask(message?: string) {
    // The toolbar's Close waits for a running write; a finished one closes with its result.
    if (taskBusy && !message) return;
    // Only the task's own edits prompt here; an open refund draft stays mounted and keeps its own guard.
    if (!message && taskDirty && !(await confirmDiscard())) return;
    flushSync(() => {
      setTask(null);
      setTaskBusy(false);
      setTaskDirty(false);
      if (message) setNotice(message);
    });
    focusAfter(message ? noticeRef.current : null);
  }

  function choosePaper(next: Paper) {
    setStoredPaper(next);
    say(`Prints on ${next} mm paper · remembered on this device`);
  }

  // Share opens the system sheet where there is one; anywhere else (or if it fails) it copies.
  async function share() {
    setNotice("");
    const text = receiptText(view!, business, shareCopy.current ?? undefined);
    if (canShare) {
      try {
        await navigator.share({ title: `Receipt ${formatReceiptNumber(order.receiptNumber ?? 0)}`, text });
        return;
      } catch (err) {
        // Closing the share sheet is not a failure, and nothing is copied.
        if ((err as Error).name === "AbortError") return;
      }
    }
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Receipt copied.");
    } catch {
      setNotice(canShare ? "Couldn't share or copy on this device." : "Couldn't copy on this device.");
    }
  }

  const receiptNumber = formatReceiptNumber(order.receiptNumber ?? 0);
  const paidWith = [...new Set([...payments.map((payment) => payment.method === "promptpay" ? "PromptPay" : TENDER_LABELS[payment.method].short.toLowerCase()), ...(commerce?.voucherTenders.length ? ["voucher"] : [])])].join(" + ");

  return (
    <div
      data-testid="receipt-view"
      onKeyDown={(event: KeyboardEvent) => {
        if (event.key === "Escape" && !event.defaultPrevented && shownTask && !taskBusy) {
          event.preventDefault();
          event.stopPropagation();
          void closeTask();
        }
      }}
      className={cn(
        "grid min-w-0 flex-1 content-start gap-x-8 gap-y-3 px-4 py-3 sm:gap-y-5 sm:py-5 sm:px-6 lg:grid-cols-[24rem_minmax(0,1fr)] lg:px-8 lg:py-6 xl:mx-auto xl:w-full xl:max-w-6xl",
        TOUCH_TARGETS,
      )}
    >
      <style>{printCss(paper, pageLengthMm)}</style>

      {/* What this receipt is, and the toolbar, before anything else. */}
      <header className="flex flex-wrap items-end justify-between gap-3 lg:col-span-2 print:hidden">
        <div className="min-w-0">
          <h2 className="flex flex-wrap items-center gap-2 font-serif text-2xl font-semibold tracking-tight">
            Receipt {receiptNumber}
            {paid && view.fullyRefunded ? (
              <span data-testid="receipt-status" className={cn("rounded-full px-2 py-0.5 text-xs font-medium tracking-normal", TONES.muted.bg, TONES.muted.text)}>Refunded</span>
            ) : paid ? <span data-testid="receipt-status" className="inline-flex h-6 items-center gap-1 rounded-full bg-emerald-50 px-2.5 font-sans text-[13px] font-medium tracking-normal text-emerald-800 dark:bg-emerald-400/10 dark:text-emerald-300"><Check aria-hidden className="size-3.5" />Paid</span> : null}
          </h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {order.title} · <span className="font-medium text-foreground font-sans tabular-nums">{formatMoney(totals.total)}</span> · {isVoid ? "Void" : `Paid${paidWith ? ` by ${paidWith}` : ""}`}
            {!isVoid && view.paymentRecord.tendersAmended ? " · corrected" : ""}
          </p>
          {notice ? <p ref={noticeRef} tabIndex={-1} role="status" className="mt-1 rounded text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">{notice}</p> : null}
        </div>
        <div ref={toolbarRef} role="toolbar" aria-label="Receipt actions" className="flex flex-wrap items-center gap-1.5 max-sm:w-full sm:gap-2">
          {/* While Correct payment or Void… is open, the toolbar is only its Close. */}
          {shownTask ? null : (
            <>
              <Button variant="outline" className="max-sm:size-11 max-sm:p-0 sm:px-4" aria-label="Print" onClick={() => { beforePrint(); window.print(); }} aria-describedby="receipt-print-help"><Printer aria-hidden className="size-4" /><span className="max-sm:sr-only">Print</span></Button>
              <span id="receipt-print-help" className="sr-only">Prints {paper} mm wide, as long as the receipt.</span>
              <Button className="px-3 max-sm:h-12 max-sm:flex-1 sm:px-4" disabled={refundBusy} onClick={() => { void confirmDiscard().then((discard) => { if (discard) onNewSale(); }); }}><Plus aria-hidden className="size-4" /> New sale</Button>
            </>
          )}
          {shownTask ? (
            <Button variant="ghost" disabled={taskBusy} onClick={() => closeTask()} aria-label={`Close ${shownTask === "correct" ? "Correct payment" : "Void"}`}>
              <X aria-hidden className="size-4" /> Close
            </Button>
          ) : (
            <MoreMenu
              label="More receipt actions"
              items={[
                { label: "Share", onSelect: () => void share() },
                { label: paper === "58" ? "Use 80 mm paper" : "Use 58 mm paper", onSelect: () => choosePaper(paper === "58" ? "80" : "58") },
                { label: "Correct payment", onSelect: () => openTask("correct"), hidden: !paid },
                // pos.voidOrder and voidUnreceivedOrder refuse a receipt with refunds (ORDER_HAS_REFUNDS).
                { label: refundsRecorded ? "Void… · not after a refund" : "Void…", onSelect: () => openTask("void"), destructive: true, disabled: refundsRecorded, hidden: !paid },
              ]}
            />
          )}
        </div>
      </header>

      <div className={cn("grid w-full min-w-0 content-start justify-items-center gap-3 lg:sticky lg:top-6 lg:justify-items-start lg:self-start", shownTask && "max-sm:hidden")}>
        <Disclosure label="Receipt preview" open={!phone} className={cn("receipt-preview sm:[&>summary]:hidden print:[&>summary]:hidden", viewport === "pending" && "max-sm:[&>div:not(:has([data-print-measure]))]:hidden")} contentClassName="flex justify-center pb-0 lg:justify-start">
        <article ref={receiptRef} data-sentence-budget="ignore" className="pos-receipt relative w-full min-w-0 max-w-sm rounded-xl border border-border bg-card p-4 sm:p-5 font-mono text-[13px] leading-snug [overflow-wrap:anywhere] shadow-sm" aria-label="Receipt">
          {isVoid ? (
            <p className="mb-3 rounded border-2 border-destructive px-2 py-1 text-center font-bold tracking-widest text-destructive uppercase">
              Void · {order.voidReason}
            </p>
          ) : null}
          <header className="text-center">
            <p className="text-base font-bold">{business}</p>
            <p>Receipt {formatReceiptNumber(order.receiptNumber ?? 0)}</p>
            <p className="text-xs">{order.title}</p>
            <p className="text-xs">Issued {order.paidAt ? formatResort(order.paidAt, "d MMM yyyy, HH:mm") : ""}</p>
            {customerName ? <p className="text-xs">Customer: {customerName}</p> : null}
            {bookings ? <p className="text-xs [overflow-wrap:anywhere]">{bookings}</p> : null}
          </header>
          <hr className="my-3 border-dashed border-border" />
          <ul className="space-y-2">
            {lines.map((line) => {
              const extras = commerce?.rows.get(line._id);
              if (extras) return <CommerceReceiptRow key={line._id} line={line} extras={extras} coupon={coupon} truncated={truncated} />;
              const lineRefunded = truncated ? 0 : line.refundedAmountSatang ?? 0;
              return (
              <li key={line._id}>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0">
                    {line.name}{line.qty > 1 ? ` ×${line.qty}` : ""}

                  </span>
                  <span className="shrink-0 font-sans tabular-nums">{formatMoney(lineGross(line))}</span>
                </div>
                {line.staffName || line.qty > 1 ? (
                  <p className="text-xs opacity-70">{[line.staffName, line.qty > 1 ? `${formatMoney(linePrice(line))} each` : ""].filter(Boolean).join(" · ")}</p>
                ) : null}
                {/* As paid: the row's planned date and time, frozen with it. Later links don't rewrite the receipt. */}
                {line.kind === "service" && receiptSchedule(line.schedule) ? <p className="text-xs opacity-70">{receiptSchedule(line.schedule)}</p> : null}
                {lineStaffDiscount(line) ? (
                  <div className="flex justify-between gap-2 text-xs opacity-70">
                    <span>Discount</span>
                    <span className="font-sans tabular-nums">{formatMoney(-lineStaffDiscount(line))}</span>
                  </div>
                ) : null}
                {line.couponDiscount && lineCouponDiscount(line) ? (
                  <div className="flex justify-between gap-2 text-xs opacity-70" data-testid="receipt-line-coupon">
                    <span className="min-w-0">{coupon}</span>
                    <span className="shrink-0 font-sans tabular-nums">{formatMoney(-lineCouponDiscount(line))}</span>
                  </div>
                ) : null}
                {lineRefunded ? (
                  <div className="flex justify-between gap-2 text-xs" data-testid="receipt-line-refunded">
                    <span>Refunded</span>
                    <span className="font-sans tabular-nums">{satangMoney(-lineRefunded, line.currency)}</span>
                  </div>
                ) : null}
              </li>
              );
            })}
          </ul>
          {truncated ? <p data-screen-only="" className="mt-2 font-sans text-xs text-muted-foreground print:hidden">Too many refunds to total here. See History.</p> : null}
          <hr className="my-3 border-dashed border-border" />
          <dl className="space-y-1">
            {commerce?.goodwill ? <GoodwillTotals subtotal={totals.subtotal} discount={totals.discount} coupon={totals.coupon} couponLabel={coupon} goodwill={commerce.goodwill} /> : totals.coupon ? (
              <>
                <div className="flex justify-between gap-2"><dt>Subtotal</dt><dd className="font-sans tabular-nums">{formatMoney(totals.subtotal)}</dd></div>
                {staffDiscount ? <div className="flex justify-between gap-2"><dt>Discounts</dt><dd className="font-sans tabular-nums">{formatMoney(-staffDiscount)}</dd></div> : null}
                <div className="flex justify-between gap-2" data-testid="receipt-coupon-total"><dt className="min-w-0">{coupon}</dt><dd className="shrink-0 font-sans tabular-nums">{formatMoney(-totals.coupon)}</dd></div>
              </>
            ) : null}
            <div className="flex justify-between font-bold"><dt>Total</dt><dd className="font-sans tabular-nums">{formatMoney(totals.total)}</dd></div>
            {commerce?.voucherSaleOnly ? <NotTaxInvoice /> : <div className="flex justify-between text-xs"><dt>VAT 7% included</dt><dd className="font-sans tabular-nums">{formatMoney(totals.vat)}</dd></div>}
            {totals.deposit ? <div className="flex justify-between"><dt>Paid in advance</dt><dd className="font-sans tabular-nums">{formatMoney(-totals.deposit)}</dd></div> : null}
            {payments.map((payment) => (
              <div key={payment._id} className="flex justify-between">
                <dt>{TENDER_LABELS[payment.method].long}</dt>
                <dd className="font-sans tabular-nums">{formatMoney(payment.received ?? payment.amount)}</dd>
              </div>
            ))}
            {commerce?.voucherTenders.length ? <VoucherTenderRows tenders={commerce.voucherTenders} /> : null}
            {change ? <div className="flex justify-between"><dt>Change</dt><dd className="font-sans tabular-nums">{formatMoney(change)}</dd></div> : null}
            {refunded ? (
              <>
                <div className="flex justify-between" data-testid="receipt-refunded"><dt>Refunded</dt><dd className="font-sans tabular-nums">{satangMoney(-refunded, order.currency)}</dd></div>
                <div className="flex justify-between font-bold" data-testid="receipt-net"><dt>Net</dt><dd className="font-sans tabular-nums">{formatMoney(net, order.currency)}</dd></div>
              </>
            ) : null}
          </dl>
          {totals.coupon ? (
            <p className="mt-3 border-t border-dashed border-border pt-2 text-center text-xs">You saved {formatMoney(totals.coupon)} with <span className="whitespace-nowrap">{view.promotion?.code ?? "a coupon"}</span></p>
          ) : null}
          <p className="mt-4 text-center text-xs">Thank you</p>
        </article>
        </Disclosure>
      </div>

      <div
        data-testid="receipt-side"
        className="grid min-w-0 content-start gap-4 print:hidden"
      >
        {isVoid ? (
          <div className="grid gap-1 text-sm text-muted-foreground" data-testid="receipt-void-status">
            <p>Voided by {order.voidedBy}{order.voidedAt ? ` on ${staffDateTime(order.voidedAt)}` : ""} · order and receipt numbers stay on record</p>
            {view.paymentRecord.voidUnreceived ? <p>Entered by mistake · no money was received, no refund sent</p> : null}
          </div>
        ) : null}
        <OrderApprovalStatus requests={approvals} lines={lines} decide />
        {commerce ? <ShareCopyBridge copyRef={shareCopy} /> : null}
        {commerceReaders ? <CommerceReceiptStatus orderId={order._id} /> : null}
        {shownTask === "correct" ? <CorrectPayment key={`${order._id}:correct`} view={view} onDone={closeTask} onBusyChange={setTaskBusy} onDraftChange={setTaskDirty} /> : null}
        {shownTask === "void" ? <VoidPanel key={`${order._id}:void`} view={view} waiting={waiting} onDone={closeTask} onBusyChange={setTaskBusy} onDraftChange={setTaskDirty} /> : null}
        <Card role="region" aria-label="Items" data-testid="receipt-items" className={cn("overflow-hidden", shownTask && "hidden")}>
          <h3 className="border-b border-border bg-card px-4 py-3 sm:px-5 sm:py-4 text-base font-semibold">Items</h3>
          <ul className="divide-y divide-border">
            {lines.map((line) => {
              const refundable = paid && !truncated && (line.remainingRefundableSatang ?? 0) > 0;
              const elsewhere = paid && line.net > 0 ? refundElsewhere(view, line) : null;
              const showRefund = refundable && refunding === null;
              const linkable = paid && Boolean(linkTarget(line)) && (canLink || view.links.some((l) => l.lineId === line._id && l.status === "active"));
              const note = lineNotes[line._id];
              const unscheduled = line.kind === "service" && !line.schedule?.date && !line.startAt && !view.links.some((l) => l.lineId === line._id && l.status === "active");
              return <li key={line._id} className="scroll-mt-[calc(var(--admin-header,3.5rem)+0.5rem)] px-4 py-3 sm:px-5 sm:py-4">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="text-[15px] font-medium">{line.name}{line.qty > 1 ? ` ×${line.qty}` : ""}</p>
                  <p className="shrink-0 text-[15px] font-medium font-sans tabular-nums">{formatMoney(line.net)}</p>
                </div>
                {commerce && commerceReaders && commerce.rows.has(line._id) ? <RowHistory line={line} extras={commerce.rows.get(line._id)!} receipt={commerce} /> : null}
                {unscheduled ? <span className="mt-1 inline-flex rounded-full bg-amber-50 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-400/10 dark:text-amber-300">Not scheduled</span> : null}
                {elsewhere ? <span className="ml-2"><InfoTip label={`Refunding ${line.name}`}>{elsewhere === "booking" ? "Refund this on the booking." : "Refund this on the appointment."}</InfoTip></span> : null}
                {note ? (
                  <p data-screen-only="" data-line-note={line._id} tabIndex={-1} role="status" className="mt-1 flex items-start gap-1.5 rounded font-sans text-xs font-medium text-emerald-800 outline-none focus-visible:ring-2 focus-visible:ring-ring dark:text-emerald-300 print:hidden">
                    <Check aria-hidden className="mt-px size-3.5 shrink-0" /> {note}
                  </p>
                ) : null}
                {/* An open form stays until closed, even if this line was just refunded in full. */}
                {paid && refunding === line._id ? (
                  <RefundForm view={view} line={line} waiting={waiting} onDraftChange={setRefundDirty} onBusyChange={setRefundBusy} onCancel={() => { void confirmDiscard().then((discard) => { if (discard) closeRefund(line._id); }); }} onDone={(message) => closeRefund(line._id, message)} />
                ) : showRefund || linkable ? (
                  <div data-screen-only="" className="mt-1 flex flex-wrap items-center gap-2 font-sans print:hidden">
                    {linkable ? <LineLink view={view} line={line} /> : null}
                    {showRefund ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        data-refund-trigger={line._id}
                        aria-label={`Refund ${line.name}`}
                        disabled={refundLocked}
                        onClick={() => { setNotice(""); setRefunding(line._id); }}
                        className="h-11 px-3 font-sans text-sm text-foreground"
                      >
                        Refund
                      </Button>
                    ) : null}
                  </div>
                ) : null}
              </li>;
            })}
          </ul>
        </Card>
        <LinkedRefunds view={view} />
        {/* Cashiers work the till: the paged ledgers are for managers and owners. */}
        {/* Out of sight while a task is open, but kept mounted: it reopens as it was, with the task's result. */}
        {cashier ? null : <ReceiptHistory view={view} className={shownTask ? "hidden" : undefined} />}
      </div>
    </div>
  );
}
