"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { PackageCheck, ShieldAlert, Truck, X } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { Callout, EditorSheet, FieldError, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { resortMidnight } from "@/lib/staff-bookings";
import { staffDateTime } from "@/lib/staff-time";
import Link from "@/platform/link";
import { DeclineHoldSheet } from "./PurchasingEditorSheets";
import { createOperationKey, HOLD_STATUS_META, holdAge, parseStockError, parseWholeQuantity, STOCK_PAGE_SIZE } from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

export type HeldGoodsRow = FunctionReturnType<typeof api.commerce.purchasing.holds>["page"][number];
type HoldStatus = HeldGoodsRow["status"];

/**
 * Held goods queue: unresolved units, supplier and age per hold, an exact receipt-reference or item filter (server-side,
 * within the branch and status) and the acceptance paths each hold actually has.
 */
export function HeldGoodsPanel({
  branch,
  access,
  status,
  onStatusChange,
  detailHref,
  onCreateLinkedOrder,
  onNotice,
}: {
  branch: { id: Id<"branches">; name: string };
  access: { buyer: boolean; directOrder: boolean };
  status: HoldStatus;
  onStatusChange: (status: HoldStatus) => void;
  detailHref: (path: string) => string;
  onCreateLinkedOrder: (hold: HeldGoodsRow) => void;
  onNotice: (message: string) => void;
}) {
  const [referenceText, setReferenceText] = useState("");
  const [receiptReference, setReceiptReference] = useState("");
  const [item, setItem] = useState<{ variantId: Id<"productVariants">; label: string } | null>(null);
  const [declining, setDeclining] = useState<HeldGoodsRow | null>(null);
  const [accepting, setAccepting] = useState<HeldGoodsRow | null>(null);
  const [recordingPickup, setRecordingPickup] = useState<HeldGoodsRow | null>(null);
  const [now] = useState(() => Date.now());

  const { results, status: queryStatus, loadMore } = usePaginatedQuery(
    api.commerce.purchasing.holds,
    {
      branchId: branch.id, status,
      ...(receiptReference ? { receiptReference } : item ? { variantId: item.variantId } : {}),
    },
    { initialNumItems: STOCK_PAGE_SIZE },
  );
  const current = (row: HeldGoodsRow | null) => (row ? results.find((r) => r._id === row._id) ?? row : null);
  const filtered = Boolean(receiptReference || item);

  function applyReference(event: FormEvent) {
    event.preventDefault();
    setItem(null);
    setReceiptReference(referenceText.trim());
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Excess or substitute deliveries held outside On hand. Accept them onto an order or decline and return them.
        </p>
        <Select value={status} onValueChange={(value) => onStatusChange(value as HoldStatus)}>
          <SelectTrigger aria-label="Held goods status" className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Unresolved holds</SelectItem>
            <SelectItem value="accepted">Accepted</SelectItem>
            <SelectItem value="declined">Declined</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <form onSubmit={applyReference} className="flex flex-wrap items-end gap-2" role="search" aria-label="Find held goods">
        <div className="grid gap-1.5">
          <Label htmlFor="hold-receipt-ref">Receipt reference</Label>
          <Input
            id="hold-receipt-ref"
            type="search"
            value={referenceText}
            maxLength={64}
            placeholder="e.g. GR-261128-7KQ4M"
            className="w-64 max-w-full font-mono"
            onChange={(event) => setReferenceText(event.target.value)}
          />
        </div>
        <Button type="submit" variant="outline">Find</Button>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setReferenceText("");
              setReceiptReference("");
              setItem(null);
            }}
          >
            <X aria-hidden className="size-4" />
            Clear {receiptReference ? `receipt ${receiptReference}` : item?.label}
          </Button>
        ) : null}
      </form>

      <Card className="overflow-hidden">
        {queryStatus === "LoadingFirstPage" ? (
          <SkeletonRows label="Loading held goods" rows={4} />
        ) : results.length === 0 ? (
          <EmptyState>
            {filtered
              ? `No ${status === "open" ? "unresolved" : status} holds match ${receiptReference || item?.label} at ${branch.name}.`
              : status === "open"
                ? `No unresolved held goods at ${branch.name}.`
                : `No ${status} holds found.`}
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {results.map((hold) => {
              const age = holdAge(hold.createdAt, now);
              const path = hold.acceptPath;
              return (
                <li key={hold._id} className="flex flex-wrap items-start justify-between gap-4 p-4">
                  <div className="grid min-w-0 flex-1 gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge {...HOLD_STATUS_META[hold.status]} />
                      {hold.status === "open" ? <StatusBadge tone={age.tone} label={age.label} /> : null}
                      <button
                        type="button"
                        className="text-left font-medium text-foreground hover:underline"
                        title="Show only this item"
                        onClick={() => {
                          setReferenceText("");
                          setReceiptReference("");
                          setItem({ variantId: hold.variantId, label: `${hold.item.productName} · ${hold.item.variantLabel}` });
                        }}
                      >
                        {hold.item.productName} · {hold.item.variantLabel}
                      </button>
                    </div>
                    <p className="text-sm tabular-nums text-foreground">
                      {hold.status === "open" ? (
                        <>
                          <strong>{hold.unresolved} unresolved</strong>
                          <span className="text-muted-foreground"> of {hold.quantity} held{hold.acceptedQuantity ? ` · ${hold.acceptedQuantity} accepted` : ""}</span>
                        </>
                      ) : (
                        <span className="text-muted-foreground">{hold.quantity} held · {hold.acceptedQuantity} accepted</span>
                      )}
                      {hold.supplierName ? <span className="text-muted-foreground"> · {hold.supplierName}</span> : null}
                    </p>
                    <p className="text-sm text-foreground">{hold.reason}</p>
                    <p className="text-xs text-muted-foreground">
                      Receipt{" "}
                      <Link href={detailHref(`receipts/${hold.receiptId}`)} className="font-mono underline underline-offset-4">
                        {hold.receiptReference}
                      </Link>
                      {hold.orderId ? (
                        <>
                          {" · Order "}
                          <Link href={detailHref(`orders/${hold.orderId}`)} className="font-mono underline underline-offset-4">
                            {hold.orderReference ?? hold.orderId}
                          </Link>
                        </>
                      ) : null}
                      {" · "}
                      {staffDateTime(hold.createdAt)}
                    </p>
                    {hold.resolution ? (
                      <p className="text-xs text-muted-foreground">
                        Resolution: {hold.resolution}
                        {hold.resolvedByLabel ? ` (${hold.resolvedByLabel})` : ""}
                      </p>
                    ) : null}
                    {hold.handoff ? (
                      <p className="text-xs text-muted-foreground">
                        Handoff:{" "}
                        {[
                          hold.handoff.carrier,
                          hold.handoff.returnReference ? `Return ref ${hold.handoff.returnReference}` : undefined,
                          hold.handoff.note,
                          hold.handoff.collectedAt ? `Collected ${staffDateTime(hold.handoff.collectedAt)}` : "Awaiting pickup",
                        ].filter(Boolean).join(" · ")}
                      </p>
                    ) : null}
                    {path?.kind === "order_closed" ? (
                      <p className="text-xs text-muted-foreground">
                        {path.orderReference} is closed, so these goods can only go on a linked order or back to the supplier.
                      </p>
                    ) : null}
                  </div>
                  {hold.status === "open" && access.buyer ? (
                    <div className="flex shrink-0 flex-wrap gap-2">
                      {path?.kind === "own_order" ? (
                        <Button type="button" size="sm" onClick={() => setAccepting(hold)}>
                          <PackageCheck aria-hidden className="size-3.5" />
                          Accept on {path.orderReference} ({path.due} due)
                        </Button>
                      ) : null}
                      {path?.kind === "no_due" ? (
                        <ButtonLink href={detailHref(`orders/${path.orderId}`)} size="sm" variant="outline">
                          Amend {path.orderReference} to accept
                        </ButtonLink>
                      ) : null}
                      {access.directOrder && path?.kind !== "own_order" ? (
                        <Button type="button" size="sm" variant="outline" onClick={() => onCreateLinkedOrder(hold)}>
                          Create linked order
                        </Button>
                      ) : null}
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeclining(hold)}
                      >
                        <ShieldAlert aria-hidden className="size-3.5" />
                        Decline & return
                      </Button>
                    </div>
                  ) : null}
                  {hold.status === "declined" && access.buyer && !hold.handoff?.collectedAt ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => setRecordingPickup(hold)}>
                      <Truck aria-hidden className="size-3.5" />
                      Record pickup
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {queryStatus === "CanLoadMore" ? (
        <div className="flex justify-center">
          <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
            Load more holds
          </Button>
        </div>
      ) : null}

      {declining ? (
        <DeclineHoldSheet
          hold={current(declining)!}
          onClose={() => setDeclining(null)}
          onDone={() => {
            setDeclining(null);
            onNotice("Held goods declined.");
          }}
        />
      ) : null}
      {accepting ? (
        <AcceptHoldSheet
          branchId={branch.id}
          hold={current(accepting)!}
          onClose={() => setAccepting(null)}
          onDone={(reference) => {
            setAccepting(null);
            onNotice(`Held goods accepted into On hand on ${reference}.`);
          }}
        />
      ) : null}
      {recordingPickup ? (
        <HoldPickupSheet
          hold={current(recordingPickup)!}
          onClose={() => setRecordingPickup(null)}
          onDone={() => {
            setRecordingPickup(null);
            onNotice("Pickup recorded.");
          }}
        />
      ) : null}
    </div>
  );
}

function AcceptHoldSheet({
  branchId,
  hold,
  onClose,
  onDone,
}: {
  branchId: Id<"branches">;
  hold: HeldGoodsRow;
  onClose: () => void;
  onDone: (receiptReference: string) => void;
}) {
  const accept = useMutation(api.commerce.purchasing.acceptHeldGoods);
  const tracked = useQuery(api.commerce.stockExpansion.trackedItems, { branchId, variantIds: [hold.variantId] });
  const isTracked = tracked?.includes(hold.variantId) ?? false;
  const path = hold.acceptPath?.kind === "own_order" ? hold.acceptPath : null;
  const max = path ? Math.min(hold.unresolved, path.due) : 0;
  const [reviewedRevision, setReviewedRevision] = useState(hold.revision);
  const [qtyText, setQtyText] = useState(String(max));
  const [lotCode, setLotCode] = useState("");
  const [lotExpiry, setLotExpiry] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("hold-acc"));
  const { requestClose } = useStockDirtyGuard(qtyText !== String(max) || lotCode.trim() !== "", onClose, saving);
  const isStale = hold.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!path) {
      setError("This hold can no longer be accepted on its order.");
      return;
    }
    const parsed = parseWholeQuantity(qtyText, { allowZero: false, max });
    if (!parsed.ok || !parsed.value) {
      setError(parsed.ok ? "Enter how many units to accept." : parsed.error);
      document.getElementById("hold-acc-qty")?.focus();
      return;
    }
    if (isTracked && (!lotCode.trim() || !lotExpiry)) {
      setError("Enter the lot code and expiry for this lot-tracked item.");
      document.getElementById(lotCode.trim() ? "hold-acc-lot-exp" : "hold-acc-lot")?.focus();
      return;
    }
    if (isStale) {
      setError("This held goods record changed while open. Review the updated hold above before accepting.");
      return;
    }
    setSaving(true);
    try {
      const result = await accept({
        holdId: hold._id,
        expectedRevision: reviewedRevision,
        quantity: parsed.value,
        ...(isTracked ? { lotReceipt: { code: lotCode.trim(), expiresAt: resortMidnight(lotExpiry) } } : {}),
        operationKey: opKey,
      });
      onDone(result.reference ?? "the order");
    } catch (cause) {
      setError(parseStockError(cause, "Could not accept the held goods.").message);
      setOpKey(createOperationKey("hold-acc"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Accept held goods</SheetTitle>
          <SheetDescription>
            {hold.item.productName} · {hold.item.variantLabel}: {hold.unresolved} unresolved
            {path ? ` · ${path.due} still due on ${path.orderReference}` : ""}
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Accept into On hand">
        {isStale ? (
          <StockStaleBanner
            title="Held goods record changed"
            description="This hold was updated elsewhere. Review the latest quantity before accepting."
            actionLabel="Review updated hold"
            onReview={() => {
              setReviewedRevision(hold.revision);
              setError("");
              setOpKey(createOperationKey("hold-acc"));
            }}
          />
        ) : null}
        <Callout tone="info">
          Posts a receipt on {path?.orderReference ?? "the order"} from these held goods. On hand rises, the order&apos;s due units fall and the hold closes once all units are accepted.
        </Callout>
        <div className="grid gap-1.5">
          <Label htmlFor="hold-acc-qty">Units to accept (max {max})</Label>
          <NumberField id="hold-acc-qty" value={qtyText} onChange={(event) => { setQtyText(event.target.value); setOpKey(createOperationKey("hold-acc")); }} />
        </div>
        {isTracked ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="hold-acc-lot">Lot code (required)</Label>
              <Input id="hold-acc-lot" value={lotCode} maxLength={80} onChange={(event) => { setLotCode(event.target.value); setOpKey(createOperationKey("hold-acc")); }} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="hold-acc-lot-exp">Lot expiry (required)</Label>
              <DatePicker id="hold-acc-lot-exp" value={lotExpiry} onValueChange={(value) => { setLotExpiry(value); setOpKey(createOperationKey("hold-acc")); }} placeholder="Select expiry date" />
            </div>
          </div>
        ) : null}
      </SheetForm>
    </EditorSheet>
  );
}

function HoldPickupSheet({ hold, onClose, onDone }: { hold: HeldGoodsRow; onClose: () => void; onDone: () => void }) {
  const record = useMutation(api.commerce.purchasing.recordHeldGoodsHandoff);
  const [carrier, setCarrier] = useState(hold.handoff?.carrier ?? "");
  const [returnReference, setReturnReference] = useState(hold.handoff?.returnReference ?? "");
  const [note, setNote] = useState(hold.handoff?.note ?? "");
  const [collected, setCollected] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldError, setFieldError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("hold-pickup"));
  const dirty = carrier !== (hold.handoff?.carrier ?? "") || returnReference !== (hold.handoff?.returnReference ?? "") || note !== (hold.handoff?.note ?? "");
  const { requestClose } = useStockDirtyGuard(dirty, onClose, saving);
  const fresh = () => setOpKey(createOperationKey("hold-pickup"));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    setFieldError("");
    if (!dirty && !collected) {
      setFieldError("Enter a detail or confirm the pickup.");
      document.getElementById("hold-pickup-carrier")?.focus();
      return;
    }
    setSaving(true);
    try {
      await record({
        holdId: hold._id,
        expectedRevision: hold.revision,
        handoff: {
          carrier: carrier.trim() || undefined,
          returnReference: returnReference.trim() || undefined,
          note: note.trim() || undefined,
          collected: collected || undefined,
        },
        operationKey: opKey,
      });
      onDone();
    } catch (cause) {
      setError(parseStockError(cause, "Could not record the pickup.").message);
      fresh();
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Record pickup</SheetTitle>
          <SheetDescription>
            {hold.item.productName} · {hold.item.variantLabel}: {hold.quantity} declined on {hold.receiptReference}
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Save handoff">
        <div className="grid gap-1.5">
          <Label htmlFor="hold-pickup-carrier">Carrier or driver</Label>
          <Input id="hold-pickup-carrier" value={carrier} maxLength={200} aria-describedby={fieldError ? "hold-pickup-err" : undefined}
            onChange={(event) => { setCarrier(event.target.value); fresh(); }} />
          <FieldError id="hold-pickup-err">{fieldError}</FieldError>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hold-pickup-ref">Supplier return reference</Label>
          <Input id="hold-pickup-ref" value={returnReference} maxLength={64} onChange={(event) => { setReturnReference(event.target.value); fresh(); }} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="hold-pickup-note">Collection note</Label>
          <Input id="hold-pickup-note" value={note} maxLength={2000} onChange={(event) => { setNote(event.target.value); fresh(); }} />
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input type="checkbox" checked={collected} onChange={(event) => { setCollected(event.target.checked); fresh(); }} className="mt-0.5 size-4 accent-foreground" />
          <span>The goods were collected now</span>
        </label>
      </SheetForm>
    </EditorSheet>
  );
}
