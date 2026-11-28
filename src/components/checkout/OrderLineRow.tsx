"use client";

import { PackedLotEditor } from "./PackedLotEditor";

import { satangToBaht } from "convex/shared/money";
import { parseMoneyInput } from "@/lib/money-input";
import { ChevronDown, ChevronRight, Minus, Plus, RefreshCw, TicketPercent, Trash2, TriangleAlert, X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { formatMoney } from "@/components/admin/labels";
import { useStaffAccess } from "@/components/admin/staff-access";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { REASON_CHIPS } from "@/components/ui/reason-chips";
import { ReasonField } from "@/components/ui/reason-field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { isTimeValue } from "@/lib/dates/values";
import { useNow } from "@/lib/staff-bookings";
import { serviceScheduleValue, serviceStartLabel } from "./service-row-dates";
import { cn } from "@/lib/utils";
import { MAX_PRICE, MAX_QTY, MERGES_QTY, lineCouponDiscount, roundMoney } from "convex/shared/orderMath";
import type { ApprovalPayload } from "convex/shared/staffTypes";
import { ApprovalInline, ApprovalRequestForm, useSendApproval } from "./ApprovalRequest";
import { useCheckoutBackend, type ApprovalRequest, type Catalog, type OrderLine } from "./backend";
import { amountInput, scheduleLabel } from "./checkout-ui";
import { CheckoutPhoto } from "./CheckoutPhoto";
import { discountText, parseDiscount } from "./discount-input";
import { useCheckoutDraft, useCheckoutDraftState, useCheckoutDiscountNotice } from "./CheckoutDrafts";
import { discountOverLimit, formatPercent, needsApproval } from "./staff-approvals";
import type { Run } from "./useOrderWrites";

/** A request the cashier is about to send: what it is, its exact payload, and a reason to start from. */
type Ask = { what: string; payload: ApprovalPayload; reason?: string };

const isAmount = (text: string) => text !== "" && Number.isFinite(Number(text));

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

export function OrderLineRow({ line, catalog, open, onToggle, run, now, waiting, request, onSent, takeBack, canEditProductQuantity }: {
  line: OrderLine; catalog: Catalog | undefined; open: boolean; onToggle: () => void; run: Run; now: number; waiting: boolean;
  /** This line's request: waiting for a manager, or its recent outcome. */
  request: ApprovalRequest | null;
  /** A discount request was sent from the editor; it closes, and the request shows in its place. */
  onSent: () => void;
  takeBack: ReactNode;
  canEditProductQuantity: boolean;
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
  const listPrice = roundMoney(line.unitPrice * line.qty);
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
      {/* Rooms, extras and products can carry a quantity. Service and appointment rows keep their own schedules. */}
      {MERGES_QTY[line.kind] && !line.fee && (line.kind !== "product" || canEditProductQuantity) ? <QtyStepper line={line} run={run} /> : null}
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
            const failed = await send(line.orderId, ask.payload, reason);
            if (!failed) setAsk(null);
            return failed;
          }}
        />
      ) : null}
      {takeBack}
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
      className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", on ? "border-input bg-background text-foreground shadow-sm" : "border-border hover:bg-muted")}
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
  const draftKey = `${line.orderId}:${line._id}:price`;
  const [priceOpen, setPriceOpen] = useCheckoutDraftState(`${draftKey}:open`, false);
  const [price, setPrice] = useCheckoutDraftState(draftKey, "");
  const [note, setNote] = useCheckoutDraftState(`${draftKey}:reason`, "");
  const [approvalDirty, setApprovalDirty] = useState(false);
  const priceDirty = priceOpen && (price !== (line.priceOverride ? String(satangToBaht(line.priceOverride.price)) : "") || note !== (line.priceOverride?.note ?? ""));
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
    const request: Ask = { what: "custom price", payload: { kind: "customPrice", action: "overrideLinePrice", lineId, price: parseMoneyInput(price), note: note.trim() }, reason: note.trim() };
    if (priceNeedsManager) {
      setAsk(request);
      return;
    }
    if (await orAsk(() => actions.overrideLinePrice({ lineId, price: parseMoneyInput(price), note }), request)) {
      setPriceOpen(false);
      setPrice("");
      setNote("");
    }
  }

  // A changed price can be corrected (price or reason) in place, without restoring it first.
  function editPrice() {
    setPrice(line.priceOverride ? String(satangToBaht(line.priceOverride.price)) : "");
    setNote(line.priceOverride?.note ?? "");
    setPriceOpen(true);
  }
  // Opening a row brings its editor into the rows' view, so the discount is on screen.
  const editor = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const row = editor.current?.closest("li");
    if (row) reveal(row);
  }, []);
  const unchangedPrice = line.priceOverride !== undefined && parseMoneyInput(price) === line.priceOverride.price && note.trim() === line.priceOverride.note;

  return (
    <div ref={editor} className="mx-3 mb-3 divide-y divide-border overflow-hidden rounded-xl bg-muted/50 px-3">
      {line.kind === "product" || line.kind === "package" ? <PackedLotEditor key={line._id} line={line} disabled={waiting} /> : null}
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
                  <Input id={`price-${lineId}`} inputMode="decimal" className="h-9 w-28" value={price} onChange={(e) => setPrice(amountInput(e.target.value, MAX_PRICE / 100))} placeholder={String(satangToBaht(line.unitPrice))} autoFocus />
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
            const failed = await send(line.orderId, ask.payload, reason);
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
  const draftKey = `${line.orderId}:${line._id}:discount`;
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
            orderId: line.orderId,
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
    const failed = await send(line.orderId, { kind: "discount", lineId, discount: typed }, reason.trim());
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
          <ReasonField compact value={reason} onChange={setReason} chips={REASON_CHIPS.discount} disabled={sending} />
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
