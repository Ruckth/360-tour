"use client";

import { format } from "date-fns";
import { Ban, Copy, Plus, Printer, Share2 } from "lucide-react";
import { useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorText } from "@/lib/staff-bookings";
import { changeDue, formatReceiptNumber, lineGross, linePrice } from "convex/lib/billMath";
import { cn } from "@/lib/utils";
import { useCheckoutBackend, type BillId, type BillView } from "./backend";
import { TENDER_LABELS } from "./PayPanel";
import { TOUCH_TARGETS } from "./checkout-ui";

type Paper = "58" | "80";

/** Plain-text receipt for share and copy. */
function receiptText(view: BillView, business: string) {
  const { bill, lines, payments, totals } = view;
  const row = (left: string, right: string) => `${left}  ${right}`;
  return [
    business,
    `Receipt ${formatReceiptNumber(bill.receiptNumber ?? 0)}${bill.status === "void" ? " (VOID)" : ""}`,
    bill.paidAt ? format(bill.paidAt, "d MMM yyyy, HH:mm") : "",
    bill.label,
    "",
    ...lines.map((line) => row(`${line.name}${line.qty > 1 ? ` ×${line.qty}` : ""}`, formatMoney(line.net))),
    "",
    row("Total", formatMoney(totals.total)),
    row("VAT 7% included", formatMoney(totals.vat)),
    ...(totals.deposit ? [row("Paid before", formatMoney(-totals.deposit))] : []),
    ...payments.map((p) => row(TENDER_LABELS[p.method].long, formatMoney(p.amount))),
  ].join("\n");
}

/** Receipt after payment: thermal print (58/80mm), share or copy, and void with a reason. */
export function ReceiptView({ billId, onNewSale, onOpenBill }: { billId: BillId; onNewSale: () => void; onOpenBill: (billId: BillId) => void }) {
  const backend = useCheckoutBackend();
  const view = backend.useBill(billId);
  const business = backend.useBusinessName() ?? "";
  const [paper, setPaper] = useState<Paper>("80");
  const [notice, setNotice] = useState("");
  const [voiding, setVoiding] = useState(false);

  if (view === undefined) return <div className="grid flex-1 place-items-center p-10"><Spinner label="Loading receipt" className="size-6" /></div>;
  if (view === null) return <p className="p-10 text-center text-sm text-muted-foreground">Receipt not found.</p>;
  if (view.bill.status === "draft" || view.bill.status === "held") {
    return (
      <div className="grid flex-1 place-items-center gap-3 p-10 text-center">
        <p className="text-sm text-muted-foreground">This bill isn&apos;t paid yet.</p>
        <Button onClick={() => onOpenBill(billId)}>Open the bill</Button>
      </div>
    );
  }

  const { bill, lines, payments, totals } = view;
  const isVoid = bill.status === "void";
  const change = changeDue(payments);

  async function share() {
    const text = receiptText(view!, business);
    try {
      if (navigator.share) {
        await navigator.share({ title: `Receipt ${formatReceiptNumber(bill.receiptNumber ?? 0)}`, text });
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

  return (
    <div className={cn("flex flex-1 flex-col items-center gap-4 px-4 py-6", TOUCH_TARGETS)}>
      <style>{`
        @media print {
          @page { size: ${paper}mm auto; margin: 0; }
          body * { visibility: hidden !important; }
          .pos-receipt, .pos-receipt * { visibility: visible !important; }
          .pos-receipt { position: absolute; inset: 0 auto auto 0; width: ${paper}mm !important; max-width: none !important;
            margin: 0 !important; padding: 3mm !important; border: 0 !important; box-shadow: none !important; border-radius: 0 !important;
            background: #fff !important; color: #000 !important; font-size: ${paper === "58" ? 10 : 11.5}px !important; }
          .pos-receipt * { color: #000 !important; }
        }
      `}</style>

      <div className="flex w-full max-w-md flex-wrap items-center gap-2 print:hidden">
        <ToggleGroup value={paper} onValueChange={setPaper} aria-label="Paper width">
          <ToggleGroupItem value="58">58 mm</ToggleGroupItem>
          <ToggleGroupItem value="80">80 mm</ToggleGroupItem>
        </ToggleGroup>
        <Button variant="outline" onClick={() => window.print()}><Printer aria-hidden className="size-4" /> Print</Button>
        <Button variant="outline" onClick={share}><Share2 aria-hidden className="size-4" /> Share</Button>
        <Button variant="ghost" size="icon" onClick={copy} aria-label="Copy receipt"><Copy aria-hidden className="size-4" /></Button>
      </div>
      {notice ? <p role="status" className="text-sm text-muted-foreground print:hidden">{notice}</p> : null}

      <article className="pos-receipt relative w-full max-w-sm rounded-xl border border-border bg-card p-5 font-mono text-[13px] leading-snug shadow-sm" aria-label="Receipt">
        {isVoid ? (
          <p className="mb-3 rounded border-2 border-destructive px-2 py-1 text-center font-bold tracking-widest text-destructive uppercase">
            Void · {bill.voidReason}
          </p>
        ) : null}
        <header className="text-center">
          <p className="text-base font-bold">{business}</p>
          <p>Receipt {formatReceiptNumber(bill.receiptNumber ?? 0)}</p>
          <p className="text-xs">{bill.paidAt ? format(bill.paidAt, "d MMM yyyy, HH:mm") : ""}</p>
          <p className="text-xs">{bill.label}</p>
        </header>
        <hr className="my-3 border-dashed border-border" />
        <ul className="space-y-2">
          {lines.map((line) => (
            <li key={line._id}>
              <div className="flex justify-between gap-2">
                <span>{line.name}{line.qty > 1 ? ` ×${line.qty}` : ""}</span>
                <span className="tabular-nums">{formatMoney(lineGross(line))}</span>
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

      <div className="flex w-full max-w-sm flex-wrap gap-2 print:hidden">
        <Button className="flex-1" onClick={onNewSale}><Plus aria-hidden className="size-4" /> New sale</Button>
        {!isVoid ? (
          <Button variant="outline" className="text-destructive" onClick={() => setVoiding(true)}><Ban aria-hidden className="size-4" /> Void…</Button>
        ) : null}
      </div>
      {isVoid ? <p className="max-w-sm text-center text-xs text-muted-foreground print:hidden">Voided by {bill.voidedBy}{bill.voidedAt ? ` on ${format(bill.voidedAt, "d MMM, HH:mm")}` : ""}. The receipt number stays on record.</p> : null}

      <VoidDialog open={voiding} onOpenChange={setVoiding} billId={billId} hasAttached={lines.some((l) => l.bookingId || l.appointmentId)} />
    </div>
  );
}

function VoidDialog({ open, onOpenChange, billId, hasAttached }: { open: boolean; onOpenChange: (open: boolean) => void; billId: BillId; hasAttached: boolean }) {
  const actions = useCheckoutBackend().useActions();
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    setSaving(true);
    setError("");
    try {
      await actions.voidBill({ billId, reason });
      onOpenChange(false);
    } catch (err) {
      setError(errorText(err, "Couldn't void the bill."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-md", TOUCH_TARGETS)}>
        <DialogHeader>
          <DialogTitle>Void this receipt?</DialogTitle>
          <DialogDescription>
            The receipt stays on record, marked void, with its number. Give back any money at the desk.
            {hasAttached ? " Attached bookings and appointments stay marked paid; record a refund on them if needed." : ""}
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="void-reason">Reason</Label>
          <Textarea id="void-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Charged the wrong guest" autoFocus />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button variant="destructive" disabled={!reason.trim() || saving} onClick={submit}>
            {saving ? <Spinner className="text-current" /> : null}
            Void receipt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
