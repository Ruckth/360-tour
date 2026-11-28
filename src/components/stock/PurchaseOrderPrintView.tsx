"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { staffDateTime } from "@/lib/staff-time";
import { formatSatang } from "./stock-format";
import type { StockItemSnapshot, StockSupplierSnapshot } from "./stock-types";

export type PrintableOrderRevision = {
  reference: string;
  revision: number;
  branchName: string;
  supplier: StockSupplierSnapshot;
  expectedDate?: string;
  supplierReference?: string;
  note?: string;
  reason?: string;
  issuedAt?: number;
  actorLabel?: string;
  /** Buying business and receiving contact from branch settings (absent → branch name only). */
  buyer?: {
    legalName: string; taxId?: string; address?: string; branchCode?: string;
    receivingContact: string; receivingPhone?: string; contactName: string;
  };
  lines: readonly {
    variantId: string;
    item: StockItemSnapshot;
    ordered: number;
    cancelled: number;
    unitCost?: number;
    /** Price to be confirmed by the supplier. */
    priceTbc?: boolean;
  }[];
};

/**
 * Printable issued Purchase Order sheet. Renders current issued PO or any prior
 * issued revision snapshot from History with clean print layout.
 */
export function PurchaseOrderPrintDialog({
  open,
  onOpenChange,
  order,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PrintableOrderRevision | null;
}) {
  if (!order) return null;

  const activeLines = order.lines.map((line) => {
    const netQty = Math.max(0, line.ordered - line.cancelled);
    const lineTotal = line.unitCost !== undefined ? line.unitCost * netQty : undefined;
    return { ...line, netQty, lineTotal };
  });
  const totalUnits = activeLines.reduce((sum, line) => sum + line.netQty, 0);
  const totalSatang = activeLines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);
  const hasCosts = activeLines.some((line) => line.unitCost !== undefined);
  const hasTbc = activeLines.some((line) => line.unitCost === undefined && line.priceTbc);
  const buyer = order.buyer;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl print:static print:max-w-none print:translate-x-0 print:translate-y-0 print:border-0 print:shadow-none">
        <DialogHeader className="print:hidden">
          <DialogTitle>
            Purchase order {order.reference} · Rev {order.revision}
          </DialogTitle>
          <DialogDescription>
            Supplier-facing issued copy. Print or save as PDF to share with {order.supplier.name}.
          </DialogDescription>
        </DialogHeader>

        <article className="grid gap-5 rounded-lg border border-border bg-background p-5 text-sm print:border-0 print:p-0">
          <header className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
            <div className="grid gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Purchase Order
              </p>
              <h2 className="font-mono text-xl font-semibold text-foreground">
                {order.reference}
              </h2>
              <p className="text-xs text-muted-foreground">
                Revision {order.revision}
                {order.issuedAt ? ` · Issued ${staffDateTime(order.issuedAt)}` : ""}
              </p>
            </div>
            <div className="grid gap-0.5 text-right text-xs">
              {buyer ? (
                <section aria-label="Buyer and delivery" className="grid gap-0.5">
                  <p className="font-semibold text-foreground">{buyer.legalName}</p>
                  {buyer.taxId ? <p className="text-muted-foreground">Tax ID {buyer.taxId}{buyer.branchCode ? ` · Branch ${buyer.branchCode}` : ""}</p> : null}
                  <p className="font-medium text-foreground">Deliver to: {order.branchName}</p>
                  {buyer.address ? <p className="whitespace-pre-wrap text-muted-foreground">{buyer.address}</p> : null}
                  <p className="text-muted-foreground">
                    Receiving: {buyer.receivingContact}{buyer.receivingPhone ? ` · ${buyer.receivingPhone}` : ""}
                  </p>
                  <p className="text-muted-foreground">Contact: {buyer.contactName}</p>
                </section>
              ) : (
                <p className="font-medium text-foreground">Deliver to: {order.branchName}</p>
              )}
              {order.expectedDate ? <p className="text-muted-foreground">Expected: {order.expectedDate}</p> : null}
              {order.supplierReference ? (
                <p className="text-muted-foreground">Supplier ref: {order.supplierReference}</p>
              ) : null}
            </div>
          </header>

          <section aria-label="Supplier details" className="grid gap-1 text-xs">
            <p className="font-semibold text-foreground">{order.supplier.name}</p>
            {order.supplier.address && <p className="whitespace-pre-wrap">{order.supplier.address}</p>}
            {order.supplier.taxId && <p>Tax ID · {order.supplier.taxId}</p>}
            {order.supplier.paymentTerms && <p>Payment terms · {order.supplier.paymentTerms}</p>}
            {order.supplier.deliveryDays && <p>Delivery days · {order.supplier.deliveryDays}</p>}
            {order.supplier.minimumOrder && <p>Minimum order · {order.supplier.minimumOrder}</p>}
            <p className="text-muted-foreground">
              {[order.supplier.contactName, order.supplier.phone, order.supplier.email]
                .filter(Boolean)
                .join(" · ") || "No contact details recorded"}
            </p>
          </section>

          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th scope="col" className="py-2 pr-3 font-medium">Item</th>
                  <th scope="col" className="py-2 pr-3 font-medium">SKU</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Qty</th>
                  <th scope="col" className="py-2 pr-3 text-right font-medium">Unit cost</th>
                  <th scope="col" className="py-2 text-right font-medium">Line total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {activeLines.map((line) => (
                  <tr key={line.variantId}>
                    <td className="py-2 pr-3">
                      <span className="font-medium text-foreground">{line.item.productName}</span>
                      <span className="block text-muted-foreground">{line.item.variantLabel}</span>
                    </td>
                    <td className="py-2 pr-3 font-mono text-muted-foreground">{line.item.sku ?? "—"}</td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                      {line.netQty.toLocaleString("en-US")}
                      {line.cancelled > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          ({line.ordered} − {line.cancelled} cancelled)
                        </span>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums text-foreground">
                      {line.unitCost === undefined && line.priceTbc ? "TBC" : formatSatang(line.unitCost)}
                    </td>
                    <td className="py-2 text-right tabular-nums font-medium text-foreground">
                      {line.unitCost === undefined && line.priceTbc ? "TBC" : formatSatang(line.lineTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border font-semibold text-foreground">
                  <td colSpan={2} className="py-2.5 pr-3">Total</td>
                  <td className="py-2.5 pr-3 text-right tabular-nums">{totalUnits.toLocaleString("en-US")}</td>
                  <td className="py-2.5 pr-3" />
                  <td className="py-2.5 text-right tabular-nums">
                    {hasCosts ? `${formatSatang(totalSatang)}${hasTbc ? " + TBC" : ""}` : hasTbc ? "TBC" : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {order.note ? (
            <section aria-label="Order note" className="rounded-md bg-muted/40 p-3 text-xs">
              <p className="font-medium text-foreground">Note</p>
              <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{order.note}</p>
            </section>
          ) : null}

          {order.reason ? (
            <p className="text-xs text-muted-foreground">Revision reason: {order.reason}</p>
          ) : null}
        </article>

        <DialogFooter className="print:hidden">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={() => window.print()}>
            <Printer aria-hidden className="size-4" />
            Print / Save PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
