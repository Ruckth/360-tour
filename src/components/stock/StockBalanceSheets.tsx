"use client";

import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Check, Eye, EyeOff } from "lucide-react";
import { useMemo, useState, type FormEvent, type KeyboardEvent } from "react";
import {
  Callout,
  EditorSheet,
  FieldError,
  NumberField,
  SheetForm,
} from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  ADJUST_ADD_REASONS,
  ADJUST_REMOVE_REASONS,
  COUNT_VARIANCE_CHIPS,
  createOperationKey,
  formatSignedDelta,
  parseStockError,
  parseWholeQuantity,
  STOCK_MAX_LINES,
} from "./stock-format";
import { readBlindCountPref, writeBlindCountPref } from "./StockCountMode";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

export { BranchStockAccessSheet } from "./BranchStockAccessSheet";
export { OpeningStockSheet } from "./OpeningStockSheet";

type BalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];
type OperationPreviewResult = FunctionReturnType<typeof api.commerce.stock.previewOperation>;

function LotModeGuidanceCallout({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: readonly BalanceRow[];
}) {
  return (
    <Callout tone="warning" role="alert" title={title}>
      <p>{description}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((row) => (
          <ButtonLink
            key={row.variantId}
            href={`/admin/stock/expansion?variantId=${encodeURIComponent(row.variantId)}`}
            size="sm"
            variant="outline"
          >
            Open lots: {row.productName} · {row.label}
          </ButtonLink>
        ))}
      </div>
    </Callout>
  );
}

function VarianceBadge({ delta }: { delta: number }) {
  return (
    <StatusBadge
      tone={delta === 0 ? "success" : delta < 0 ? "danger" : "info"}
      label={delta === 0 ? "Matches" : formatSignedDelta(delta)}
    />
  );
}

export function StockCountSheet({
  branchId,
  branchName,
  items,
  liveItems,
  staffKey,
  scopeLabel,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName: string;
  items: BalanceRow[];
  liveItems: readonly BalanceRow[];
  staffKey?: string | null;
  scopeLabel?: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const postOperation = useMutation(api.commerce.stock.postOperation);
  // Freeze ordered targets at launch (capped at STOCK_MAX_LINES) so live list updates cannot reorder rows
  const [trackedItems] = useState<BalanceRow[]>(() => items.filter((item) => item.lotTracked));
  const [countableItems] = useState<BalanceRow[]>(() =>
    items.filter((item) => !item.lotTracked).slice(0, STOCK_MAX_LINES),
  );
  const defaultBlind = useMemo(() => countableItems.some((item) => item.needsRecount), [countableItems]);

  // Pin stock revisions when the sheet opens so live changes require explicit review
  const [reviewedByVariant, setReviewedByVariant] = useState<Record<string, { revision: number; onHand: number }>>(() =>
    Object.fromEntries(countableItems.map((item) => [item.variantId, { revision: item.revision, onHand: item.onHand }])),
  );
  const [blindCount, setBlindCount] = useState<boolean>(() => readBlindCountPref(defaultBlind, staffKey));
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(countableItems.map((item) => [item.variantId, ""])),
  );
  const [reason, setReason] = useState("");
  const [lineErrors, setLineErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operationKey, setOperationKey] = useState(() => createOperationKey("stock-count"));

  const dirty = Object.values(counts).some((val) => val.trim() !== "") || reason.trim() !== "";
  const { requestClose } = useStockDirtyGuard(dirty, onClose, saving);

  const validLines = useMemo(() => {
    if (countableItems.length === 0) return null;
    const parsed: { variantId: Id<"productVariants">; quantity: number }[] = [];
    for (const item of countableItems) {
      const result = parseWholeQuantity(counts[item.variantId] ?? "", { allowZero: true });
      if (!result.ok || result.value === undefined) return null;
      parsed.push({ variantId: item.variantId, quantity: result.value });
    }
    return parsed;
  }, [countableItems, counts]);

  const previewQueries = useMemo(
    (): RequestForQueries =>
      validLines
        ? {
            preview: {
              query: api.commerce.stock.previewOperation,
              args: { branchId, kind: "count" as const, lines: validLines, ...(reason.trim() ? { reason: reason.trim() } : {}) },
            },
          }
        : {},
    [branchId, validLines, reason],
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
    for (const item of countableItems) {
      const reviewed = reviewedByVariant[item.variantId];
      const live = liveByVariant.get(item.variantId);
      if (reviewed && live && live.revision !== reviewed.revision) {
        changed.push({ item, reviewed, live });
      }
    }
    return changed;
  }, [countableItems, reviewedByVariant, liveByVariant]);

  const { enteredCount, varianceCount } = useMemo(() => {
    let entered = 0;
    let variances = 0;
    for (const item of countableItems) {
      const raw = counts[item.variantId] ?? "";
      if (!raw.trim()) continue;
      const parsed = parseWholeQuantity(raw, { allowZero: true });
      if (parsed.ok && parsed.value !== undefined) {
        entered += 1;
        const baseline = reviewedByVariant[item.variantId]?.onHand ?? item.onHand;
        if (parsed.value !== baseline) variances += 1;
      }
    }
    return { enteredCount: entered, varianceCount: variances };
  }, [countableItems, counts, reviewedByVariant]);

  const requiresReason = varianceCount > 0 || (staleEntries.length === 0 && Boolean(preview?.requiresReason));
  const useCompactGrid = countableItems.length > 3;

  function toggleBlindCount() {
    setBlindCount((current) => {
      const next = !current;
      writeBlindCountPref(next, staffKey);
      return next;
    });
  }

  function isLineRevealed(variantId: string) {
    if (!blindCount) return true;
    const raw = counts[variantId] ?? "";
    if (!raw.trim()) return false;
    const parsed = parseWholeQuantity(raw, { allowZero: true });
    return parsed.ok && parsed.value !== undefined;
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
    setOperationKey(createOperationKey("stock-count"));
  }

  function handleQtyChange(variantId: string, val: string) {
    setCounts((current) => ({ ...current, [variantId]: val }));
    setLineErrors((current) => {
      if (!current[variantId]) return current;
      const next = { ...current };
      delete next[variantId];
      return next;
    });
    setOperationKey(createOperationKey("stock-count"));
  }

  function handleGridKeyDown(index: number, event: KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    const nextItem = countableItems[index + 1];
    if (!nextItem) return;
    event.preventDefault();
    document.getElementById(`count-qty-${nextItem.variantId}`)?.focus();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (countableItems.length === 0) return;
    setError("");
    const nextErrors: Record<string, string> = {};
    let firstInvalidId: string | undefined;
    for (const item of countableItems) {
      const check = parseWholeQuantity(counts[item.variantId] ?? "", { allowZero: true, label: "Counted quantity" });
      if (!check.ok || check.value === undefined) {
        nextErrors[item.variantId] = check.ok ? "Enter the counted quantity." : check.error;
        firstInvalidId ??= `count-qty-${item.variantId}`;
      }
    }
    setLineErrors(nextErrors);
    if (firstInvalidId) {
      document.getElementById(firstInvalidId)?.focus();
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
      setError("Stock balances changed while you were counting. Accept the updated balance above before posting.");
      return;
    }
    if (preview.requiresReason && !reason.trim()) {
      setError("Enter a reason for the count variance.");
      document.getElementById("count-reason")?.focus();
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
      onSuccess();
    } catch (cause) {
      setError(
        parseStockError(
          cause,
          "Stock changed while counting. Review the refreshed balance preview below and post again.",
        ).message,
      );
      setOperationKey(createOperationKey("stock-count"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      wide
      onClose={requestClose}
      header={
        <div className="flex flex-wrap items-start justify-between gap-2 pe-8">
          <div>
            <SheetTitle>Count stock · {branchName}</SheetTitle>
            <SheetDescription>
              {scopeLabel ? `${scopeLabel} · ` : ""}
              Enter the physical quantity on the shelf. Variances update live; zero-variance counts also clear Needs recount.
            </SheetDescription>
          </div>
          {countableItems.length > 0 ? (
            <Button
              type="button"
              variant={blindCount ? "secondary" : "outline"}
              size="sm"
              aria-pressed={blindCount}
              onClick={toggleBlindCount}
              className="shrink-0"
            >
              {blindCount ? <EyeOff aria-hidden className="size-3.5" /> : <Eye aria-hidden className="size-3.5" />}
              Blind count
            </Button>
          ) : null}
        </div>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        compact={useCompactGrid}
        submitLabel="Post count"
        readOnly={countableItems.length === 0}
        footerSummary={
          countableItems.length > 1 ? (
            <span className="tabular-nums">
              {enteredCount} counted · {varianceCount} with variance
            </span>
          ) : undefined
        }
      >
        {trackedItems.length > 0 ? (
          <LotModeGuidanceCallout
            title="Lot-tracked items use per-lot counting"
            description="Lot-tracked items cannot be counted in bulk. Open lot view to verify shelf counts per lot."
            items={trackedItems}
          />
        ) : null}

        {staleEntries.length > 0 ? (
          <StockStaleBanner
            title="Stock balance changed while counting"
            description={`${staleEntries
              .map((entry) =>
                isLineRevealed(entry.item.variantId)
                  ? `${entry.item.productName} (${entry.reviewed.onHand} → ${entry.live.onHand})`
                  : `${entry.item.productName} (balance updated)`,
              )
              .join(", ")}. Your typed counts are preserved — update Expected to reconcile against the live balance.`}
            actionLabel={
              staleEntries.length === 1
                ? isLineRevealed(staleEntries[0].item.variantId)
                  ? `Use new balance (${staleEntries[0].live.onHand})`
                  : "Use updated balance"
                : `Use updated balances (${staleEntries.length})`
            }
            onReview={acceptUpdatedBalances}
          />
        ) : null}

        {previewError ? (
          <Callout tone="warning" role="alert" title="Cannot preview stock count">
            {parseStockError(previewError, "Check the entered quantities and try again.").message}
          </Callout>
        ) : null}

        {countableItems.length > 0 ? (
          <>
            {useCompactGrid ? (
              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="border-b border-border bg-muted/40 text-xs font-medium text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2">Item</th>
                      <th scope="col" className="w-24 px-2 py-2 text-right">Expected</th>
                      <th scope="col" className="w-28 px-2 py-2">Counted</th>
                      <th scope="col" className="w-32 px-3 py-2 text-right">Variance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {countableItems.map((item, idx) => {
                      const reviewed = reviewedByVariant[item.variantId] ?? { revision: item.revision, onHand: item.onHand };
                      const live = liveByVariant.get(item.variantId);
                      const isLineStale = Boolean(live && live.revision !== reviewed.revision);
                      const rawVal = counts[item.variantId] ?? "";
                      const inlineParse = rawVal.trim()
                        ? parseWholeQuantity(rawVal, { allowZero: true, label: "Counted quantity" })
                        : null;
                      const parsedValue = inlineParse?.ok ? inlineParse.value : undefined;
                      const fieldError = lineErrors[item.variantId] ?? (inlineParse && !inlineParse.ok ? inlineParse.error : undefined);
                      const showExpected = !blindCount || parsedValue !== undefined;
                      const delta = parsedValue !== undefined ? parsedValue - reviewed.onHand : null;
                      const inputId = `count-qty-${item.variantId}`;
                      const errorId = `${inputId}-error`;
                      return (
                        <tr key={item.variantId} className={cn(fieldError && "bg-destructive/5")}>
                          <td className="px-3 py-1.5 align-middle">
                            <span className="block truncate text-sm font-medium leading-tight text-foreground">
                              {item.productName}
                            </span>
                            <span className="block truncate text-xs leading-tight text-muted-foreground">
                              {item.label}
                              {item.sku ? ` · ${item.sku}` : ""}
                            </span>
                            <FieldError id={errorId}>{fieldError}</FieldError>
                          </td>
                          <td className="px-2 py-1.5 text-right align-middle font-mono text-xs tabular-nums text-muted-foreground">
                            {showExpected ? (
                              <>
                                <strong className="text-foreground">{reviewed.onHand}</strong>
                                {isLineStale && live ? (
                                  <span className="block text-[11px] text-amber-700 dark:text-amber-300">
                                    live: {live.onHand}
                                  </span>
                                ) : null}
                              </>
                            ) : (
                              <span aria-label="Hidden in blind count">—</span>
                            )}
                          </td>
                          <td className="px-2 py-1.5 align-middle">
                            <NumberField
                              id={inputId}
                              aria-label={`Counted quantity for ${item.productName} ${item.label}`}
                              value={rawVal}
                              placeholder="0"
                              className="h-8 text-sm"
                              aria-invalid={fieldError ? true : undefined}
                              aria-describedby={fieldError ? errorId : undefined}
                              onKeyDown={(event) => handleGridKeyDown(idx, event)}
                              onChange={(event) => handleQtyChange(item.variantId, event.target.value)}
                            />
                          </td>
                          <td className="px-3 py-1.5 text-right align-middle">
                            {showExpected && delta !== null && parsedValue !== undefined ? (
                              <div className="inline-flex flex-col items-end gap-0.5">
                                <VarianceBadge delta={delta} />
                                <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
                                  {reviewed.onHand} → {parsedValue}
                                </span>
                              </div>
                            ) : (
                              <span className="text-xs text-muted-foreground">—</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <ul className="grid gap-3">
                {countableItems.map((item) => {
                  const reviewed = reviewedByVariant[item.variantId] ?? { revision: item.revision, onHand: item.onHand };
                  const live = liveByVariant.get(item.variantId);
                  const isLineStale = Boolean(live && live.revision !== reviewed.revision);
                  const rawVal = counts[item.variantId] ?? "";
                  const inlineParse = rawVal.trim()
                    ? parseWholeQuantity(rawVal, { allowZero: true, label: "Counted quantity" })
                    : null;
                  const parsedValue = inlineParse?.ok ? inlineParse.value : undefined;
                  const fieldError = lineErrors[item.variantId] ?? (inlineParse && !inlineParse.ok ? inlineParse.error : undefined);
                  const showExpected = !blindCount || parsedValue !== undefined;
                  const delta = parsedValue !== undefined ? parsedValue - reviewed.onHand : null;
                  const inputId = `count-qty-${item.variantId}`;
                  const errorId = `${inputId}-error`;
                  return (
                    <li
                      key={item.variantId}
                      className={cn(
                        "grid gap-2.5 rounded-lg border border-border bg-card p-3.5",
                        fieldError && "border-destructive/60",
                      )}
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-foreground">{item.productName}</p>
                          <p className="text-xs text-muted-foreground">
                            {item.label}
                            {item.sku ? ` · ${item.sku}` : ""}
                          </p>
                        </div>
                        {showExpected ? (
                          <span className="font-mono text-xs text-muted-foreground">
                            Expected: <strong className="text-foreground">{reviewed.onHand}</strong>
                            {isLineStale && live ? (
                              <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                                (live: {live.onHand})
                              </span>
                            ) : null}
                          </span>
                        ) : (
                          <span className="text-xs text-muted-foreground">Blind count</span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div className="grid min-w-44 flex-1 gap-1.5 sm:max-w-xs">
                          <Label htmlFor={inputId}>Shelf count</Label>
                          <NumberField
                            id={inputId}
                            value={rawVal}
                            placeholder="Enter counted units"
                            aria-invalid={fieldError ? true : undefined}
                            aria-describedby={fieldError ? errorId : undefined}
                            onChange={(event) => handleQtyChange(item.variantId, event.target.value)}
                          />
                          <FieldError id={errorId}>{fieldError}</FieldError>
                        </div>

                        {showExpected && delta !== null && parsedValue !== undefined ? (
                          <div className="flex flex-col items-end gap-1 pb-1">
                            <VarianceBadge delta={delta} />
                            <span className="font-mono text-xs tabular-nums text-muted-foreground">
                              {reviewed.onHand} → {parsedValue}
                              {item.needsRecount ? " · Clears Needs recount" : ""}
                            </span>
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            <ReasonField
              id="count-reason"
              label={requiresReason ? "Reason (required)" : "Reason (required if counts differ)"}
              required={requiresReason}
              value={reason}
              onChange={(value) => {
                setReason(value);
                setOperationKey(createOperationKey("stock-count"));
              }}
              chips={COUNT_VARIANCE_CHIPS}
              placeholder={requiresReason ? "Pick a reason or explain the variance" : "Optional note (required if counts differ)"}
            />
          </>
        ) : null}
      </SheetForm>
    </EditorSheet>
  );
}

export function StockAdjustSheet({
  branchId,
  branchName,
  item,
  liveItem,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName: string;
  item: BalanceRow;
  liveItem?: BalanceRow;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const postOperation = useMutation(api.commerce.stock.postOperation);
  // Pin stock balance revision when sheet opens so live changes require explicit review
  const [reviewedBalance, setReviewedBalance] = useState<{ revision: number; onHand: number }>(() => ({
    revision: item.revision,
    onHand: item.onHand,
  }));
  const [direction, setDirection] = useState<"remove" | "add">("remove");
  const [qtyText, setQtyText] = useState("");
  const [reasonCode, setReasonCode] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operationKey, setOperationKey] = useState(() => createOperationKey("stock-adjust"));

  const dirty = qtyText.trim() !== "" || note.trim() !== "" || direction !== "remove" || reasonCode !== "";
  const { requestClose } = useStockDirtyGuard(dirty, onClose, saving);

  const isLotTracked = liveItem?.lotTracked ?? item.lotTracked;
  const reasonOptions = direction === "remove" ? ADJUST_REMOVE_REASONS : ADJUST_ADD_REASONS;
  const parsedQty = parseWholeQuantity(qtyText, { allowZero: false });
  const signedDelta = parsedQty.ok && parsedQty.value ? (direction === "remove" ? -parsedQty.value : parsedQty.value) : null;

  const previewQueries = useMemo(
    (): RequestForQueries =>
      !isLotTracked && signedDelta !== null && reasonCode !== ""
        ? {
            preview: {
              query: api.commerce.stock.previewOperation,
              args: {
                branchId,
                kind: "adjust" as const,
                lines: [{ variantId: item.variantId, quantity: signedDelta }],
                reasonCode,
                reason: note.trim() || reasonCode,
              },
            },
          }
        : {},
    [isLotTracked, branchId, item.variantId, signedDelta, reasonCode, note],
  );
  const previewRaw: unknown = useQueries(previewQueries).preview;
  const previewError = previewRaw instanceof Error ? previewRaw : null;
  const preview = previewRaw && !(previewRaw instanceof Error) ? (previewRaw as OperationPreviewResult) : undefined;

  const liveRevision = preview?.lines[0]?.revision ?? liveItem?.revision ?? item.revision;
  const liveOnHand = preview?.lines[0]?.before ?? liveItem?.onHand ?? item.onHand;
  const isStale = liveRevision !== reviewedBalance.revision;

  const inlineQtyError = qtyText.trim() !== "" && !parsedQty.ok ? parsedQty.error : undefined;

  // Immediate local preview as soon as a valid quantity is typed (S17)
  const localAfter = signedDelta !== null ? reviewedBalance.onHand + signedDelta : null;
  const localExceeds = signedDelta !== null && direction === "remove" && localAfter !== null && localAfter < 0;
  const previewBefore = !isStale && preview?.lines[0] ? preview.lines[0].before : reviewedBalance.onHand;
  const previewAfter = !isStale && preview?.lines[0] ? preview.lines[0].after : localAfter;
  const previewDelta = !isStale && preview?.lines[0] ? preview.lines[0].delta : signedDelta;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!parsedQty.ok || !parsedQty.value || signedDelta === null) {
      setError(parsedQty.ok ? "Enter a positive quantity." : parsedQty.error);
      document.getElementById("adjust-qty")?.focus();
      return;
    }
    if (!reasonOptions.some((r) => r.code === reasonCode)) {
      setError("Choose an adjustment reason.");
      document.querySelector<HTMLInputElement>('input[name="adjust-reason"]')?.focus();
      return;
    }
    if (reasonCode === "other" && !note.trim()) {
      setError("Enter a note when choosing Other.");
      document.getElementById("adjust-note")?.focus();
      return;
    }
    if (isStale) {
      setError("Stock balance changed while editing. Review the updated balance above before saving.");
      return;
    }
    if (previewError) {
      setError(
        parseStockError(
          previewError,
          "Cannot preview this adjustment. Check that a decrease does not exceed current On hand.",
        ).message,
      );
      document.getElementById("adjust-qty")?.focus();
      return;
    }
    if (!preview?.lines[0]) {
      setError("Waiting for live balance preview. Try again in a moment.");
      return;
    }

    const reasonLabel = reasonOptions.find((r) => r.code === reasonCode)?.label ?? reasonCode;
    const fullReason = note.trim() ? `${reasonLabel}: ${note.trim()}` : reasonLabel;

    setSaving(true);
    try {
      await postOperation({
        branchId,
        kind: "adjust",
        operationKey,
        reasonCode,
        reason: fullReason,
        lines: [
          {
            variantId: item.variantId,
            quantity: signedDelta,
            expectedRevision: reviewedBalance.revision,
          },
        ],
      });
      onSuccess();
    } catch (cause) {
      setError(parseStockError(cause, "Could not save adjustment. Check the current balance and try again.").message);
      setOperationKey(createOperationKey("stock-adjust"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Adjust stock · {branchName}</SheetTitle>
          <SheetDescription>
            {item.productName} · {item.label}
            {item.sku ? ` (${item.sku})` : ""}
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
        submitLabel="Save adjustment"
        readOnly={isLotTracked}
      >
        {isLotTracked ? (
          <LotModeGuidanceCallout
            title="Lot-tracked items must be adjusted per lot"
            description="Open the lot view for this item to add to a lot with expiry or remove units from a specific lot."
            items={[item]}
          />
        ) : (
          <>
            {isStale ? (
              <StockStaleBanner
                title="Stock balance changed while editing"
                description={`On hand changed from ${reviewedBalance.onHand} to ${liveOnHand}. Your typed adjustment is preserved — review the updated balance before saving.`}
                actionLabel="Review updated balance"
                onReview={() => {
                  setReviewedBalance({ revision: liveRevision, onHand: liveOnHand });
                  setError("");
                  setOperationKey(createOperationKey("stock-adjust"));
                }}
              />
            ) : null}

            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-medium leading-none text-foreground">Adjustment type</legend>
              <div className="grid grid-cols-2 gap-1 rounded-lg border border-border bg-muted/60 p-1">
                {([
                  { value: "remove", label: "Remove" },
                  { value: "add", label: "Add" },
                ] as const).map((opt) => (
                  <label
                    key={opt.value}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center justify-center rounded-md px-3 text-sm font-medium transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      direction === opt.value
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <input
                      type="radio"
                      name="adjust-direction"
                      value={opt.value}
                      checked={direction === opt.value}
                      onChange={() => {
                        setDirection(opt.value);
                        setReasonCode("");
                        setOperationKey(createOperationKey("stock-adjust"));
                      }}
                      className="sr-only"
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="adjust-qty">
                Quantity to {direction} (On hand: {reviewedBalance.onHand})
              </Label>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-36 shrink-0">
                  <NumberField
                    id="adjust-qty"
                    value={qtyText}
                    placeholder="0"
                    className="min-h-11"
                    aria-invalid={inlineQtyError || previewError || localExceeds ? true : undefined}
                    aria-describedby={inlineQtyError ? "adjust-qty-error" : undefined}
                    onChange={(event) => {
                      setQtyText(event.target.value);
                      setOperationKey(createOperationKey("stock-adjust"));
                    }}
                  />
                </div>
                {previewAfter !== null && previewDelta !== null && !previewError && !localExceeds ? (
                  <div
                    aria-live="polite"
                    className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 font-mono text-sm tabular-nums"
                  >
                    <span className="text-muted-foreground">
                      {previewBefore} → <strong className="text-foreground">{previewAfter}</strong>
                    </span>
                    <span className={cn("font-semibold", previewDelta < 0 ? "text-red-700 dark:text-red-300" : "text-emerald-700 dark:text-emerald-300")}>
                      ({formatSignedDelta(previewDelta)})
                    </span>
                  </div>
                ) : null}
              </div>
              <FieldError id="adjust-qty-error">{inlineQtyError}</FieldError>
            </div>

            {previewError ? (
              <Callout tone="warning" role="alert" title="Cannot preview adjustment">
                {parseStockError(
                  previewError,
                  "Enter a nonzero adjustment that keeps a stock decrease within the available balance.",
                ).message}
              </Callout>
            ) : localExceeds ? (
              <Callout tone="warning" role="alert" title="Exceeds available balance">
                You cannot remove more than {reviewedBalance.onHand} units on hand.
              </Callout>
            ) : null}

            <fieldset className="grid gap-1.5">
              <legend className="text-sm font-medium leading-none text-foreground">Reason (required)</legend>
              <div className="flex flex-wrap gap-2">
                {reasonOptions.map((r) => {
                  const selected = reasonCode === r.code;
                  return (
                    <label
                      key={r.code}
                      className={cn(
                        "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2",
                        selected
                          ? "border-foreground bg-foreground text-background shadow-sm"
                          : "border-border bg-muted text-foreground hover:border-foreground/40",
                      )}
                    >
                      <input
                        type="radio"
                        name="adjust-reason"
                        value={r.code}
                        checked={selected}
                        onChange={() => {
                          setReasonCode(r.code);
                          setOperationKey(createOperationKey("stock-adjust"));
                        }}
                        className="sr-only"
                      />
                      {selected ? <Check aria-hidden className="size-3.5 shrink-0" /> : null}
                      {r.label}
                    </label>
                  );
                })}
              </div>
            </fieldset>

            <div className="grid gap-1.5">
              <Label htmlFor="adjust-note">
                Note {reasonCode === "other" ? "(required)" : "(optional)"}
              </Label>
              <Input
                id="adjust-note"
                className="min-h-11"
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setOperationKey(createOperationKey("stock-adjust"));
                }}
                placeholder={reasonCode === "other" ? "Explain this adjustment" : "Optional details"}
              />
            </div>
          </>
        )}
      </SheetForm>
    </EditorSheet>
  );
}
