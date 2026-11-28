"use client";

import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo, useState, type FormEvent } from "react";
import {
  Callout,
  ChoiceGroup,
  EditorSheet,
  FieldError,
  NumberField,
  SheetForm,
} from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { ButtonLink } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { resortMidnight } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import {
  ADJUST_ADD_REASONS,
  ADJUST_REMOVE_REASONS,
  COUNT_VARIANCE_CHIPS,
  createOperationKey,
  formatSignedDelta,
  parseStockError,
  parseWholeQuantity,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

export { BranchStockAccessSheet } from "./BranchStockAccessSheet";

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
            Open lot view: {row.productName} · {row.label}
          </ButtonLink>
        ))}
      </div>
    </Callout>
  );
}

export function StockCountSheet({
  branchId,
  branchName,
  items,
  liveItems,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  branchName: string;
  items: BalanceRow[];
  liveItems: readonly BalanceRow[];
  onClose: () => void;
  onSuccess: () => void;
}) {
  const postOperation = useMutation(api.commerce.stock.postOperation);
  const trackedItems = useMemo(() => items.filter((item) => item.lotTracked), [items]);
  const countableItems = useMemo(() => items.filter((item) => !item.lotTracked), [items]);
  // Pin stock revisions when the sheet opens so live changes require explicit review
  const [reviewedByVariant, setReviewedByVariant] = useState<Record<string, { revision: number; onHand: number }>>(() =>
    Object.fromEntries(items.map((item) => [item.variantId, { revision: item.revision, onHand: item.onHand }])),
  );
  const [counts, setCounts] = useState<Record<string, string>>(() =>
    Object.fromEntries(items.map((item) => [item.variantId, ""])),
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
      setError("Stock balances changed while you were counting. Click Review updated balances above before posting.");
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
        <>
          <SheetTitle>Count stock · {branchName}</SheetTitle>
          <SheetDescription>
            Enter the physical quantity on the shelf. Preview variances before posting; zero-variance counts also clear Needs recount.
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel="Post count"
        readOnly={countableItems.length === 0}
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
            description={`${staleEntries.map((entry) => `${entry.item.productName} (${entry.reviewed.onHand} → ${entry.live.onHand})`).join(", ")}. Your typed counts are preserved — review the updated balances before posting.`}
            actionLabel="Review updated balances"
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
            <ul className="grid gap-3">
              {countableItems.map((item) => {
            const previewLine = preview?.lines.find((line) => line.variantId === item.variantId);
            const reviewed = reviewedByVariant[item.variantId] ?? { revision: item.revision, onHand: item.onHand };
            const rawVal = counts[item.variantId] ?? "";
            const inlineParse = rawVal.trim()
              ? parseWholeQuantity(rawVal, { allowZero: true, label: "Counted quantity" })
              : null;
            const fieldError = lineErrors[item.variantId] ?? (inlineParse && !inlineParse.ok ? inlineParse.error : undefined);
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
                  <span className="font-mono text-xs text-muted-foreground">
                    Expected: <strong className="text-foreground">{reviewed.onHand}</strong>
                    {previewLine && previewLine.revision !== reviewed.revision ? (
                      <span className="ml-1.5 text-amber-700 dark:text-amber-300">
                        (live: {previewLine.before})
                      </span>
                    ) : null}
                  </span>
                </div>

                <div className="grid gap-1.5 sm:max-w-xs">
                  <Label htmlFor={inputId}>Shelf count</Label>
                  <NumberField
                    id={inputId}
                    value={rawVal}
                    placeholder="Enter counted units"
                    aria-invalid={fieldError ? true : undefined}
                    aria-describedby={fieldError ? errorId : undefined}
                    onChange={(event) => {
                      const val = event.target.value;
                      setCounts((current) => ({ ...current, [item.variantId]: val }));
                      setLineErrors((current) => {
                        if (!current[item.variantId]) return current;
                        const next = { ...current };
                        delete next[item.variantId];
                        return next;
                      });
                      setOperationKey(createOperationKey("stock-count"));
                    }}
                  />
                  <FieldError id={errorId}>{fieldError}</FieldError>
                </div>

                {previewLine ? (
                  <p
                    className={cn(
                      "font-mono text-xs tabular-nums",
                      previewLine.delta === 0
                        ? "text-emerald-700 dark:text-emerald-300"
                        : "text-amber-800 dark:text-amber-300",
                    )}
                  >
                    Preview: {previewLine.before} → {previewLine.after} ({formatSignedDelta(previewLine.delta)})
                    {previewLine.needsRecount ? " · Clears Needs recount" : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>

        {preview?.requiresReason ? (
          <ReasonField
            id="count-reason"
            label="Reason for count variance"
            value={reason}
            onChange={(value) => {
              setReason(value);
              setOperationKey(createOperationKey("stock-count"));
            }}
            chips={COUNT_VARIANCE_CHIPS}
          />
        ) : (
          <div className="grid gap-1.5">
            <Label htmlFor="count-note">Optional note</Label>
            <Input
              id="count-note"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="Optional verification note"
            />
          </div>
        )}
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

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!parsedQty.ok || !parsedQty.value || signedDelta === null) {
      setError(parsedQty.ok ? "Enter a positive quantity." : parsedQty.error);
      document.getElementById("adjust-qty")?.focus();
      return;
    }
    if (!reasonOptions.some((reason) => reason.code === reasonCode)) {
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

        <ChoiceGroup
          name="adjust-direction"
          label="Adjustment type"
          value={direction}
          onChange={(next) => {
            setDirection(next);
            setReasonCode("");
            setOperationKey(createOperationKey("stock-adjust"));
          }}
          options={[
            { value: "remove", label: "Remove stock", hint: "Damaged, expired, lost, or other" },
            { value: "add", label: "Add stock", hint: "Found units or other" },
          ]}
        />

        <div className="grid gap-1.5">
          <Label htmlFor="adjust-qty">
            Quantity to {direction} (current On hand: {reviewedBalance.onHand})
          </Label>
          <NumberField
            id="adjust-qty"
            value={qtyText}
            placeholder="0"
            aria-invalid={inlineQtyError || previewError ? true : undefined}
            aria-describedby={inlineQtyError ? "adjust-qty-error" : undefined}
            onChange={(event) => {
              setQtyText(event.target.value);
              setOperationKey(createOperationKey("stock-adjust"));
            }}
          />
          <FieldError id="adjust-qty-error">{inlineQtyError}</FieldError>
        </div>

        <ChoiceGroup
          name="adjust-reason"
          label="Reason (required)"
          value={reasonCode}
          onChange={(next) => {
            setReasonCode(next);
            setOperationKey(createOperationKey("stock-adjust"));
          }}
          options={reasonOptions.map((r) => ({ value: r.code, label: r.label }))}
        />

        <div className="grid gap-1.5">
          <Label htmlFor="adjust-note">
            Note {reasonCode === "other" ? "(required)" : "(optional)"}
          </Label>
          <Input
            id="adjust-note"
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              setOperationKey(createOperationKey("stock-adjust"));
            }}
            placeholder={reasonCode === "other" ? "Explain this adjustment" : "Optional details"}
          />
        </div>

        {previewError ? (
          <Callout tone="warning" role="alert" title="Cannot preview adjustment">
            {parseStockError(
              previewError,
              "Enter a nonzero adjustment that keeps a stock decrease within the available balance.",
            ).message}
          </Callout>
        ) : preview?.lines[0] ? (
          <Callout tone="info" title="Balance preview">
            <span className="font-mono tabular-nums">
              {preview.lines[0].before} → <strong>{preview.lines[0].after}</strong> (
              {formatSignedDelta(preview.lines[0].delta)})
            </span>
          </Callout>
        ) : signedDelta !== null && direction === "remove" && reviewedBalance.onHand + signedDelta < 0 ? (
          <Callout tone="warning" role="alert" title="Exceeds available balance">
            You cannot remove more than {reviewedBalance.onHand} units on hand.
          </Callout>
        ) : null}
          </>
        )}
      </SheetForm>
    </EditorSheet>
  );
}

export function OpeningStockSheet({
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
  const [reviewedRevision, setReviewedRevision] = useState(item.revision);
  const [qtyText, setQtyText] = useState("");
  const [note, setNote] = useState("");
  const [lotCode, setLotCode] = useState("");
  const [lotExpiry, setLotExpiry] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ qty?: string; lotCode?: string; lotExpiry?: string }>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [operationKey, setOperationKey] = useState(() => createOperationKey("stock-open"));

  const isLotTracked = liveItem?.lotTracked ?? item.lotTracked;
  const dirty = qtyText.trim() !== "" || note.trim() !== "" || lotCode.trim() !== "" || lotExpiry !== "";
  const { requestClose } = useStockDirtyGuard(dirty, onClose, saving);

  const liveRevision = liveItem?.revision ?? item.revision;
  const isStale = liveRevision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsed = parseWholeQuantity(qtyText, { allowZero: false, label: "Opening quantity" });
    const nextErrors: { qty?: string; lotCode?: string; lotExpiry?: string } = {};
    let firstInvalidId: string | undefined;
    if (!parsed.ok || !parsed.value) {
      nextErrors.qty = parsed.ok ? "Enter an opening quantity." : parsed.error;
      firstInvalidId ??= "opening-qty";
    }
    if (isLotTracked) {
      if (!lotCode.trim()) {
        nextErrors.lotCode = "Enter a lot code for this lot-tracked item.";
        firstInvalidId ??= "opening-lot";
      }
      if (!lotExpiry) {
        nextErrors.lotExpiry = "Select an expiry date for this lot-tracked item.";
        firstInvalidId ??= "opening-expiry";
      }
    }
    setFieldErrors(nextErrors);
    if (firstInvalidId) {
      setError("Fix the highlighted fields before posting.");
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (isStale) {
      setError("This item's balance changed while the form was open. Review the latest state before posting.");
      return;
    }
    if (!parsed.ok || !parsed.value) return;
    setSaving(true);
    try {
      await postOperation({
        branchId,
        kind: "opening",
        operationKey,
        reason: note.trim() || "Opening stock",
        reasonCode: "opening_stock",
        lines: [
          {
            variantId: item.variantId,
            quantity: parsed.value,
            expectedRevision: reviewedRevision,
            ...(isLotTracked && lotCode.trim() && lotExpiry
              ? { lotReceipt: { code: lotCode.trim(), expiresAt: resortMidnight(lotExpiry) } }
              : {}),
          },
        ],
      });
      onSuccess();
    } catch (cause) {
      setError(parseStockError(cause, "Could not record opening stock.").message);
      setOperationKey(createOperationKey("stock-open"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Opening stock · {branchName}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-2">
            <span>
              {item.productName} · {item.label}
              {item.sku ? ` (${item.sku})` : ""}
            </span>
            {isLotTracked ? <StatusBadge tone="info" label="Lot-tracked" /> : null}
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel="Post opening stock"
      >
        {isStale ? (
          <StockStaleBanner
            title="Item balance changed"
            description="Stock balance was updated elsewhere. Review the latest balance before posting opening stock."
            actionLabel="Review updated state"
            onReview={() => {
              setReviewedRevision(liveRevision);
              setError("");
              setOperationKey(createOperationKey("stock-open"));
            }}
          />
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="opening-qty">Opening quantity</Label>
          <NumberField
            id="opening-qty"
            value={qtyText}
            aria-invalid={fieldErrors.qty ? true : undefined}
            aria-describedby={fieldErrors.qty ? "opening-qty-error" : undefined}
            onChange={(event) => {
              setQtyText(event.target.value);
              setFieldErrors((curr) => (curr.qty ? { ...curr, qty: undefined } : curr));
              setOperationKey(createOperationKey("stock-open"));
            }}
            placeholder="e.g. 20"
          />
          <FieldError id="opening-qty-error">{fieldErrors.qty}</FieldError>
        </div>
        {isLotTracked ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="opening-lot">Lot code (required)</Label>
              <Input
                id="opening-lot"
                value={lotCode}
                aria-invalid={fieldErrors.lotCode ? true : undefined}
                aria-describedby={fieldErrors.lotCode ? "opening-lot-error" : undefined}
                onChange={(event) => {
                  setLotCode(event.target.value);
                  setFieldErrors((curr) => (curr.lotCode ? { ...curr, lotCode: undefined } : curr));
                  setOperationKey(createOperationKey("stock-open"));
                }}
                placeholder="e.g. LOT-2026-11"
              />
              <FieldError id="opening-lot-error">{fieldErrors.lotCode}</FieldError>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="opening-expiry">Lot expiry date (required)</Label>
              <DatePicker
                id="opening-expiry"
                value={lotExpiry}
                aria-invalid={fieldErrors.lotExpiry ? true : undefined}
                aria-describedby={fieldErrors.lotExpiry ? "opening-expiry-error" : undefined}
                onValueChange={(val) => {
                  setLotExpiry(val);
                  setFieldErrors((curr) => (curr.lotExpiry ? { ...curr, lotExpiry: undefined } : curr));
                  setOperationKey(createOperationKey("stock-open"));
                }}
                clearable
                placeholder="Select expiry date"
              />
              <FieldError id="opening-expiry-error">{fieldErrors.lotExpiry}</FieldError>
            </div>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="opening-note">Note (optional)</Label>
          <Input
            id="opening-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Initial branch count"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}
