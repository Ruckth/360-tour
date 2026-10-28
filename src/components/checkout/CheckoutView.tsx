"use client";

import { ChevronUp, ReceiptText, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { errorText } from "@/lib/staff-bookings";
import { useCheckoutBackend, type BillId, type CatalogItem } from "./backend";
import { BillPanel, type Run } from "./BillPanel";
import { CatalogPane } from "./CatalogPane";
import { CustomerStrip } from "./CustomerStrip";

/**
 * Staff checkout: customer strip on top, catalog on the left, the bill on the right (wide
 * screens) or in a bottom sheet behind a floating total (phones). Data comes from the
 * CheckoutBackend in context, so the admin page and the dev preview render the same UI.
 */
export function CheckoutView({
  billId,
  onBillChange,
  onPaid,
  notice,
}: {
  billId: BillId | null;
  onBillChange: (billId: BillId | null) => void;
  onPaid: (billId: BillId) => void;
  /** Shown above the catalog, e.g. a refused `?booking=` link. */
  notice?: string;
}) {
  const backend = useCheckoutBackend();
  const catalog = backend.useCatalog();
  const view = backend.useBill(billId);
  const nextWalkIn = backend.useNextWalkIn();
  const actions = backend.useActions();
  const [error, setError] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);

  // Writes run one after another, so a second tap before the bill exists joins the same bill.
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const currentBill = useRef(billId);
  useEffect(() => {
    currentBill.current = billId;
  }, [billId]);

  const run = useCallback<Run>(
    (task) => {
      const next = queue.current.then(async () => {
        try {
          setError("");
          const result = await task(currentBill.current ?? undefined);
          const created = result && typeof result === "object" && "billId" in result ? (result.billId as BillId) : undefined;
          if (created && created !== currentBill.current) {
            currentBill.current = created;
            onBillChange(created);
          }
          return true;
        } catch (err) {
          setError(errorText(err, "That didn't save. Try again."));
          return false;
        }
      });
      queue.current = next;
      return next;
    },
    [onBillChange],
  );

  const add = useCallback((item: CatalogItem) => void run((id) => actions.addItem({ billId: id, item })), [run, actions]);

  const changeBill = useCallback(
    (next: BillId | null) => {
      currentBill.current = next;
      setSheetOpen(false);
      onBillChange(next);
    },
    [onBillChange],
  );

  // Paying and then seeing the bill turn paid both lead to the receipt; go there once.
  const shownReceipt = useRef<BillId | null>(null);
  const toReceipt = useCallback(
    (id: BillId) => {
      if (shownReceipt.current === id) return;
      shownReceipt.current = id;
      onPaid(id);
    },
    [onPaid],
  );

  const missing = billId !== null && view === null;
  const label = view?.bill.label ?? (nextWalkIn ? `Walk-in #${nextWalkIn}` : "Walk-in");
  const lines = view?.lines ?? [];
  const count = lines.reduce((n, line) => n + line.qty, 0);
  const paidAlready = view && view.bill.status !== "draft" && view.bill.status !== "held";

  // A paid or void bill opened by link goes straight to its receipt.
  useEffect(() => {
    if (paidAlready && view) toReceipt(view.bill._id);
  }, [paidAlready, view, toReceipt]);

  const panel = (
    <BillPanel view={missing ? null : view} label={label} catalog={catalog} run={run} onBillChange={changeBill} onPaid={toReceipt} />
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CustomerStrip view={view} label={label} run={run} onBillChange={changeBill} />
      {notice || error || missing ? (
        <div role="alert" className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-4 py-2 text-sm text-destructive sm:px-6">
          <span className="flex-1">{error || notice || "That bill doesn't exist. Start a new one."}</span>
          {error ? (
            <button type="button" onClick={() => setError("")} aria-label="Dismiss" className="rounded p-0.5 hover:bg-destructive/10">
              <X aria-hidden className="size-4" />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1">
        <CatalogPane catalog={catalog} lines={lines} onAdd={add} className="min-w-0 flex-1" />
        <aside aria-label="Bill" className="hidden w-[360px] shrink-0 border-l border-border bg-card lg:flex lg:flex-col">
          {panel}
        </aside>
      </div>

      <button
        type="button"
        onClick={() => setSheetOpen(true)}
        className="fixed inset-x-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] z-30 flex items-center gap-3 rounded-full bg-primary px-5 py-3.5 text-primary-foreground shadow-xl lg:hidden"
      >
        <ReceiptText aria-hidden className="size-5" />
        <span className="flex-1 text-left text-sm font-semibold">
          {count} {count === 1 ? "item" : "items"} · {formatMoney(view?.totals.due ?? 0)}
        </span>
        <ChevronUp aria-hidden className="size-5" />
      </button>
      <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
        <SheetContent side="bottom" showCloseButton={false} className="h-[94dvh] gap-0 rounded-t-2xl p-0 lg:hidden">
          <button type="button" onClick={() => setSheetOpen(false)} aria-label="Close bill" className="mx-auto mt-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <SheetTitle className="sr-only">Bill</SheetTitle>
          <SheetDescription className="sr-only">Items, totals and payment</SheetDescription>
          {panel}
        </SheetContent>
      </Sheet>
    </div>
  );
}
