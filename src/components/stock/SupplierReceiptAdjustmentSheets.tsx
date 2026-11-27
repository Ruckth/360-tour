"use client";

import { useMutation, useQueries, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { AlertTriangle } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Callout, EditorSheet, FieldError, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";
import { CORRECTION_REASON_CHIPS, createOperationKey, parseStockError, parseWholeQuantity, SUPPLIER_RETURN_REASON_CHIPS } from "./stock-format";

type ReceiptLineRow = FunctionReturnType<typeof api.commerce.purchasing.receipt>["lines"][number];
type AdjustmentRow = FunctionReturnType<typeof api.commerce.purchasing.receiptAdjustments>["page"][number];
type ReceiptCorrectionPreviewResult = FunctionReturnType<typeof api.commerce.purchasing.correctionPreview>;

export function CorrectReceiptLineSheet({
  line,
  onClose,
  onDone,
}: {
  line: ReceiptLineRow;
  onClose: () => void;
  onDone: (resolvedReport: boolean) => void;
}) {
  const correctReceipt = useMutation(api.commerce.purchasing.correctReceipt);
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [report, setReport] = useState<{ id: Id<"stockProblemReports">; revision: number; quantity: number } | null>(null);
  const [blockedMessage, setBlockedMessage] = useState("");
  const [countedText, setCountedText] = useState("");
  const [confirmNegative, setConfirmNegative] = useState(false);
  const [reviewedSnapshot, setReviewedSnapshot] = useState<{ eligible: number; onHand: number; stockRevision: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("gr-corr"));

  const isDirty =
    qtyText.trim() !== "" ||
    reason.trim() !== "" ||
    countedText.trim() !== "" ||
    confirmNegative ||
    report !== null;
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  const parsedQty = parseWholeQuantity(qtyText, { allowZero: false, max: line.eligible });
  const quantity = parsedQty.ok ? parsedQty.value : undefined;
  const previewQueries = useMemo(
    (): RequestForQueries =>
      quantity
        ? {
            preview: {
              query: api.commerce.purchasing.correctionPreview,
              args: { receiptLineId: line._id, quantity },
            },
          }
        : {},
    [quantity, line._id],
  );
  const previewRaw: unknown = useQueries(previewQueries).preview;
  const previewError = previewRaw instanceof Error ? previewRaw : null;
  const preview =
    previewRaw && !(previewRaw instanceof Error) ? (previewRaw as ReceiptCorrectionPreviewResult) : undefined;

  if (preview && reviewedSnapshot === null) {
    setReviewedSnapshot({ eligible: preview.eligible, onHand: preview.onHand, stockRevision: preview.stockRevision });
  }

  const isStale = Boolean(
    reviewedSnapshot &&
      (line.eligible !== reviewedSnapshot.eligible ||
        (preview !== undefined && (preview.stockRevision !== reviewedSnapshot.stockRevision || preview.eligible !== reviewedSnapshot.eligible))),
  );
  const inlineQtyError = qtyText.trim() !== "" && !parsedQty.ok ? parsedQty.error : undefined;
  const currentReport = report && preview?.stockRevision === report.revision && quantity === report.quantity ? report : null;
  const mayConfirmNegative = preview?.blockedBy === "negative_stock" && currentReport !== null;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!parsedQty.ok || !parsedQty.value) {
      setError(parsedQty.ok ? "Enter how many units to remove." : parsedQty.error);
      document.getElementById("gr-corr-qty")?.focus();
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for this correction.");
      document.getElementById("gr-corr-reason")?.focus();
      return;
    }
    if (previewError) {
      setError(parseStockError(previewError, "Cannot preview this receipt correction.").message);
      document.getElementById("gr-corr-qty")?.focus();
      return;
    }
    if (isStale || !preview) {
      setError("Balance or eligible quantity changed while reviewing. Click Review updated balance above before posting.");
      return;
    }

    let negativeOverride: { countedOnHand: number; stockRevision: number } | undefined;
    if (mayConfirmNegative && currentReport) {
      if (!confirmNegative) {
        setError("Record the physical count and check the confirmation box to post a negative-balance correction.");
        document.getElementById("gr-corr-confirm-neg")?.focus();
        return;
      }
      const parsedCount = parseWholeQuantity(countedText, { allowZero: true, label: "Physical count" });
      if (!parsedCount.ok || parsedCount.value === undefined) {
        setError(parsedCount.ok ? "Enter the physical count." : parsedCount.error);
        document.getElementById("gr-corr-count")?.focus();
        return;
      }
      negativeOverride = { countedOnHand: parsedCount.value, stockRevision: currentReport.revision };
    }

    setSaving(true);
    try {
      const result = await correctReceipt({
        receiptLineId: line._id,
        quantity: parsedQty.value,
        reason: reason.trim(),
        ...(currentReport ? { reportId: currentReport.id } : {}),
        negativeOverride,
        operationKey: opKey,
      });
      if (result.outcome === "reported") {
        setReport({ id: result.reportId, revision: result.stockRevision, quantity: result.requestedQuantity });
        setBlockedMessage(result.blockedBy === "lot_reconciliation"
          ? "Count or adjust the affected lots under Transfers & Lots, then review this correction again."
          : "Record the shelf count and confirm the negative-balance correction.");
        setOpKey(createOperationKey("gr-corr"));
        setSaving(false);
        return;
      }
      onDone(Boolean(result.resolvedReportId));
    } catch (cause) {
      setError(parseStockError(cause, "Could not post receipt correction.").message);
      setOpKey(createOperationKey("gr-corr"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Correct quantity</SheetTitle>
          <SheetDescription>
            {line.item.productName} · {line.item.variantLabel} (up to {line.eligible} eligible)
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
          preview?.blockedBy
            ? mayConfirmNegative
              ? "Confirm negative correction"
              : "Open reconciliation report"
            : "Post correction"
        }
      >
        {isStale && reviewedSnapshot ? (
          <StockStaleBanner
            title="Balance or eligible quantity changed"
            description={`Observed On hand ${reviewedSnapshot.onHand} / eligible ${reviewedSnapshot.eligible} changed to On hand ${preview?.onHand ?? reviewedSnapshot.onHand} / eligible ${preview?.eligible ?? line.eligible}. Your typed correction is preserved — review before posting.`}
            actionLabel="Review updated balance"
            onReview={() => {
              setReviewedSnapshot({
                eligible: preview?.eligible ?? line.eligible,
                onHand: preview?.onHand ?? reviewedSnapshot.onHand,
                stockRevision: preview?.stockRevision ?? reviewedSnapshot.stockRevision,
              });
              setConfirmNegative(false);
              setCountedText("");
              setError("");
              setOpKey(createOperationKey("gr-corr"));
            }}
          />
        ) : null}

        {blockedMessage ? (
          <Callout tone="info" role="status" title="Reconciliation report opened">
            {blockedMessage}
          </Callout>
        ) : null}

        <div className="grid gap-1.5">
          <Label htmlFor="gr-corr-qty">Units to remove (max {line.eligible})</Label>
          <NumberField
            id="gr-corr-qty"
            value={qtyText}
            aria-invalid={inlineQtyError || previewError ? true : undefined}
            aria-describedby={inlineQtyError ? "gr-corr-qty-err" : undefined}
            onChange={(e) => {
              setQtyText(e.target.value);
              setOpKey(createOperationKey("gr-corr"));
            }}
            placeholder={String(line.eligible)}
          />
          <FieldError id="gr-corr-qty-err">{inlineQtyError}</FieldError>
        </div>

        {previewError ? (
          <Callout tone="warning" role="alert" title="Cannot preview correction">
            {parseStockError(previewError, "Check the quantity and try again.").message}
          </Callout>
        ) : preview ? (
          <Callout
            tone={preview.blockedBy ? "warning" : "info"}
            title={preview.blockedBy === "lot_reconciliation" ? "Review the affected lots" : preview.negative ? "Balance would become negative" : "Effect preview"}
          >
            <p className="tabular-nums">
              On hand: <strong>{preview.onHand}</strong> → <strong>{preview.onHandAfter}</strong>
            </p>
            {preview.dueBefore !== null && preview.dueAfter !== null ? (
              <p className="tabular-nums">
                Order still due: <strong>{preview.dueBefore}</strong> → <strong>{preview.dueAfter}</strong>
                {preview.remainderClosed ? " (corrected units stay closed)" : ""}
              </p>
            ) : null}
          </Callout>
        ) : null}

        <ReasonField
          id="gr-corr-reason"
          label="Reason"
          value={reason}
          onChange={(value) => {
            setReason(value);
            setOpKey(createOperationKey("gr-corr"));
          }}
          chips={CORRECTION_REASON_CHIPS}
        />

        {mayConfirmNegative ? (
          <div className="grid gap-3 rounded-lg border border-amber-300/60 bg-amber-50/60 p-3.5 dark:border-amber-500/30 dark:bg-amber-950/20">
            <div className="flex items-start gap-2 text-xs font-medium text-amber-900 dark:text-amber-200">
              <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span>Reconciliation report opened. Record physical shelf count to confirm negative override (sets Needs recount).</span>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="gr-corr-count">Physical count on shelf</Label>
              <NumberField
                id="gr-corr-count"
                value={countedText}
                onChange={(e) => setCountedText(e.target.value)}
                placeholder="0"
              />
            </div>
            <label className="flex items-start gap-2 text-xs text-foreground">
              <input
                id="gr-corr-confirm-neg"
                type="checkbox"
                checked={confirmNegative}
                onChange={(e) => setConfirmNegative(e.target.checked)}
                className="mt-0.5 size-4 accent-foreground"
              />
              <span>Confirm negative-balance correction after verifying shelf count.</span>
            </label>
          </div>
        ) : null}
      </SheetForm>
    </EditorSheet>
  );
}

export function ReturnToSupplierSheet({
  line,
  onClose,
  onDone,
}: {
  line: ReceiptLineRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const submitReturn = useMutation(api.commerce.purchasing.supplierReturn);
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState("");
  const [supplierReference, setSupplierReference] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("gr-ret"));

  const isDirty = qtyText.trim() !== "" || reason.trim() !== "" || supplierReference.trim() !== "";
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsed = parseWholeQuantity(qtyText, { allowZero: false, max: line.eligible });
    if (!parsed.ok || !parsed.value) {
      setError(parsed.ok ? "Enter return quantity." : parsed.error);
      document.getElementById("ret-qty")?.focus();
      return;
    }
    if (!reason.trim()) {
      setError("Enter a return reason.");
      document.getElementById("ret-reason")?.focus();
      return;
    }
    setSaving(true);
    try {
      await submitReturn({
        receiptLineId: line._id,
        quantity: parsed.value,
        reason: reason.trim(),
        supplierReference: supplierReference.trim() || undefined,
        operationKey: opKey,
      });
      onDone();
    } catch (cause) {
      setError(parseStockError(cause, "Could not post supplier return.").message);
      setOpKey(createOperationKey("gr-ret"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Return to supplier</SheetTitle>
          <SheetDescription>
            {line.item.productName} · {line.item.variantLabel} (up to {line.eligible} eligible). Order accepted quantities stay unchanged.
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Post supplier return">
        <div className="grid gap-1.5">
          <Label htmlFor="ret-qty">Quantity leaving stock (max {line.eligible})</Label>
          <NumberField id="ret-qty" value={qtyText} onChange={(e) => setQtyText(e.target.value)} placeholder="0" />
        </div>
        <ReasonField
          id="ret-reason"
          label="Reason"
          value={reason}
          onChange={setReason}
          chips={SUPPLIER_RETURN_REASON_CHIPS}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="ret-ref">Supplier return / RMA reference (optional)</Label>
          <Input id="ret-ref" value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}

export function ReverseReturnSheet({
  adjustment,
  onClose,
  onDone,
}: {
  adjustment: AdjustmentRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const reverseReturn = useMutation(api.commerce.purchasing.reverseReturn);
  const maxQty = adjustment.quantity - adjustment.reversedQuantity;
  const [qtyText, setQtyText] = useState(String(maxQty));
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("gr-revret"));

  const isDirty = qtyText !== String(maxQty) || reason.trim() !== "";
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const parsed = parseWholeQuantity(qtyText, { allowZero: false, max: maxQty });
    if (!parsed.ok || !parsed.value) {
      setError(parsed.ok ? "Enter quantity to reverse." : parsed.error);
      document.getElementById("rev-ret-qty")?.focus();
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for reversing this supplier return.");
      document.getElementById("rev-ret-reason")?.focus();
      return;
    }
    setSaving(true);
    try {
      await reverseReturn({
        adjustmentId: adjustment._id,
        quantity: parsed.value,
        reason: reason.trim(),
        operationKey: opKey,
      });
      onDone();
    } catch (cause) {
      setError(parseStockError(cause, "Could not reverse supplier return.").message);
      setOpKey(createOperationKey("gr-revret"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Reverse supplier return</SheetTitle>
          <SheetDescription>
            {adjustment.item.productName} · {adjustment.item.variantLabel} (up to {maxQty} reversible)
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Post reversal">
        <div className="grid gap-1.5">
          <Label htmlFor="rev-ret-qty">Quantity to restore (max {maxQty})</Label>
          <NumberField id="rev-ret-qty" value={qtyText} onChange={(e) => setQtyText(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="rev-ret-reason">Reason</Label>
          <Input id="rev-ret-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}
