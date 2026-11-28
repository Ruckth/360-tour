"use client";

import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, ArrowRight, Check, Eye, EyeOff, SkipForward, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { Callout } from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { Spinner } from "@/components/ui/spinner";
import {
  COUNT_VARIANCE_CHIPS,
  createOperationKey,
  formatSignedDelta,
  parseStockError,
  parseWholeQuantity,
  STOCK_MAX_LINES,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

type BalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];
type OperationPreviewResult = FunctionReturnType<typeof api.commerce.stock.previewOperation>;

export function blindCountStorageKey(staffKey?: string | null): string {
  const normalized = staffKey?.trim().toLowerCase();
  return normalized ? `stock:blind-count-pref:${normalized}` : "stock:blind-count-pref";
}

export function readBlindCountPref(defaultValue: boolean, staffKey?: string | null): boolean {
  if (typeof window === "undefined") return defaultValue;
  try {
    const raw = window.localStorage?.getItem(blindCountStorageKey(staffKey));
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Ignore storage access errors in private contexts
  }
  return defaultValue;
}

export function writeBlindCountPref(value: boolean, staffKey?: string | null) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage?.setItem(blindCountStorageKey(staffKey), value ? "true" : "false");
  } catch {
    // Ignore storage access errors in private contexts
  }
}

export function StockCountMode({
  branchId,
  branchName,
  items,
  liveItems,
  staffKey,
  scopeLabel,
  batchInfo,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName: string;
  items: BalanceRow[];
  liveItems: readonly BalanceRow[];
  staffKey?: string | null;
  scopeLabel?: string;
  batchInfo?: { batchNumber: number; totalBatches: number; remainingCount: number };
  onClose: () => void;
  onSuccess: (countedCount: number) => void;
}) {
  const postOperation = useMutation(api.commerce.stock.postOperation);
  // Freeze ordered non-lot target snapshot at launch (capped at STOCK_MAX_LINES) so live query updates never shift item index
  const [countableItems] = useState<BalanceRow[]>(() =>
    items.filter((item) => !item.lotTracked).slice(0, STOCK_MAX_LINES),
  );
  const defaultBlind = useMemo(() => countableItems.some((item) => item.needsRecount), [countableItems]);

  const [step, setStep] = useState<"counting" | "summary">("counting");
  const [index, setIndex] = useState(0);
  const [blindCount, setBlindCount] = useState<boolean>(() => readBlindCountPref(defaultBlind, staffKey));
  const [reviewedByVariant, setReviewedByVariant] = useState<Record<string, { revision: number; onHand: number }>>(() =>
    Object.fromEntries(countableItems.map((item) => [item.variantId, { revision: item.revision, onHand: item.onHand }])),
  );
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [skippedIds, setSkippedIds] = useState<Set<string>>(() => new Set());
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operationKey, setOperationKey] = useState(() => createOperationKey("stock-count-mode"));
  const inputRef = useRef<HTMLInputElement>(null);

  const currentItem = countableItems[index];

  useEffect(() => {
    if (step === "counting") {
      inputRef.current?.focus();
    }
  }, [step, index]);

  const { enteredLines, invalidEntries } = useMemo(() => {
    const entered: { item: BalanceRow; variantId: Id<"productVariants">; quantity: number }[] = [];
    const invalid: { item: BalanceRow; raw: string; error: string; itemIndex: number }[] = [];
    for (let i = 0; i < countableItems.length; i++) {
      const item = countableItems[i];
      const raw = counts[item.variantId];
      if (!raw || !raw.trim()) continue;
      const parsed = parseWholeQuantity(raw, { allowZero: true, label: "Counted quantity" });
      if (parsed.ok && parsed.value !== undefined) {
        entered.push({ item, variantId: item.variantId, quantity: parsed.value });
      } else {
        invalid.push({
          item,
          raw,
          error: parsed.ok ? "Enter a valid whole number." : parsed.error,
          itemIndex: i,
        });
      }
    }
    return { enteredLines: entered, invalidEntries: invalid };
  }, [countableItems, counts]);

  // Include invalid/partial typed drafts so closing always confirms before discarding work
  const dirty = Object.values(counts).some((raw) => raw.trim() !== "") || reason.trim() !== "";
  const { requestClose } = useStockDirtyGuard(dirty, onClose, saving);

  const previewQueries = useMemo(
    (): RequestForQueries =>
      step === "summary" && enteredLines.length > 0 && invalidEntries.length === 0
        ? {
            preview: {
              query: api.commerce.stock.previewOperation,
              args: {
                branchId,
                kind: "count" as const,
                lines: enteredLines.map(({ variantId, quantity }) => ({ variantId, quantity })),
                ...(reason.trim() ? { reason: reason.trim() } : {}),
              },
            },
          }
        : {},
    [step, branchId, enteredLines, invalidEntries.length, reason],
  );
  const previewRaw: unknown = useQueries(previewQueries).preview;
  const previewError = previewRaw instanceof Error ? previewRaw : null;
  const preview = previewRaw && !(previewRaw instanceof Error) ? (previewRaw as OperationPreviewResult) : undefined;

  const liveByVariant = useMemo(() => {
    const map = new Map<string, { revision: number; onHand: number }>();
    for (const row of liveItems) {
      map.set(row.variantId, { revision: row.revision, onHand: row.onHand });
    }
    if (preview) {
      for (const line of preview.lines) {
        map.set(line.variantId, { revision: line.revision, onHand: line.before });
      }
    }
    return map;
  }, [liveItems, preview]);

  const staleEntries = useMemo(() => {
    const changed: { item: BalanceRow; reviewed: { revision: number; onHand: number }; live: { revision: number; onHand: number } }[] = [];
    for (const entry of enteredLines) {
      const reviewed = reviewedByVariant[entry.variantId];
      const live = liveByVariant.get(entry.variantId);
      if (reviewed && live && live.revision !== reviewed.revision) {
        changed.push({ item: entry.item, reviewed, live });
      }
    }
    return changed;
  }, [enteredLines, reviewedByVariant, liveByVariant]);

  const localHasVariance = useMemo(() => {
    return enteredLines.some((entry) => {
      const reviewed = reviewedByVariant[entry.variantId]?.onHand ?? entry.item.onHand;
      return entry.quantity !== reviewed;
    });
  }, [enteredLines, reviewedByVariant]);

  const requiresReason = preview?.requiresReason ?? localHasVariance;
  const unvisitedCount = Math.max(
    0,
    countableItems.length - enteredLines.length - invalidEntries.length - skippedIds.size,
  );

  function toggleBlind() {
    setBlindCount((curr) => {
      const next = !curr;
      writeBlindCountPref(next, staffKey);
      return next;
    });
  }

  function validateCurrentDraft(): boolean {
    if (!currentItem) return true;
    const raw = counts[currentItem.variantId] ?? "";
    if (raw.trim() === "") return true;
    const parsed = parseWholeQuantity(raw, { allowZero: true, label: "Counted quantity" });
    if (!parsed.ok) {
      setError(parsed.error);
      inputRef.current?.focus();
      return false;
    }
    return true;
  }

  function openSummary() {
    setError("");
    if (!validateCurrentDraft()) return;
    setStep("summary");
  }

  function advanceNext() {
    setError("");
    if (!currentItem) return;
    if (!validateCurrentDraft()) return;
    const raw = counts[currentItem.variantId] ?? "";
    if (raw.trim() !== "") {
      setSkippedIds((prev) => {
        if (!prev.has(currentItem.variantId)) return prev;
        const next = new Set(prev);
        next.delete(currentItem.variantId);
        return next;
      });
    }
    if (index + 1 < countableItems.length) {
      setIndex(index + 1);
    } else {
      setStep("summary");
    }
  }

  function skipCurrent() {
    setError("");
    if (!currentItem) return;
    setCounts((prev) => {
      if (!(currentItem.variantId in prev)) return prev;
      const next = { ...prev };
      delete next[currentItem.variantId];
      return next;
    });
    setSkippedIds((prev) => new Set(prev).add(currentItem.variantId));
    if (index + 1 < countableItems.length) {
      setIndex(index + 1);
    } else {
      setStep("summary");
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      advanceNext();
    }
  }

  function acceptUpdatedBalances() {
    setReviewedByVariant((current) => {
      const next = { ...current };
      for (const entry of staleEntries) {
        next[entry.item.variantId] = entry.live;
      }
      return next;
    });
    setError("");
    setOperationKey(createOperationKey("stock-count-mode"));
  }

  async function handlePost(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (invalidEntries.length > 0) {
      setError("Fix or clear the invalid entries listed above before posting.");
      return;
    }
    if (enteredLines.length === 0) {
      setError("Count at least one item before posting.");
      return;
    }
    if (previewError) {
      setError(parseStockError(previewError, "Cannot preview this stock count.").message);
      return;
    }
    if (!preview) {
      setError("Waiting for live balance preview. Try again in a moment.");
      return;
    }
    if (staleEntries.length > 0) {
      setError("Balances changed while counting. Use the updated balance above before posting.");
      return;
    }
    if (requiresReason && !reason.trim()) {
      setError("Enter a reason for the count variance.");
      document.getElementById("count-mode-reason")?.focus();
      return;
    }

    setSaving(true);
    try {
      await postOperation({
        branchId,
        kind: "count",
        operationKey,
        reason: reason.trim() || undefined,
        reasonCode: preview.requiresReason ? "count_variance" : "verified_count",
        lines: preview.lines.map((line) => ({
          variantId: line.variantId,
          quantity: line.quantity,
          expectedRevision: reviewedByVariant[line.variantId]?.revision ?? line.revision,
        })),
      });
      onSuccess(preview.lines.length);
    } catch (cause) {
      setError(parseStockError(cause, "Could not post stock count. Review variances and try again.").message);
      setOperationKey(createOperationKey("stock-count-mode"));
      setSaving(false);
    }
  }

  if (countableItems.length === 0) {
    return null;
  }

  const currentVal = currentItem ? (counts[currentItem.variantId] ?? "") : "";
  const currentParsed = currentVal.trim() ? parseWholeQuantity(currentVal, { allowZero: true }) : null;
  const currentReviewed = currentItem ? (reviewedByVariant[currentItem.variantId] ?? { revision: currentItem.revision, onHand: currentItem.onHand }) : null;
  const showExpectedForCurrent = !blindCount || (currentParsed?.ok && currentParsed.value !== undefined);

  return (
    <Dialog open onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        showCloseButton={false}
        className="fixed inset-0 top-0 left-0 z-50 flex h-dvh max-h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 bg-background p-0 text-foreground shadow-none max-md:inset-0 max-md:top-0 max-md:h-dvh max-md:max-h-dvh max-md:rounded-none max-md:pb-0"
      >
        <DialogDescription className="sr-only">
          Count one item at a time and review variances before posting one stock count operation.
        </DialogDescription>
        <header className="flex items-center justify-between gap-2 border-b border-border px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
          <div className="min-w-0">
            <DialogTitle className="truncate font-serif text-base font-semibold">
              {step === "counting" ? `Count mode · ${index + 1} of ${countableItems.length}` : "Count summary"}
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              {branchName}
              {scopeLabel ? ` · ${scopeLabel}` : ""}
              {batchInfo && batchInfo.totalBatches > 1
                ? ` · Batch ${batchInfo.batchNumber}/${batchInfo.totalBatches}`
                : ""}
              {" · "}
              {enteredLines.length} counted
              {skippedIds.size > 0 ? ` · ${skippedIds.size} skipped` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            {step === "counting" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-h-11 px-2.5 text-xs"
                aria-pressed={blindCount}
                onClick={toggleBlind}
              >
                {blindCount ? <EyeOff aria-hidden className="size-4" /> : <Eye aria-hidden className="size-4" />}
                {blindCount ? "Blind" : "Expected"}
              </Button>
            ) : null}
            {step === "counting" && (enteredLines.length > 0 || invalidEntries.length > 0) ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 px-3 text-xs"
                onClick={openSummary}
              >
                Review ({enteredLines.length})
              </Button>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Exit count mode"
              className="size-11"
              onClick={requestClose}
            >
              <X aria-hidden className="size-5" />
            </Button>
          </div>
        </header>

        <div className="h-1 w-full shrink-0 bg-muted">
          <div
            className="h-full bg-foreground transition-all"
            style={{
              width: `${step === "summary" ? 100 : Math.round(((index + 1) / countableItems.length) * 100)}%`,
            }}
          />
        </div>

        {step === "counting" && currentItem && currentReviewed ? (
          <div className="flex min-h-0 flex-1 flex-col justify-between overflow-y-auto px-5 py-6">
            <div className="mx-auto grid w-full max-w-md gap-5">
              <div className="grid gap-1 text-center">
                <p className="text-xl font-semibold text-foreground">{currentItem.productName}</p>
                <p className="text-sm text-muted-foreground">
                  {currentItem.label}
                  {currentItem.sku ? ` · ${currentItem.sku}` : ""}
                </p>
                <div className="mt-1 flex flex-wrap justify-center gap-1.5">
                  {currentItem.needsRecount ? <StatusBadge tone="warning" label="Needs recount" /> : null}
                  {!currentItem.hasBalance ? <StatusBadge tone="neutral" label="Never stocked" /> : null}
                </div>
              </div>

              <div className="rounded-xl border border-border bg-muted/30 px-4 py-3 text-center">
                {showExpectedForCurrent ? (
                  <p className="text-sm text-muted-foreground">
                    Expected on shelf:{" "}
                    <strong className="font-mono text-base font-semibold tabular-nums text-foreground">
                      {currentReviewed.onHand}
                    </strong>
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    Blind count active — expected quantity hidden until entered
                  </p>
                )}
              </div>

              <div className="grid gap-2">
                <Label htmlFor="count-mode-input" className="text-center text-sm font-medium">
                  Shelf count
                </Label>
                <Input
                  ref={inputRef}
                  id="count-mode-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  autoComplete="off"
                  value={currentVal}
                  aria-invalid={error ? true : undefined}
                  onKeyDown={handleKeyDown}
                  onChange={(event) => {
                    const val = event.target.value;
                    setCounts((prev) => ({ ...prev, [currentItem.variantId]: val }));
                    setError("");
                    setOperationKey(createOperationKey("stock-count-mode"));
                  }}
                  placeholder="0"
                  className="min-h-14 text-center font-mono text-2xl font-semibold tabular-nums"
                />
                {error ? (
                  <p role="alert" className="text-center text-sm font-medium text-destructive">
                    {error}
                  </p>
                ) : currentParsed?.ok && currentParsed.value !== undefined && showExpectedForCurrent ? (
                  <div className="flex items-center justify-center gap-2 pt-1">
                    {(() => {
                      const delta = currentParsed.value - currentReviewed.onHand;
                      return (
                        <>
                          <span className="font-mono text-xs tabular-nums text-muted-foreground">
                            {currentReviewed.onHand} → {currentParsed.value}
                          </span>
                          <StatusBadge
                            tone={delta === 0 ? "success" : delta < 0 ? "danger" : "info"}
                            label={delta === 0 ? "Matches" : formatSignedDelta(delta)}
                          />
                        </>
                      );
                    })()}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="mx-auto grid w-full max-w-md grid-cols-3 gap-2 pt-6 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
              <Button
                type="button"
                variant="outline"
                className="min-h-12"
                disabled={index === 0}
                onClick={() => {
                  setError("");
                  setIndex((i) => Math.max(0, i - 1));
                }}
              >
                <ArrowLeft aria-hidden className="size-4" />
                Back
              </Button>
              <Button type="button" variant="ghost" className="min-h-12" onClick={skipCurrent}>
                <SkipForward aria-hidden className="size-4" />
                Skip
              </Button>
              <Button type="button" className="min-h-12" onClick={advanceNext}>
                {index + 1 < countableItems.length ? (
                  <>
                    Next
                    <ArrowRight aria-hidden className="size-4" />
                  </>
                ) : (
                  <>
                    Summary
                    <Check aria-hidden className="size-4" />
                  </>
                )}
              </Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePost} noValidate className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
              <div className="mx-auto grid w-full max-w-lg gap-4">
                <p className="text-xs text-muted-foreground">
                  {enteredLines.length} counted · {skippedIds.size} skipped
                  {unvisitedCount > 0 ? ` · ${unvisitedCount} not visited` : ""}
                  {invalidEntries.length > 0 ? ` · ${invalidEntries.length} invalid` : ""}
                </p>

                {invalidEntries.length > 0 ? (
                  <Callout tone="danger" role="alert" title="Invalid entries need attention">
                    <ul className="mt-1 grid gap-1.5 text-xs">
                      {invalidEntries.map((entry) => (
                        <li key={entry.item.variantId} className="flex items-center justify-between gap-2">
                          <span>
                            <strong>{entry.item.productName}</strong> (“{entry.raw}”): {entry.error}
                          </span>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setIndex(entry.itemIndex);
                              setStep("counting");
                            }}
                          >
                            Fix
                          </Button>
                        </li>
                      ))}
                    </ul>
                  </Callout>
                ) : null}

                {staleEntries.length > 0 ? (
                  <StockStaleBanner
                    title="Stock balance changed while counting"
                    description={`${staleEntries.map((entry) => `${entry.item.productName} (${entry.reviewed.onHand} → ${entry.live.onHand})`).join(", ")}.`}
                    actionLabel={
                      staleEntries.length === 1
                        ? `Use new balance (${staleEntries[0].live.onHand})`
                        : `Use new balances (${staleEntries.length})`
                    }
                    onReview={acceptUpdatedBalances}
                  />
                ) : null}

                {previewError ? (
                  <Callout tone="warning" role="alert" title="Cannot preview stock count">
                    {parseStockError(previewError, "Check the entered quantities and try again.").message}
                  </Callout>
                ) : null}

                {enteredLines.length === 0 ? (
                  <Callout tone="info" title="No items counted yet">
                    Go back and enter at least one shelf count to post.
                  </Callout>
                ) : (
                  <ul className="divide-y divide-border rounded-lg border border-border bg-card">
                    {enteredLines.map((entry) => {
                      const reviewed = reviewedByVariant[entry.variantId] ?? {
                        revision: entry.item.revision,
                        onHand: entry.item.onHand,
                      };
                      const delta = entry.quantity - reviewed.onHand;
                      const itemIdx = countableItems.findIndex((c) => c.variantId === entry.variantId);
                      return (
                        <li key={entry.variantId} className="flex items-center justify-between gap-3 px-3.5 py-3">
                          <button
                            type="button"
                            className="min-w-0 flex-1 text-left"
                            onClick={() => {
                              if (itemIdx >= 0) {
                                setIndex(itemIdx);
                                setStep("counting");
                              }
                            }}
                          >
                            <span className="block truncate text-sm font-medium text-foreground">
                              {entry.item.productName}
                            </span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {entry.item.label}
                              {entry.item.sku ? ` · ${entry.item.sku}` : ""} · {reviewed.onHand} → {entry.quantity}
                            </span>
                          </button>
                          <StatusBadge
                            tone={delta === 0 ? "success" : delta < 0 ? "danger" : "info"}
                            label={delta === 0 ? "Matches" : formatSignedDelta(delta)}
                          />
                        </li>
                      );
                    })}
                  </ul>
                )}

                {enteredLines.length > 0 ? (
                  <ReasonField
                    id="count-mode-reason"
                    label={requiresReason ? "Reason (required)" : "Reason (required if counts differ)"}
                    required={requiresReason}
                    value={reason}
                    onChange={(val) => {
                      setReason(val);
                      setOperationKey(createOperationKey("stock-count-mode"));
                    }}
                    chips={COUNT_VARIANCE_CHIPS}
                    placeholder={requiresReason ? "Explain count variance" : "Optional verification note"}
                  />
                ) : null}
              </div>
            </div>

            <div className="grid gap-2 border-t border-border px-5 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
              {error ? (
                <p role="alert" className="text-sm font-medium text-destructive">
                  {error}
                </p>
              ) : null}
              <div className="mx-auto flex w-full max-w-lg items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 flex-1"
                  onClick={() => {
                    setError("");
                    setStep("counting");
                  }}
                >
                  <ArrowLeft aria-hidden className="size-4" />
                  Back to items
                </Button>
                <Button
                  type="submit"
                  className="min-h-11 flex-1"
                  disabled={saving || enteredLines.length === 0 || invalidEntries.length > 0}
                >
                  {saving ? <Spinner label="Posting" className="text-current" /> : null}
                  Post count ({enteredLines.length})
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
