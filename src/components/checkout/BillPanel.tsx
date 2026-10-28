"use client";

import { format } from "date-fns";
import { ChevronDown, Minus, Pause, Plus, ReceiptText, Trash2, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { MERGES_QTY, type BillTotals, type TenderMethod } from "convex/lib/billMath";
import { useCheckoutBackend, type BillId, type BillLine, type BillView, type Catalog } from "./backend";
import { TENDER_LABELS, TOUCH_TARGETS, amountInput } from "./checkout-ui";
import { PayPanel } from "./PayPanel";

/** Runs a bill write in order; the task gets the current bill id (undefined before the first item). */
export type Run = (task: (billId: BillId | undefined) => Promise<unknown>) => Promise<boolean>;

const EMPTY_TOTALS: BillTotals = { subtotal: 0, discount: 0, total: 0, vat: 0, deposit: 0, due: 0 };

/**
 * The bill: rows (tap to edit inline), totals with the VAT included, and the tender buttons
 * in the footer. Paying swaps the rows for the payment panel. Used beside the catalog on
 * wide screens and inside the bottom sheet on phones (which passes `onClose`).
 */
export function BillPanel({
  view,
  label,
  catalog,
  run,
  onBillChange,
  onPaid,
  onClose,
}: {
  view: BillView | null | undefined;
  label: string;
  catalog: Catalog | undefined;
  run: Run;
  onBillChange: (billId: BillId | null) => void;
  onPaid: (billId: BillId) => void;
  onClose?: () => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const [confirmClear, setConfirmClear] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState<TenderMethod | "split" | "none" | null>(null);
  const lines = view?.lines ?? [];
  const totals = view?.totals ?? EMPTY_TOTALS;
  const billId = view?.bill._id;
  const itemCount = lines.reduce((n, line) => n + line.qty, 0);

  async function hold() {
    if (!billId) return;
    if (await run(() => actions.holdBill({ billId }))) onBillChange(null);
  }

  async function clear() {
    setConfirmClear(false);
    if (billId) await run(() => actions.clearBill({ billId }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3">
        <ReceiptText aria-hidden className="size-5 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold">Bill</h2>
          <p className="truncate text-xs text-muted-foreground">
            {label} · {itemCount} {itemCount === 1 ? "item" : "items"}
            {view?.bill.status === "held" ? " · held" : ""}
          </p>
        </div>
        {paying ? null : (
          <>
            <Button size="sm" variant="outline" onClick={hold} disabled={!itemCount}>
              <Pause aria-hidden className="size-3.5" /> Hold
            </Button>
            {/* A local dialog rather than useConfirm: on phones it nests in the bill sheet, which a
                dialog from outside would dismiss, and it gets the touch sizes. */}
            <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
              <DialogTrigger asChild>
                <Button size="icon" variant="ghost" className="size-9" disabled={!billId || (!itemCount && !view?.bill.guestName)} aria-label="Clear bill">
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </DialogTrigger>
              <DialogContent role="alertdialog" showCloseButton={false} className={cn("max-w-md", TOUCH_TARGETS)}>
                <DialogHeader>
                  <DialogTitle>Clear this bill?</DialogTitle>
                  <DialogDescription>Removes every item and the guest from the bill. Price changes stay in the audit log.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={clear}>Clear bill</Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </>
        )}
        {onClose ? (
          <Button size="icon" variant="ghost" className="size-9" onClick={onClose} aria-label="Close bill">
            <X aria-hidden className="size-4" />
          </Button>
        ) : null}
      </div>

      {paying && view ? (
        <PayPanel key={`${paying}:${totals.due}`} mode={paying} view={view} onBack={() => setPaying(null)} onPaid={onPaid} />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {lines.length === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
                <p>Tap an item to add it to the bill.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {lines.map((line) => (
                  <BillLineRow
                    key={line._id}
                    line={line}
                    catalog={catalog}
                    open={expanded === line._id}
                    onToggle={() => setExpanded(expanded === line._id ? null : line._id)}
                    run={run}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-border px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <dl className="space-y-1 text-sm">
              <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
              {totals.discount ? <TotalRow label="Discounts" value={formatMoney(-totals.discount)} /> : null}
              <TotalRow label="VAT 7% (included)" value={formatMoney(totals.vat)} muted />
              {totals.deposit ? <TotalRow label="Paid online (deposit)" value={formatMoney(-totals.deposit)} /> : null}
            </dl>
            <div className="mt-2 mb-3 flex items-baseline justify-between">
              <span className="text-sm font-semibold">Due</span>
              <span className="text-2xl font-bold tabular-nums">{formatMoney(totals.due)}</span>
            </div>
            {lines.length && totals.due === 0 ? (
              <Button className="h-12 w-full" onClick={() => setPaying("none")}>Close bill (nothing due)</Button>
            ) : (
              <>
                <div className="grid grid-cols-4 gap-2">
                  {(["cash", "promptpay", "card", "transfer"] as const).map((method) => (
                    <Button key={method} className="h-12 px-1 text-xs sm:text-sm" variant={method === "cash" ? "default" : "secondary"} disabled={!lines.length} onClick={() => setPaying(method)}>
                      {TENDER_LABELS[method].short}
                    </Button>
                  ))}
                </div>
                <Button variant="outline" className="mt-2 w-full" disabled={!lines.length} onClick={() => setPaying("split")}>
                  Split payment
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between", muted ? "text-xs text-muted-foreground" : "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function lineSubtitle(line: BillLine) {
  const parts = [line.detail];
  if (line.kind === "service" || line.kind === "appointment") {
    parts.push(line.staffName ?? "Any therapist");
    if (line.kind === "service") parts.push(line.startAt ? format(line.startAt, "HH:mm") : "Now");
  }
  if (MERGES_QTY[line.kind] && line.qty > 1) parts.push(`${formatMoney(line.priceOverride?.price ?? line.unitPrice)} each`);
  return parts.filter(Boolean).join(" · ");
}

function BillLineRow({ line, catalog, open, onToggle, run }: { line: BillLine; catalog: Catalog | undefined; open: boolean; onToggle: () => void; run: Run }) {
  const listPrice = line.unitPrice * line.qty;
  return (
    <li className={cn("rounded-xl border bg-background", open ? "border-primary" : "border-border")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-start gap-2 p-3 text-left">
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">
            {line.name}
            {MERGES_QTY[line.kind] && line.qty > 1 ? <span className="text-muted-foreground"> ×{line.qty}</span> : null}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{lineSubtitle(line)}</span>
          {line.deposit ? <span className="block text-xs text-emerald-700 dark:text-emerald-300">{formatMoney(line.deposit)} paid online</span> : null}
          {line.priceOverride ? <span className="block truncate text-xs text-amber-700 dark:text-amber-300">Price changed: {line.priceOverride.note}</span> : null}
        </span>
        <span className="text-right">
          <span className="block text-sm font-semibold tabular-nums">{formatMoney(line.net)}</span>
          {line.net !== listPrice ? <span className="block text-xs text-muted-foreground tabular-nums line-through">{formatMoney(listPrice)}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition", open && "rotate-180")} />
      </button>
      {open ? <LineEditor line={line} catalog={catalog} run={run} /> : null}
    </li>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      {children}
    </div>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", on ? "border-primary bg-primary text-primary-foreground" : "border-border hover:bg-muted")}
    >
      {children}
    </button>
  );
}

function LineEditor({ line, catalog, run }: { line: BillLine; catalog: Catalog | undefined; run: Run }) {
  const actions = useCheckoutBackend().useActions();
  const [discountType, setDiscountType] = useState<"amount" | "percent">(line.discount?.type ?? "amount");
  const [discountValue, setDiscountValue] = useState(line.discount ? String(line.discount.value) : "");
  const [priceOpen, setPriceOpen] = useState(false);
  const [price, setPrice] = useState("");
  const [note, setNote] = useState("");
  const lineId = line._id;
  const service = catalog?.services.find((s) => s._id === line.serviceId);
  const eligible = catalog?.staff.filter((person) => service?.staffIds.includes(person._id)) ?? [];

  function setStart(value: string) {
    if (!/^\d{2}:\d{2}$/.test(value)) return;
    const [hours, minutes] = value.split(":").map(Number);
    const start = new Date();
    start.setHours(hours, minutes, 0, 0);
    void run(() => actions.updateLine({ lineId, startAt: start.getTime() }));
  }

  async function applyPrice() {
    if (await run(() => actions.overrideLinePrice({ lineId, price: Number(price), note }))) {
      setPriceOpen(false);
      setPrice("");
      setNote("");
    }
  }

  return (
    <div className="grid gap-4 border-t border-dashed border-border px-3 pt-3 pb-3">
      {line.kind === "service" ? (
        <>
          <Field label="Therapist">
            <div className="flex flex-wrap gap-1.5">
              <Chip on={!line.staffId} onClick={() => run(() => actions.updateLine({ lineId, staffId: null }))}>Any</Chip>
              {eligible.map((person) => (
                <Chip key={person._id} on={line.staffId === person._id} onClick={() => run(() => actions.updateLine({ lineId, staffId: person._id }))}>
                  {person.name}
                </Chip>
              ))}
            </div>
            {catalog && !eligible.length ? <p className="text-xs text-muted-foreground">No one is set up for this service yet.</p> : null}
          </Field>
          <Field label="Time">
            <div className="flex items-center gap-2">
              <Chip on={!line.startAt} onClick={() => run(() => actions.updateLine({ lineId, startAt: null }))}>Now</Chip>
              <Input type="time" aria-label="Start time" className="h-9 w-32" value={line.startAt ? format(line.startAt, "HH:mm") : ""} onChange={(e) => setStart(e.target.value)} />
            </div>
          </Field>
        </>
      ) : null}

      {MERGES_QTY[line.kind] ? (
        <Field label={line.kind === "room" ? "Nights" : "Quantity"}>
          <div className="flex items-center gap-3">
            <Button size="icon" variant="outline" className="size-9" aria-label="One less" disabled={line.qty <= 1} onClick={() => run(() => actions.updateLine({ lineId, qty: line.qty - 1 }))}>
              <Minus aria-hidden className="size-4" />
            </Button>
            <span className="w-6 text-center text-sm font-semibold tabular-nums">{line.qty}</span>
            <Button size="icon" variant="outline" className="size-9" aria-label="One more" onClick={() => run(() => actions.updateLine({ lineId, qty: line.qty + 1 }))}>
              <Plus aria-hidden className="size-4" />
            </Button>
          </div>
        </Field>
      ) : null}

      <Field label="Discount">
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup value={discountType} onValueChange={setDiscountType} aria-label="Discount type" className="p-0.5">
            <ToggleGroupItem value="amount" className="px-2.5 py-1.5">฿</ToggleGroupItem>
            <ToggleGroupItem value="percent" className="px-2.5 py-1.5">%</ToggleGroupItem>
          </ToggleGroup>
          <Input inputMode="decimal" aria-label="Discount" className="h-9 w-24" value={discountValue} onChange={(e) => setDiscountValue(amountInput(e.target.value))} placeholder="0" />
          <Button size="sm" variant="outline" disabled={discountValue === ""} onClick={() => run(() => actions.updateLine({ lineId, discount: { type: discountType, value: Number(discountValue) } }))}>
            Apply
          </Button>
          {line.discount ? (
            <Button size="sm" variant="ghost" onClick={async () => { if (await run(() => actions.updateLine({ lineId, discount: null }))) setDiscountValue(""); }}>
              Remove
            </Button>
          ) : null}
        </div>
      </Field>

      <Field label="Price">
        {line.priceOverride ? (
          <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-2 text-xs dark:bg-amber-400/10">
            <span>
              {formatMoney(line.priceOverride.price)} instead of {formatMoney(line.unitPrice)} · “{line.priceOverride.note}”
            </span>
            <Button size="sm" variant="ghost" className="h-7" onClick={() => run(() => actions.overrideLinePrice({ lineId, price: null, note: "" }))}>
              Restore
            </Button>
          </div>
        ) : priceOpen ? (
          <div className="grid gap-2">
            <div className="flex items-center gap-2">
              <Label htmlFor={`price-${lineId}`} className="sr-only">New unit price</Label>
              <Input id={`price-${lineId}`} inputMode="decimal" className="h-9 w-28" value={price} onChange={(e) => setPrice(amountInput(e.target.value))} placeholder={String(line.unitPrice)} autoFocus />
              <span className="text-xs text-muted-foreground">was {formatMoney(line.unitPrice)}</span>
            </div>
            <Textarea aria-label="Reason for the price change" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} placeholder="Why? (required, kept in the audit log)" className="min-h-16 text-sm" />
            <div className="flex gap-2">
              <Button size="sm" disabled={price === "" || !note.trim()} onClick={applyPrice}>Apply price</Button>
              <Button size="sm" variant="ghost" onClick={() => setPriceOpen(false)}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setPriceOpen(true)}>
            Change price
          </Button>
        )}
      </Field>

      <Button size="sm" variant="ghost" className="justify-self-start text-destructive" onClick={() => run(() => actions.removeLine({ lineId }))}>
        <Trash2 aria-hidden className="size-3.5" /> Remove item
      </Button>
    </div>
  );
}
