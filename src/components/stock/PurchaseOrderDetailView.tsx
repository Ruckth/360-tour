"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, CheckCircle2, PackageCheck, Pencil, Printer, Send } from "lucide-react";
import { useState } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { STOCK_TABLE } from "./stock-table";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import {
  Callout,
  NoticeBar,
  useNotice,
} from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoreMenu } from "@/components/ui/more-menu";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { PurchaseEventHistory } from "./PurchaseEventHistory";
import { latenessLabel, relativeDate, URGENCY_CLASS } from "./purchasing-display";
import { PurchaseOrderPrintDialog, type PrintableOrderRevision } from "./PurchaseOrderPrintView";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import {
  createOperationKey,
  formatSatang,
  holdAge,
  invoiceVariance,
  ORDER_STATUS_META,
  parseStockError,
  RECEIPT_KIND_META,
  sanitizeStockReturnTo,
  STOCK_PAGE_SIZE,
  stockReturnLabel,
} from "./stock-format";
import { AmendOrderSheet, CloseRemainderSheet, ReasonSheet } from "./PurchaseOrderSheets";

import { OrderEditorSheet } from "./StockPurchasingHubView";

type OrderDetailResult = FunctionReturnType<typeof api.commerce.purchasing.order>;
type OrderRow = OrderDetailResult["order"];

export function PurchaseOrderDetailView({ orderId }: { orderId: string }) {
  const { current: branch, branches, select: selectBranch } = useAdminBranch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));
  const confirm = useConfirm();
  const { notice, show, clear } = useNotice();

  const id = orderId as Id<"purchaseOrders">;
  const detail = useQuery(api.commerce.purchasing.order, { orderId: id });
  const [tab, setTab] = useState<"overview" | "receipts" | "history">("overview");
  const [printRevNumber, setPrintRevNumber] = useState<number | null>(null);
  const printRevision = useQuery(
    api.commerce.purchasing.orderRevision,
    detail && printRevNumber !== null ? { orderId: detail.order._id, revision: printRevNumber } : "skip",
  );

  const {
    results: receipts,
    status: receiptsStatus,
    loadMore: loadMoreReceipts,
  } = usePaginatedQuery(
    api.commerce.purchasing.orderReceipts,
    detail && tab === "receipts" ? { orderId: detail.order._id } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  const {
    results: events,
    status: historyStatus,
    loadMore: loadMoreHistory,
  } = usePaginatedQuery(
    api.commerce.purchasing.history,
    detail && tab === "history"
      ? { branchId: detail.order.branchId, entity: "order", entityId: detail.order._id }
      : "skip",
    { initialNumItems: 20 },
  );

  const issueOrder = useMutation(api.commerce.purchasing.issuePurchaseOrder);
  const approveIssue = useMutation(api.commerce.purchasing.approvePurchaseOrderIssue);
  const declineIssue = useMutation(api.commerce.purchasing.declinePurchaseOrderIssue);
  const deleteDraft = useMutation(api.commerce.purchasing.deletePurchaseOrderDraft);
  const amendOrder = useMutation(api.commerce.purchasing.amendPurchaseOrder);
  const closeRemainder = useMutation(api.commerce.purchasing.closePurchaseOrderRemainder);

  const [editTarget, setEditTarget] = useState<"draft" | Id<"productVariants"> | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [declineIssueOpen, setDeclineIssueOpen] = useState(false);
  const [allocationShortfalls, setAllocationShortfalls] = useState<
    { orderLineId: Id<"purchaseOrderLines">; available: number }[] | null
  >(null);
  const [busy, setBusy] = useState(false);

  if (!branch) return null;
  if (detail === undefined) return <SkeletonRows label="Loading purchase order" rows={5} />;

  const { order, lines, holds, permissions, sourceRequest } = detail;

  if (order.branchId !== branch.id) {
    const targetBranch = branches.find((b) => b.id === order.branchId);
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
            <ButtonLink href={returnTo ?? "/admin/stock/purchasing?tab=orders"} variant={targetBranch ? "outline" : "default"} size="sm">
              Back to {stockReturnLabel(returnTo, "Orders")}
            </ButtonLink>
          </div>
        }
      >
        This purchase order ({order.reference}) belongs to {targetBranch ? targetBranch.name : "another branch"}. Switch to its branch to view or receive it.
      </Callout>
    );
  }

  const isDraft = order.status === "draft";
  const awaitingApproval = order.status === "awaiting_approval";
  const expected = relativeDate(order.expectedDate);
  const isOpenIssued = order.status === "ordered" || order.status === "partially_received";
  const openHolds = holds.filter((h) => h.status === "open");
  const oldestHold = openHolds.length ? holdAge(Math.min(...openHolds.map((h) => h.createdAt))) : null;
  const heldUnits = openHolds.reduce((sum, h) => sum + h.quantity - h.acceptedQuantity, 0);

  async function handleIssue() {
    setBusy(true);
    setAllocationShortfalls(null);
    try {
      const result = await issueOrder({
        orderId: order._id,
        expectedRevision: order.revision,
        operationKey: createOperationKey("po-issue"),
      });
      show(
        result.awaitingApproval
          ? "This order is above the branch's direct order limit. It was sent to a different approver before it can be issued."
          : "Purchase order issued. You can now print or share it with the supplier.",
        "success",
      );
    } catch (cause) {
      const parsed = parseStockError(cause, "Could not issue order.");
      show(parsed.message, "danger");
      if (cause && typeof cause === "object" && "data" in cause) {
        const data = (cause as { data?: Record<string, unknown> }).data;
        if (data?.code === "ALLOCATION_CHANGED" && Array.isArray(data.lines)) {
          setAllocationShortfalls(data.lines as { orderLineId: Id<"purchaseOrderLines">; available: number }[]);
        }
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleApproveIssue() {
    const ok = await confirm({
      title: `Approve and issue ${order.reference}?`,
      description: `${order.supplier.name} · ${formatSatang(order.totalCost ?? 0)} (above the direct order limit${permissions.directOrderLimit ? ` of ${formatSatang(permissions.directOrderLimit)}` : ""}). Requested by ${order.approvalRequestedByLabel ?? order.createdByLabel}.`,
      confirmLabel: "Approve and issue",
    });
    if (!ok) return;
    setBusy(true);
    try {
      await approveIssue({ orderId: order._id, expectedRevision: order.revision, operationKey: createOperationKey("po-approve") });
      show("Order approved and issued.", "success");
    } catch (cause) {
      show(parseStockError(cause, "Could not approve this order.").message, "danger");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeleteDraft() {
    const ok = await confirm({
      title: `Delete draft ${order.reference}?`,
      description: "Draft orders do not commit quantities. History keeps who deleted the draft and when.",
      confirmLabel: "Delete draft",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteDraft({
        orderId: order._id,
        expectedRevision: order.revision,
        operationKey: createOperationKey("po-del"),
      });
      router.push("/admin/stock/purchasing?tab=orders");
    } catch (cause) {
      show(parseStockError(cause, "Could not delete draft order.").message, "danger");
      setBusy(false);
    }
  }

  const printableDoc: PrintableOrderRevision | null = printRevision
    ? {
        reference: printRevision.reference,
        revision: printRevision.revision,
        branchName: printRevision.branchName,
        supplier: printRevision.supplier,
        expectedDate: printRevision.expectedDate,
        supplierReference: printRevision.supplierReference,
        note: printRevision.note,
        reason: printRevision.reason,
        issuedAt: printRevision.issuedAt,
        actorLabel: printRevision.actorLabel,
        lines: printRevision.lines,
        buyer: printRevision.buyer,
      }
    : null;

  return (
    <div className="grid gap-3 sm:gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-start justify-between gap-2 sm:gap-4">
        <div className="grid gap-1">
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href={returnTo ?? "/admin/stock/purchasing?tab=orders"} variant="ghost" size="sm" className="-ml-2">
              <ArrowLeft aria-hidden className="size-4" />
              {stockReturnLabel(returnTo, "Orders")}
            </ButtonLink>
            <span className="text-xs text-muted-foreground">· {branch.name}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 className="font-mono text-xl font-semibold text-foreground">{order.reference}</h2>
            <StatusBadge {...ORDER_STATUS_META[order.status]} />
            {order.issuedRevision > 0 ? (
              <span className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-muted-foreground">
                Rev {order.issuedRevision}
              </span>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            {order.supplier.name}
            {order.expectedDate ? (
              <>
                {" · Expected "}
                <time dateTime={order.expectedDate}>{order.expectedDate}</time>
                {isOpenIssued ? <span className={cn("ml-1", URGENCY_CLASS[expected.urgency])}>({expected.label})</span> : null}
              </>
            ) : ""}
            {order.supplierReference ? ` · Ref ${order.supplierReference}` : ""}
          </p>
          <OrderValueSummary order={order} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {awaitingApproval && permissions.approver ? (
            <>
              <Button type="button" disabled={busy} onClick={() => void handleApproveIssue()}>
                <CheckCircle2 aria-hidden className="size-4" />
                Approve and issue
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setDeclineIssueOpen(true)}>
                Send back to draft
              </Button>
            </>
          ) : null}
          {isDraft && permissions.buyer ? (
            <>
              <Button type="button" disabled={busy} onClick={() => void handleIssue()}>
                <Send aria-hidden className="size-4" />
                Issue order
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditTarget("draft")}>
                <Pencil aria-hidden className="size-4" />
                Edit draft
              </Button>
            </>
          ) : null}

          {isOpenIssued && order.dueUnits > 0 && permissions.receiver ? (
            <Button type="button" onClick={() => setReceiveOpen(true)}>
              <PackageCheck aria-hidden className="size-4" />
              Receive
            </Button>
          ) : null}

          {!isDraft && order.dueUnits === 0 ? (
            <Button type="button" variant="outline" onClick={() => setTab("receipts")}>
              <CheckCircle2 aria-hidden className="size-4" />
              View receipts
            </Button>
          ) : null}

          {order.issuedRevision > 0 ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setPrintRevNumber(order.issuedRevision)}
            >
              <Printer aria-hidden className="size-4" />
              Print PO
            </Button>
          ) : null}

          <MoreMenu
            label="More order actions"
            items={[
              {
                label: "Amend order",
                hidden: !isOpenIssued || !permissions.buyer,
                onSelect: () => setAmendOpen(true),
              },
              {
                label: "Close remainder",
                hidden: !isOpenIssued || !permissions.buyer,
                destructive: true,
                onSelect: () => setCloseOpen(true),
              },
              {
                label: "Delete draft",
                hidden: !isDraft || !permissions.buyer,
                destructive: true,
                onSelect: () => void handleDeleteDraft(),
              },
            ]}
          />
        </div>
      </div>

      {isDraft && permissions.buyer && allocationShortfalls?.length ? (
        <Callout tone="warning" title="Approved quantity changed on the source request">
          <p>Adjust the draft quantities to fit the remaining approval.</p>
          <ul className="mt-2 grid gap-2 text-xs">
            {allocationShortfalls.map(({ orderLineId, available }) => {
              const line = lines.find((row) => row._id === orderLineId);
              if (!line) return null;
              const label = [line.item.productName, line.item.variantLabel, line.item.sku].filter(Boolean).join(" · ");
              return (
                <li key={orderLineId} className="grid gap-1">
                  <strong>{label}</strong>
                  <span>Requested on this order {line.ordered} · Still available {available}</span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="justify-self-start"
                    onClick={() => setEditTarget(line.variantId)}
                  >
                    Edit quantity for {label}
                  </Button>
                </li>
              );
            })}
          </ul>
        </Callout>
      ) : null}

      {awaitingApproval ? (
        <Callout tone="warning" title="Waiting for order approval">
          {order.totalCost !== undefined ? formatSatang(order.totalCost) : "This order"} is above this branch&apos;s direct order limit
          {permissions.directOrderLimit ? ` of ${formatSatang(permissions.directOrderLimit)}` : ""}. A different approver must approve it before
          it is issued{order.approvalRequestedByLabel ? ` (sent by ${order.approvalRequestedByLabel})` : ""}.
        </Callout>
      ) : null}

      {order.forHoldId ? (
        <Callout
          tone="info"
          title="Linked replacement order for held goods"
          action={
            <ButtonLink href="/admin/stock/purchasing?tab=holds" size="sm" variant="outline">
              View Held goods
            </ButtonLink>
          }
        >
          When receiving this order, select the linked held goods record on the matching line so those held units move into On hand and resolve the hold.
        </Callout>
      ) : null}

      {openHolds.length > 0 ? (
        <Callout
          tone={oldestHold?.tone === "danger" ? "danger" : "warning"}
          className="items-center"
          title={`${heldUnits} held ${heldUnits === 1 ? "unit" : "units"}${oldestHold ? (oldestHold.days === 0 ? " · today" : ` · oldest ${oldestHold.days}d`) : ""}`}
          action={
            <ButtonLink href="/admin/stock/purchasing?tab=holds" size="sm" variant="ghost" aria-label="Review held goods">
              Review
            </ButtonLink>
          }
        />
      ) : null}

      {detail.returnsAwaitingCredit.count > 0 ? (
        <Callout tone="info" title={`${detail.returnsAwaitingCredit.units} returned ${detail.returnsAwaitingCredit.units === 1 ? "unit" : "units"} awaiting a supplier credit`}>
          {detail.returnsAwaitingCredit.count} supplier {detail.returnsAwaitingCredit.count === 1 ? "return expects" : "returns expect"} a credit note. Check it against the supplier statement.
        </Callout>
      ) : null}

      {order.closedReason ? (
        <Callout tone="info" title="Closure note">
          {order.closedReason}
        </Callout>
      ) : null}

      <SegmentedTabs
        id="po-detail"
        label="Purchase order tabs"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "overview", label: "Overview" },
          { value: "receipts", label: "Receipts" },
          { value: "history", label: "History" },
        ]}
      />

      {tab === "overview" ? (
        <div {...tabPanelProps("po-detail", "overview")} className="grid gap-4">
          <Card className="overflow-hidden">
            <table className={STOCK_TABLE.table}>
              <thead className={STOCK_TABLE.head}>
                <tr>
                  <th scope="col" className={STOCK_TABLE.th}>Item</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Ordered</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Accepted</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Rejected on delivery</th>
                  <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Still due</th>
                  {permissions.seeCosts ? (
                    <>
                      <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Unit cost</th>
                      <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Line value</th>
                    </>
                  ) : null}
                </tr>
              </thead>
              <tbody className={STOCK_TABLE.body}>
                {lines.map((line) => (
                  <tr key={line._id} className={STOCK_TABLE.row}>
                    <td data-label="Item" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                      <span className="block font-medium text-foreground">{line.item.productName}</span>
                      <span className="text-xs text-muted-foreground">
                        {line.item.variantLabel}
                        {line.item.sku ? ` · ${line.item.sku}` : ""}
                      </span>
                    </td>
                    <td data-label="Ordered" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.ordered - line.cancelled}
                      {line.cancelled > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          ({line.cancelled} cancelled)
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Accepted" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.accepted}
                      {line.corrected > 0 || line.returned > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {line.corrected > 0 ? `${line.corrected} corr` : ""}
                          {line.corrected > 0 && line.returned > 0 ? " · " : ""}
                          {line.returned > 0 ? `${line.returned} ret` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Rejected on delivery" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.rejected ?? 0}
                      {(line.rejected ?? 0) > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">Still due unless closed · see Receipts</span>
                      ) : null}
                    </td>
                    <td data-label="Still due" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono font-semibold tabular-nums lg:text-right")}>
                      {line.due}
                    </td>
                    {permissions.seeCosts ? (
                      <>
                        <td data-label="Unit cost" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                          {line.unitCost !== undefined ? formatSatang(line.unitCost) : line.priceTbc ? "TBC" : <span className="text-destructive">Price missing</span>}
                        </td>
                        <td data-label="Line value" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                          <span className="block">
                            Received {line.acceptedValue !== undefined ? formatSatang(line.acceptedValue) : line.accepted > 0 ? "— (valuation pending)" : formatSatang(0)}
                          </span>
                          <span className="block text-muted-foreground">
                            Outstanding {line.unitCost === undefined && line.due > 0 ? "unknown" : formatSatang(Math.max(0, line.due) * (line.unitCost ?? 0))}
                          </span>
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <p className="text-xs text-muted-foreground">
            Received value uses each receipt&apos;s recorded unit cost; outstanding units use the current price. Corrections remove
            value at the cost recorded on their receipt; supplier returns leave accepted value unchanged.
          </p>

          {order.requestId ? (
            <p className="text-xs text-muted-foreground">
              Source request:{" "}
              <Link
                href={`/admin/stock/purchasing/requests/${order.requestId}`}
                className="font-mono font-medium text-foreground underline underline-offset-4"
              >
                {sourceRequest?.reference ?? "Open purchase request"}
              </Link>
            </p>
          ) : null}
        </div>
      ) : tab === "receipts" ? (
        <div {...tabPanelProps("po-detail", "receipts")} className="grid gap-4">
          <Card className="overflow-hidden">
            {receiptsStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading order receipts" rows={4} />
            ) : receipts.length === 0 ? (
              <EmptyState>No supplier receipts posted against this order yet.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {receipts.map((rec) => (
                  <li key={rec._id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/admin/stock/purchasing/receipts/${rec._id}`}
                          className="font-mono text-sm font-semibold text-foreground hover:underline"
                        >
                          {rec.reference}
                        </Link>
                        <StatusBadge {...RECEIPT_KIND_META[rec.kind]} />
                        {invoiceVariance(rec.invoiceTotal, rec.acceptedValue)?.flagged ? (
                          <StatusBadge tone="warning" label="Invoice variance" />
                        ) : null}
                        {rec.orderRevision ? (
                          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">Rev {rec.orderRevision}</span>
                        ) : null}
                        <span className={cn("text-xs", rec.lateDays !== null && rec.lateDays > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {latenessLabel(rec.lateDays)}
                          {rec.expectedDate ? ` (expected ${rec.expectedDate}, received ${rec.receivedOn})` : ""}
                        </span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Accepted {rec.acceptedUnits}
                        {rec.rejectedUnits > 0 ? ` · Rejected ${rec.rejectedUnits}` : ""}
                        {rec.heldUnits > 0 ? ` · Held ${rec.heldUnits}` : ""}
                        {rec.deliveryReference ? ` · Ref ${rec.deliveryReference}` : ""}
                        {rec.invoiceTotal !== undefined ? ` · Invoice ${formatSatang(rec.invoiceTotal)}` : ""}
                        {" · "}
                        {rec.actorLabel} · {staffDateTime(rec.createdAt)}
                      </p>
                    </div>
                    <ButtonLink href={`/admin/stock/purchasing/receipts/${rec._id}`} variant="outline" size="sm">
                      Open receipt
                    </ButtonLink>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {receiptsStatus === "CanLoadMore" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => loadMoreReceipts(STOCK_PAGE_SIZE)}>
              Load more receipts
            </Button>
          ) : null}
        </div>
      ) : (
        <div {...tabPanelProps("po-detail", "history")} className="grid gap-4">
          <Card className="p-5">
            <PurchaseEventHistory
              events={events}
              loading={historyStatus === "LoadingFirstPage"}
              hasMore={historyStatus === "CanLoadMore"}
              loadingMore={historyStatus === "LoadingMore"}
              onLoadMore={() => loadMoreHistory(20)}
              onPrintRevision={setPrintRevNumber}
            />
          </Card>
        </div>
      )}

      {editTarget && isDraft && permissions.buyer ? (
        <OrderEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          canAddSupplier={permissions.buyer}
          liveRevision={order.revision}
          focusQuantityVariantId={editTarget === "draft" ? undefined : editTarget}
          existing={{
            orderId: order._id,
            revision: order.revision,
            supplierId: order.supplierId,
            supplierName: order.supplier.name,
            requestId: order.requestId,
            expectedDate: order.expectedDate,
            supplierReference: order.supplierReference,
            note: order.note,
            lines: lines.map((line) => ({
              variantId: line.variantId,
              productName: line.item.productName,
              variantLabel: line.item.variantLabel,
              sku: line.item.sku,
              requestLineId: line.requestLineId,
              quantityText: String(line.ordered),
              unitCostText: line.unitCost !== undefined ? (line.unitCost / 100).toString() : "",
              priceTbc: line.priceTbc,
            })),
          }}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setEditTarget(null);
            setAllocationShortfalls(null);
            show("Order draft updated.", "success");
          }}
        />
      ) : null}

      {receiveOpen ? (
        <ReceiveDeliverySheet
          branchId={branch.id}
          branchName={branch.name}
          initialOrderId={order._id}
          allowDirectReceipt={permissions.directReceipt}
          canAddSupplier={permissions.buyer}
          onClose={() => setReceiveOpen(false)}
          onPosted={(receiptId) => {
            setReceiveOpen(false);
            router.push(`/admin/stock/purchasing/receipts/${receiptId}?returnTo=${encodeURIComponent(`/admin/stock/purchasing/orders/${order._id}`)}`);
          }}
        />
      ) : null}

      {amendOpen ? (
        <AmendOrderSheet
          order={order}
          lines={lines}
          branchId={branch.id}
          canAddDirect={permissions.directOrder}
          requestLines={detail.addableRequestLines}
          requestReference={sourceRequest?.reference}
          onClose={() => setAmendOpen(false)}
          onAmended={() => {
            setAmendOpen(false);
            show("Order amended and new revision issued.", "success");
          }}
          amendMutation={amendOrder}
        />
      ) : null}

      {declineIssueOpen ? (
        <ReasonSheet
          title={`Send ${order.reference} back to draft`}
          description="The buyer can edit the draft and send it again. History keeps your reason."
          submitLabel="Send back"
          placeholder="e.g. Split into two orders under the limit"
          onClose={() => setDeclineIssueOpen(false)}
          onSubmit={async (reason) => {
            await declineIssue({ orderId: order._id, expectedRevision: order.revision, reason, operationKey: createOperationKey("po-decline") });
            setDeclineIssueOpen(false);
            show("Order sent back to draft.", "success");
          }}
        />
      ) : null}

      {closeOpen ? (
        <CloseRemainderSheet
          lines={lines}
          sourceRequest={sourceRequest}
          canCloseDemand={permissions.lead}
          order={order}
          onClose={() => setCloseOpen(false)}
          onClosed={() => {
            setCloseOpen(false);
            show("Remaining due quantities closed.", "success");
          }}
          closeMutation={closeRemainder}
        />
      ) : null}

      <PurchaseOrderPrintDialog
        open={printRevNumber !== null && printableDoc !== null}
        onOpenChange={(next) => {
          if (!next) setPrintRevNumber(null);
        }}
        order={printableDoc}
      />
    </div>
  );
}

/** Received value at receipt costs, outstanding commitment at current prices, and a chip when any line has no price. */
function OrderValueSummary({ order }: { order: OrderRow }) {
  const received = order.receivedValue ?? 0;
  const outstanding = order.outstandingValue ?? 0;
  const unpriced = order.unpricedLines ?? 0;
  if (order.totalCost === undefined || (order.totalCost <= 0 && unpriced === 0)) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>Total {formatSatang(order.totalCost)}</span>
      {order.receivedValue !== undefined ? <span>· Received {formatSatang(received)}</span> : null}
      {order.outstandingValue !== undefined ? <span>· Outstanding {formatSatang(outstanding)}</span> : null}
      {unpriced > 0 ? (
        <span className="rounded bg-amber-100 px-1.5 py-0.5 font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
          Price missing on {unpriced} {unpriced === 1 ? "line" : "lines"}
        </span>
      ) : null}
    </p>
  );
}
