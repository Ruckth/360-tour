"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Callout,
  EditorSheet,
  FieldError,
  NumberField,
  SheetForm,
} from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { resortMidnight } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import {
  createOperationKey,
  parseOptionalSatang,
  parseStockError,
  parseWholeQuantity,
  STOCK_MAX_LINES,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

type BalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];

type OpeningLineDraft = {
  qtyText: string;
  unitCostText: string;
  lotCode: string;
  lotExpiry: string;
};

type OpeningLineError = {
  qty?: string;
  unitCost?: string;
  lotCode?: string;
  lotExpiry?: string;
};

export function OpeningStockSheet({
  branchId,
  branchName,
  items,
  liveItems,
  item,
  liveItem,
  scopeLabel,
  onRedirectToCount,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName: string;
  items?: BalanceRow[];
  liveItems?: readonly BalanceRow[];
  item?: BalanceRow;
  liveItem?: BalanceRow;
  scopeLabel?: string;
  onRedirectToCount?: (row: BalanceRow) => void;
  onClose: () => void;
  onSuccess: () => void;
}) {
  // Freeze ordered opening targets at launch (capped at STOCK_MAX_LINES)
  const [initialItems] = useState<BalanceRow[]>(() => {
    const source = items && items.length > 0 ? items : item ? [item] : [];
    return source.slice(0, STOCK_MAX_LINES);
  });
  const [removedIds, setRemovedIds] = useState<Set<string>>(() => new Set());
  const targetItems = useMemo(
    () => initialItems.filter((row) => !removedIds.has(row.variantId)),
    [initialItems, removedIds],
  );

  const liveMap = useMemo(() => {
    const map = new Map<string, BalanceRow>();
    if (liveItem) map.set(liveItem.variantId, liveItem);
    for (const row of liveItems ?? []) map.set(row.variantId, row);
    return map;
  }, [liveItem, liveItems]);

  const postOperation = useMutation(api.commerce.stock.postOperation);
  const [reviewedByVariant, setReviewedByVariant] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialItems.map((row) => [row.variantId, row.revision])),
  );
  const [drafts, setDrafts] = useState<Record<string, OpeningLineDraft>>(() =>
    Object.fromEntries(
      initialItems.map((row) => [
        row.variantId,
        { qtyText: "", unitCostText: "", lotCode: "", lotExpiry: "" },
      ]),
    ),
  );
  const [note, setNote] = useState("");
  const [lineErrors, setLineErrors] = useState<Record<string, OpeningLineError>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operationKey, setOperationKey] = useState(() => createOperationKey("stock-open"));

  const dirty =
    note.trim() !== "" ||
    targetItems.some((row) => {
      const d = drafts[row.variantId];
      return Boolean(
        d &&
          (d.qtyText.trim() !== "" ||
            d.unitCostText.trim() !== "" ||
            d.lotCode.trim() !== "" ||
            d.lotExpiry !== ""),
      );
    });
  const { requestClose } = useStockDirtyGuard(dirty, onClose, saving);

  // Items that gained a balance elsewhere cannot be posted as opening stock (S20 recovery)
  const ineligibleItems = useMemo(() => {
    return targetItems.filter((row) => liveMap.get(row.variantId)?.hasBalance === true);
  }, [targetItems, liveMap]);

  const staleItems = useMemo(() => {
    return targetItems.filter((row) => {
      const live = liveMap.get(row.variantId);
      if (!live || live.hasBalance) return false;
      const reviewed = reviewedByVariant[row.variantId] ?? row.revision;
      return live.revision !== reviewed;
    });
  }, [targetItems, liveMap, reviewedByVariant]);

  if (targetItems.length === 0) return null;

  const isBulk = initialItems.length > 1;
  const singleItem = targetItems[0];
  const singleDraft = drafts[singleItem.variantId] ?? {
    qtyText: "",
    unitCostText: "",
    lotCode: "",
    lotExpiry: "",
  };
  const singleLive = liveMap.get(singleItem.variantId);
  const singleLotTracked = singleLive?.lotTracked ?? singleItem.lotTracked;
  const singleIneligible = singleLive?.hasBalance === true;
  const singleParsedQty = singleDraft.qtyText.trim()
    ? parseWholeQuantity(singleDraft.qtyText, { allowZero: false, label: "Opening quantity" })
    : null;
  const singlePreviewAfter = singleParsedQty?.ok ? singleParsedQty.value : undefined;

  function patchDraft(variantId: string, patch: Partial<OpeningLineDraft>, clearErrorKey?: keyof OpeningLineError) {
    setDrafts((current) => ({
      ...current,
      [variantId]: {
        ...(current[variantId] ?? { qtyText: "", unitCostText: "", lotCode: "", lotExpiry: "" }),
        ...patch,
      },
    }));
    if (clearErrorKey) {
      setLineErrors((current) => {
        const prev = current[variantId];
        if (!prev?.[clearErrorKey]) return current;
        return { ...current, [variantId]: { ...prev, [clearErrorKey]: undefined } };
      });
    }
    setOperationKey(createOperationKey("stock-open"));
  }

  function removeIneligibleRows(rowsToRemove: readonly BalanceRow[]) {
    setRemovedIds((current) => {
      const next = new Set(current);
      for (const row of rowsToRemove) next.add(row.variantId);
      return next;
    });
    setError("");
    setOperationKey(createOperationKey("stock-open"));
  }

  function acceptUpdatedStates() {
    setReviewedByVariant((current) => {
      const next = { ...current };
      for (const row of staleItems) {
        const live = liveMap.get(row.variantId);
        if (live) next[row.variantId] = live.revision;
      }
      return next;
    });
    setError("");
    setOperationKey(createOperationKey("stock-open"));
  }

  function handleBulkQtyKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const nextRow = targetItems[index + 1];
    if (!nextRow) return;
    event.preventDefault();
    document.getElementById(`opening-qty-${nextRow.variantId}`)?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (ineligibleItems.length > 0) {
      setError(
        ineligibleItems.length === 1
          ? `${ineligibleItems[0].productName} already has a balance. Remove it from this opening operation or switch to Count.`
          : `${ineligibleItems.length} items already have a balance. Remove them above before posting opening stock.`,
      );
      return;
    }

    const nextErrors: Record<string, OpeningLineError> = {};
    let firstInvalidId: string | undefined;

    const payloadLines: {
      variantId: Id<"productVariants">;
      quantity: number;
      expectedRevision: number;
      unitCost?: number;
      lotReceipt?: { code: string; expiresAt: number };
    }[] = [];

    for (const row of targetItems) {
      const draft = drafts[row.variantId] ?? { qtyText: "", unitCostText: "", lotCode: "", lotExpiry: "" };
      const live = liveMap.get(row.variantId);
      const isLotTracked = live?.lotTracked ?? row.lotTracked;
      const qtyId = isBulk ? `opening-qty-${row.variantId}` : "opening-qty";
      const costId = isBulk ? `opening-cost-${row.variantId}` : "opening-cost";
      const lotId = isBulk ? `opening-lot-${row.variantId}` : "opening-lot";
      const expiryId = isBulk ? `opening-expiry-${row.variantId}` : "opening-expiry";
      const rowErr: OpeningLineError = {};

      const parsedQty = parseWholeQuantity(draft.qtyText, { allowZero: false, label: "Opening quantity" });
      if (!parsedQty.ok || !parsedQty.value) {
        rowErr.qty = parsedQty.ok ? "Enter an opening quantity." : parsedQty.error;
        firstInvalidId ??= qtyId;
      }

      const parsedCost = parseOptionalSatang(draft.unitCostText);
      if (!parsedCost.ok) {
        rowErr.unitCost = parsedCost.error;
        firstInvalidId ??= costId;
      }

      if (isLotTracked) {
        if (!draft.lotCode.trim()) {
          rowErr.lotCode = "Enter a lot code.";
          firstInvalidId ??= lotId;
        }
        if (!draft.lotExpiry) {
          rowErr.lotExpiry = "Select an expiry date.";
          firstInvalidId ??= expiryId;
        }
      }

      if (rowErr.qty || rowErr.unitCost || rowErr.lotCode || rowErr.lotExpiry) {
        nextErrors[row.variantId] = rowErr;
        continue;
      }

      if (parsedQty.ok && parsedQty.value && parsedCost.ok) {
        payloadLines.push({
          variantId: row.variantId,
          quantity: parsedQty.value,
          expectedRevision: reviewedByVariant[row.variantId] ?? row.revision,
          ...(parsedCost.value !== undefined ? { unitCost: parsedCost.value } : {}),
          ...(isLotTracked && draft.lotCode.trim() && draft.lotExpiry
            ? { lotReceipt: { code: draft.lotCode.trim(), expiresAt: resortMidnight(draft.lotExpiry) } }
            : {}),
        });
      }
    }

    setLineErrors(nextErrors);
    if (firstInvalidId) {
      setError("Fix the highlighted fields before posting.");
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (staleItems.length > 0) {
      setError("Item balance changed while the form was open. Review the latest state before posting.");
      return;
    }

    setSaving(true);
    try {
      await postOperation({
        branchId,
        kind: "opening",
        operationKey,
        reason: note.trim() || "Opening stock",
        reasonCode: "opening_stock",
        lines: payloadLines,
      });
      onSuccess();
    } catch (cause) {
      setError(parseStockError(cause, "Could not record opening stock.").message);
      setOperationKey(createOperationKey("stock-open"));
      setSaving(false);
    }
  }

  // Single item opens as a centered dialog on desktop and a bottom sheet on mobile (S19)
  if (!isBulk) {
    const singleErr = lineErrors[singleItem.variantId] ?? {};
    return (
      <Dialog open onOpenChange={(open) => !open && requestClose()}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Opening stock · {branchName}</DialogTitle>
            <DialogDescription className="flex flex-wrap items-center gap-2">
              <span>
                {singleItem.productName} · {singleItem.label}
                {singleItem.sku ? ` (${singleItem.sku})` : ""}
              </span>
              {singleLotTracked ? <StatusBadge tone="info" label="Lot-tracked" /> : null}
            </DialogDescription>
          </DialogHeader>

          <form noValidate onSubmit={handleSubmit} className="grid gap-4">
            {singleIneligible && singleLive ? (
              <Callout
                tone="warning"
                role="alert"
                title="Item already stocked elsewhere"
                action={
                  onRedirectToCount && !singleLive.lotTracked ? (
                    <Button type="button" size="sm" variant="outline" onClick={() => onRedirectToCount(singleLive)}>
                      Switch to Count
                    </Button>
                  ) : undefined
                }
              >
                {singleItem.productName} now has <strong>{singleLive.onHand}</strong> on hand at {branchName}. Opening stock can only be recorded once; use Count or Adjust instead.
              </Callout>
            ) : staleItems.length > 0 ? (
              <StockStaleBanner
                title="Item balance changed"
                description="Stock balance was updated elsewhere. Review the latest state before posting opening stock."
                actionLabel="Review updated state"
                onReview={acceptUpdatedStates}
              />
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
              <span className="text-muted-foreground">
                Never stocked at {branchName}
              </span>
              <span className="font-mono font-semibold tabular-nums text-foreground">
                0 → {singlePreviewAfter !== undefined ? singlePreviewAfter.toLocaleString("en-US") : "—"}
              </span>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="opening-qty">Opening quantity</Label>
                <NumberField
                  id="opening-qty"
                  value={singleDraft.qtyText}
                  disabled={singleIneligible}
                  aria-invalid={singleErr.qty ? true : undefined}
                  aria-describedby={singleErr.qty ? "opening-qty-error" : undefined}
                  onChange={(event) => patchDraft(singleItem.variantId, { qtyText: event.target.value }, "qty")}
                  placeholder="e.g. 16"
                />
                <FieldError id="opening-qty-error">{singleErr.qty}</FieldError>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="opening-cost">Reference unit cost (optional)</Label>
                <NumberField
                  id="opening-cost"
                  prefix="฿"
                  inputMode="decimal"
                  value={singleDraft.unitCostText}
                  disabled={singleIneligible}
                  aria-invalid={singleErr.unitCost ? true : undefined}
                  aria-describedby={singleErr.unitCost ? "opening-cost-error" : "opening-cost-hint"}
                  onChange={(event) => patchDraft(singleItem.variantId, { unitCostText: event.target.value }, "unitCost")}
                  placeholder="0.00"
                />
                <p id="opening-cost-hint" className="text-[11px] text-muted-foreground">
                  Saved as a reference for buyers & leads.
                </p>
                <FieldError id="opening-cost-error">{singleErr.unitCost}</FieldError>
              </div>
            </div>

            {singleLotTracked ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-1.5">
                  <Label htmlFor="opening-lot">Lot code (required)</Label>
                  <Input
                    id="opening-lot"
                    value={singleDraft.lotCode}
                    disabled={singleIneligible}
                    aria-invalid={singleErr.lotCode ? true : undefined}
                    aria-describedby={singleErr.lotCode ? "opening-lot-error" : undefined}
                    onChange={(event) => patchDraft(singleItem.variantId, { lotCode: event.target.value }, "lotCode")}
                    placeholder="e.g. LOT-2026-11"
                  />
                  <FieldError id="opening-lot-error">{singleErr.lotCode}</FieldError>
                </div>
                <div className="grid gap-1.5">
                  <Label htmlFor="opening-expiry">Lot expiry date (required)</Label>
                  <DatePicker
                    id="opening-expiry"
                    value={singleDraft.lotExpiry}
                    aria-invalid={singleErr.lotExpiry ? true : undefined}
                    aria-describedby={singleErr.lotExpiry ? "opening-expiry-error" : undefined}
                    onValueChange={(val) => patchDraft(singleItem.variantId, { lotExpiry: val }, "lotExpiry")}
                    clearable
                    placeholder="Select expiry date"
                  />
                  <FieldError id="opening-expiry-error">{singleErr.lotExpiry}</FieldError>
                </div>
              </div>
            ) : null}

            <div className="grid gap-1.5">
              <Label htmlFor="opening-note">Note (optional)</Label>
              <Input
                id="opening-note"
                value={note}
                disabled={singleIneligible}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Initial branch count"
              />
            </div>

            {error ? (
              <p role="alert" className="text-sm font-medium text-destructive">
                {error}
              </p>
            ) : null}

            <DialogFooter>
              <Button type="button" variant="outline" onClick={requestClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || singleIneligible}>
                {saving ? <Spinner label="Saving" className="text-current" /> : null}
                Post opening stock
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    );
  }

  // Bulk opening stock mode (S20)
  const filledCount = targetItems.filter((row) => {
    const parsed = parseWholeQuantity(drafts[row.variantId]?.qtyText ?? "", { allowZero: false });
    return parsed.ok && Boolean(parsed.value);
  }).length;
  const remainingEligibleCount = targetItems.length - ineligibleItems.length;

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Record opening stock ({targetItems.length}) · {branchName}</SheetTitle>
          <SheetDescription>
            {scopeLabel ? `${scopeLabel} · ` : ""}
            Enter initial shelf quantities for {targetItems.length} never-stocked items. Posts as one opening operation.
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        compact
        submitLabel={`Post opening stock (${targetItems.length})`}
        footerSummary={
          <span className="tabular-nums">
            {filledCount} of {targetItems.length} entered
          </span>
        }
      >
        {ineligibleItems.length > 0 ? (
          <Callout
            tone="warning"
            role="alert"
            title="Some items were stocked elsewhere"
            action={
              remainingEligibleCount > 0 ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => removeIneligibleRows(ineligibleItems)}
                >
                  Remove stocked {ineligibleItems.length === 1 ? "item" : `items (${ineligibleItems.length})`}
                </Button>
              ) : undefined
            }
          >
            <p className="text-xs">
              {ineligibleItems
                .map((row) => {
                  const live = liveMap.get(row.variantId);
                  return `${row.productName} (now ${live?.onHand ?? 0} on hand)`;
                })
                .join(", ")}{" "}
              can no longer be posted as opening stock. Removing {ineligibleItems.length === 1 ? "it" : "them"} preserves your other entered drafts.
            </p>
          </Callout>
        ) : null}

        {staleItems.length > 0 ? (
          <StockStaleBanner
            title="Item balances changed"
            description={`${staleItems.map((row) => row.productName).join(", ")} changed elsewhere. Review before posting.`}
            actionLabel="Review updated state"
            onReview={acceptUpdatedStates}
          />
        ) : null}

        <div className="overflow-hidden rounded-lg border border-border">
          <table role="table" className="block w-full text-left text-sm sm:table">
            <thead className="hidden border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground sm:table-header-group">
              <tr>
                <th scope="col" className="px-3 py-2">Item</th>
                <th scope="col" className="w-28 px-2 py-2">Opening qty</th>
                <th scope="col" className="w-32 px-2 py-2">Ref. unit cost</th>
                <th scope="col" className="w-28 px-3 py-2 text-right">Preview</th>
              </tr>
            </thead>
            <tbody role="rowgroup" className="block divide-y divide-border sm:table-row-group">
              {targetItems.map((row, idx) => {
                const draft = drafts[row.variantId] ?? { qtyText: "", unitCostText: "", lotCode: "", lotExpiry: "" };
                const rowErr = lineErrors[row.variantId] ?? {};
                const live = liveMap.get(row.variantId);
                const isLotTracked = live?.lotTracked ?? row.lotTracked;
                const isIneligible = live?.hasBalance === true;
                const parsedQty = draft.qtyText.trim()
                  ? parseWholeQuantity(draft.qtyText, { allowZero: false, label: "Opening quantity" })
                  : null;
                const qtyVal = parsedQty?.ok ? parsedQty.value : undefined;
                return (
                  <tr
                    key={row.variantId}
                    role="row"
                    className={cn(
                      "grid grid-cols-2 gap-x-3 gap-y-2.5 p-3 sm:table-row sm:p-0",
                      isIneligible
                        ? "bg-amber-500/10"
                        : (rowErr.qty || rowErr.unitCost || rowErr.lotCode || rowErr.lotExpiry) && "bg-destructive/5",
                    )}
                  >
                    <td role="cell" className="col-span-full min-w-0 align-top sm:px-3 sm:py-2">
                      <span className="block wrap-anywhere font-medium leading-tight text-foreground">{row.productName}</span>
                      <span className="mt-0.5 block wrap-anywhere text-xs text-muted-foreground">
                        {row.label}
                        {row.sku ? ` · ${row.sku}` : ""}
                      </span>
                      {isIneligible && live ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <StatusBadge tone="warning" label={`Now ${live.onHand} on hand`} />
                          {targetItems.length > 1 ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => removeIneligibleRows([row])}
                            >
                              Remove line
                            </Button>
                          ) : null}
                          {onRedirectToCount && !live.lotTracked ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="h-7 px-2 text-xs"
                              onClick={() => onRedirectToCount(live)}
                            >
                              Count instead
                            </Button>
                          ) : null}
                        </div>
                      ) : null}
                      {isLotTracked && !isIneligible ? (
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          <div className="grid gap-1">
                            <Label htmlFor={`opening-lot-${row.variantId}`} className="text-[11px]">Lot code</Label>
                            <Input
                              id={`opening-lot-${row.variantId}`}
                              value={draft.lotCode}
                              onChange={(event) => patchDraft(row.variantId, { lotCode: event.target.value }, "lotCode")}
                              placeholder="LOT-001"
                              className="h-8 text-xs"
                            />
                            <FieldError id={`opening-lot-err-${row.variantId}`}>{rowErr.lotCode}</FieldError>
                          </div>
                          <div className="grid gap-1">
                            <Label htmlFor={`opening-expiry-${row.variantId}`} className="text-[11px]">Expiry</Label>
                            <DatePicker
                              id={`opening-expiry-${row.variantId}`}
                              value={draft.lotExpiry}
                              onValueChange={(val) => patchDraft(row.variantId, { lotExpiry: val }, "lotExpiry")}
                              clearable
                              placeholder="Expiry date"
                            />
                            <FieldError id={`opening-expiry-err-${row.variantId}`}>{rowErr.lotExpiry}</FieldError>
                          </div>
                        </div>
                      ) : null}
                    </td>
                    <td role="cell" className="min-w-0 align-top sm:px-2 sm:py-2">
                      <Label htmlFor={`opening-qty-${row.variantId}`} className="mb-1 block text-xs sm:hidden">Opening qty</Label>
                      <NumberField
                        id={`opening-qty-${row.variantId}`}
                        aria-label={`Opening quantity for ${row.productName} ${row.label}`}
                        value={draft.qtyText}
                        disabled={isIneligible}
                        onKeyDown={(event) => handleBulkQtyKeyDown(idx, event)}
                        aria-invalid={rowErr.qty ? true : undefined}
                        onChange={(event) => patchDraft(row.variantId, { qtyText: event.target.value }, "qty")}
                        placeholder="0"
                        className="h-11 text-base sm:h-8 sm:text-sm"
                      />
                      <FieldError id={`opening-qty-err-${row.variantId}`}>{rowErr.qty}</FieldError>
                    </td>
                    <td role="cell" className="min-w-0 align-top sm:px-2 sm:py-2">
                      <Label htmlFor={`opening-cost-${row.variantId}`} className="mb-1 block text-xs sm:hidden">Ref. unit cost</Label>
                      <NumberField
                        id={`opening-cost-${row.variantId}`}
                        aria-label={`Reference unit cost for ${row.productName} ${row.label}`}
                        prefix="฿"
                        inputMode="decimal"
                        value={draft.unitCostText}
                        disabled={isIneligible}
                        aria-invalid={rowErr.unitCost ? true : undefined}
                        onChange={(event) => patchDraft(row.variantId, { unitCostText: event.target.value }, "unitCost")}
                        placeholder="0.00"
                        className="h-11 text-base sm:h-8 sm:text-sm"
                      />
                      <FieldError id={`opening-cost-err-${row.variantId}`}>{rowErr.unitCost}</FieldError>
                    </td>
                    <td role="cell" className="col-span-full text-right align-top font-mono text-xs tabular-nums text-muted-foreground sm:px-3 sm:py-2">
                      <span className="mr-2 font-sans sm:hidden">Preview</span>
                      {isIneligible ? "Blocked" : <>0 → <strong className="text-foreground">{qtyVal !== undefined ? qtyVal : "—"}</strong></>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="opening-bulk-note">Note (optional)</Label>
          <Input
            id="opening-bulk-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Initial branch stock setup"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}
