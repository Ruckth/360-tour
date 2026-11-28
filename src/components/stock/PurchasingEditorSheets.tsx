"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo, useState, type FormEvent } from "react";
import { Callout, EditorSheet, FieldError, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  createOperationKey,
  parseOptionalSatang,
  parseStockError,
  parseWholeQuantity,
  STOCK_MAX_QUANTITY,
} from "./stock-format";
import type { StockLineDraft } from "./stock-types";
import { StockStaleBanner, useResolvedStockVariants, useStockDirtyGuard, type ResolvedBalanceRow } from "./StockFormGuard";
import { StockLineEditor, type StockLineFieldErrors } from "./StockLineEditor";
import { StockVariantPickerDialog } from "./StockVariantPicker";
import { addDays } from "convex/shared/dates";
import { resortTodayIso } from "convex/shared/time";
import { SupplierPickerField } from "./SupplierPicker";

const REQUEST_NOTE_LIMIT = 2_000;

export function newRequestLine(item: {
  variantId: Id<"productVariants">;
  productName: string;
  label: string;
  sku?: string;
  onHand: number;
  onOrder: number;
  reorderPoint?: number;
}): StockLineDraft {
  const { variantId, productName, label, sku, onHand, onOrder, reorderPoint } = item;
  const quantity = reorderPoint === undefined ? 1 : Math.min(STOCK_MAX_QUANTITY, Math.max(1, reorderPoint - onHand - onOrder));
  return {
    variantId, productName, variantLabel: label, sku, onHand, onOrder,
    quantityText: String(quantity),
    quantityHint: reorderPoint === undefined ? undefined
      : `Suggested ${quantity} · Par ${reorderPoint} − on hand ${onHand} − on order ${onOrder} (minimum 1, maximum ${STOCK_MAX_QUANTITY.toLocaleString("en-US")})`,
  };
}

type HoldRow = FunctionReturnType<typeof api.commerce.purchasing.holds>["page"][number];

function buildRequestSnapshotKey(needBy: string, note: string, lines: readonly { variantId: string; quantityText: string }[]): string {
  return JSON.stringify({
    needBy,
    note: note.trim(),
    lines: lines.map((line) => ({ variantId: line.variantId, quantityText: line.quantityText.trim() })),
  });
}

export function RequestReorderPoint({
  branchId,
  row,
  disabled,
  onSaved,
}: {
  branchId: Id<"branches">;
  row: ResolvedBalanceRow;
  disabled?: boolean;
  onSaved: (point: number | undefined) => void;
}) {
  const save = useMutation(api.commerce.stock.setReorderPoint);
  const [draft, setDraft] = useState<{ text: string; revision: number }>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const fieldId = `reorder-point-${row.variantId}`;
  const revision = row.reorderPointRevision ?? 0;
  const stale = draft !== undefined && draft.revision !== revision;

  function reviewLatest() {
    setDraft({ text: row.reorderPoint?.toString() ?? "", revision });
    setError("");
  }

  async function savePoint() {
    if (!draft || stale || busy || disabled) return;
    const parsed = parseWholeQuantity(draft.text, { allowBlank: true, allowZero: true, label: "Reorder point" });
    if (!parsed.ok) {
      setError(parsed.error);
      document.getElementById(fieldId)?.focus();
      return;
    }
    setError("");
    setBusy(true);
    try {
      await save({ branchId, variantId: row.variantId, quantity: parsed.value ?? null, expectedRevision: draft.revision });
      onSaved(parsed.value);
      setDraft(undefined);
    } catch (cause) {
      setError(parseStockError(cause, "Could not save the reorder point.").message);
    } finally {
      setBusy(false);
    }
  }

  if (!draft) return (
    <Button type="button" variant="ghost" size="sm" className="w-fit" disabled={disabled} onClick={reviewLatest}
      aria-label={`Edit reorder point for ${row.productName} · ${row.label}`}>
      {row.reorderPoint === undefined ? "Set reorder point" : `Reorder point ${row.reorderPoint} · Edit`}
    </Button>
  );

  return (
    <div className="grid gap-2 rounded-md border p-2.5">
      <Label htmlFor={fieldId}>Branch reorder point</Label>
      <NumberField id={fieldId} value={draft.text} disabled={busy || disabled} placeholder="Unset"
        aria-describedby={`${fieldId}-hint ${fieldId}-error`}
        aria-invalid={Boolean(error)}
        onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setError(""); }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          void savePoint();
        }} />
      <p id={`${fieldId}-hint`} className="text-xs text-muted-foreground">Save an empty field to clear it. This setting applies to new request lines at this branch.</p>
      <FieldError id={`${fieldId}-error`}>{error}</FieldError>
      {stale ? <p role="status" className="text-xs text-muted-foreground">The reorder point changed while you were editing.</p> : null}
      <div className="flex flex-wrap gap-2">
        {stale ? (
          <Button type="button" size="sm" disabled={busy || disabled} onClick={reviewLatest}>Review latest point</Button>
        ) : (
          <Button type="button" size="sm" disabled={busy || disabled} onClick={() => void savePoint()}>
            {busy ? "Saving…" : "Save reorder point"}
          </Button>
        )}
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => setDraft(undefined)}>Cancel</Button>
      </div>
    </div>
  );
}

export function RequestEditorSheet({
  branchId,
  branchName,
  existing,
  liveRevision,
  copySkipped = 0,
  canSetReorderPoint = false,
  initialLines = [],
  onClose,
  onSaved,
}: {
  branchId: Id<"branches">;
  branchName: string;
  existing?: {
    requestId: Id<"purchaseRequests">;
    revision: number;
    needBy?: string;
    note?: string;
    lines: StockLineDraft[];
  };
  liveRevision?: number;
  copySkipped?: number;
  canSetReorderPoint?: boolean;
  initialLines?: StockLineDraft[];
  onClose: () => void;
  onSaved: (requestId: Id<"purchaseRequests">, warning?: string) => void;
}) {
  const saveRequest = useMutation(api.commerce.purchasing.saveRequest);
  const submitRequest = useMutation(api.commerce.purchasing.submitRequestForApproval);

  const today = resortTodayIso();
  const [dateError, setDateError] = useState("");
  const initialNeedBy = existing?.needBy ?? "";
  const initialNote = existing?.note ?? "";
  const startingLines = existing?.lines ?? initialLines;

  const [needBy, setNeedBy] = useState(initialNeedBy);
  const [note, setNote] = useState(initialNote);
  const [lines, setLines] = useState<StockLineDraft[]>(startingLines);
  const variantIds = useMemo(() => lines.map((line) => line.variantId), [lines]);
  const { items: reorderRows } = useResolvedStockVariants(branchId, variantIds, { enabled: canSetReorderPoint, includeReorderPoint: true });
  const [lineErrors, setLineErrors] = useState<StockLineFieldErrors>({});
  const [submitNow, setSubmitNow] = useState(!existing);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Retain saved requestId + revision across Save & Submit partial failures so retries never create duplicate drafts
  const [savedDraft, setSavedDraft] = useState<{
    requestId: Id<"purchaseRequests">;
    revision: number;
    reference?: string;
    snapshotKey: string;
  } | null>(() =>
    existing
      ? {
          requestId: existing.requestId,
          revision: existing.revision,
          snapshotKey: buildRequestSnapshotKey(initialNeedBy, initialNote, existing.lines),
        }
      : null,
  );
  const [saveOpKey, setSaveOpKey] = useState(() => createOperationKey("pr-save"));
  const [submitOpKey, setSubmitOpKey] = useState(() => createOperationKey("pr-submit"));
  const [submitPendingDraft, setSubmitPendingDraft] = useState(false);

  const initialSnapshotKey = useMemo(
    () => buildRequestSnapshotKey(initialNeedBy, initialNote, startingLines),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const currentSnapshotKey = buildRequestSnapshotKey(needBy, note, lines);
  const isDirty = currentSnapshotKey !== initialSnapshotKey || submitPendingDraft;
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  const isStale = Boolean(
    existing && savedDraft && liveRevision !== undefined && liveRevision !== savedDraft.revision,
  );

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (needBy && needBy < today && (submitNow || needBy !== initialNeedBy)) {
      setDateError("Choose today or a future date.");
      document.getElementById("pr-need-by")?.focus();
      return;
    }
    const errs: StockLineFieldErrors = {};
    let firstInvalidId: string | undefined;
    if (lines.length === 0) {
      setError("Add at least one item to request.");
      return;
    }
    const payloadLines: { variantId: Id<"productVariants">; quantity: number }[] = [];
    for (const line of lines) {
      const parsed = parseWholeQuantity(line.quantityText, { allowZero: false });
      if (!parsed.ok || !parsed.value) {
        errs[line.variantId] = { quantity: parsed.ok ? "Required" : parsed.error };
        firstInvalidId ??= `pr-line-qty-${line.variantId}`;
      } else {
        payloadLines.push({ variantId: line.variantId, quantity: parsed.value });
      }
    }
    setLineErrors(errs);
    if (Object.keys(errs).length > 0) {
      if (firstInvalidId) document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (isStale) {
      setError("This request changed elsewhere while open. Click Review updated revision above before saving.");
      return;
    }

    setSaving(true);
    let activeDraft = savedDraft;
    let activeSubmitKey = submitOpKey;

    try {
      const needsDraftSave = !activeDraft || activeDraft.snapshotKey !== currentSnapshotKey;
      if (needsDraftSave) {
        const res = await saveRequest({
          branchId,
          ...(activeDraft ? { requestId: activeDraft.requestId, expectedRevision: activeDraft.revision } : {}),
          needBy: needBy || undefined,
          note: note.trim() || undefined,
          lines: payloadLines,
          operationKey: saveOpKey,
        });
        const nextRevision = res.revision ?? ((activeDraft?.revision ?? 0) + 1);
        activeDraft = {
          requestId: res.id as Id<"purchaseRequests">,
          revision: nextRevision,
          reference: res.reference ?? activeDraft?.reference,
          snapshotKey: currentSnapshotKey,
        };
        setSavedDraft(activeDraft);
        setSaveOpKey(createOperationKey("pr-save"));
        activeSubmitKey = createOperationKey("pr-submit");
        setSubmitOpKey(activeSubmitKey);
      }

      let warning: string | undefined;
      if (submitNow && activeDraft) {
        try {
          const result = await submitRequest({
            requestId: activeDraft.requestId,
            expectedRevision: activeDraft.revision,
            operationKey: activeSubmitKey,
          });
          warning = result.warning;
          setSubmitPendingDraft(false);
        } catch (submitCause) {
          // Draft succeeded, submit failed: keep savedDraft + submitOpKey so retrying never duplicates the draft
          setSubmitPendingDraft(true);
          const submitMsg = parseStockError(submitCause, "Could not submit request for approval.").message;
          setError(
            `Draft${activeDraft.reference ? ` ${activeDraft.reference}` : ""} was saved, but submitting failed: ${submitMsg} Fix any issue or retry without creating a duplicate draft.`,
          );
          setSaving(false);
          return;
        }
      }
      if (activeDraft) {
        if (warning) onSaved(activeDraft.requestId, warning);
        else onSaved(activeDraft.requestId);
      }
    } catch (cause) {
      setError(parseStockError(cause, "Could not save purchase request.").message);
      setSaving(false);
    }
  }

  return (
    <>
      <EditorSheet
        open
        wide
        onClose={requestClose}
        header={
          <>
            <SheetTitle>{savedDraft ? "Edit purchase request" : `Request stock · ${branchName}`}</SheetTitle>
            <SheetDescription>
              Select items and quantities needed. Approvers review requests before buyers issue orders.
            </SheetDescription>
          </>
        }
      >
        <SheetForm
          onSubmit={handleSubmit}
          onCancel={requestClose}
          saving={saving}
          error={error}
          submitLabel={
            submitPendingDraft && submitNow && savedDraft?.snapshotKey === currentSnapshotKey
              ? "Retry submit for approval"
              : submitNow
                ? "Save & submit for approval"
                : "Save draft"
          }
        >
          {isStale && savedDraft && liveRevision !== undefined ? (
            <StockStaleBanner
              title="Purchase request changed while editing"
              description={`This request moved from revision ${savedDraft.revision} to ${liveRevision}. Your typed edits are preserved — review the latest revision before saving.`}
              actionLabel="Review updated revision"
              onReview={() => {
                setSavedDraft({ ...savedDraft, revision: liveRevision });
                setError("");
                setSaveOpKey(createOperationKey("pr-save"));
              }}
            />
          ) : null}

          {submitPendingDraft && savedDraft ? (
            <Callout
              tone="info"
              title={`Draft ${savedDraft.reference ?? ""} saved (rev ${savedDraft.revision})`}
              action={
                <Button type="button" size="sm" variant="outline" onClick={() => onSaved(savedDraft.requestId)}>
                  Open saved draft
                </Button>
              }
            >
              Retrying will submit this saved draft (or update it if you change fields) without creating a duplicate request.
            </Callout>
          ) : null}

          {copySkipped > 0 ? (
            <Callout tone="warning">{copySkipped} archived {copySkipped === 1 ? "item was" : "items were"} left out of this draft.</Callout>
          ) : null}
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="pr-need-by">Need-by date (optional)</Label>
              <DatePicker
                id="pr-need-by"
                value={needBy}
                min={today}
                aria-invalid={Boolean(dateError)}
                aria-describedby={dateError ? "pr-need-by-error" : undefined}
                onValueChange={(val) => {
                  setNeedBy(val);
                  setDateError("");
                  setSaveOpKey(createOperationKey("pr-save"));
                }}
                clearable
                placeholder="Optional date"
              />
              <FieldError id="pr-need-by-error">{dateError}</FieldError>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="pr-note">Note (optional)</Label>
              <Textarea
                id="pr-note"
                rows={3}
                maxLength={REQUEST_NOTE_LIMIT}
                className="min-h-24 [field-sizing:content]"
                aria-describedby={note.length >= 1_800 ? "pr-note-count" : undefined}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setSaveOpKey(createOperationKey("pr-save"));
                }}
                placeholder="Context for approver"
              />
              {note.length >= 1_800 ? (
                <p id="pr-note-count" className="text-xs text-muted-foreground">{note.length} / {REQUEST_NOTE_LIMIT} characters</p>
              ) : null}
            </div>
          </div>

          <StockLineEditor
            lines={lines}
            onChange={(next) => {
              setLines(next);
              setLineErrors({});
              setSaveOpKey(createOperationKey("pr-save"));
            }}
            lineErrors={lineErrors}
            onAddClick={() => setPickerOpen(true)}
            addLabel="Add item"
            idPrefix="pr-line"
            renderLineExtra={canSetReorderPoint ? (line) => {
              const row = reorderRows.find((item) => item.variantId === line.variantId);
              return row ? (
                <RequestReorderPoint branchId={branchId} row={row} disabled={saving}
                  onSaved={(reorderPoint) => {
                    const { quantityHint } = newRequestLine({ ...row, reorderPoint });
                    setLines((current) => current.map((item) => item.variantId === row.variantId ? { ...item, quantityHint } : item));
                  }} />
              ) : null;
            } : undefined}
          />

          <label className="flex items-center gap-2.5 text-sm">
            <input
              type="checkbox"
              checked={submitNow}
              onChange={(event) => setSubmitNow(event.target.checked)}
              className="size-4 accent-foreground"
            />
            <span>Submit immediately for approval after saving</span>
          </label>
        </SheetForm>
      </EditorSheet>

      <StockVariantPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        branchId={branchId}
        selectedIds={lines.map((line) => line.variantId)}
        title="Add items to purchase request"
        includeReorderPoint
        onSelectMany={(items) => {
          setLines((curr) => [
            ...curr,
            ...items.map(newRequestLine),
          ]);
          setSaveOpKey(createOperationKey("pr-save"));
        }}
      />
    </>
  );
}

export function OrderEditorSheet({
  branchId,
  branchName,
  canAddSupplier,
  existing,
  liveRevision,
  focusQuantityVariantId,
  fromRequest,
  forHold,
  replacesReturnId,
  initialSupplier,
  initialLines = [],
  onClose,
  onSaved,
}: {
  branchId: Id<"branches">;
  branchName: string;
  canAddSupplier: boolean;
  existing?: {
    orderId: Id<"purchaseOrders">;
    revision: number;
    supplierId: Id<"suppliers">;
    supplierName: string;
    requestId?: Id<"purchaseRequests">;
    expectedDate?: string;
    supplierReference?: string;
    note?: string;
    lines: StockLineDraft[];
  };
  liveRevision?: number;
  focusQuantityVariantId?: Id<"productVariants">;
  fromRequest?: {
    requestId: Id<"purchaseRequests">;
    reference: string;
    lines: StockLineDraft[];
  };
  forHold?: HoldRow;
  replacesReturnId?: Id<"supplierReceiptAdjustments">;
  initialSupplier?: { id: Id<"suppliers">; name: string };
  initialLines?: StockLineDraft[];
  onClose: () => void;
  onSaved: (orderId: Id<"purchaseOrders">) => void;
}) {
  const saveOrder = useMutation(api.commerce.purchasing.saveOrder);
  const [reviewedRevision, setReviewedRevision] = useState<number | undefined>(() => existing?.revision);
  const startSupplier = useMemo(
    () => (existing ? { id: existing.supplierId, name: existing.supplierName } : initialSupplier ?? null),
    [existing, initialSupplier],
  );
  const startLines = useMemo<StockLineDraft[]>(() => {
    if (existing) return existing.lines;
    if (fromRequest) return fromRequest.lines;
    if (forHold) {
      return [
        {
          variantId: forHold.variantId,
          productName: forHold.item.productName,
          variantLabel: forHold.item.variantLabel,
          sku: forHold.item.sku,
          quantityText: String(Math.max(1, forHold.quantity - forHold.acceptedQuantity)),
          unitCostText: "",
        },
      ];
    }
    return initialLines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [supplier, setSupplier] = useState<{ id: Id<"suppliers">; name: string } | null>(startSupplier);
  const [expectedDateEdited, setExpectedDateEdited] = useState(false);
  const [expectedDate, setExpectedDate] = useState(existing?.expectedDate ?? "");
  const [supplierReference, setSupplierReference] = useState(existing?.supplierReference ?? "");
  const [note, setNote] = useState(existing?.note ?? "");
  const [lines, setLines] = useState<StockLineDraft[]>(startLines);
  const [tbc, setTbc] = useState<ReadonlySet<string>>(() => new Set(startLines.filter((line) => line.priceTbc).map((line) => line.variantId)));
  const [lineErrors, setLineErrors] = useState<StockLineFieldErrors>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("po-save"));
  // Replacement orders for held or returned goods may issue without prices; others need a cost or TBC on every line.
  const pricesRequired = !forHold && !replacesReturnId;
  const unpricedLines = lines.filter((line) => !(line.unitCostText ?? "").trim());
  const expectedMin = existing?.expectedDate && existing.expectedDate < resortTodayIso() ? existing.expectedDate : resortTodayIso();

  const isDirty = useMemo(() => {
    if ((supplier?.id ?? null) !== (startSupplier?.id ?? null)) return true;
    if (expectedDate !== (existing?.expectedDate ?? "")) return true;
    if (supplierReference !== (existing?.supplierReference ?? "")) return true;
    if (note !== (existing?.note ?? "")) return true;
    if (lines.length !== startLines.length) return true;
    if (startLines.some((line) => Boolean(line.priceTbc) !== tbc.has(line.variantId))) return true;
    return lines.some((line, idx) => {
      const init = startLines[idx];
      return (
        !init ||
        init.variantId !== line.variantId ||
        init.quantityText !== line.quantityText ||
        (init.unitCostText ?? "") !== (line.unitCostText ?? "")
      );
    });
  }, [supplier, startSupplier, expectedDate, existing, supplierReference, note, lines, startLines, tbc]);

  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);
  const isStale = Boolean(
    existing && reviewedRevision !== undefined && liveRevision !== undefined && liveRevision !== reviewedRevision,
  );

  const requestId = existing?.requestId ?? fromRequest?.requestId;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const errs: StockLineFieldErrors = {};
    let firstInvalidId: string | undefined;
    if (!supplier) {
      setError("Select a supplier before saving this order.");
      return;
    }
    if (lines.length === 0) {
      setError("Add at least one order line.");
      return;
    }
    const payloadLines: {
      variantId: Id<"productVariants">;
      quantity: number;
      unitCost?: number;
      requestLineId?: Id<"purchaseRequestLines">;
      priceTbc?: boolean;
    }[] = [];

    for (const line of lines) {
      const qtyParsed = parseWholeQuantity(line.quantityText, { allowZero: false, max: line.maxQuantity });
      const costParsed = parseOptionalSatang(line.unitCostText ?? "");
      if (!qtyParsed.ok || !qtyParsed.value) {
        errs[line.variantId] = { ...(errs[line.variantId] ?? {}), quantity: qtyParsed.ok ? "Required" : qtyParsed.error };
        firstInvalidId ??= `po-line-qty-${line.variantId}`;
      }
      if (!costParsed.ok) {
        errs[line.variantId] = { ...(errs[line.variantId] ?? {}), unitCost: costParsed.error };
        firstInvalidId ??= `po-line-cost-${line.variantId}`;
      }
      if (qtyParsed.ok && qtyParsed.value && costParsed.ok) {
        payloadLines.push({
          variantId: line.variantId,
          quantity: qtyParsed.value,
          ...(costParsed.value !== undefined ? { unitCost: costParsed.value } : {}),
          ...(costParsed.value === undefined && tbc.has(line.variantId) ? { priceTbc: true } : {}),
          ...(line.requestLineId ? { requestLineId: line.requestLineId as Id<"purchaseRequestLines"> } : {}),
        });
      }
    }
    setLineErrors(errs);
    if (Object.keys(errs).length > 0) {
      if (firstInvalidId) document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (isStale) {
      setError("This draft order changed elsewhere while open. Review the latest revision above before saving.");
      return;
    }

    setSaving(true);
    try {
      const res = await saveOrder({
        branchId,
        ...(existing ? { orderId: existing.orderId, expectedRevision: reviewedRevision ?? existing.revision } : {}),
        supplierId: supplier.id,
        ...(requestId ? { requestId } : {}),
        expectedDate: expectedDateEdited ? expectedDate : expectedDate || undefined,
        supplierReference: supplierReference.trim() || undefined,
        note: note.trim() || undefined,
        ...(forHold ? { forHoldId: forHold._id } : {}),
        ...(replacesReturnId ? { replacesReturnId } : {}),
        lines: payloadLines,
        operationKey: opKey,
      });
      onSaved(res.id as Id<"purchaseOrders">);
    } catch (cause) {
      setError(parseStockError(cause, "Could not save purchase order draft.").message);
      setSaving(false);
    }
  }

  return (
    <>
      <EditorSheet
        open
        wide
        onOpenAutoFocus={(event) => {
          if (!focusQuantityVariantId) return;
          const input = document.getElementById(`po-line-qty-${focusQuantityVariantId}`);
          if (!input) return;
          event.preventDefault();
          input.focus();
        }}
        onClose={requestClose}
        header={
          <>
            <SheetTitle>
              {existing
                ? "Edit draft purchase order"
                : fromRequest
                  ? `Create order from ${fromRequest.reference}`
                  : forHold
                    ? "Create linked order for held goods"
                    : `Create purchase order · ${branchName}`}
            </SheetTitle>
            <SheetDescription>
              Drafts do not affect On order until issued. Choose one supplier and review quantities and optional unit costs.
            </SheetDescription>
          </>
        }
      >
        <SheetForm
          onSubmit={handleSubmit}
          onCancel={requestClose}
          saving={saving}
          error={error}
          submitLabel="Save order draft"
        >
          {isStale && reviewedRevision !== undefined && liveRevision !== undefined ? (
            <StockStaleBanner
              title="Draft purchase order changed while editing"
              description={`This order moved from revision ${reviewedRevision} to ${liveRevision}. Your typed values are preserved — review the latest revision before saving.`}
              actionLabel="Review updated revision"
              onReview={() => {
                setReviewedRevision(liveRevision);
                setError("");
                setOpKey(createOperationKey("po-save"));
              }}
            />
          ) : null}

          <div className="grid gap-1.5">
            <Label>Supplier</Label>
            <SupplierPickerField
              branchId={branchId}
              value={supplier?.id ?? null}
              selectedName={supplier?.name}
              canCreate={canAddSupplier}
              required
              onChange={(next) => {
                setSupplier(next);
                if (!existing && !expectedDateEdited) {
                  setExpectedDate(next?.leadTimeDays === undefined ? "" : addDays(resortTodayIso(), next.leadTimeDays));
                }
                setOpKey(createOperationKey("po-save"));
              }}
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="po-expected">Expected delivery date (optional)</Label>
              <DatePicker
                id="po-expected"
                value={expectedDate}
                onValueChange={(val) => {
                  setExpectedDateEdited(true);
                  setExpectedDate(val);
                  setOpKey(createOperationKey("po-save"));
                }}
                min={expectedMin}
                clearable
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="po-sup-ref">Supplier reference / quote #</Label>
              <Input
                id="po-sup-ref"
                value={supplierReference}
                onChange={(event) => {
                  setSupplierReference(event.target.value);
                  setOpKey(createOperationKey("po-save"));
                }}
                placeholder="Optional reference"
              />
            </div>
          </div>

          <StockLineEditor
            lines={lines}
            onChange={(next) => {
              setLines(next);
              setLineErrors({});
              setOpKey(createOperationKey("po-save"));
            }}
            showUnitCost
            lineErrors={lineErrors}
            onAddClick={requestId ? undefined : () => setPickerOpen(true)}
            addLabel="Add order item"
            idPrefix="po-line"
          />

          {unpricedLines.length > 0 ? (
            <fieldset className="grid gap-2 rounded-lg border border-border p-3 text-sm">
              <legend className="px-1 text-xs font-medium text-muted-foreground">
                {pricesRequired ? "Lines without a unit cost need one, or Price to be confirmed, before issue" : "Lines without a unit cost"}
              </legend>
              {unpricedLines.map((line) => (
                <label key={line.variantId} className="inline-flex items-center gap-2">
                  <input
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={tbc.has(line.variantId)}
                    onChange={(event) => {
                      const next = new Set(tbc);
                      if (event.target.checked) next.add(line.variantId);
                      else next.delete(line.variantId);
                      setTbc(next);
                      setOpKey(createOperationKey("po-save"));
                    }}
                  />
                  <span>{line.productName} · {line.variantLabel} — Price to be confirmed (prints TBC)</span>
                </label>
              ))}
            </fieldset>
          ) : null}

          <div className="grid gap-1.5">
            <Label htmlFor="po-note">Note for supplier (optional)</Label>
            <Textarea
              id="po-note"
              rows={3}
              maxLength={REQUEST_NOTE_LIMIT}
              value={note}
              aria-describedby={note.length >= 1_800 ? "po-note-count" : undefined}
              onChange={(event) => {
                setNote(event.target.value);
                setOpKey(createOperationKey("po-save"));
              }}
              placeholder="Delivery instructions"
              className="field-sizing-content min-h-20"
            />
            {note.length >= 1_800 ? (
              <p id="po-note-count" className="text-xs text-muted-foreground" aria-live="polite">{note.length} / {REQUEST_NOTE_LIMIT} characters</p>
            ) : null}
          </div>
        </SheetForm>
      </EditorSheet>

      <StockVariantPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        branchId={branchId}
        selectedIds={lines.map((line) => line.variantId)}
        title="Add items to purchase order"
        onSelectMany={(items) => {
          setLines((curr) => [
            ...curr,
            ...items.map((item) => ({
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              onHand: item.onHand,
              onOrder: item.onOrder,
              quantityText: "1",
              unitCostText: "",
            })),
          ]);
          setOpKey(createOperationKey("po-save"));
        }}
      />
    </>
  );
}

export function DeclineHoldSheet({
  hold,
  onClose,
  onDone,
}: {
  hold: HoldRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const decline = useMutation(api.commerce.purchasing.declineHeldGoods);
  const [reviewedRevision, setReviewedRevision] = useState(hold.revision);
  const [reason, setReason] = useState("");
  const [handoff, setHandoff] = useState({ carrier: "", returnReference: "", note: "", collected: false });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("hold-dec"));
  const editHandoff = (patch: Partial<typeof handoff>) => {
    setHandoff((current) => ({ ...current, ...patch }));
    setOpKey(createOperationKey("hold-dec"));
  };
  const handoffEntered = Boolean(handoff.carrier.trim() || handoff.returnReference.trim() || handoff.note.trim() || handoff.collected);

  const { requestClose } = useStockDirtyGuard(reason.trim() !== "" || handoffEntered, onClose, saving);
  const isStale = hold.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("Enter a reason for declining the held goods.");
      document.getElementById("decline-hold-reason")?.focus();
      return;
    }
    if (isStale) {
      setError("This held goods record changed while open. Review the updated state above before confirming.");
      return;
    }
    setSaving(true);
    try {
      await decline({
        holdId: hold._id,
        expectedRevision: reviewedRevision,
        reason: reason.trim(),
        ...(handoffEntered
          ? {
              handoff: {
                carrier: handoff.carrier.trim() || undefined,
                returnReference: handoff.returnReference.trim() || undefined,
                note: handoff.note.trim() || undefined,
                collected: handoff.collected || undefined,
              },
            }
          : {}),
        operationKey: opKey,
      });
      onDone();
    } catch (cause) {
      setError(parseStockError(cause, "Could not decline held goods.").message);
      setOpKey(createOperationKey("hold-dec"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Decline held goods</SheetTitle>
          <SheetDescription>
            {hold.item.productName} · {hold.item.variantLabel} (qty {hold.quantity - hold.acceptedQuantity})
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel="Decline & mark returned"
      >
        {isStale ? (
          <StockStaleBanner
            title="Held goods record changed"
            description="This hold was updated elsewhere. Review the latest quantity/status before declining."
            actionLabel="Review updated hold"
            onReview={() => {
              setReviewedRevision(hold.revision);
              setError("");
              setOpKey(createOperationKey("hold-dec"));
            }}
          />
        ) : null}
        <Callout tone="info">
          Declining removes this hold from the open queue without changing On hand.
        </Callout>
        <div className="grid gap-1.5">
          <Label htmlFor="decline-hold-reason">Reason</Label>
          <Input
            id="decline-hold-reason"
            value={reason}
            onChange={(event) => {
              setReason(event.target.value);
              setOpKey(createOperationKey("hold-dec"));
            }}
            placeholder="e.g. Returned excess shipment to supplier driver"
          />
        </div>
        <fieldset className="grid gap-3 rounded-lg border border-border p-3">
          <legend className="px-1 text-sm font-medium text-foreground">Handoff evidence (optional)</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid gap-1.5">
              <Label htmlFor="decline-hold-carrier">Carrier or driver</Label>
              <Input id="decline-hold-carrier" value={handoff.carrier} maxLength={200} onChange={(event) => editHandoff({ carrier: event.target.value })} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="decline-hold-return-ref">Supplier return reference</Label>
              <Input id="decline-hold-return-ref" value={handoff.returnReference} maxLength={64} placeholder="e.g. RMA-881" onChange={(event) => editHandoff({ returnReference: event.target.value })} />
            </div>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="decline-hold-collection-note">Collection note</Label>
            <Input id="decline-hold-collection-note" value={handoff.note} maxLength={2000} placeholder="e.g. Driver signed the return slip" onChange={(event) => editHandoff({ note: event.target.value })} />
          </div>
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input type="checkbox" checked={handoff.collected} onChange={(event) => editHandoff({ collected: event.target.checked })} className="mt-0.5 size-4 accent-foreground" />
            <span>Goods were collected now. Leave unticked if the supplier picks them up later; you can record the pickup from the queue.</span>
          </label>
        </fieldset>
      </SheetForm>
    </EditorSheet>
  );
}
