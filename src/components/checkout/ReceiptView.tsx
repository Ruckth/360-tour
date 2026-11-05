"use client";

import { format } from "date-fns";
import { Ban, ChevronLeft, Copy, Plus, Printer, Share2 } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorText } from "@/lib/staff-bookings";
import { changeDue, formatReceiptNumber, lineGross, linePrice } from "convex/lib/billMath";
import { cn } from "@/lib/utils";
import { useCheckoutBackend, type OrderId } from "./backend";
import { PaymentRecord } from "./PaymentRecord";
import { OrderHistory } from "./OrderHistory";
import { TENDER_LABELS, TOUCH_TARGETS, receiptBookings, receiptName, receiptText } from "./checkout-ui";

type Paper = "58" | "80";

const PX_PER_MM = 96 / 25.4;
/** Extra paper after the receipt, so rounding never spills it onto a second page. */
const PAGE_SLACK_MM = 2;

/** The printed receipt's box, at the paper's width. Shared by print and by the on-screen measurement. */
const printBox = (paper: Paper) => `width: ${paper}mm !important; max-width: none !important; margin: 0 !important; padding: 3mm !important;
  border: 0 !important; font-size: ${paper === "58" ? 10 : 11.5}px !important;`;

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
    }
    .pos-receipt[data-print-measure] { ${printBox(paper)} }
  `;
}

/** Receipt after payment: thermal print (58/80mm), share or copy, and void with a reason. */
export function ReceiptView({ orderId, onNewSale, onOpenOrder }: { orderId: OrderId; onNewSale: () => void; onOpenOrder: (orderId: OrderId) => void }) {
  const backend = useCheckoutBackend();
  const view = backend.useOrder(orderId);
  const business = backend.useBusinessName() ?? "";
  const [paper, setPaper] = useState<Paper>("80");
  const [notice, setNotice] = useState("");
  const receiptRef = useRef<HTMLElement>(null);
  // Starts as an A4 length until the receipt has been measured.
  const [pageLengthMm, setPageLengthMm] = useState(297);

  // The receipt's printed length: its height with the print box applied, read before the browser paints.
  const measure = useCallback(() => {
    const receipt = receiptRef.current;
    if (!receipt) return;
    receipt.setAttribute("data-print-measure", "");
    const height = receipt.getBoundingClientRect().height;
    receipt.removeAttribute("data-print-measure");
    setPageLengthMm(Math.ceil(height / PX_PER_MM) + PAGE_SLACK_MM);
  }, []);
  useLayoutEffect(measure, [measure, paper, view, business]);
  // Measure again as printing starts (fonts may have loaded since), committed before print layout.
  useEffect(() => {
    const beforePrint = () => flushSync(measure);
    window.addEventListener("beforeprint", beforePrint);
    return () => window.removeEventListener("beforeprint", beforePrint);
  }, [measure]);

  if (view === undefined) return <div className="grid flex-1 place-items-center p-10"><Spinner label="Loading receipt" className="size-6" /></div>;
  if (view === null) return <p className="p-10 text-center text-sm text-muted-foreground">Receipt not found.</p>;
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

  async function share() {
    const text = receiptText(view!, business);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Receipt ${formatReceiptNumber(order.receiptNumber ?? 0)}`, text });
        return;
      }
      await navigator.clipboard.writeText(text);
      setNotice("Receipt copied.");
    } catch (err) {
      if ((err as Error).name !== "AbortError") setNotice("Couldn't share. Try copy instead.");
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(receiptText(view!, business));
      setNotice("Receipt copied.");
    } catch {
      setNotice("Couldn't copy on this device.");
    }
  }

  const receiptNumber = formatReceiptNumber(order.receiptNumber ?? 0);
  const paidWith = [...new Set(payments.map((payment) => TENDER_LABELS[payment.method].short))].join(" + ");

  return (
    <div
      className={cn(
        "grid min-w-0 flex-1 content-start gap-x-8 gap-y-5 px-4 py-5 sm:px-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:px-8 lg:py-6 xl:mx-auto xl:w-full xl:max-w-5xl",
        TOUCH_TARGETS,
      )}
    >
      <style>{printCss(paper, pageLengthMm)}</style>

      {/* Where you are, what this receipt is, and the next step, before anything else. */}
      <header className="flex flex-wrap items-end justify-between gap-3 lg:col-span-2 print:hidden">
        <div className="min-w-0">
          <button
            type="button"
            onClick={onNewSale}
            className="-ml-1 inline-flex min-h-7 items-center gap-1 rounded px-1 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ChevronLeft aria-hidden className="size-4" /> Checkout
          </button>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">Receipt {receiptNumber}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {order.title} · {formatMoney(totals.total)} · {isVoid ? "Void" : `Paid${paidWith ? ` by ${paidWith.toLowerCase()}` : ""}`}
          </p>
        </div>
        <Button onClick={onNewSale}><Plus aria-hidden className="size-4" /> New sale</Button>
      </header>

      <div className="grid min-w-0 content-start justify-items-center gap-3 lg:sticky lg:top-6">
        <div className="flex w-full flex-wrap items-center gap-2 print:hidden">
          {/* A setting, so its selected state stays quieter than New sale. */}
          <ToggleGroup value={paper} onValueChange={setPaper} aria-label="Paper width">
            <ToggleGroupItem value="58" className={QUIET_SELECTED}>58 mm</ToggleGroupItem>
            <ToggleGroupItem value="80" className={QUIET_SELECTED}>80 mm</ToggleGroupItem>
          </ToggleGroup>
          <Button variant="outline" onClick={() => window.print()} aria-describedby="receipt-print-help"><Printer aria-hidden className="size-4" /> Print</Button>
          <Button variant="outline" onClick={share}><Share2 aria-hidden className="size-4" /> Share</Button>
          <Button variant="ghost" onClick={copy} aria-label="Copy receipt text"><Copy aria-hidden className="size-4" /> Copy</Button>
        </div>
        {/* The browser sets the page size; the printer's driver decides what reaches the paper. */}
        <details className="w-full text-xs text-muted-foreground print:hidden">
          <summary className="w-fit cursor-pointer rounded font-medium hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:py-3">
            Print setup for {paper} mm paper
          </summary>
          <p id="receipt-print-help" className="mt-1">
            Prints on a {paper} mm wide page, as long as the receipt. In the print dialog, choose the receipt printer, margins None and scale 100%.
            If it still prints on another paper size, select the {paper} mm roll in the printer&apos;s own settings.
          </p>
        </details>
        {notice ? <p role="status" className="w-full text-sm text-muted-foreground print:hidden">{notice}</p> : null}

        <article ref={receiptRef} className="pos-receipt relative w-full min-w-0 max-w-sm rounded-xl border border-border bg-card p-5 font-mono text-[13px] leading-snug [overflow-wrap:anywhere] shadow-sm" aria-label="Receipt">
          {isVoid ? (
            <p className="mb-3 rounded border-2 border-destructive px-2 py-1 text-center font-bold tracking-widest text-destructive uppercase">
              Void · {order.voidReason}
            </p>
          ) : null}
          <header className="text-center">
            <p className="text-base font-bold">{business}</p>
            <p>Receipt {formatReceiptNumber(order.receiptNumber ?? 0)}</p>
            <p className="text-xs">{order.title}</p>
            <p className="text-xs">Issued {order.paidAt ? format(order.paidAt, "d MMM yyyy, HH:mm") : ""}</p>
            {customerName ? <p className="text-xs">Customer: {customerName}</p> : null}
            {bookings ? <p className="text-xs [overflow-wrap:anywhere]">{bookings}</p> : null}
          </header>
          <hr className="my-3 border-dashed border-border" />
          <ul className="space-y-2">
            {lines.map((line) => (
              <li key={line._id}>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0">{line.name}{line.qty > 1 ? ` ×${line.qty}` : ""}</span>
                  <span className="shrink-0 tabular-nums">{formatMoney(lineGross(line))}</span>
                </div>
                {line.staffName || line.qty > 1 ? (
                  <p className="text-xs opacity-70">{[line.staffName, line.qty > 1 ? `${formatMoney(linePrice(line))} each` : ""].filter(Boolean).join(" · ")}</p>
                ) : null}
                {line.net !== lineGross(line) ? (
                  <div className="flex justify-between text-xs opacity-70">
                    <span>Discount</span>
                    <span className="tabular-nums">{formatMoney(line.net - lineGross(line))}</span>
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
          <hr className="my-3 border-dashed border-border" />
          <dl className="space-y-1">
            <div className="flex justify-between font-bold"><dt>Total</dt><dd className="tabular-nums">{formatMoney(totals.total)}</dd></div>
            <div className="flex justify-between text-xs"><dt>VAT 7% included</dt><dd className="tabular-nums">{formatMoney(totals.vat)}</dd></div>
            {totals.deposit ? <div className="flex justify-between"><dt>Paid before checkout</dt><dd className="tabular-nums">{formatMoney(-totals.deposit)}</dd></div> : null}
            {payments.map((payment) => (
              <div key={payment._id} className="flex justify-between">
                <dt>{TENDER_LABELS[payment.method].long}</dt>
                <dd className="tabular-nums">{formatMoney(payment.received ?? payment.amount)}</dd>
              </div>
            ))}
            {change ? <div className="flex justify-between"><dt>Change</dt><dd className="tabular-nums">{formatMoney(change)}</dd></div> : null}
          </dl>
          <p className="mt-4 text-center text-xs">Thank you</p>
        </article>
      </div>

      <div className="grid min-w-0 content-start gap-5 print:hidden">
        <PaymentRecord view={view} />
        <OrderHistory orderId={orderId} />
        {isVoid ? (
          <p className="text-xs text-muted-foreground">Voided by {order.voidedBy}{order.voidedAt ? ` on ${format(order.voidedAt, "d MMM, HH:mm")}` : ""}. The order and receipt numbers stay on record.</p>
        ) : (
          <div className="border-t border-border pt-4">
            <VoidDialog orderId={orderId} receipt={`${receiptNumber} · ${formatMoney(totals.total)}`} hasAttached={lines.some((l) => l.bookingId || l.appointmentId)} />
          </div>
        )}
      </div>
    </div>
  );
}

const QUIET_SELECTED =
  "data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border data-[state=on]:focus-visible:ring-2 data-[state=on]:focus-visible:ring-ring";

/** The Void… button and its dialog; the button is the trigger, so Cancel puts focus back on it. */
function VoidDialog({ orderId, receipt, hasAttached }: { orderId: OrderId; receipt: string; hasAttached: boolean }) {
  const actions = useCheckoutBackend().useActions();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);

  async function submit() {
    if (lock.current) return;
    lock.current = true;
    setSaving(true);
    setError("");
    try {
      await actions.voidOrder({ orderId, reason });
      setOpen(false);
    } catch (err) {
      setError(errorText(err, "Couldn't void the receipt."));
    } finally {
      lock.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="text-destructive"><Ban aria-hidden className="size-4" /> Void…</Button>
      </DialogTrigger>
      <DialogContent className={cn("max-w-md", TOUCH_TARGETS)}>
        <DialogHeader>
          <DialogTitle>Void receipt {receipt}?</DialogTitle>
          <DialogDescription asChild>
            <ul className="grid list-disc gap-1 pl-5">
              <li>The order and receipt stay on record, marked void, with their numbers.</li>
              <li>No refund is sent or recorded here.</li>
              {hasAttached ? <li>Its bookings and appointments stay marked paid. Record a refund on them if needed.</li> : null}
              <li>No money received at all? Use “No money was received” on the receipt instead.</li>
            </ul>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea disabled={saving} id="void-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Charged the wrong guest" autoFocus />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim() || saving} onClick={submit}>
            {saving ? <Spinner className="text-current" /> : null}
            Void receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
