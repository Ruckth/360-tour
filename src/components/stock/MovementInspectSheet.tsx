"use client";

import { useMutation, usePaginatedQuery, useQueries, useQuery, type RequestForQueries } from "convex/react";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { AlertTriangle, CheckCircle2, ExternalLink, Flag, RotateCcw } from "lucide-react";
import { useMemo, useRef, useState, type FormEvent } from "react";
import { SkeletonRows } from "@/components/admin/admin-bulk";
import { Callout, EditorSheet, FieldError, NumberField, SheetForm } from "@/components/admin/marketing/MarketingBits";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import {
  CORRECTION_REASON_CHIPS,
  createOperationKey,
  formatSignedDelta,
  MOVEMENT_KIND_META,
  movementProblemReasons,
  parseStockError,
  parseWholeQuantity,
  PROBLEM_STATUS_META,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";

type StockAccessResult = FunctionReturnType<typeof api.commerce.stock.access>;
type ProblemReportRow = FunctionReturnType<typeof api.commerce.stock.listReports>["page"][number];
type CorrectionPreviewResult = FunctionReturnType<typeof api.commerce.stock.previewCorrection>;

export function MovementInspectSheet({
  branchId,
  movementId,
  access,
  reportContext,
  onClose,
  onSuccess,
}: {
  branchId: Id<"branches">;
  movementId: Id<"stockMovements">;
  access: StockAccessResult;
  reportContext: ProblemReportRow | null;
  onClose: () => void;
  onSuccess: (message: string) => void;
}) {
  const detail = useQuery(api.commerce.stock.getMovement, { branchId, movementId });
  const operationDetail = useQuery(
    api.commerce.stock.getOperation,
    detail?.operationId
      ? { branchId, operationId: detail.operationId }
      : "skip",
  );
  const lotEvidence = useQuery(api.commerce.stockExpansion.movementLots, { branchId, movementId });
  const {
    results: relatedMovements,
    status: sourceActivityStatus,
    loadMore: loadMoreSourceActivity,
  } = usePaginatedQuery(
    api.commerce.stock.sourceActivity,
    detail?.sourceId ? { branchId, sourceId: detail.sourceId } : "skip",
    { initialNumItems: 10 },
  );
  const { results: corrections } = usePaginatedQuery(
    api.commerce.stock.correctionHistory,
    { branchId, movementId },
    { initialNumItems: 10 },
  );

  const postCorrection = useMutation(api.commerce.stock.postCorrection);
  const reportProblem = useMutation(api.commerce.stock.reportProblem);
  const resolveReport = useMutation(api.commerce.stock.resolveReport);

  const [mode, setMode] = useState<"view" | "correct" | "report" | "resolve">("view");

  // Correction state (preserved on error / reconciliation)
  const [qtyText, setQtyText] = useState("");
  const [reason, setReason] = useState(reportContext?.reason ?? "");
  const reconciliationReportId = reportContext?.status === "open" ? reportContext._id : null;
  const [physicalCountText, setPhysicalCountText] = useState("");
  const [confirmNegative, setConfirmNegative] = useState(false);
  const [reviewedBalance, setReviewedBalance] = useState<{ revision: number; onHand: number } | null>(null);
  const [reviewedReportRevision, setReviewedReportRevision] = useState<number | null>(
    reportContext?.revision ?? null,
  );

  // Report / Resolve state
  const [problemReason, setProblemReason] = useState("");
  const [resolveReason, setResolveReason] = useState("");

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const correctionAttempt = useRef<FunctionArgs<typeof api.commerce.stock.postCorrection> | null>(null);
  const [operationKey, setOperationKey] = useState(() => createOperationKey("stock-act"));

  const isDirty =
    (mode === "correct" &&
      (qtyText.trim() !== "" ||
        reason.trim() !== (reportContext?.reason ?? "").trim() ||
        physicalCountText.trim() !== "" ||
        confirmNegative)) ||
    (mode === "report" && problemReason.trim() !== "") ||
    (mode === "resolve" && resolveReason.trim() !== "");

  const { requestClose, confirmDiscard } = useStockDirtyGuard(isDirty, onClose, saving);

  function cancelSubMode() {
    if (saving) return;
    if (!isDirty) {
      setMode("view");
      setError("");
      return;
    }
    void confirmDiscard().then((discard) => {
      if (discard) {
        setMode("view");
        setError("");
      }
    });
  }

  const parsedQty = parseWholeQuantity(qtyText, { allowZero: false });
  const previewQuantity = parsedQty.ok ? parsedQty.value : undefined;
  const previewQueries = useMemo(
    (): RequestForQueries =>
      mode === "correct" && access.lead && previewQuantity
        ? {
            preview: {
              query: api.commerce.stock.previewCorrection,
              args: { branchId, movementId, quantity: previewQuantity },
            },
          }
        : {},
    [mode, access.lead, previewQuantity, branchId, movementId],
  );
  const previewRaw: unknown = useQueries(previewQueries).preview;
  const previewError = previewRaw instanceof Error ? previewRaw : null;
  const preview =
    previewRaw && !(previewRaw instanceof Error) ? (previewRaw as CorrectionPreviewResult) : undefined;

  // Pin observed stock balance revision once preview first loads in correction mode
  if (mode === "correct" && preview && reviewedBalance === null) {
    setReviewedBalance({ revision: preview.line.revision, onHand: preview.line.before });
  }

  const isCorrectionStale = Boolean(
    mode === "correct" && preview && reviewedBalance && preview.line.revision !== reviewedBalance.revision,
  );
  const isReportStale = Boolean(
    mode === "resolve" &&
      reportContext &&
      reviewedReportRevision !== null &&
      reportContext.revision !== reviewedReportRevision,
  );
  const inlineQtyError = qtyText.trim() !== "" && !parsedQty.ok ? parsedQty.error : undefined;

  async function submitCorrection(event: FormEvent) {
    event.preventDefault();
    setError("");
    const previous = correctionAttempt.current;
    if (previous?.operationKey === operationKey) {
      await sendCorrection(previous);
      return;
    }
    if (!parsedQty.ok || !parsedQty.value) {
      setError(parsedQty.ok ? "Enter a correction quantity." : parsedQty.error);
      document.getElementById("corr-qty")?.focus();
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for this correction.");
      document.getElementById("corr-reason")?.focus();
      return;
    }
    if (previewError) {
      setError(parseStockError(previewError, "Cannot preview this correction.").message);
      document.getElementById("corr-qty")?.focus();
      return;
    }
    if (!preview) {
      setError("Wait for the live balance preview to load before posting.");
      return;
    }
    if (isCorrectionStale) {
      setError("Stock balance changed while reviewing this correction. Click Review updated balance above before posting.");
      return;
    }

    let physicalCount: number | undefined;
    if (preview.requiresReconciliation) {
      const parsedCount = parseWholeQuantity(physicalCountText, { allowZero: true, label: "Physical count" });
      if (!parsedCount.ok || parsedCount.value === undefined) {
        setError(parsedCount.ok ? "Enter the physical count." : parsedCount.error);
        document.getElementById("corr-physical-count")?.focus();
        return;
      }
      if (!confirmNegative) {
        setError("Confirm the negative balance after checking the physical count.");
        return;
      }
      physicalCount = parsedCount.value;
    }

    await sendCorrection({
      branchId,
      movementId,
      quantity: parsedQty.value,
      operationKey,
      expectedRevision: reviewedBalance?.revision ?? preview.line.revision,
      reason: reason.trim(),
      ...(reconciliationReportId ? { reportId: reconciliationReportId } : {}),
      ...(physicalCount !== undefined ? { physicalCount } : {}),
      ...(preview.requiresReconciliation && confirmNegative ? { confirmNegative: true } : {}),
    });
  }

  async function sendCorrection(input: FunctionArgs<typeof api.commerce.stock.postCorrection>) {
    correctionAttempt.current = input;
    setSaving(true);
    try {
      const result = await postCorrection(input);
      if (!result.operationId && !result.reportId) {
        setError("The server returned no correction or report. Retry to recover the result.");
        setSaving(false);
        return;
      }
      correctionAttempt.current = null;
      onSuccess(result.operationId ? "Linked stock correction posted." : "Reconciliation report opened in Needs review.");
      onClose();
    } catch (cause) {
      const parsed = parseStockError(cause, "Could not confirm the correction. Retry to recover the result.");
      setError(parsed.message);
      setSaving(false);
    }
  }

  async function submitReport(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!problemReason.trim()) {
      setError("Describe the problem so the stock lead can review it.");
      document.getElementById("report-reason")?.focus();
      return;
    }
    setSaving(true);
    try {
      await reportProblem({
        branchId,
        operationKey,
        movementId,
        reason: problemReason.trim(),
      });
      onSuccess("Problem reported to branch stock lead.");
      onClose();
    } catch (cause) {
      setError(parseStockError(cause, "Could not submit report. Try again.").message);
      setOperationKey(createOperationKey("stock-report"));
      setSaving(false);
    }
  }

  async function submitResolve(event: FormEvent) {
    event.preventDefault();
    if (!reportContext) return;
    setError("");
    if (!resolveReason.trim()) {
      setError("Enter a resolution reason.");
      document.getElementById("resolve-reason")?.focus();
      return;
    }
    if (isReportStale) {
      setError("This report changed while open. Review the updated report above before resolving.");
      return;
    }
    setSaving(true);
    try {
      await resolveReport({
        branchId,
        operationKey,
        reportId: reportContext._id,
        expectedRevision: reviewedReportRevision ?? reportContext.revision,
        reason: resolveReason.trim(),
      });
      onSuccess("Report marked resolved.");
      onClose();
    } catch (cause) {
      setError(parseStockError(cause, "Could not resolve report. Reload and try again.").message);
      setOperationKey(createOperationKey("stock-resolve"));
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
          <SheetTitle>{mode === "report" ? "Report a problem" : "Movement details"}</SheetTitle>
          <SheetDescription>
            {detail ? `${detail.itemLabel} · ${staffDateTime(detail.createdAt)}` : "Loading movement…"}
          </SheetDescription>
        </>
      }
    >
      {!detail ? (
        <div className="p-6">
          <SkeletonRows label="Loading movement details" rows={3} />
        </div>
      ) : mode === "correct" ? (
        <SheetForm
          onSubmit={submitCorrection}
          onCancel={cancelSubMode}
          saving={saving}
          error={error}
          submitLabel={preview?.requiresReconciliation ? "Confirm negative correction" : "Post correction"}
        >
          {isCorrectionStale && preview && reviewedBalance ? (
            <StockStaleBanner
              title="Stock balance changed while reviewing"
              description={`On hand changed from ${reviewedBalance.onHand} to ${preview.line.before}. Your typed correction is preserved — review the updated balance before posting.`}
              actionLabel="Review updated balance"
              onReview={() => {
                setReviewedBalance({ revision: preview.line.revision, onHand: preview.line.before });
                setError("");
                setOperationKey(createOperationKey("stock-corr"));
              }}
            />
          ) : null}

          <Callout tone="info" title={detail.itemLabel}>
            Original movement: <strong>{formatSignedDelta(detail.delta)}</strong> · Up to{" "}
            <strong>{detail.reversibleQuantity}</strong> units eligible to reverse.
          </Callout>

          <div className="grid gap-1.5">
            <Label htmlFor="corr-qty">Quantity to reverse (max {detail.reversibleQuantity})</Label>
            <NumberField
              id="corr-qty"
              value={qtyText}
              aria-invalid={inlineQtyError || previewError ? true : undefined}
              aria-describedby={inlineQtyError ? "corr-qty-error" : undefined}
              onChange={(event) => {
                setQtyText(event.target.value);
                setOperationKey(createOperationKey("stock-corr"));
              }}
              placeholder={String(detail.reversibleQuantity)}
            />
            <Button type="button" variant="outline" size="sm" className="justify-self-start" onClick={() => {
              setQtyText(String(reportContext?.requestedQuantity ?? detail.reversibleQuantity));
              setOperationKey(createOperationKey("stock-corr"));
            }}>
              {reportContext?.requestedQuantity ? "Use reported quantity" : "Use all reversible units"}
            </Button>
            <FieldError id="corr-qty-error">{inlineQtyError}</FieldError>
          </div>

          {previewError ? (
            <Callout tone="warning" role="alert" title="Cannot preview correction">
              {parseStockError(previewError, "Check the quantity and try again.").message}
            </Callout>
          ) : preview ? (
            <Callout
              tone={preview.requiresReconciliation ? "warning" : "info"}
              title={
                preview.requiresReconciliation
                  ? "This correction would make On hand negative"
                  : "Balance preview"
              }
            >
              <p className="tabular-nums">
                Current on hand: <strong>{preview.line.before}</strong> → After correction:{" "}
                <strong>{preview.line.after}</strong> ({formatSignedDelta(preview.line.delta)})
              </p>
              {preview.requiresReconciliation ? (
                <p className="mt-1">
                  Record the physical shelf count and confirm the negative balance. Posting sets <strong>Needs recount</strong> until a verified count posts.
                </p>
              ) : null}
            </Callout>
          ) : null}

          <ReasonField
            id="corr-reason"
            label="Reason for correction"
            value={reason}
            onChange={(value) => {
              setReason(value);
              setOperationKey(createOperationKey("stock-corr"));
            }}
            chips={CORRECTION_REASON_CHIPS}
          />

          {preview?.requiresReconciliation ? (
            <div className="grid gap-3 rounded-lg border border-amber-300/60 bg-amber-50/60 p-4 dark:border-amber-500/30 dark:bg-amber-950/20">
              <div className="flex items-start gap-2 text-sm font-medium text-amber-900 dark:text-amber-200">
                <AlertTriangle aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>Reconciliation evidence required for negative-balance override</span>
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="corr-physical-count">Physical count on shelf</Label>
                <NumberField
                  id="corr-physical-count"
                  value={physicalCountText}
                  onChange={(event) => {
                    setPhysicalCountText(event.target.value);
                    setOperationKey(createOperationKey("stock-corr"));
                  }}
                  placeholder="0"
                />
              </div>
              <label className="flex items-start gap-2.5 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={confirmNegative}
                  onChange={(event) => {
                    setConfirmNegative(event.target.checked);
                    setOperationKey(createOperationKey("stock-corr"));
                  }}
                  className="mt-0.5 size-4 accent-foreground"
                />
                <span>
                  I verified the physical count and explicitly confirm posting this negative balance (marks item as Needs recount).
                </span>
              </label>
            </div>
          ) : null}
        </SheetForm>
      ) : mode === "report" ? (
        <SheetForm
          onSubmit={submitReport}
          onCancel={cancelSubMode}
          saving={saving}
          error={error}
          submitLabel="Submit report"
        >
          <p className="text-sm text-muted-foreground">
            {detail.itemLabel} · {MOVEMENT_KIND_META[detail.kind].label} · {formatSignedDelta(detail.delta)}
          </p>
          <ReasonField
            id="report-reason"
            label="What looks wrong?"
            value={problemReason}
            onChange={setProblemReason}
            chips={movementProblemReasons(detail.kind)}
            placeholder="Describe the quantity or item issue…"
          />
        </SheetForm>
      ) : mode === "resolve" && reportContext ? (
        <SheetForm
          onSubmit={submitResolve}
          onCancel={cancelSubMode}
          saving={saving}
          error={error}
          submitLabel="Mark resolved"
        >
          {isReportStale ? (
            <StockStaleBanner
              title="Report changed while open"
              description="This report was updated elsewhere. Review the latest status before marking it resolved."
              actionLabel="Review updated report"
              onReview={() => {
                setReviewedReportRevision(reportContext.revision);
                setError("");
                setOperationKey(createOperationKey("stock-resolve"));
              }}
            />
          ) : null}
          <Callout tone="info" title="Resolve without posting a correction">
            Reported by {reportContext.actorLabel}: “{reportContext.reason}”
          </Callout>
          <div className="grid gap-1.5">
            <Label htmlFor="resolve-reason">Resolution note</Label>
            <Input
              id="resolve-reason"
              value={resolveReason}
              onChange={(event) => setResolveReason(event.target.value)}
              placeholder="Explain why no correction was needed or how it was handled"
            />
            <FieldError id="resolve-reason-error">{!resolveReason.trim() && error ? error : undefined}</FieldError>
          </div>
        </SheetForm>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="grid min-h-0 flex-1 content-start gap-4 overflow-y-auto px-5 py-5 sm:px-6">
            {reportContext ? (
              <Callout tone="info" title="Reported problem">
                <p className="break-words">{reportContext.reason}</p>
              </Callout>
            ) : null}
            <dl className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-muted/30 p-3 text-sm [&>div]:min-w-0 [&_dd]:wrap-anywhere">
              <div>
                <dt className="text-xs text-muted-foreground">Type</dt>
                <dd className="mt-1">
                  <StatusBadge {...MOVEMENT_KIND_META[detail.kind]} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Change</dt>
                <dd className="mt-1 font-mono font-semibold tabular-nums">
                  {formatSignedDelta(detail.delta)} ({detail.before} → {detail.after})
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Staff</dt>
                <dd className="mt-0.5 text-foreground">{detail.actorLabel}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">SKU</dt>
                <dd className="mt-0.5 font-mono text-foreground">{detail.sku ?? "—"}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted-foreground">Reason</dt>
                <dd className="mt-0.5 text-foreground">{detail.reason ?? detail.reasonCode ?? "—"}</dd>
              </div>
            </dl>

            <div className="flex flex-wrap gap-2">
              {detail.orderId ? (
                <ButtonLink href={`/admin/receipt/${detail.orderId}`} variant="outline" size="sm">
                  <ExternalLink aria-hidden className="size-4" />
                  Open sales receipt
                </ButtonLink>
              ) : null}
              {detail.receiptId ? (
                <ButtonLink
                  href={`/admin/stock/purchasing/receipts/${detail.receiptId}?${new URLSearchParams({
                    returnTo: reportContext ? "/admin/stock/activity?view=needs-review" : "/admin/stock/activity",
                    ...(reportContext && access.lead ? { focusMovement: detail.originalMovementId ?? movementId } : {}),
                  })}`}
                  variant="outline"
                  size="sm"
                >
                  <ExternalLink aria-hidden className="size-4" />
                  {reportContext && access.lead ? "Correct on receipt" : "Open supplier receipt"}
                </ButtonLink>
              ) : null}
              {detail.kind === "count" ? (
                <ButtonLink
                  href={`/admin/stock/balances?countVariantId=${detail.variantId}`}
                  variant="outline"
                  size="sm"
                >
                  Recount against today’s balance
                </ButtonLink>
              ) : null}
              {detail.canCorrect ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => {
                    correctionAttempt.current = null;
                    setOperationKey(createOperationKey("stock-corr"));
                    setQtyText("");
                    setPhysicalCountText("");
                    setConfirmNegative(false);
                    setReviewedBalance(null);
                    setError("");
                    setMode("correct");
                  }}
                >
                  <RotateCcw aria-hidden className="size-4" />
                  Correct movement
                </Button>
              ) : null}
              {!access.lead ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("report")}>
                  <Flag aria-hidden className="size-4" />
                  Report a problem
                </Button>
              ) : null}
              {access.lead && reportContext?.status === "open" ? (
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("resolve")}>
                  <CheckCircle2 aria-hidden className="size-4" />
                  Resolve report
                </Button>
              ) : null}
            </div>

            {relatedMovements.length > 1 ? (
              <section aria-label="Movements from same source" className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  All movements in this source ({relatedMovements.length})
                </h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {relatedMovements.map((rel) => (
                    <li key={rel._id} className="flex items-center justify-between gap-2 p-3 text-xs">
                      <span className="min-w-0 truncate font-medium text-foreground">
                        {rel.itemLabel}
                        {rel.sku ? ` (${rel.sku})` : ""}
                      </span>
                      <span className="shrink-0 font-mono tabular-nums text-muted-foreground">
                        {formatSignedDelta(rel.delta)} ({rel.before} → {rel.after})
                      </span>
                    </li>
                  ))}
                </ul>
                {sourceActivityStatus === "CanLoadMore" ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => loadMoreSourceActivity(10)}
                  >
                    Load more source lines
                  </Button>
                ) : null}
              </section>
            ) : null}

            {detail.reports.length > 0 ? (
              <section aria-label="Your reports" className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">Your reports on this movement</h3>
                <ul className="grid gap-2">
                  {detail.reports.map((report) => (
                    <li key={report._id} className="rounded-lg border border-border p-3 text-xs">
                      <StatusBadge {...PROBLEM_STATUS_META[report.status]} />
                      {report.resolution ? (
                        <p className="mt-1.5 text-muted-foreground">Resolution: {report.resolution}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {lotEvidence && lotEvidence.allocations.length > 0 ? (
              <section aria-label="Lot allocations" className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">Lot allocations</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {lotEvidence.allocations.map((alloc) => (
                    <li key={alloc.lotId} className="flex items-center justify-between gap-2 p-3 text-xs">
                      <span className="font-mono font-medium text-foreground">
                        {alloc.code ?? alloc.lotId}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        Qty {alloc.quantity}
                        {alloc.expiresAt ? ` · Exp ${staffDateTime(alloc.expiresAt)}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {operationDetail ? (
              <section aria-label="Stock operation source" className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">
                  Source stock operation ({operationDetail.kind})
                </h3>
                <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs">
                  <p className="text-muted-foreground">
                    Posted by <strong className="text-foreground">{operationDetail.actorLabel}</strong> ·{" "}
                    {staffDateTime(operationDetail.createdAt)} · {operationDetail.lines.length}{" "}
                    {operationDetail.lines.length === 1 ? "line" : "lines"}
                    {operationDetail.physicalCount !== undefined
                      ? ` · Physical count evidence: ${operationDetail.physicalCount}`
                      : ""}
                  </p>
                  {operationDetail.reason ? (
                    <p className="mt-1 text-foreground">Reason: {operationDetail.reason}</p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {corrections.length > 0 ? (
              <section aria-label="Linked corrections" className="grid gap-2">
                <h3 className="text-sm font-semibold text-foreground">Linked corrections</h3>
                <ul className="divide-y divide-border rounded-lg border border-border">
                  {corrections.map((corr) => (
                    <li key={corr._id} className="grid gap-1 p-3 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono font-semibold text-foreground">
                          {formatSignedDelta(corr.delta)} ({corr.before} → {corr.after})
                        </span>
                        <span className="text-muted-foreground">{staffDateTime(corr.createdAt)}</span>
                      </div>
                      <p className="text-muted-foreground">
                        {corr.actorLabel}
                        {corr.reason ? ` · ${corr.reason}` : ""}
                      </p>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>

          <div className="flex justify-end border-t border-border px-5 py-4 sm:px-6">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </EditorSheet>
  );
}
