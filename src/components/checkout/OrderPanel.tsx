"use client";

import { ChevronDown, Minus, Plus, ReceiptText, RefreshCw, Save, TicketPercent, Trash2, TriangleAlert, X } from "lucide-react";
import { useState, type ReactNode } from "react";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Dialog, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { isTimeValue } from "@/lib/dates/values";
import {
  formatResortDate,
  formatResortFullDate,
  resortIsoDate,
  resortTime24,
  useNow,
} from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { MAX_PRICE, MAX_QTY, MERGES_QTY, lineCouponDiscount, round2, type BillTotals, type TenderMethod } from "convex/lib/billMath";
import { useCheckoutBackend, type Catalog, type OrderId, type OrderLine, type OrderView } from "./backend";
import { TENDER_LABELS, UP_TO_FOUR_COLUMNS, amountInput, couponLabel, scheduleLabel } from "./checkout-ui";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { CheckoutPhoto } from "./CheckoutPhoto";
import { FinancialHistory } from "./FinancialHistory";
import { OrderCoupon, SHORT_SCREEN_ONLY, canAddCoupon } from "./OrderCoupon";
import { OrderHistory } from "./OrderHistory";
import { PayPanel } from "./PayPanel";
import type { Run } from "./useOrderWrites";

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

/** A legacy row's start: "14:00" today, "Mon, Oct 26, 14:00" on another day this year, with the year otherwise. */
export function serviceStartLabel(startAt: number, now: number) {
  const time = resortTime24(startAt);
  const day = resortIsoDate(startAt);
  const today = resortIsoDate(now);
  if (day === today) return time;
  return `${day.slice(0, 4) === today.slice(0, 4) ? formatResortDate(startAt) : formatResortFullDate(startAt)}, ${time}`;
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
  onSaved,
  onPaid,
  onClose,
}: {
  view: OrderView | null | undefined;
  title: string;
  catalog: Catalog | undefined;
  run: Run;
  /** Order writes are still saving (the coupon field waits for them). */
  busy?: boolean;
  /** After Save & close, with the saved order's title. */
  onSaved: (title: string) => void;
  onPaid: (orderId: OrderId) => void;
  onClose?: () => void;
}) {
  const actions = useCheckoutBackend().useActions();
  const [confirmClear, setConfirmClear] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [paying, setPaying] = useState<TenderMethod | "split" | "none" | null>(null);
  const [couponOpen, setCouponOpen] = useState(false);
  const now = useNow();
  const lines = view?.lines ?? [];
  const totals = view?.totals ?? EMPTY_TOTALS;
  const orderId = view?.order._id;
  const itemCount = lines.reduce((n, line) => n + line.qty, 0);
  // Rows whose booking or appointment changed must be updated (or removed) before payment.
  const stale = lines.filter((line) => line.sourceIssue).length;
  // A coupon that no longer fits must be fixed or removed first; settleOrder refuses it too.
  const couponBlocked = Boolean(view?.promotion?.problem) && lines.length > 0;
  const cannotPay = !lines.length || stale > 0 || couponBlocked;
  const staffDiscount = round2(totals.discount - totals.coupon);

  async function saveAndClose() {
    if (!orderId) return;
    // Leaves the order only if it is still the one on screen when saving finishes.
    await run(() => actions.saveOrder({ orderId }), () => onSaved(title));
  }

  async function clear() {
    setConfirmClear(false);
    if (orderId) await run(() => actions.clearOrder({ orderId }));
  }

  if (view?.order.state === "discarded") return <div className="grid gap-4 overflow-y-auto p-5">
    <h2 className="font-serif text-2xl">{title} · Discarded</h2>
    <p className="text-sm">Read only. Restore from Orders → Discarded before editing or payment. Contents, customer, source links and history are kept; bookings are not cancelled.</p>
    <ul className="grid gap-3">{lines.map(line => <li key={line._id}><p className="font-medium">{line.name} · {formatMoney(line.net)}</p><p className="text-xs text-muted-foreground">{line.detail} · Quantity {line.qty}</p></li>)}</ul>
    <OrderHistory orderId={view.order._id} /><FinancialHistory orderId={view.order._id} view={view} />
    {onClose ? <Button variant="outline" onClick={onClose}>Close order</Button> : null}
  </div>;

  // With enlarged text the header and footer can outgrow the screen. The rows keep a minimum
  // height (no more than they get at normal text, even in phone landscape) and the panel itself
  // scrolls, so every action stays reachable; at normal text only the rows scroll.
  return (
    <div className="flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border/70 px-4 py-3 sm:px-5 lg:py-4 [@media(max-height:32rem)]:py-2">
        <div className="flex min-w-0 flex-1 basis-40 items-center gap-3">
          <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border border-border bg-muted/60 text-gold-text">
            <ReceiptText className="size-[18px]" strokeWidth={1.5} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className={cn("leading-tight font-semibold lining-nums [overflow-wrap:anywhere]", paying ? "text-base" : "font-serif text-2xl")} data-testid="order-panel-title">{paying ? `${formatMoney(totals.due)} due` : title}</h2>
            <p className="truncate text-sm text-muted-foreground">
              {paying ? `${title} · ` : ""}{itemCount} {itemCount === 1 ? "item" : "items"}
              {view?.customer ? ` · ${view.customer.name}` : ""}
            </p>
          </div>
        </div>
        <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center justify-end gap-2">
        {paying ? null : (
          <>
            {canAddCoupon(view) && !couponOpen ? (
              <Button size="icon" variant="outline" className={cn("size-9 rounded-xl text-gold-text", SHORT_SCREEN_ONLY)} data-add-coupon onClick={() => setCouponOpen(true)} aria-label="Add coupon" title="Add coupon: code, QR or link">
                <TicketPercent aria-hidden className="size-4" />
              </Button>
            ) : null}
            <Button variant="outline" className="h-auto min-h-10 max-w-full rounded-xl whitespace-normal" onClick={saveAndClose} disabled={!itemCount} title="Keep this unpaid order and start a new one. Reopen it from Orders.">
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
          <div className="min-h-[min(14rem,28dvh)] flex-1 overflow-y-auto [@media(max-height:36rem)]:min-h-[24dvh]">
            {orderId ? <div className="px-4"><OrderHistory orderId={orderId} /></div> : null}
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
                    now={now}
                  />
                ))}
              </ul>
            )}
          </div>

          <div className="@container shrink-0 border-t border-border/70 px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-5 lg:pb-5">
            {view ? <OrderCoupon view={view} run={run} busy={busy} open={couponOpen} onOpenChange={setCouponOpen} /> : null}
            <dl className="space-y-1 text-sm">
              <TotalRow label="Subtotal" value={formatMoney(totals.subtotal)} />
              {staffDiscount ? <TotalRow label="Discounts" value={formatMoney(-staffDiscount)} /> : null}
              {totals.coupon ? (
                <div className="flex justify-between gap-3 text-foreground" data-testid="order-coupon-total">
                  <dt className="flex min-w-0 items-center gap-1.5">
                    <TicketPercent aria-hidden className="size-3.5 shrink-0 text-gold-text" />
                    <span className="[overflow-wrap:anywhere]">{couponLabel(view ?? {})}</span>
                  </dt>
                  <dd className="text-right font-medium tabular-nums">{formatMoney(-totals.coupon)}</dd>
                </div>
              ) : null}
              <TotalRow label="VAT 7% (included)" value={formatMoney(totals.vat)} muted />
              {totals.deposit ? <TotalRow label="Paid online (deposit)" value={formatMoney(-totals.deposit)} /> : null}
            </dl>
            <div className="mt-2 mb-3 flex flex-wrap items-baseline justify-between gap-x-3 border-t border-border/70 pt-2 [@media(max-height:32rem)]:mb-2 [@media(max-height:32rem)]:pt-1">
              <span className="font-serif text-2xl font-semibold">Due</span>
              {/* Never wider than the panel: shrinks with it, and wraps under "Due" if it must. */}
              <span className="ml-auto min-w-0 text-right font-serif text-[min(2.25rem,13cqi)] leading-none font-semibold lining-nums tabular-nums [overflow-wrap:anywhere] [@media(max-height:32rem)]:text-[min(1.875rem,13cqi)]" data-testid="order-due">{formatMoney(totals.due)}</span>
            </div>
            {stale ? (
              <p role="status" className="mb-2 text-xs text-amber-800 dark:text-amber-300">
                {stale === 1 ? "A booking row changed" : `${stale} booking rows changed`}. Update {stale === 1 ? "it" : "them"} before taking payment.
              </p>
            ) : null}
            {couponBlocked ? (
              <p role="status" className="mb-2 text-xs text-amber-800 dark:text-amber-300">Fix or remove the coupon before taking payment.</p>
            ) : null}
            {lines.length && totals.due === 0 ? (
              <Button className="h-12 w-full rounded-xl" disabled={cannotPay} onClick={() => setPaying("none")}>Close order (nothing due)</Button>
            ) : (
              // On short screens (phone landscape) Split joins the tender row, leaving room for the items.
              <>
              <p className="mb-2 text-xs font-medium text-muted-foreground [@media(max-height:32rem)]:sr-only">Take payment by</p>
              <div className={cn(UP_TO_FOUR_COLUMNS, "[@media(max-height:32rem)]:grid-cols-5")}>
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
                  className="col-span-full h-11 rounded-xl border-gold/60 text-gold-text hover:bg-gold/10 hover:text-gold-text [@media(max-height:32rem)]:col-span-1 [@media(max-height:32rem)]:px-1 [@media(max-height:32rem)]:text-xs"
                  disabled={cannotPay}
                  onClick={() => setPaying("split")}
                >
                  Split payment
                </Button>
              </div>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/** A typed amount that is a number: "" and a lone "." are not. */
const isAmount = (text: string) => text !== "" && Number.isFinite(Number(text));

function TotalRow({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className={cn("flex justify-between gap-3", muted ? "text-xs text-muted-foreground" : "text-muted-foreground")}>
      <dt>{label}</dt>
      <dd className="text-right tabular-nums">{value}</dd>
    </div>
  );
}

function lineSubtitle(line: OrderLine, now: number) {
  const parts = [line.detail];
  if (line.kind === "service" || line.kind === "appointment") {
    parts.push(line.staffName ?? "Any therapist");
    // Legacy rows (no schedule) keep their own meaning: a start, or "Now".
    if (line.kind === "service") parts.push(scheduleLabel(line.schedule, now) ?? (line.startAt ? serviceStartLabel(line.startAt, now) : "Now"));
  }
  if (MERGES_QTY[line.kind] && line.qty > 1) parts.push(`${formatMoney(line.priceOverride?.price ?? line.unitPrice)} each`);
  return parts.filter(Boolean).join(" · ");
}

function OrderLineRow({ line, catalog, open, onToggle, run, now }: { line: OrderLine; catalog: Catalog | undefined; open: boolean; onToggle: () => void; run: Run; now: number }) {
  const actions = useCheckoutBackend().useActions();
  const listPrice = round2(line.unitPrice * line.qty);
  const issue = line.sourceIssue;
  // Already part of `net`: shown so staff can tell it from a line discount.
  const couponShare = line.couponDiscount ? lineCouponDiscount(line) : 0;
  return (
    <li className={cn("rounded-lg", open && "bg-muted/40", issue && "bg-amber-50/60 dark:bg-amber-400/5")}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-14 w-full flex-wrap items-start gap-3 rounded-lg px-3 py-3 text-left hover:bg-muted/40 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-4">
        <CheckoutPhoto src={line.imageUrl} kind={line.kind} className="size-11 sm:size-12" />
        {/* With enlarged text the name keeps a readable width and the price wraps below it. */}
        <span className="min-w-24 flex-1">
          <span className="block text-sm font-semibold [overflow-wrap:anywhere]">
            {line.name}
          </span>
          <span className="block truncate text-xs text-muted-foreground">{lineSubtitle(line, now)}</span>
          {line.deposit ? <span className="block text-xs text-emerald-700 dark:text-emerald-300">{formatMoney(line.deposit)} paid online</span> : null}
          {line.priceOverride ? <span className="block truncate text-xs text-amber-700 dark:text-amber-300">Price changed: {line.priceOverride.note}</span> : null}
          {line.stayCoupon ? (
            <span className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
              <TicketPercent aria-hidden className="mt-px size-3.5 shrink-0 text-gold-text" />
              <span className="min-w-0 [overflow-wrap:anywhere]">Priced with <span className="font-mono font-semibold">{line.stayCoupon.code}</span> on the booking</span>
            </span>
          ) : null}
        </span>
        <span className="ml-auto shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">{formatMoney(line.net)}</span>
          {line.net !== listPrice ? <span className="block text-xs text-muted-foreground tabular-nums line-through">{formatMoney(listPrice)}</span> : null}
          {couponShare ? <span className="block text-xs font-medium whitespace-nowrap text-gold-text tabular-nums">Coupon {formatMoney(-couponShare)}</span> : null}
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
            <Button size="sm" variant="outline" className="h-7 shrink-0" onClick={() => run(() => actions.updateSourceLine({ lineId: line._id }))}>
              {issue.kind === "changed" ? <><RefreshCw aria-hidden className="size-3.5" /> Update</> : <><Trash2 aria-hidden className="size-3.5" /> Remove</>}
            </Button>
          )}
        </div>
      ) : null}
      {open && !line.fee ? <LineEditor line={line} catalog={catalog} run={run} /> : null}
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

/**
 * A service row's optional time. A complete time is saved as it is entered; emptying the field (or
 * Clear) saves no time once the field is left, so a half-typed time never clears a saved one.
 */
function ServiceTimeInput({ value, onCommit }: { value: string; onCommit: (time: string) => unknown }) {
  const [text, setText] = useState(value);
  const [saved, setSaved] = useState(value);
  // Follow a change saved elsewhere (another device, or this one) without remounting while typing.
  if (saved !== value) {
    setSaved(value);
    setText(value);
  }
  return (
    <div className="flex items-center gap-1">
      <Input
        type="time"
        aria-label="Service time"
        className="h-9 w-32"
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          if (isTimeValue(e.target.value) && e.target.value !== value) onCommit(e.target.value);
        }}
        onBlur={(e) => { if (!e.target.value && value && !e.target.validity.badInput) onCommit(""); }}
      />
      {value ? (
        <Button size="icon" variant="ghost" className="size-9" aria-label="Clear service time" onClick={() => { setText(""); onCommit(""); }}>
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

  const when = serviceScheduleValue(line);

  async function applyPrice() {
    if (await run(() => actions.overrideLinePrice({ lineId, price: Number(price), note }))) {
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
  const unchangedPrice = line.priceOverride !== undefined && Number(price) === line.priceOverride.price && note.trim() === line.priceOverride.note;

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
              <Button size="sm" variant="outline" disabled={!isAmount(discountValue)} onClick={() => run(() => actions.updateLine({ lineId, discount: { type: discountType, value: Number(discountValue) } }))}>
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
            {line.priceOverride && !priceOpen ? (
              <div className="flex items-start justify-between gap-2 rounded-lg bg-amber-50 p-2 text-xs dark:bg-amber-400/10">
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  {formatMoney(line.priceOverride.price)} instead of {formatMoney(line.unitPrice)} · “{line.priceOverride.note}”
                </span>
                <span className="flex shrink-0 gap-1">
                  <Button size="sm" variant="ghost" className="h-7" onClick={editPrice}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7" onClick={() => run(() => actions.overrideLinePrice({ lineId, price: null, note: "" }))}>
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
                  <Button size="sm" disabled={!isAmount(price) || !note.trim() || unchangedPrice} onClick={applyPrice}>Apply price</Button>
                  <Button size="sm" variant="ghost" onClick={() => setPriceOpen(false)}>Cancel</Button>
                </div>
              </div>
            ) : (
              <Button size="sm" variant="outline" className="justify-self-start" onClick={editPrice}>
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
