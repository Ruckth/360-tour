"use client";

import type { PaginationStatus } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { CheckCheck, ExternalLink, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { SkeletonRows } from "@/components/admin/admin-bulk";
import { Callout, FieldError, NumberField } from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { DIRECT_RECEIPT_REASON_CHIPS } from "./stock-format";
import type { StockLineDraft } from "./stock-types";
import { StockStaleBanner } from "./StockFormGuard";
import { StockLineEditor, type StockLineFieldErrors } from "./StockLineEditor";
import { SupplierPickerField } from "./SupplierPicker";

export type ReceiveOrderDetail = FunctionReturnType<typeof api.commerce.purchasing.order>;
export type ReceiveOrderRow = FunctionReturnType<typeof api.commerce.purchasing.orders>["page"][number];
export type ReceiveAcceptableHold = ReceiveOrderDetail["acceptableHolds"][number] & {
  receiptReference?: string;
  reason?: string;
};

export type PoLineFieldErrors = Record<
  string,
  { accepted?: string; rejected?: string; rejectReason?: string; lotCode?: string; lotExpiry?: string; hold?: string }
>;

export type HeldLineDraft = {
  key: string;
  variantId: Id<"productVariants">;
  productName: string;
  variantLabel: string;
  sku?: string;
  quantityText: string;
  reason: string;
};

export type MatchedOpenOrder = {
  orderId: Id<"purchaseOrders">;
  reference?: string;
  supplierName?: string;
  dueUnits?: number;
};

const NO_HOLD_VALUE = "__none__";

/** Order picker + PO receiving lines (with eligible open hold selection and optional lot entry). */
export function ReceivePurchaseOrderSection({
  branchName,
  initialOrderId,
  allowDirectReceipt,
  orderedOpenOrders,
  openOrdersStatus,
  onLoadMoreOrders,
  matchedOrderIdSet,
  selectedOrderId,
  orderDetail,
  reviewedOrder,
  isOrderStale,
  acceptedByLine,
  rejectedByLine,
  rejectReasonByLine,
  selectedHoldByLine,
  lotCodeByKey,
  lotExpiryByKey,
  trackedVariantIds,
  poLineErrors,
  eligibleHoldsByLine,
  onSelectOrder,
  onAcceptStaleOrder,
  onReceiveAllRemaining,
  onAcceptedChange,
  onRejectedChange,
  onRejectReasonChange,
  onHoldChange,
  onLotCodeChange,
  onLotExpiryChange,
}: {
  branchName: string;
  initialOrderId?: Id<"purchaseOrders">;
  allowDirectReceipt: boolean;
  orderedOpenOrders: readonly ReceiveOrderRow[];
  openOrdersStatus: PaginationStatus;
  onLoadMoreOrders: () => void;
  matchedOrderIdSet: ReadonlySet<Id<"purchaseOrders">>;
  selectedOrderId: Id<"purchaseOrders"> | null;
  orderDetail: ReceiveOrderDetail | undefined;
  reviewedOrder: { orderId: Id<"purchaseOrders">; issuedRevision: number; revision: number } | null;
  isOrderStale: boolean;
  acceptedByLine: Record<string, string>;
  rejectedByLine: Record<string, string>;
  rejectReasonByLine: Record<string, string>;
  selectedHoldByLine: Record<string, Id<"purchaseHolds"> | "">;
  lotCodeByKey: Record<string, string>;
  lotExpiryByKey: Record<string, string>;
  trackedVariantIds: ReadonlySet<Id<"productVariants">>;
  poLineErrors: PoLineFieldErrors;
  eligibleHoldsByLine: ReadonlyMap<Id<"purchaseOrderLines">, ReceiveAcceptableHold[]>;
  onSelectOrder: (orderId: Id<"purchaseOrders">) => void;
  onAcceptStaleOrder: () => void;
  onReceiveAllRemaining: () => void;
  onAcceptedChange: (lineId: string, val: string) => void;
  onRejectedChange: (lineId: string, val: string) => void;
  onRejectReasonChange: (lineId: string, val: string) => void;
  onHoldChange: (lineId: string, holdId: Id<"purchaseHolds"> | "") => void;
  onLotCodeChange: (lineId: string, val: string) => void;
  onLotExpiryChange: (lineId: string, val: string) => void;
}) {
  const loadMoreButton = useRef<HTMLButtonElement>(null);
  const [ordersBeforeKeyboardLoad, setOrdersBeforeKeyboardLoad] = useState<Set<string> | null>(null);
  const firstNewOrder = ordersBeforeKeyboardLoad
    ? orderedOpenOrders.find(order => !ordersBeforeKeyboardLoad.has(order._id))
    : undefined;
  const showLoadMore = openOrdersStatus === "CanLoadMore" || openOrdersStatus === "LoadingMore";

  return (
    <div className="grid gap-4">
      {!initialOrderId ? (
        <div className="grid gap-2">
          <Label>Select an open purchase order</Label>
          {openOrdersStatus === "LoadingFirstPage" ? (
            <SkeletonRows label="Loading open purchase orders" rows={2} />
          ) : openOrdersStatus === "Exhausted" && orderedOpenOrders.length === 0 ? (
            <Callout tone="info">
              No open purchase orders at {branchName}.
              {allowDirectReceipt ? " You can switch to Receive without PO above." : ""}
            </Callout>
          ) : (
            <ul className="grid max-h-48 gap-1.5 overflow-y-auto rounded-lg border border-border p-2">
              {orderedOpenOrders.map((po) => {
                const matchesPrefill = matchedOrderIdSet.has(po._id);
                return (
                  <li key={po._id}>
                    <button
                      type="button"
                      ref={po === firstNewOrder ? button => {
                        if (button && document.activeElement === loadMoreButton.current) button.focus();
                      } : undefined}
                      aria-pressed={selectedOrderId === po._id}
                      onClick={() => onSelectOrder(po._id)}
                      className={cn(
                        "flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm transition hover:bg-muted",
                        selectedOrderId === po._id && "bg-muted font-medium",
                      )}
                    >
                      <span>
                        <span className="font-mono">{po.reference}</span> · {po.supplier.name}
                        {matchesPrefill ? (
                          <span className="ml-2 rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">
                            Matches selected item
                          </span>
                        ) : null}
                      </span>
                      <span className="text-xs tabular-nums text-muted-foreground">
                        {po.dueUnits} due
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Keep the paging button mounted until keyboard focus reaches the first new option. */}
          {showLoadMore || firstNewOrder ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              ref={loadMoreButton}
              aria-disabled={openOrdersStatus !== "CanLoadMore"}
              onBlur={() => setOrdersBeforeKeyboardLoad(null)}
              onClick={event => {
                if (openOrdersStatus !== "CanLoadMore") return;
                if (event.detail === 0 && document.activeElement === event.currentTarget) {
                  setOrdersBeforeKeyboardLoad(new Set(orderedOpenOrders.map(order => order._id)));
                }
                onLoadMoreOrders();
              }}
            >
              {openOrdersStatus === "LoadingMore" ? "Loading more orders…" : "Load more orders"}
            </Button>
          ) : null}
        </div>
      ) : null}

      {orderDetail ? (
        <>
          {isOrderStale && reviewedOrder ? (
            <StockStaleBanner
              title="Purchase order changed while receiving"
              description={`This order updated from Rev ${reviewedOrder.issuedRevision} (edit #${reviewedOrder.revision}) to Rev ${orderDetail.order.issuedRevision} (edit #${orderDetail.order.revision}). Your typed quantities are preserved — review the latest due units before posting.`}
              actionLabel="Review updated order"
              onReview={onAcceptStaleOrder}
            />
          ) : null}

          <Callout tone="info" title={`${orderDetail.order.reference} · ${orderDetail.order.supplier.name}`}>
            Branch: {branchName} · Rev {orderDetail.order.issuedRevision} · {orderDetail.order.dueUnits} units still due.
          </Callout>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">Order lines</h3>
            <Button type="button" variant="outline" size="sm" onClick={onReceiveAllRemaining}>
              <CheckCheck aria-hidden className="size-4" />
              Receive all remaining
            </Button>
          </div>

          <ul className="grid gap-3">
            {orderDetail.lines.map((line) => {
              const lineErr = poLineErrors[line._id];
              const isLotTracked = trackedVariantIds.has(line.variantId);
              const eligibleHolds = eligibleHoldsByLine.get(line._id) ?? [];
              const selectedHoldId = selectedHoldByLine[line._id] ?? "";
              const activeHold = selectedHoldId
                ? eligibleHolds.find((h) => h.holdId === selectedHoldId)
                : undefined;
              const holdRemaining = activeHold?.remaining;
              return (
                <li
                  key={line._id}
                  className={cn(
                    "grid gap-3 rounded-lg border border-border bg-card p-3.5",
                    lineErr && "border-destructive/60",
                  )}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium text-foreground">{line.item.productName}</p>
                        {isLotTracked ? <StatusBadge tone="info" label="Lot-tracked" /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {line.item.variantLabel}
                        {line.item.sku ? ` · ${line.item.sku}` : ""}
                      </p>
                    </div>
                    <span className="font-mono text-xs tabular-nums text-muted-foreground">
                      Ordered {line.ordered - line.cancelled} · Accepted {line.accepted} ·{" "}
                      <strong className="text-foreground">Due {line.due}</strong>
                    </span>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="grid gap-1.5">
                      <Label htmlFor={`po-acc-${line._id}`}>Accepted now</Label>
                      <NumberField
                        id={`po-acc-${line._id}`}
                        value={acceptedByLine[line._id] ?? ""}
                        disabled={line.due <= 0}
                        placeholder={line.due > 0 ? `0–${line.due}` : "0 due"}
                        aria-invalid={lineErr?.accepted ? true : undefined}
                        aria-describedby={lineErr?.accepted ? `po-acc-${line._id}-err` : undefined}
                        onChange={(event) => onAcceptedChange(line._id, event.target.value)}
                      />
                      <FieldError id={`po-acc-${line._id}-err`}>{lineErr?.accepted}</FieldError>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`po-rej-${line._id}`}>Rejected (optional)</Label>
                      <NumberField
                        id={`po-rej-${line._id}`}
                        value={rejectedByLine[line._id] ?? ""}
                        placeholder="0"
                        aria-invalid={lineErr?.rejected ? true : undefined}
                        aria-describedby={lineErr?.rejected ? `po-rej-${line._id}-err` : undefined}
                        onChange={(event) => onRejectedChange(line._id, event.target.value)}
                      />
                      <FieldError id={`po-rej-${line._id}-err`}>{lineErr?.rejected}</FieldError>
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor={`po-rej-reason-${line._id}`}>Rejection reason</Label>
                      <Input
                        id={`po-rej-reason-${line._id}`}
                        value={rejectReasonByLine[line._id] ?? ""}
                        placeholder="Required if rejected > 0"
                        aria-invalid={lineErr?.rejectReason ? true : undefined}
                        aria-describedby={lineErr?.rejectReason ? `po-rej-reason-${line._id}-err` : undefined}
                        onChange={(event) => onRejectReasonChange(line._id, event.target.value)}
                      />
                      <FieldError id={`po-rej-reason-${line._id}-err`}>{lineErr?.rejectReason}</FieldError>
                    </div>
                  </div>

                  {eligibleHolds.length > 0 ? (
                    <div className="grid gap-1.5 rounded-md border border-amber-300/60 bg-amber-50/50 p-2.5 dark:border-amber-500/30 dark:bg-amber-950/20">
                      <Label htmlFor={`po-hold-${line._id}`} className="text-xs font-medium text-foreground">
                        Accept from held goods (links receipt to open hold)
                      </Label>
                      <Select
                        value={selectedHoldId || NO_HOLD_VALUE}
                        onValueChange={(val) =>
                          onHoldChange(line._id, val === NO_HOLD_VALUE ? "" : (val as Id<"purchaseHolds">))
                        }
                      >
                        <SelectTrigger id={`po-hold-${line._id}`} className="h-9 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_HOLD_VALUE}>None (new delivery, not held goods)</SelectItem>
                          {eligibleHolds.map((hold) => {
                            const labelPrefix = hold.receiptReference
                              ? hold.receiptReference
                              : hold.link === "replacement"
                                ? "Linked replacement hold"
                                : "Order hold";
                            return (
                              <SelectItem key={hold.holdId} value={hold.holdId}>
                                {labelPrefix} · {hold.remaining} held{hold.reason ? ` — ${hold.reason}` : ""}
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                      {activeHold && holdRemaining !== undefined ? (
                        <p className="text-xs text-muted-foreground">
                          Accepting against{" "}
                          {activeHold.receiptReference ? (
                            <>
                              hold from <span className="font-mono">{activeHold.receiptReference}</span>
                            </>
                          ) : activeHold.link === "replacement" ? (
                            "linked replacement hold"
                          ) : (
                            "held goods"
                          )}{" "}
                          (up to <strong>{holdRemaining}</strong> held units remaining).
                        </p>
                      ) : null}
                      <FieldError id={`po-hold-${line._id}-err`}>{lineErr?.hold}</FieldError>
                    </div>
                  ) : null}

                  {isLotTracked ? (
                    <div className="grid gap-3 border-t border-border/60 pt-2.5 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`po-lot-code-${line._id}`} className="text-xs font-medium text-foreground">
                          Lot code (required for accepted units)
                        </Label>
                        <Input
                          id={`po-lot-code-${line._id}`}
                          value={lotCodeByKey[line._id] ?? ""}
                          placeholder="e.g. LOT-2026-11"
                          aria-invalid={lineErr?.lotCode ? true : undefined}
                          aria-describedby={lineErr?.lotCode ? `po-lot-code-${line._id}-err` : undefined}
                          onChange={(event) => onLotCodeChange(line._id, event.target.value)}
                        />
                        <FieldError id={`po-lot-code-${line._id}-err`}>{lineErr?.lotCode}</FieldError>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`po-lot-exp-${line._id}`} className="text-xs font-medium text-foreground">
                          Lot expiry date (required)
                        </Label>
                        <DatePicker
                          id={`po-lot-exp-${line._id}`}
                          value={lotExpiryByKey[line._id] ?? ""}
                          onValueChange={(val) => onLotExpiryChange(line._id, val)}
                          clearable
                          placeholder="Select expiry date"
                          aria-invalid={lineErr?.lotExpiry ? true : undefined}
                          aria-describedby={lineErr?.lotExpiry ? `po-lot-exp-${line._id}-err` : undefined}
                        />
                        <FieldError id={`po-lot-exp-${line._id}-err`}>{lineErr?.lotExpiry}</FieldError>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Direct (without-PO) receiving section: supplier, reason, line editor, lots, and proactive open-PO warning. */
export function ReceiveDirectSection({
  branchId,
  canAddSupplier,
  supplier,
  reason,
  directLines,
  directLineErrors,
  lotCodeByKey,
  lotExpiryByKey,
  trackedVariantIds,
  openOrderMatches,
  confirmBypassOpenOrders,
  onSupplierChange,
  onReasonChange,
  onDirectLinesChange,
  onOpenDirectPicker,
  onLotCodeChange,
  onLotExpiryChange,
  onSwitchToOrder,
  onConfirmBypassChange,
}: {
  branchId: Id<"branches">;
  canAddSupplier: boolean;
  supplier: { id: Id<"suppliers">; name: string } | null;
  reason: string;
  directLines: readonly StockLineDraft[];
  directLineErrors: StockLineFieldErrors;
  lotCodeByKey: Record<string, string>;
  lotExpiryByKey: Record<string, string>;
  trackedVariantIds: ReadonlySet<Id<"productVariants">>;
  openOrderMatches: readonly MatchedOpenOrder[];
  confirmBypassOpenOrders: boolean;
  onSupplierChange: (next: { id: Id<"suppliers">; name: string } | null) => void;
  onReasonChange: (val: string) => void;
  onDirectLinesChange: (next: StockLineDraft[]) => void;
  onOpenDirectPicker: () => void;
  onLotCodeChange: (variantId: string, val: string) => void;
  onLotExpiryChange: (variantId: string, val: string) => void;
  onSwitchToOrder: (orderId: Id<"purchaseOrders">) => void;
  onConfirmBypassChange: (checked: boolean) => void;
}) {
  return (
    <div className="grid gap-4">
      <div className="grid gap-1.5">
        <Label>Supplier (optional)</Label>
        <SupplierPickerField
          branchId={branchId}
          value={supplier?.id ?? null}
          selectedName={supplier?.name}
          canCreate={canAddSupplier}
          onChange={onSupplierChange}
        />
      </div>

      <ReasonField
        id="direct-recv-reason"
        label="Reason for receiving without PO"
        value={reason}
        onChange={onReasonChange}
        chips={DIRECT_RECEIPT_REASON_CHIPS}
      />

      <StockLineEditor
        lines={[...directLines]}
        onChange={onDirectLinesChange}
        showUnitCost
        quantityLabel="Accepted quantity"
        lineErrors={directLineErrors}
        onAddClick={onOpenDirectPicker}
        addLabel="Add delivered item"
        idPrefix="direct-line"
        renderLineBadge={(line) =>
          trackedVariantIds.has(line.variantId) ? <StatusBadge tone="info" label="Lot-tracked" /> : null
        }
        renderLineExtra={(line) => {
          if (!trackedVariantIds.has(line.variantId)) return null;
          const err = directLineErrors[line.variantId];
          const codeId = `direct-lot-code-${line.variantId}`;
          const expId = `direct-lot-exp-${line.variantId}`;
          return (
            <div className="grid gap-3 border-t border-border/60 pt-2.5 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor={codeId} className="text-xs font-medium text-foreground">
                  Lot code (required)
                </Label>
                <Input
                  id={codeId}
                  value={lotCodeByKey[line.variantId] ?? ""}
                  placeholder="e.g. LOT-2026-11"
                  aria-invalid={err?.lotCode ? true : undefined}
                  aria-describedby={err?.lotCode ? `${codeId}-err` : undefined}
                  onChange={(event) => onLotCodeChange(line.variantId, event.target.value)}
                />
                <FieldError id={`${codeId}-err`}>{err?.lotCode}</FieldError>
              </div>
              <div className="grid gap-1">
                <Label htmlFor={expId} className="text-xs font-medium text-foreground">
                  Lot expiry date (required)
                </Label>
                <DatePicker
                  id={expId}
                  value={lotExpiryByKey[line.variantId] ?? ""}
                  onValueChange={(val) => onLotExpiryChange(line.variantId, val)}
                  clearable
                  placeholder="Select expiry date"
                  aria-invalid={err?.lotExpiry ? true : undefined}
                  aria-describedby={err?.lotExpiry ? `${expId}-err` : undefined}
                />
                <FieldError id={`${expId}-err`}>{err?.lotExpiry}</FieldError>
              </div>
            </div>
          );
        }}
      />

      {openOrderMatches.length > 0 ? (
        <Callout tone="warning" role="alert" title="Matching open orders exist">
          <p>Open purchase orders already expect these items. Receive against an open order or explicitly confirm bypass:</p>
          <ul className="mt-2 grid gap-1.5">
            {openOrderMatches.map((match) => (
              <li key={match.orderId} className="flex flex-wrap items-center justify-between gap-2 rounded bg-background/60 px-2.5 py-1.5 text-xs">
                <span>
                  <strong className="font-mono">{match.reference ?? match.orderId}</strong>
                  {match.supplierName ? ` · ${match.supplierName}` : ""}
                  {match.dueUnits !== undefined ? ` (${match.dueUnits} due)` : ""}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    onClick={() => onSwitchToOrder(match.orderId)}
                  >
                    Receive against {match.reference ?? "order"}
                  </Button>
                  <ButtonLink
                    href={`/admin/stock/purchasing/orders/${match.orderId}`}
                    variant="link"
                    size="sm"
                    className="h-auto p-0 text-xs"
                  >
                    Inspect
                    <ExternalLink aria-hidden className="size-3" />
                  </ButtonLink>
                </div>
              </li>
            ))}
          </ul>
          <label className="mt-2.5 flex items-start gap-2 text-xs font-medium text-foreground">
            <input
              id="recv-bypass-open-orders"
              type="checkbox"
              checked={confirmBypassOpenOrders}
              onChange={(event) => onConfirmBypassChange(event.target.checked)}
              className="mt-0.5 size-4 accent-foreground"
            />
            <span>This delivery is separate from those open orders. Confirm bypass and post direct receipt.</span>
          </label>
        </Callout>
      ) : null}
    </div>
  );
}

/** Shared delivery reference, note, and duplicate-delivery confirmation fields. */
export function ReceiveDeliveryMetaSection({
  deliveryReference,
  note,
  duplicateConflict,
  duplicateReason,
  onDeliveryReferenceChange,
  onNoteChange,
  onDuplicateReasonChange,
}: {
  deliveryReference: string;
  note: string;
  duplicateConflict: { receiptId: Id<"supplierReceipts">; reference: string } | null;
  duplicateReason: string;
  onDeliveryReferenceChange: (val: string) => void;
  onNoteChange: (val: string) => void;
  onDuplicateReasonChange: (val: string) => void;
}) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="recv-del-ref">Delivery reference / invoice #</Label>
          <Input
            id="recv-del-ref"
            value={deliveryReference}
            onChange={(event) => onDeliveryReferenceChange(event.target.value)}
            placeholder="e.g. INV-2026-0042"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="recv-note">Note (optional)</Label>
          <Input
            id="recv-note"
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            placeholder="Condition or driver notes"
          />
        </div>
      </div>

      {duplicateConflict ? (
        <Callout tone="warning" title={`Duplicate delivery reference (${duplicateConflict.reference})`}>
          <p>
            A prior receipt already used this delivery reference.{" "}
            <ButtonLink
              href={`/admin/stock/purchasing/receipts/${duplicateConflict.receiptId}`}
              variant="link"
              size="sm"
              className="h-auto p-0"
            >
              Inspect {duplicateConflict.reference}
            </ButtonLink>
          </p>
          <div className="mt-2 grid gap-1.5">
            <Label htmlFor="dup-reason">Confirm separate delivery reason</Label>
            <Input
              id="dup-reason"
              value={duplicateReason}
              onChange={(event) => onDuplicateReasonChange(event.target.value)}
              placeholder="Why this separate delivery shares the same reference"
            />
          </div>
        </Callout>
      ) : null}
    </>
  );
}

/** Shared Held-for-buyer section rendered at the bottom of ReceiveDeliverySheet. */
export function ReceiveHeldGoodsSection({
  heldLines,
  onAddClick,
  onRemove,
  onChangeQuantity,
  onChangeReason,
}: {
  heldLines: readonly HeldLineDraft[];
  onAddClick: () => void;
  onRemove: (index: number) => void;
  onChangeQuantity: (index: number, value: string) => void;
  onChangeReason: (index: number, value: string) => void;
}) {
  return (
    <section aria-label="Held for buyer" className="grid gap-2.5 rounded-lg border border-border bg-muted/20 p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Held for buyer (optional)</h3>
          <p className="text-xs text-muted-foreground">
            Record excess or substitute items without adding them to On hand until the buyer decides.
          </p>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onAddClick}>
          <Plus aria-hidden className="size-4" />
          Add held goods
        </Button>
      </div>
      {heldLines.length > 0 ? (
        <ul className="grid gap-2.5">
          {heldLines.map((hold, idx) => (
            <li key={hold.key} className="grid gap-2 rounded-md border border-border bg-card p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-medium text-foreground">
                  {hold.productName} · {hold.variantLabel}
                </span>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove held ${hold.productName}`}
                  onClick={() => onRemove(idx)}
                  className="size-8"
                >
                  <Trash2 aria-hidden className="size-3.5" />
                </Button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <NumberField
                  id={`held-qty-${hold.key}`}
                  aria-label={`Held quantity for ${hold.productName}`}
                  value={hold.quantityText}
                  placeholder="Qty"
                  onChange={(event) => onChangeQuantity(idx, event.target.value)}
                />
                <Input
                  id={`held-reason-${hold.key}`}
                  aria-label={`Hold reason for ${hold.productName}`}
                  value={hold.reason}
                  placeholder="e.g. Excess shipment or substitute SKU"
                  onChange={(event) => onChangeReason(idx, event.target.value)}
                />
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
