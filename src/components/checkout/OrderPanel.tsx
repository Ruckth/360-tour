"use client";

import { format } from "date-fns";
import { ChevronDown, Minus, Plus, ReceiptText, RefreshCw, Save, Trash2, TriangleAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { MAX_PRICE, MAX_QTY, MERGES_QTY, round2, type BillTotals, type TenderMethod } from "convex/lib/billMath";
import { useCheckoutBackend, type Catalog, type OrderId, type OrderLine, type OrderView } from "./backend";
import { TENDER_LABELS, amountInput } from "./checkout-ui";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { CheckoutPhoto } from "./CheckoutPhoto";
import { PayPanel } from "./PayPanel";
import type { Run } from "./useOrderWrites";

const EMPTY_TOTALS: BillTotals = { subtotal: 0, discount: 0, total: 0, vat: 0, deposit: 0, due: 0 };

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
  onSaved,
  onPaid,
  onClose,
}: {
  view: OrderView | null | undefined;
  title: string;
  catalog: Catalog | undefined;
  run: Run;
  /** After Save & close, with the saved order's title. */
  onSaved: (title: string) => void;
  onPaid: (orderId: OrderId) => void;
  onClose?: () => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const [confirmClear, setConfirmClear] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState<TenderMethod | "split" | "none" | null>(null);
  const lines = view?.lines ?? [];
  const totals = view?.totals ?? EMPTY_TOTALS;
  const orderId = view?.order._id;
  const itemCount = lines.reduce((n, line) => n + line.qty, 0);
  // Rows whose booking or appointment changed must be updated (or removed) before payment.
  const stale = lines.filter((line) => line.sourceIssue).length;
  const cannotPay = !lines.length || stale > 0;

  async function saveAndClose() {
    if (!orderId) return;
    // Leaves the order only if it is still the one on screen when saving finishes.
    await run(() => actions.saveOrder({ orderId }), () => onSaved(title));
  }

  async function clear() {
    setConfirmClear(false);
    if (orderId) await run(() => actions.clearOrder({ orderId }));
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3 sm:px-5 lg:py-4 [@media(max-height:32rem)]:py-2">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-muted/60 text-gold-text">
            <ReceiptText className="size-[18px]" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="font-serif text-2xl leading-tight font-semibold lining-nums [overflow-wrap:anywhere]" data-testid="order-panel-title">{title}</h2>
            <p className="truncate text-sm text-muted-foreground">
              {itemCount} {itemCount === 1 ? "item" : "items"}
              {view?.customer ? ` · ${view.customer.name}` : ""}
            </p>
          </div>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2">
        {paying ? null : (
          <>
            <Button variant="outline" className="rounded-xl" onClick={saveAndClose} disabled={!itemCount} title="Keep this unpaid order and start a new one. Reopen it from Orders.">
              <Save aria-hidden className="size-3.5" /> Save &amp; close
            </Button>
            {/* A local dialog rather than useConfirm: on phones it nests in the order sheet, which a
                dialog from outside would dismiss, and it gets the touch sizes. */}
            <Dialog open={confirmClear} onOpenChange={setConfirmClear}>
              <DialogTrigger asChild>
                <Button size="icon" variant="outline" className="size-9 rounded-xl" disabled={!orderId || !itemCount} aria-label="Clear order">
                  <Trash2 aria-hidden className="size-4" />
                </Button>
              </DialogTrigger>
              <CheckoutDialogContent role="alertdialog" showCloseButton={false} className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Clear this order?</DialogTitle>
                  <DialogDescription>Removes every item. The order keeps its number, customer and booking; price changes stay in the audit log.</DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <Button variant="outline" onClick={() => setConfirmClear(false)}>Cancel</Button>
                  <Button variant="destructive" onClick={clear}>Clear order</Button>
                </DialogFooter>
              </CheckoutDialogContent>
            </Dialog>
          </>
        )}
        {onClose ? (
          <Button size="icon" variant="ghost" className="size-9" onClick={onClose} aria-label="Close order">
            <X aria-hidden className="size-4" />
          </Button>
        ) : null}
        </div>
      </div>

      {paying && view ? (
        <PayPanel key={`${view.order._id}:${paying}`} mode={paying} view={view} onBack={() => setPaying(null)} onPaid={onPaid} />
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {lines.length === 0 ? (
              <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
                <p>Tap an item to add it to the order.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border/70 px-1">
                {lines.map((line) => (
                  <OrderLineRow
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

          <div className="shrink-0 border-t border-border/70 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 lg:pb-5">
            <dl className="space-y-1 text-sm">
              <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
              {totals.discount ? <TotalRow label="Discounts" value={formatMoney(-totals.discount)} /> : null}
              <TotalRow label="VAT 7% (included)" value={formatMoney(totals.vat)} muted />
              {totals.deposit ? <TotalRow label="Paid online (deposit)" value={formatMoney(-totals.deposit)} /> : null}
            </dl>
            <div className="mt-2 mb-3 flex items-baseline justify-between gap-3 border-t border-border/70 pt-2 [@media(max-height:32rem)]:mb-2 [@media(max-height:32rem)]:pt-1">
              <span className="font-serif text-2xl font-semibold">Due</span>
              <span className="font-serif text-4xl leading-none font-semibold lining-nums tabular-nums [@media(max-height:32rem)]:text-3xl" data-testid="order-due">{formatMoney(totals.due)}</span>
            </div>
            {stale ? (
              <p role="status" className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                {stale === 1 ? "A booking row changed" : `${stale} booking rows changed`}. Update {stale === 1 ? "it" : "them"} before taking payment.
              </p>
            ) : null}
            {lines.length && totals.due === 0 ? (
              <Button className="h-12 w-full rounded-xl" disabled={cannotPay} onClick={() => setPaying("none")}>Close order (nothing due)</Button>
            ) : (
              // On short screens (phone landscape) Split joins the tender row, leaving room for the items.
              <div className="grid grid-cols-4 gap-2 [@media(max-height:32rem)]:grid-cols-5">
                {(["cash", "promptpay", "card", "transfer"] as const).map((method) => (
                  <Button
                    key={method}
                    className={cn("h-12 rounded-xl px-1 text-xs sm:text-sm [@media(max-height:32rem)]:h-11", method !== "cash" && "border-border bg-muted/50 hover:bg-muted")}
                    variant={method === "cash" ? "default" : "outline"}
                    disabled={cannotPay}
                    onClick={() => setPaying(method)}
                  >
                    {TENDER_LABELS[method].short}
                  </Button>
                ))}
                {/* Outlined in gold, so Cash stays the one filled action. */}
                <Button
                  variant="outline"
                  className="col-span-4 h-11 rounded-xl border-gold/60 text-gold-text hover:bg-gold/10 hover:text-gold-text [@media(max-height:32rem)]:col-span-1 [@media(max-height:32rem)]:px-1 [@media(max-height:32rem)]:text-xs"
                  disabled={cannotPay}
                  onClick={() => setPaying("split")}
                >
                  Split payment
                </Button>
              </div>
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

function lineSubtitle(line: OrderLine) {
  const parts = [line.detail];
  if (line.kind === "service" || line.kind === "appointment") {
    parts.push(line.staffName ?? "Any therapist");
    if (line.kind === "service") parts.push(line.startAt ? format(line.startAt, "HH:mm") : "Now");
  }
  if (MERGES_QTY[line.kind] && line.qty > 1) parts.push(`${formatMoney(line.priceOverride?.price ?? line.unitPrice)} each`);
  return parts.filter(Boolean).join(" · ");
}

function OrderLineRow({ line, catalog, open, onToggle, run }: { line: OrderLine; catalog: Catalog | undefined; open: boolean; onToggle: () => void; run: Run }) {
  const actions = useCheckoutBackend().useActions();
  const listPrice = round2(line.unitPrice * line.qty);
  const issue = line.sourceIssue;
  return (
    <li className={cn("rounded-lg", open && "bg-muted/40", issue && "bg-amber-50/60 dark:bg-amber-400/5")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-4">
        <CheckoutPhoto src={line.imageUrl} kind={line.kind} className="size-11 sm:size-12" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold [overflow-wrap:anywhere]">
            {line.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{lineSubtitle(line)}</span>
          {line.deposit ? <span className="block text-xs text-emerald-700 dark:text-emerald-300">{formatMoney(line.deposit)} paid online</span> : null}
          {line.priceOverride ? <span className="block truncate text-xs text-amber-700 dark:text-amber-300">Price changed: {line.priceOverride.note}</span> : null}
        </span>
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">{formatMoney(line.net)}</span>
          {line.net !== listPrice ? <span className="block text-xs text-muted-foreground tabular-nums line-through">{formatMoney(listPrice)}</span> : null}
        </span>
        <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition motion-reduce:transition-none", open && "rotate-180")} />
      </button>
      {/* Only rooms and extras have a quantity; each service or appointment is its own scheduled row. */}
      {MERGES_QTY[line.kind] ? <QtyStepper line={line} run={run} /> : null}
      {issue ? (
        <div className="flex items-start gap-2 px-4 pb-2.5 text-xs text-amber-800 dark:text-amber-300">
          <TriangleAlert aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{issue.message}</span>
          {issue.kind === "online" ? null : (
            <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => run(() => actions.updateSourceLine({ lineId: line._id }))}>
              {issue.kind === "changed" ? <><RefreshCw aria-hidden className="size-3.5" /> Update</> : <><Trash2 aria-hidden className="size-3.5" /> Remove</>}
            </Button>
          )}
        </div>
      ) : null}
      {open ? <LineEditor line={line} catalog={catalog} run={run} /> : null}
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
      <output aria-live="polite" className="min-w-14 text-center text-sm font-semibold tabular-nums">
        {line.qty}
        {unit ? <span className="font-normal text-muted-foreground"> {unit}</span> : null}
      </output>
      <Button size="icon" variant="outline" className="size-8 rounded-full" aria-label={words.more} disabled={line.qty >= MAX_QTY} onClick={() => step(1)}>
        <Plus aria-hidden className="size-3.5" />
      </Button>
    </div>
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

function LineEditor({ line, catalog, run }: { line: OrderLine; catalog: Catalog | undefined; run: Run }) {
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
    <div className="grid gap-4 border-t border-dashed border-border px-4 pt-3 pb-3">
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

      {line.kind === "booking" ? (
        // The booking records the stay as paid in full, so its price is changed on the booking.
        <p className="text-xs text-muted-foreground">A stay is charged at its booked price. To change it, edit the booking, then update the row here.</p>
      ) : (
        <>
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
                  <Input id={`price-${lineId}`} inputMode="decimal" className="h-9 w-28" value={price} onChange={(e) => setPrice(amountInput(e.target.value, MAX_PRICE))} placeholder={String(line.unitPrice)} autoFocus />
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
        </>
      )}

      <Button size="sm" variant="ghost" className="justify-self-start text-destructive" onClick={() => run(() => actions.removeLine({ lineId }))}>
        <Trash2 aria-hidden className="size-3.5" /> Remove item
      </Button>
    </div>
  );
}
