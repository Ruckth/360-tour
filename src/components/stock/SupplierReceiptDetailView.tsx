"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, ExternalLink, Flag, PackagePlus, Pencil, RotateCcw, Undo2 } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { SkeletonRows } from "@/components/admin/admin-bulk";
import { STOCK_TABLE } from "./stock-table";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import {
  Callout,
  EditorSheet,
  NoticeBar,
  SheetForm,
  useNotice,
} from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ReasonField } from "@/components/ui/reason-field";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { CorrectReceiptLineSheet, ReturnToSupplierSheet, ReverseReturnSheet } from "./SupplierReceiptAdjustmentSheets";
import { PurchaseEventHistory } from "./PurchaseEventHistory";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import {
  CORRECTION_REASON_CHIPS,
  createOperationKey,
  formatSatang,
  HOLD_STATUS_META,
  invoiceVariance,
  parseStockError,
  PROBLEM_STATUS_META,
  RECEIPT_KIND_META,
  rejectReasonLabel,
  returnOutcomeLabel,
  sanitizeStockReturnTo,
  stockReturnLabel,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";
import { OrderEditorSheet } from "./StockPurchasingHubView";

type ReceiptDetailResult = FunctionReturnType<typeof api.commerce.purchasing.receipt>;
type ReceiptRow = ReceiptDetailResult["receipt"];
type ReceiptLineRow = ReceiptDetailResult["lines"][number];
type AdjustmentRow = FunctionReturnType<typeof api.commerce.purchasing.receiptAdjustments>["page"][number];

export function SupplierReceiptDetailView({ receiptId }: { receiptId: string }) {
  const { current: branch, branches, select: selectBranch } = useAdminBranch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const focusMovement = searchParams.get("focusMovement");
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));
  const { notice, show, clear } = useNotice();

  const id = receiptId as Id<"supplierReceipts">;
  const detail = useQuery(api.commerce.purchasing.receipt, { receiptId: id });
  const [tab, setTab] = useState<"overview" | "history">("overview");
  const adjustmentPage = usePaginatedQuery(api.commerce.purchasing.receiptAdjustments,
    detail && tab === "overview" ? { receiptId: id } : "skip", { initialNumItems: 25 });
  const adjustments = adjustmentPage.results;

  const { results: events, status: historyStatus, loadMore: loadMoreHistory } = usePaginatedQuery(
    api.commerce.purchasing.history,
    detail && tab === "history"
      ? { branchId: detail.receipt.branchId, entity: "receipt", entityId: detail.receipt._id }
      : "skip",
    { initialNumItems: 20 },
  );

  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [correctingLineId, setCorrectingLineId] = useState<Id<"supplierReceiptLines"> | null>(null);
  const [returningLineId, setReturningLineId] = useState<Id<"supplierReceiptLines"> | null>(null);
  const [reportingLine, setReportingLine] = useState<ReceiptLineRow | null>(null);
  const [reversingAdjustment, setReversingAdjustment] = useState<AdjustmentRow | null>(null);
  const [followUpAdjustment, setFollowUpAdjustment] = useState<AdjustmentRow | null>(null);
  const [receivingMissing, setReceivingMissing] = useState(false);
  const [replacementReturn, setReplacementReturn] = useState<Pick<AdjustmentRow, "_id" | "variantId" | "item" | "quantity"> | null>(null);

  const focusedLine = detail?.receipt.branchId === branch?.id && focusMovement
    ? detail?.lines.find(line => line.movementId === focusMovement)
    : undefined;
  const focusedLineId = focusedLine?._id;
  useEffect(() => {
    if (tab !== "overview" || !focusedLineId) return;
    const target = document.getElementById(`receipt-stock-line-${focusedLineId}`);
    target?.focus();
  }, [focusedLineId, tab]);

  if (!branch) return null;
  if (detail === undefined) return <SkeletonRows label="Loading supplier receipt" rows={5} />;

  const { receipt, lines, holds, permissions } = detail;

  if (receipt.branchId !== branch.id) {
    const targetBranch = branches.find((b) => b.id === receipt.branchId);
    return (
      <Callout
        tone="warning"
        title="Different branch selected"
        action={
          <div className="flex flex-wrap gap-2">
            {targetBranch ? (
              <Button type="button" size="sm" onClick={() => void selectBranch(targetBranch.id)}>
                Switch to {targetBranch.name}
              </Button>
            ) : null}
            <ButtonLink href={returnTo ?? "/admin/stock/purchasing?tab=receipts"} variant={targetBranch ? "outline" : "default"} size="sm">
              Back to {stockReturnLabel(returnTo, "Purchasing")}
            </ButtonLink>
          </div>
        }
      >
        This supplier receipt ({receipt.reference}) belongs to {targetBranch ? targetBranch.name : "another branch"}. Switch to its branch to inspect or adjust it.
      </Callout>
    );
  }

  const correctingLine = correctingLineId ? lines.find((l) => l._id === correctingLineId) ?? null : null;
  const returningLine = returningLineId ? lines.find((l) => l._id === returningLineId) ?? null : null;
  const defaultBackHref = receipt.orderId
    ? `/admin/stock/purchasing/orders/${receipt.orderId}`
    : "/admin/stock/purchasing?tab=receipts";
  const defaultBackLabel = receipt.orderId ? (receipt.orderReference ? `Order ${receipt.orderReference}` : "Order") : "Receipts";
  const currentReceiptHref = `/admin/stock/purchasing/receipts/${receipt._id}`;
  // Cost columns and the receipt total are for buyers and stock leads; the server omits them for everyone else.
  const seeCost = permissions.buyer || permissions.lead;
  const variance = invoiceVariance(receipt.invoiceTotal, receipt.acceptedValue);

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink
              href={returnTo ?? defaultBackHref}
              variant="ghost"
              size="sm"
              className="-ml-2"
            >
              <ArrowLeft aria-hidden className="size-4" />
              {returnTo ? stockReturnLabel(returnTo, defaultBackLabel) : defaultBackLabel}
            </ButtonLink>
            <span className="text-xs text-muted-foreground">· {branch.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-mono text-xl font-semibold text-foreground">{receipt.reference}</h2>
            <StatusBadge {...RECEIPT_KIND_META[receipt.kind]} />
          </div>
          <p className="text-xs text-muted-foreground">
            {receipt.supplier?.name ? `${receipt.supplier.name} · ` : ""}
            {receipt.deliveryReference ? `Delivery ref ${receipt.deliveryReference} · ` : ""}
            Posted by {receipt.actorLabel} · {staffDateTime(receipt.createdAt)}
          </p>
          {seeCost && (receipt.acceptedValue !== undefined || receipt.invoiceTotal !== undefined) ? (
            <p className="text-sm tabular-nums text-foreground">
              Receipt total <strong>{formatSatang(receipt.acceptedValue ?? 0)}</strong>
              {receipt.invoiceTotal !== undefined ? <> · Invoice <strong>{formatSatang(receipt.invoiceTotal)}</strong></> : null}
            </p>
          ) : null}
          {receipt.overDeliveredUnits ? (
            <p className="text-xs text-muted-foreground">
              Includes {receipt.overDeliveredUnits} over-delivered {receipt.overDeliveredUnits === 1 ? "unit" : "units"} accepted within the branch tolerance.
            </p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          {permissions.receiver && (receipt.orderId || permissions.directReceipt) && lines.length > 0 ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setReceivingMissing(true)}>
              <PackagePlus aria-hidden className="size-3.5" />
              Receive missing units
            </Button>
          ) : null}
          {permissions.receiver || permissions.lead ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setEditMetaOpen(true)}>
              <Pencil aria-hidden className="size-3.5" />
              Edit ref / note
            </Button>
          ) : null}
          <ButtonLink
            href={`/admin/stock/activity?returnTo=${encodeURIComponent(currentReceiptHref)}`}
            variant="outline"
            size="sm"
          >
            <ExternalLink aria-hidden className="size-3.5" />
            Activity
          </ButtonLink>
        </div>
      </div>

      {seeCost && variance?.flagged ? (
        <Callout tone="warning" title="Invoice differs from the order price">
          The invoice is {formatSatang(Math.abs(variance.difference))} {variance.difference > 0 ? "above" : "below"} the accepted value at order cost. Check the supplier price before paying. Stock is not affected.
        </Callout>
      ) : null}

      {receipt.undercountOf ? (
        <p className="text-sm text-muted-foreground">
          Missing units from <Link className="text-foreground underline underline-offset-4" href={`/admin/stock/purchasing/receipts/${receipt.undercountOf}`}>
            {receipt.undercountOfReference ?? "the original receipt"}
          </Link>
        </p>
      ) : null}

      {receipt.reason || receipt.note ? (
        <Card className="grid gap-1 px-4 py-3 text-xs text-muted-foreground">
          {receipt.reason ? (
            <p>
              <strong className="text-foreground">Reason:</strong> {receipt.reason}
            </p>
          ) : null}
          {receipt.note ? (
            <p>
              <strong className="text-foreground">Note:</strong> {receipt.note}
            </p>
          ) : null}
        </Card>
      ) : null}

      <SegmentedTabs
        id="receipt-detail"
        label="Supplier receipt tabs"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "history", label: "History" },
        ]}
      />

      {tab === "overview" ? (
        <div {...tabPanelProps("receipt-detail", "overview")} className="grid gap-5">
          <Card className="overflow-hidden">
            <table className={STOCK_TABLE.table}>
              <thead className={STOCK_TABLE.head}>
                <tr>
                  <th scope="col" className={STOCK_TABLE.th}>Item</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Accepted</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Rejected</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Corrected / Returned</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Eligible</th>
                  {seeCost ? <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Unit cost</th> : null}
                  {seeCost ? <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Line value</th> : null}
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody className={STOCK_TABLE.body}>
                {lines.map((line) => (
                  <tr key={line._id} id={`receipt-stock-line-${line._id}`} tabIndex={focusedLine?._id === line._id ? -1 : undefined}
                    className={cn(STOCK_TABLE.row, focusedLine?._id === line._id && "bg-muted/50")}>
                    <td data-label="Item" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                      <span className="block font-medium text-foreground">{line.item.productName}</span>
                      <span className="text-xs text-muted-foreground">
                        {line.item.variantLabel}
                        {line.item.sku ? ` · ${line.item.sku}` : ""}
                      </span>
                      {line.rejectReason || line.rejectReasonCode ? (
                        <span className="mt-0.5 block text-xs text-destructive">
                          Rejected: {[rejectReasonLabel(line.rejectReasonCode), line.rejectReason].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Accepted" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.accepted}
                    </td>
                    <td data-label="Rejected" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.rejected}
                    </td>
                    <td data-label="Corrected / Returned" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                      {line.corrected} / {line.returned}
                    </td>
                    <td data-label="Eligible" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono font-semibold tabular-nums lg:text-right")}>
                      {line.eligible}
                    </td>
                    {seeCost ? (
                      <td data-label="Unit cost" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                        {formatSatang(line.unitCost)}
                      </td>
                    ) : null}
                    {seeCost ? (
                      <td data-label="Line value" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                        {line.unitCost === undefined ? "—" : formatSatang(line.accepted * line.unitCost)}
                      </td>
                    ) : null}
                    <td className={cn(STOCK_TABLE.cell, "lg:text-right")}>
                      {permissions.lead && line.eligible > 0 ? (
                        <div className="flex flex-wrap gap-1.5 lg:justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setCorrectingLineId(line._id)}
                            title="We counted or posted wrong"
                          >
                            <RotateCcw aria-hidden className="size-3.5" />
                            Correct qty
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setReturningLineId(line._id)}
                            title="Goods go back to the supplier"
                          >
                            <Undo2 aria-hidden className="size-3.5" />
                            Return
                          </Button>
                        </div>
                      ) : line.movementId ? (
                        <div className="flex flex-wrap gap-1.5 lg:justify-end">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setReportingLine(line)}
                          >
                            <Flag aria-hidden className="size-3.5" />
                            Report a problem
                          </Button>
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {permissions.lead && lines.some((line) => line.eligible > 0) ? (
              <p className="border-t border-border px-4 py-2.5 text-xs text-muted-foreground">
                <strong className="text-foreground">Correct qty</strong>: we counted or posted wrong; the units become due again.{" "}
                <strong className="text-foreground">Return</strong>: goods go back to the supplier (damaged, wrong or expired); accepted quantities stay.
              </p>
            ) : null}
          </Card>

          {adjustmentPage.status === "LoadingFirstPage" ? <SkeletonRows rows={2} label="Loading receipt adjustments" /> : null}
          {adjustments.length > 0 ? (
            <section aria-label="Corrections and supplier returns" className="grid gap-3">
              <h3 className="text-sm font-semibold text-foreground">
                Corrections & supplier returns ({adjustments.length})
              </h3>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {adjustments.map((adj) => (
                    <li key={adj._id} className="flex flex-wrap items-start justify-between gap-3 p-4">
                      <div className="grid gap-1 text-xs">
                        <div className="flex flex-wrap items-center gap-2">
                          <StatusBadge
                            tone={adj.kind === "supplier_return" ? "danger" : adj.kind === "return_reversal" ? "info" : "accent"}
                            label={
                              adj.kind === "supplier_return"
                                ? "Supplier return"
                                : adj.kind === "return_reversal"
                                  ? "Return reversal"
                                  : "Quantity correction"
                            }
                          />
                          <span className="font-medium text-foreground">
                            {adj.item.productName} · {adj.item.variantLabel} (qty {adj.quantity})
                          </span>
                        </div>
                        <p className="text-foreground">{adj.reason}</p>
                        <p className="text-muted-foreground">
                          {adj.actorLabel} · {staffDateTime(adj.createdAt)}
                          {adj.supplierReference ? ` · Supplier ref ${adj.supplierReference}` : ""}
                          {adj.returnOutcome ? ` · ${returnOutcomeLabel(adj.returnOutcome)}` : ""}
                          {adj.negativeOverride ? ` · Negative override (counted ${adj.countedOnHand})` : ""}
                        </p>
                        {adj.followUpReceiptId ? (
                          <p>
                            Follow-up receipt:{" "}
                            <Link
                              href={`/admin/stock/purchasing/receipts/${adj.followUpReceiptId}`}
                              className="font-mono underline underline-offset-4"
                            >
                              Open linked receipt
                            </Link>
                          </p>
                        ) : null}
                      </div>

                      <div className="flex flex-wrap gap-2">
                        {adj.kind === "correction" && !adj.followUpReceiptId && permissions.receiver ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setFollowUpAdjustment(adj)}
                          >
                            <PackagePlus aria-hidden className="size-3.5" />
                            Receive correct item
                          </Button>
                        ) : null}
                        {adj.kind === "supplier_return" &&
                        adj.quantity > adj.reversedQuantity &&
                        permissions.lead ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setReversingAdjustment(adj)}
                          >
                            Reverse return
                          </Button>
                        ) : null}
                        {adj.kind === "supplier_return" && permissions.directOrder ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => setReplacementReturn(adj)}
                          >
                            Replacement order
                          </Button>
                        ) : null}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>
              {adjustmentPage.status !== "Exhausted" ? (
                <Button type="button" variant="outline" size="sm" className="justify-self-start"
                  disabled={adjustmentPage.status !== "CanLoadMore"} onClick={() => adjustmentPage.loadMore(25)}>
                  Load more adjustments
                </Button>
              ) : null}
            </section>
          ) : null}

          {holds.length > 0 ? (
            <section aria-label="Held goods on receipt" className="grid gap-3">
              <h3 className="text-sm font-semibold text-foreground">Held goods ({holds.length})</h3>
              <Card className="overflow-hidden">
                <ul className="divide-y divide-border">
                  {holds.map((hold) => (
                    <li key={hold._id} className="flex flex-wrap items-center justify-between gap-2 p-4 text-xs">
                      <div>
                        <p className="font-medium text-foreground">
                          {hold.item.productName} · {hold.item.variantLabel} (qty {hold.quantity})
                        </p>
                        <p className="text-muted-foreground">{hold.reason}</p>
                      </div>
                      <StatusBadge {...HOLD_STATUS_META[hold.status]} />
                    </li>
                  ))}
                </ul>
              </Card>
            </section>
          ) : null}
        </div>
      ) : (
        <div {...tabPanelProps("receipt-detail", "history")}>
          <Card className="p-5">
            <PurchaseEventHistory
              events={events}
              loading={historyStatus === "LoadingFirstPage"}
              hasMore={historyStatus === "CanLoadMore"}
              loadingMore={historyStatus === "LoadingMore"}
              onLoadMore={() => loadMoreHistory(20)}
            />
          </Card>
        </div>
      )}

      {editMetaOpen ? (
        <EditReceiptDetailsSheet
          receipt={receipt}
          onClose={() => setEditMetaOpen(false)}
          onSaved={() => {
            setEditMetaOpen(false);
            show("Receipt details updated.", "success");
          }}
        />
      ) : null}

      {correctingLine ? (
        <CorrectReceiptLineSheet
          line={correctingLine}
          onClose={() => setCorrectingLineId(null)}
          onSwitchToReturn={() => {
            setCorrectingLineId(null);
            setReturningLineId(correctingLine._id);
          }}
          onDone={(resolvedReport) => {
            setCorrectingLineId(null);
            show(
              resolvedReport
                ? "Receipt quantity correction posted and reconciliation report resolved."
                : "Receipt quantity correction posted.",
              "success",
            );
          }}
        />
      ) : null}

      {returningLine ? (
        <ReturnToSupplierSheet
          line={returningLine}
          onClose={() => setReturningLineId(null)}
          onDone={({ adjustmentId, outcome, quantity }) => {
            setReturningLineId(null);
            if (outcome === "replacement_expected" && permissions.directOrder) {
              show("Supplier return posted. Create the replacement order.", "success");
              setReplacementReturn({ _id: adjustmentId, variantId: returningLine.variantId, item: returningLine.item, quantity });
              return;
            }
            show(
              outcome === "replacement_expected"
                ? "Supplier return posted. Ask a buyer to raise the replacement order from this receipt."
                : "Supplier return posted.",
              "success",
            );
          }}
        />
      ) : null}

      {reportingLine && reportingLine.movementId ? (
        <ReportReceiptLineProblemSheet
          branchId={receipt.branchId}
          receiptReference={receipt.reference}
          line={reportingLine}
          movementId={reportingLine.movementId}
          onClose={() => setReportingLine(null)}
          onSubmitted={() => {
            setReportingLine(null);
            show("Problem reported to branch stock lead.", "success");
          }}
        />
      ) : null}

      {reversingAdjustment ? (
        <ReverseReturnSheet
          adjustment={reversingAdjustment}
          onClose={() => setReversingAdjustment(null)}
          onDone={() => {
            setReversingAdjustment(null);
            show("Supplier return reversed.", "success");
          }}
        />
      ) : null}

      {followUpAdjustment || receivingMissing ? (
        <ReceiveDeliverySheet
          branchId={branch.id}
          branchName={branch.name}
          initialOrderId={receivingMissing ? receipt.orderId : undefined}
          initialMode={receivingMissing ? (receipt.orderId ? "po" : "direct") : permissions.directReceipt ? "direct" : "po"}
          initialSupplier={
            receipt.supplierId && receipt.supplier
              ? { id: receipt.supplierId, name: receipt.supplier.name }
              : undefined
          }
          allowDirectReceipt={permissions.directReceipt}
          canAddSupplier={permissions.buyer}
          followUp={followUpAdjustment ? { adjustmentId: followUpAdjustment._id, quantity: followUpAdjustment.quantity } : undefined}
          undercount={receivingMissing ? { receiptId: receipt._id } : undefined}
          initialLines={receivingMissing && !receipt.orderId && lines.length === 1 ? lines.map(line => ({
            variantId: line.variantId, productName: line.item.productName, variantLabel: line.item.variantLabel, sku: line.item.sku,
            quantityText: "", unitCostText: "",
          })) : undefined}
          onClose={() => {
            setFollowUpAdjustment(null);
            setReceivingMissing(false);
          }}
          onPosted={(newReceiptId) => {
            setFollowUpAdjustment(null);
            setReceivingMissing(false);
            router.push(`/admin/stock/purchasing/receipts/${newReceiptId}?returnTo=${encodeURIComponent(currentReceiptHref)}`);
          }}
        />
      ) : null}

      {replacementReturn ? (
        <OrderEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          canAddSupplier={permissions.buyer}
          replacesReturnId={replacementReturn._id}
          initialSupplier={
            receipt.supplierId && receipt.supplier
              ? { id: receipt.supplierId, name: receipt.supplier.name }
              : undefined
          }
          initialLines={[
            {
              variantId: replacementReturn.variantId,
              productName: replacementReturn.item.productName,
              variantLabel: replacementReturn.item.variantLabel,
              sku: replacementReturn.item.sku,
              quantityText: String(replacementReturn.quantity),
              unitCostText: "",
            },
          ]}
          onClose={() => setReplacementReturn(null)}
          onSaved={(orderId) => {
            setReplacementReturn(null);
            router.push(`/admin/stock/purchasing/orders/${orderId}?returnTo=${encodeURIComponent(currentReceiptHref)}`);
          }}
        />
      ) : null}
    </div>
  );
}

function EditReceiptDetailsSheet({
  receipt,
  onClose,
  onSaved,
}: {
  receipt: ReceiptRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const updateReceipt = useMutation(api.commerce.purchasing.updateReceipt);
  const [reviewedRevision, setReviewedRevision] = useState(receipt.revision);
  const [initialRef] = useState(receipt.deliveryReference ?? "");
  const [initialNote] = useState(receipt.note ?? "");
  const [deliveryReference, setDeliveryReference] = useState(initialRef);
  const [note, setNote] = useState(initialNote);
  const [duplicateConflict, setDuplicateConflict] = useState<{
    receiptId: Id<"supplierReceipts">;
    reference: string;
  } | null>(null);
  const [dupReason, setDupReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("gr-edit"));

  const isDirty = deliveryReference !== initialRef || note !== initialNote || dupReason.trim() !== "";
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);
  const isStale = receipt.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (isStale) {
      setError("This receipt changed while editing. Review the updated receipt above before saving.");
      return;
    }
    setSaving(true);
    try {
      await updateReceipt({
        receiptId: receipt._id,
        expectedRevision: reviewedRevision,
        deliveryReference: deliveryReference.trim() || undefined,
        note: note.trim() || undefined,
        ...(duplicateConflict && dupReason.trim()
          ? { confirmDuplicate: { receiptId: duplicateConflict.receiptId, reason: dupReason.trim() } }
          : {}),
        operationKey: opKey,
      });
      onSaved();
    } catch (cause) {
      setError(parseStockError(cause, "Could not update receipt.").message);
      if (cause && typeof cause === "object" && "data" in cause) {
        const data = (cause as { data?: Record<string, unknown> }).data;
        if (data?.code === "DUPLICATE_DELIVERY" && typeof data.receiptId === "string") {
          setDuplicateConflict({
            receiptId: data.receiptId as Id<"supplierReceipts">,
            reference: typeof data.reference === "string" ? data.reference : data.receiptId,
          });
        }
      }
      setOpKey(createOperationKey("gr-edit"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Edit {receipt.reference}</SheetTitle>
          <SheetDescription>Update delivery reference or note. Changes are logged in History.</SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Save changes">
        {isStale ? (
          <StockStaleBanner
            title="Receipt changed while editing"
            description={`This receipt moved from revision ${reviewedRevision} to ${receipt.revision}. Your typed edits are preserved — review the latest revision before saving.`}
            actionLabel="Review updated receipt"
            onReview={() => {
              setReviewedRevision(receipt.revision);
              setError("");
              setOpKey(createOperationKey("gr-edit"));
            }}
          />
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="edit-gr-ref">Delivery reference</Label>
          <Input
            id="edit-gr-ref"
            value={deliveryReference}
            onChange={(e) => {
              setDeliveryReference(e.target.value);
              setDuplicateConflict(null);
            }}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="edit-gr-note">Note</Label>
          <Input id="edit-gr-note" value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        {duplicateConflict ? (
          <Callout tone="warning" title={`Matches prior receipt ${duplicateConflict.reference}`}>
            <div className="grid gap-1.5">
              <Label htmlFor="edit-gr-dup">Confirm separate delivery reason</Label>
              <Input id="edit-gr-dup" value={dupReason} onChange={(e) => setDupReason(e.target.value)} />
            </div>
          </Callout>
        ) : null}
      </SheetForm>
    </EditorSheet>
  );
}

function ReportReceiptLineProblemSheet({
  branchId,
  receiptReference,
  line,
  movementId,
  onClose,
  onSubmitted,
}: {
  branchId: Id<"branches">;
  receiptReference: string;
  line: ReceiptLineRow;
  movementId: Id<"stockMovements">;
  onClose: () => void;
  onSubmitted: () => void;
}) {
  const reportProblem = useMutation(api.commerce.stock.reportProblem);
  const movement = useQuery(api.commerce.stock.getMovement, { branchId, movementId });
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("gr-report"));

  const { requestClose } = useStockDirtyGuard(reason.trim() !== "", onClose, saving);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("Describe the problem so the branch stock lead can review it.");
      document.getElementById("gr-report-reason")?.focus();
      return;
    }
    setSaving(true);
    try {
      await reportProblem({
        branchId,
        movementId,
        reason: reason.trim(),
        operationKey: opKey,
      });
      onSubmitted();
    } catch (cause) {
      setError(parseStockError(cause, "Could not submit problem report. Try again.").message);
      setOpKey(createOperationKey("gr-report"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Report a problem · {receiptReference}</SheetTitle>
          <SheetDescription>
            {line.item.productName} · {line.item.variantLabel} (accepted {line.accepted})
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Submit report">
        {movement?.reports.length ? (
          <ul className="grid gap-2 text-sm" aria-label="Your earlier reports for this line">
            {movement.reports.map(report => (
              <li key={report._id} className="flex flex-wrap items-center gap-2">
                <StatusBadge {...PROBLEM_STATUS_META[report.status]} />
                {report.resolution ? <span>{report.resolution}</span> : null}
              </li>
            ))}
          </ul>
        ) : null}
        <Callout tone="info" title="Flag for stock lead review">
          This opens a report in <strong>Activity › Needs review</strong> linked to this receipt line’s stock movement.
        </Callout>
        <ReasonField
          id="gr-report-reason"
          label="What looks wrong?"
          value={reason}
          onChange={(val) => {
            setReason(val);
            setOpKey(createOperationKey("gr-report"));
          }}
          chips={CORRECTION_REASON_CHIPS}
          placeholder="Describe the quantity, SKU, or delivery discrepancy…"
        />
      </SheetForm>
    </EditorSheet>
  );
}
