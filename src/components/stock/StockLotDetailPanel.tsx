"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows, STACKED_TABLE } from "@/components/admin/admin-bulk";
import { Callout, ChoiceGroup, NumberField } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { resortMidnight } from "@/lib/staff-bookings";
import { staffDate } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { createOperationKey, parseStockError, parseWholeQuantity } from "./stock-format";
import { StockStaleBanner } from "./StockFormGuard";
import type { BalancePickerRow } from "./StockVariantPicker";

export function LotDetailPanel({
  branchId,
  branchName,
  variant,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName?: string;
  variant: BalancePickerRow;
  onSuccess: (msg: string) => void;
}) {
  const balances = useQuery(api.commerce.stockExpansion.lotBalances, { branchId, variantId: variant.variantId });
  const enableTracking = useMutation(api.commerce.stockExpansion.enableLotTracking);
  const adjustLot = useMutation(api.commerce.stockExpansion.adjustLot);
  const countLot = useMutation(api.commerce.stockExpansion.countLot);

  const [mode, setMode] = useState<"add" | "remove" | "count">("add");
  const [lotCode, setLotCode] = useState("");
  const [lotExpiry, setLotExpiry] = useState("");
  const [selectedLotId, setSelectedLotId] = useState<string>("");
  // Pin observed lot on-hand balance when lot is selected so live changes require explicit review
  const [reviewedLot, setReviewedLot] = useState<{ lotId: Id<"stockLots">; onHand: number } | null>(null);
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [requestId, setRequestId] = useState(() => createOperationKey("lot-op"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const isLotDirty = qtyText.trim() !== "" || reason.trim() !== "" || lotCode.trim() !== "" || lotExpiry !== "";
  useUnsavedGuard(isLotDirty);

  if (balances === undefined) return <SkeletonRows label="Loading lot balances" rows={3} />;

  const liveSelectedLot = selectedLotId ? balances.lots.find((row) => row.lotId === selectedLotId) : undefined;
  const isLotCountStale = Boolean(
    mode === "count" &&
      reviewedLot &&
      liveSelectedLot &&
      liveSelectedLot.lotId === reviewedLot.lotId &&
      liveSelectedLot.onHand !== reviewedLot.onHand,
  );

  function selectLot(nextLotId: string) {
    setSelectedLotId(nextLotId);
    const match = balances?.lots.find((row) => row.lotId === nextLotId);
    setReviewedLot(match ? { lotId: match.lotId, onHand: match.onHand } : null);
    setError("");
    setRequestId(createOperationKey("lot-op"));
  }

  async function handleEnable() {
    setError("");
    setBusy(true);
    try {
      await enableTracking({ branchId, variantId: variant.variantId });
      onSuccess("Lot tracking enabled for this item.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not enable lot tracking.").message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAdjustLot(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsedQty = parseWholeQuantity(qtyText, { allowZero: mode === "count" });
    if (!parsedQty.ok || parsedQty.value === undefined) {
      setError(parsedQty.ok ? "Enter a quantity." : parsedQty.error);
      document.getElementById("lot-qty")?.focus();
      return;
    }
    if (!reason.trim()) {
      setError(mode === "count" ? "Enter a reason for the lot count." : "Enter a reason for the lot adjustment.");
      document.getElementById("lot-reason")?.focus();
      return;
    }
    if (mode === "add" && (!lotCode.trim() || !lotExpiry)) {
      setError("Enter both lot code and expiry date.");
      document.getElementById(lotCode.trim() ? "lot-exp" : "lot-code")?.focus();
      return;
    }
    if ((mode === "remove" || mode === "count") && !selectedLotId) {
      setError("Choose the lot first.");
      document.getElementById("lot-select")?.focus();
      return;
    }
    if (isLotCountStale) {
      setError("Lot balance changed since you selected it. Review the updated balance above before posting.");
      return;
    }

    setBusy(true);
    try {
      if (mode === "count") {
        if (!reviewedLot || reviewedLot.lotId !== selectedLotId) {
          setError("Selected lot is no longer listed. Pick a lot and try again.");
          setBusy(false);
          return;
        }
        await countLot({
          branchId,
          variantId: variant.variantId,
          lotId: reviewedLot.lotId,
          expectedOnHand: reviewedLot.onHand,
          quantity: parsedQty.value,
          requestId,
          reason: reason.trim(),
        });
        setQtyText("");
        setReason("");
        setReviewedLot(liveSelectedLot ? { lotId: liveSelectedLot.lotId, onHand: parsedQty.value } : null);
        setRequestId(createOperationKey("lot-op"));
        onSuccess("Verified lot count posted.");
        return;
      }
      await adjustLot({
        branchId,
        variantId: variant.variantId,
        requestId,
        reason: reason.trim(),
        quantity: parsedQty.value,
        change:
          mode === "add"
            ? { kind: "add", lot: { code: lotCode.trim(), expiresAt: resortMidnight(lotExpiry) } }
            : { kind: "remove", lotId: selectedLotId as Id<"stockLots"> },
      });
      setQtyText("");
      setReason("");
      setRequestId(createOperationKey("lot-op"));
      onSuccess("Lot adjustment posted.");
    } catch (cause) {
      setError(parseStockError(cause, "Could not post lot update.").message);
      setRequestId(createOperationKey("lot-op"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      {error ? (
        <Callout tone="danger" role="alert">
          {error}
        </Callout>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-3">
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">On hand</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums">{balances.onHand}</p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Held / reserved</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-amber-700 dark:text-amber-300">
            {balances.held}
          </p>
        </Card>
        <Card className="p-4">
          <p className="text-xs text-muted-foreground">Sellable now</p>
          <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-emerald-700 dark:text-emerald-300">
            {balances.sellable}
          </p>
        </Card>
      </div>

      {!balances.tracking ? (
        <Callout
          tone="info"
          title="Lot tracking is not enabled for this variant"
          action={
            balances.canEnable ? (
              <Button type="button" size="sm" disabled={busy} onClick={() => void handleEnable()}>
                Enable lot tracking
              </Button>
            ) : null
          }
        >
          Enable lot tracking before an item has stock or movement history to track batch codes and expiry dates (FEFO).
        </Callout>
      ) : (
        <>
          <Card className="overflow-hidden">
            {balances.lots.length === 0 ? (
              <EmptyState>No active lots in stock at this branch yet.</EmptyState>
            ) : (
              <table className={STACKED_TABLE.table}>
                <thead className={STACKED_TABLE.head}>
                  <tr>
                    <th scope="col" className={STACKED_TABLE.th}>Lot code</th>
                    <th scope="col" className={STACKED_TABLE.th}>Expires</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>On hand</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Sellable</th>
                  </tr>
                </thead>
                <tbody className={STACKED_TABLE.body}>
                  {balances.lots.map((lot) => (
                    <tr key={lot.lotId} className={STACKED_TABLE.row}>
                      <td data-label="Lot code" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono font-medium")}>
                        {lot.code ?? lot.lotId}
                      </td>
                      <td data-label="Expires" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "tabular-nums text-xs")}>
                        {staffDate(lot.expiresAt)}
                      </td>
                      <td data-label="On hand" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                        {lot.onHand}
                      </td>
                      <td data-label="Sellable" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                        {lot.available}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {balances.canAdjust ? (
            <Card className="p-4">
              <form onSubmit={handleAdjustLot} className="grid gap-4">
                <h3 className="text-sm font-semibold text-foreground">Post lot count or adjustment</h3>
                {isLotCountStale && reviewedLot && liveSelectedLot ? (
                  <StockStaleBanner
                    title="Lot balance changed while counting"
                    description={`On hand for ${liveSelectedLot.code ?? liveSelectedLot.lotId} changed from ${reviewedLot.onHand} to ${liveSelectedLot.onHand}. Your typed count and reason are preserved — review the updated balance before posting.`}
                    actionLabel="Review updated balance"
                    onReview={() => {
                      setReviewedLot({ lotId: liveSelectedLot.lotId, onHand: liveSelectedLot.onHand });
                      setError("");
                      setRequestId(createOperationKey("lot-op"));
                    }}
                  />
                ) : null}
                <ChoiceGroup
                  name="lot-adj-mode"
                  label="Action"
                  value={mode}
                  onChange={(next) => {
                    setMode(next);
                    setRequestId(createOperationKey("lot-op"));
                  }}
                  columns="sm:grid-cols-3"
                  options={[
                    { value: "count", label: "Verify lot count", hint: "Reconcile shelf qty for one lot" },
                    { value: "add", label: "Add to lot", hint: "Record lot code & expiry" },
                    { value: "remove", label: "Remove from lot", hint: "Deduct expired or damaged units" },
                  ]}
                />
                {mode === "add" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-1.5">
                      <Label htmlFor="lot-code">Lot code</Label>
                      <Input
                        id="lot-code"
                        value={lotCode}
                        onChange={(event) => {
                          setLotCode(event.target.value);
                          setRequestId(createOperationKey("lot-op"));
                        }}
                        placeholder="e.g. LOT-2026-11"
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label htmlFor="lot-exp">Expiry date</Label>
                      <DatePicker
                        id="lot-exp"
                        value={lotExpiry}
                        onValueChange={(val) => {
                          setLotExpiry(val);
                          setRequestId(createOperationKey("lot-op"));
                        }}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-1.5">
                    <Label htmlFor="lot-select">Lot</Label>
                    <Select value={selectedLotId} onValueChange={selectLot}>
                      <SelectTrigger id="lot-select">
                        <SelectValue placeholder="Choose lot" />
                      </SelectTrigger>
                      <SelectContent>
                        {balances.lots.map((lot) => (
                          <SelectItem key={lot.lotId} value={lot.lotId}>
                            {lot.code ?? lot.lotId} · {lot.onHand} on hand · exp {staffDate(lot.expiresAt)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1.5">
                    <Label htmlFor="lot-qty">
                      {mode === "count" ? "Counted quantity on shelf" : "Quantity"}
                    </Label>
                    <NumberField
                      id="lot-qty"
                      value={qtyText}
                      onChange={(event) => {
                        setQtyText(event.target.value);
                        setRequestId(createOperationKey("lot-op"));
                      }}
                      placeholder="0"
                    />
                  </div>
                  <div className="grid gap-1.5">
                    <Label htmlFor="lot-reason">Reason</Label>
                    <Input
                      id="lot-reason"
                      value={reason}
                      onChange={(event) => {
                        setReason(event.target.value);
                        setRequestId(createOperationKey("lot-op"));
                      }}
                      placeholder={mode === "count" ? "Reason for verified lot count" : "Reason for lot adjustment"}
                    />
                  </div>
                </div>
                <div className="flex justify-end">
                  <Button type="submit" disabled={busy}>
                    {mode === "count" ? "Post verified lot count" : "Save lot adjustment"}
                  </Button>
                </div>
              </form>
            </Card>
          ) : (
            <Callout tone="info" title="View-only lot balances">
              Stock lead access is required to post lot counts or adjustments for {branchName ?? "this branch"}.
            </Callout>
          )}
        </>
      )}
    </div>
  );
}
