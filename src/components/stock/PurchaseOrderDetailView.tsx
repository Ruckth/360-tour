"use client";

import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, CheckCircle2, PackageCheck, Pencil, Printer, Send } from "lucide-react";
import { useState, type FormEvent } from "react";
import { EmptyState, SkeletonRows, STACKED_TABLE } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import {
  Callout,
  EditorSheet,
  FieldError,
  NoticeBar,
  NumberField,
  SheetForm,
  useNotice,
} from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MoreMenu } from "@/components/ui/more-menu";
import { SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { PurchaseEventHistory } from "./PurchaseEventHistory";
import { PurchaseOrderPrintDialog, type PrintableOrderRevision } from "./PurchaseOrderPrintView";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import {
  createOperationKey,
  formatSatang,
  ORDER_STATUS_META,
  parseOptionalSatang,
  parseStockError,
  parseWholeQuantity,
  RECEIPT_KIND_META,
  sanitizeStockReturnTo,
  STOCK_PAGE_SIZE,
  stockReturnLabel,
} from "./stock-format";
import { StockStaleBanner, useStockDirtyGuard } from "./StockFormGuard";
import { OrderEditorSheet } from "./StockPurchasingHubView";

type OrderDetailResult = FunctionReturnType<typeof api.commerce.purchasing.order>;
type OrderRow = OrderDetailResult["order"];
type OrderLineRow = OrderDetailResult["lines"][number];

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
  const revisionPage = usePaginatedQuery(api.commerce.purchasing.orderRevisions,
    detail && tab === "history" ? { orderId: id } : "skip", { initialNumItems: STOCK_PAGE_SIZE });
  const revisions = revisionPage.results;

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
  const deleteDraft = useMutation(api.commerce.purchasing.deletePurchaseOrderDraft);
  const amendOrder = useMutation(api.commerce.purchasing.amendPurchaseOrder);
  const closeRemainder = useMutation(api.commerce.purchasing.closePurchaseOrderRemainder);

  const [editOpen, setEditOpen] = useState(false);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [amendOpen, setAmendOpen] = useState(false);
  const [closeOpen, setCloseOpen] = useState(false);
  const [allocationShortfalls, setAllocationShortfalls] = useState<
    { requestLineId?: string; available?: number }[] | null
  >(null);
  const [busy, setBusy] = useState(false);

  if (!branch) return null;
  if (detail === undefined) return <SkeletonRows label="Loading purchase order" rows={5} />;

  const { order, lines, holds, permissions } = detail;

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
  const isOpenIssued = order.status === "ordered" || order.status === "partially_received";
  const openHolds = holds.filter((h) => h.status === "open");

  async function handleIssue() {
    setBusy(true);
    setAllocationShortfalls(null);
    try {
      await issueOrder({
        orderId: order._id,
        expectedRevision: order.revision,
        operationKey: createOperationKey("po-issue"),
      });
      show("Purchase order issued. You can now print or share it with the supplier.", "success");
    } catch (cause) {
      const parsed = parseStockError(cause, "Could not issue order.");
      show(parsed.message, "danger");
      if (cause && typeof cause === "object" && "data" in cause) {
        const data = (cause as { data?: Record<string, unknown> }).data;
        if (data?.code === "ALLOCATION_CHANGED" && Array.isArray(data.lines)) {
          setAllocationShortfalls(data.lines as { requestLineId?: string; available?: number }[]);
        }
      }
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
      }
    : null;

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-start justify-between gap-4">
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
            {order.expectedDate ? ` · Expected ${order.expectedDate}` : ""}
            {order.supplierReference ? ` · Ref ${order.supplierReference}` : ""}
            {order.totalCost > 0 ? ` · Total ${formatSatang(order.totalCost)}` : ""}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {isDraft && permissions.buyer ? (
            <>
              <Button type="button" disabled={busy} onClick={() => void handleIssue()}>
                <Send aria-hidden className="size-4" />
                Issue order
              </Button>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setEditOpen(true)}>
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

      {allocationShortfalls && allocationShortfalls.length > 0 ? (
        <Callout tone="warning" title="Approved quantity changed on the source request">
          <p>Another order used part of the approved amount. Edit this draft to fit what is still available:</p>
          <ul className="mt-1 list-disc pl-5 text-xs">
            {allocationShortfalls.map((s, idx) => (
              <li key={idx}>
                Line {s.requestLineId ?? idx + 1}: <strong>{s.available ?? 0}</strong> still available
              </li>
            ))}
          </ul>
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
          tone="warning"
          title={`${openHolds.length} unresolved held-goods ${openHolds.length === 1 ? "entry" : "entries"} on this order`}
          action={
            <ButtonLink href="/admin/stock/purchasing?tab=holds" size="sm" variant="outline">
              Open Held goods
            </ButtonLink>
          }
        >
          Held units stay outside On hand even after the order is received or closed.
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
            <table className={STACKED_TABLE.table}>
              <thead className={STACKED_TABLE.head}>
                <tr>
                  <th scope="col" className={STACKED_TABLE.th}>Item</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Ordered</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Accepted</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Still due</th>
                  <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Unit cost</th>
                </tr>
              </thead>
              <tbody className={STACKED_TABLE.body}>
                {lines.map((line) => (
                  <tr key={line._id} className={STACKED_TABLE.row}>
                    <td data-label="Item" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                      <span className="block font-medium text-foreground">{line.item.productName}</span>
                      <span className="text-xs text-muted-foreground">
                        {line.item.variantLabel}
                        {line.item.sku ? ` · ${line.item.sku}` : ""}
                      </span>
                    </td>
                    <td data-label="Ordered" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.ordered - line.cancelled}
                      {line.cancelled > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          ({line.cancelled} cancelled)
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Accepted" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {line.accepted}
                      {line.corrected > 0 || line.returned > 0 ? (
                        <span className="block text-[11px] text-muted-foreground">
                          {line.corrected > 0 ? `${line.corrected} corr` : ""}
                          {line.corrected > 0 && line.returned > 0 ? " · " : ""}
                          {line.returned > 0 ? `${line.returned} ret` : ""}
                        </span>
                      ) : null}
                    </td>
                    <td data-label="Still due" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono font-semibold tabular-nums lg:text-right")}>
                      {line.due}
                    </td>
                    <td data-label="Unit cost" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono tabular-nums lg:text-right")}>
                      {formatSatang(line.unitCost)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          {order.requestId ? (
            <p className="text-xs text-muted-foreground">
              Source request:{" "}
              <Link
                href={`/admin/stock/purchasing/requests/${order.requestId}`}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Open purchase request
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
                        {rec.orderRevision ? (
                          <span className="text-xs text-muted-foreground">Rev {rec.orderRevision}</span>
                        ) : null}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Accepted {rec.acceptedUnits}
                        {rec.rejectedUnits > 0 ? ` · Rejected ${rec.rejectedUnits}` : ""}
                        {rec.heldUnits > 0 ? ` · Held ${rec.heldUnits}` : ""}
                        {rec.deliveryReference ? ` · Ref ${rec.deliveryReference}` : ""}
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
          {revisionPage.status === "LoadingFirstPage" ? <SkeletonRows rows={2} label="Loading issued revisions" /> : null}
          {revisions.length > 0 ? (
            <Card className="p-4">
              <h3 className="text-sm font-semibold text-foreground">Issued revisions</h3>
              <ul className="mt-3 divide-y divide-border">
                {revisions.map((rev) => (
                  <li key={rev.revision} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0">
                    <div className="text-xs">
                      <span className="font-mono font-semibold text-foreground">Rev {rev.revision}</span>
                      <span className="text-muted-foreground">
                        {" · "}
                        {staffDateTime(rev.issuedAt)} · {rev.actorLabel}
                        {rev.reason ? ` · ${rev.reason}` : ""}
                      </span>
                    </div>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setPrintRevNumber(rev.revision)}
                    >
                      <Printer aria-hidden className="size-3.5" />
                      Print Rev {rev.revision}
                    </Button>
                  </li>
                ))}
              </ul>
              {revisionPage.status !== "Exhausted" ? (
                <Button type="button" variant="outline" size="sm"
                  disabled={revisionPage.status !== "CanLoadMore"} onClick={() => revisionPage.loadMore(STOCK_PAGE_SIZE)}>
                  Load more revisions
                </Button>
              ) : null}
            </Card>
          ) : null}

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

      {editOpen ? (
        <OrderEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          canAddSupplier={permissions.buyer}
          liveRevision={order.revision}
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
            })),
          }}
          onClose={() => setEditOpen(false)}
          onSaved={() => {
            setEditOpen(false);
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
          onClose={() => setAmendOpen(false)}
          onAmended={() => {
            setAmendOpen(false);
            show("Order amended and new revision issued.", "success");
          }}
          amendMutation={amendOrder}
        />
      ) : null}

      {closeOpen ? (
        <CloseRemainderSheet
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

function AmendOrderSheet({
  order,
  lines,
  onClose,
  onAmended,
  amendMutation,
}: {
  order: OrderRow;
  lines: OrderLineRow[];
  onClose: () => void;
  onAmended: () => void;
  amendMutation: (args: {
    orderId: Id<"purchaseOrders">;
    expectedRevision: number;
    reason: string;
    expectedDate?: string;
    supplierReference?: string;
    lines: { orderLineId: Id<"purchaseOrderLines">; due?: number; unitCost?: number }[];
    operationKey: string;
  }) => Promise<{ id: string }>;
}) {
  const [reviewedRevision, setReviewedRevision] = useState(order.revision);
  const [initialState] = useState(() => ({
    expectedDate: order.expectedDate ?? "",
    supplierReference: order.supplierReference ?? "",
    dueByLine: Object.fromEntries(lines.map((line) => [line._id, String(line.due)])),
    costByLine: Object.fromEntries(
      lines.map((line) => [line._id, line.unitCost !== undefined ? (line.unitCost / 100).toString() : ""]),
    ),
  }));
  const [expectedDate, setExpectedDate] = useState(initialState.expectedDate);
  const [supplierReference, setSupplierReference] = useState(initialState.supplierReference);
  const [reason, setReason] = useState("");
  const [dueByLine, setDueByLine] = useState<Record<string, string>>(initialState.dueByLine);
  const [costByLine, setCostByLine] = useState<Record<string, string>>(initialState.costByLine);
  const [lineErrors, setLineErrors] = useState<Record<string, { due?: string; cost?: string }>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("po-amend"));

  const isDirty =
    expectedDate !== initialState.expectedDate ||
    supplierReference !== initialState.supplierReference ||
    reason.trim() !== "" ||
    lines.some(
      (line) =>
        (dueByLine[line._id] ?? "") !== (initialState.dueByLine[line._id] ?? "") ||
        (costByLine[line._id] ?? "") !== (initialState.costByLine[line._id] ?? ""),
    );
  const { requestClose } = useStockDirtyGuard(isDirty, onClose, saving);
  const isStale = order.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    const nextLineErrors: Record<string, { due?: string; cost?: string }> = {};
    let firstInvalidId: string | undefined;
    const payloadLines: { orderLineId: Id<"purchaseOrderLines">; due?: number; unitCost?: number }[] = [];
    for (const line of lines) {
      const parsedDue = parseWholeQuantity(dueByLine[line._id] ?? "", { allowZero: true, label: "Due quantity" });
      if (!parsedDue.ok || parsedDue.value === undefined) {
        nextLineErrors[line._id] = {
          ...(nextLineErrors[line._id] ?? {}),
          due: parsedDue.ok ? "Invalid due quantity." : parsedDue.error,
        };
        firstInvalidId ??= `amend-due-${line._id}`;
      }
      const parsedCost = parseOptionalSatang(costByLine[line._id] ?? "");
      if (!parsedCost.ok) {
        nextLineErrors[line._id] = {
          ...(nextLineErrors[line._id] ?? {}),
          cost: parsedCost.error,
        };
        firstInvalidId ??= `amend-cost-${line._id}`;
      }
      if (parsedDue.ok && parsedDue.value !== undefined && parsedCost.ok) {
        payloadLines.push({
          orderLineId: line._id,
          due: parsedDue.value,
          ...(parsedCost.value !== undefined ? { unitCost: parsedCost.value } : {}),
        });
      }
    }
    setLineErrors(nextLineErrors);
    if (firstInvalidId) {
      setError("Fix the highlighted line values before issuing the amendment.");
      document.getElementById(firstInvalidId)?.focus();
      return;
    }
    if (!reason.trim()) {
      setError("Enter a reason for amending this issued order.");
      document.getElementById("amend-reason")?.focus();
      return;
    }
    if (isStale) {
      setError("This order changed while amending. Review the updated order above before issuing the amendment.");
      return;
    }

    setSaving(true);
    try {
      await amendMutation({
        orderId: order._id,
        expectedRevision: reviewedRevision,
        reason: reason.trim(),
        expectedDate: expectedDate || undefined,
        supplierReference: supplierReference.trim() || undefined,
        lines: payloadLines,
        operationKey: opKey,
      });
      onAmended();
    } catch (cause) {
      setError(parseStockError(cause, "Could not amend order.").message);
      setOpKey(createOperationKey("po-amend"));
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
          <SheetTitle>Amend {order.reference}</SheetTitle>
          <SheetDescription>
            Update expected date, outstanding quantities still due, or future unit costs. Creates a new issued revision.
          </SheetDescription>
        </>
      }
    >
      <SheetForm onSubmit={handleSubmit} onCancel={requestClose} saving={saving} error={error} submitLabel="Issue amendment">
        {isStale ? (
          <StockStaleBanner
            title="Purchase order changed while amending"
            description={`This order moved from revision ${reviewedRevision} to ${order.revision}. Your typed amendment is preserved — review the updated order before issuing.`}
            actionLabel="Review updated order"
            onReview={() => {
              setReviewedRevision(order.revision);
              setError("");
              setOpKey(createOperationKey("po-amend"));
            }}
          />
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="amend-expected">Expected delivery date</Label>
            <DatePicker id="amend-expected" value={expectedDate} onValueChange={setExpectedDate} clearable />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="amend-ref">Supplier reference</Label>
            <Input id="amend-ref" value={supplierReference} onChange={(e) => setSupplierReference(e.target.value)} />
          </div>
        </div>

        <ul className="grid gap-3">
          {lines.map((line) => {
            const err = lineErrors[line._id];
            return (
              <li
                key={line._id}
                className={cn(
                  "grid gap-2.5 rounded-lg border border-border p-3.5",
                  (err?.due || err?.cost) && "border-destructive/60",
                )}
              >
                <div className="flex justify-between gap-2 text-sm">
                  <span className="font-medium text-foreground">
                    {line.item.productName} · {line.item.variantLabel}
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">Accepted so far: {line.accepted}</span>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`amend-due-${line._id}`}>New still-due quantity</Label>
                    <NumberField
                      id={`amend-due-${line._id}`}
                      value={dueByLine[line._id] ?? ""}
                      aria-invalid={err?.due ? true : undefined}
                      aria-describedby={err?.due ? `amend-due-${line._id}-err` : undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        setDueByLine((c) => ({ ...c, [line._id]: val }));
                        setLineErrors((c) => (c[line._id]?.due ? { ...c, [line._id]: { ...c[line._id], due: undefined } } : c));
                        setOpKey(createOperationKey("po-amend"));
                      }}
                    />
                    <FieldError id={`amend-due-${line._id}-err`}>{err?.due}</FieldError>
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`amend-cost-${line._id}`}>Unit cost (THB)</Label>
                    <NumberField
                      id={`amend-cost-${line._id}`}
                      prefix="฿"
                      inputMode="decimal"
                      value={costByLine[line._id] ?? ""}
                      aria-invalid={err?.cost ? true : undefined}
                      aria-describedby={err?.cost ? `amend-cost-${line._id}-err` : undefined}
                      onChange={(e) => {
                        const val = e.target.value;
                        setCostByLine((c) => ({ ...c, [line._id]: val }));
                        setLineErrors((c) => (c[line._id]?.cost ? { ...c, [line._id]: { ...c[line._id], cost: undefined } } : c));
                        setOpKey(createOperationKey("po-amend"));
                      }}
                    />
                    <FieldError id={`amend-cost-${line._id}-err`}>{err?.cost}</FieldError>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>

        <div className="grid gap-1.5">
          <Label htmlFor="amend-reason">Reason for amendment</Label>
          <Input
            id="amend-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Supplier updated delivery date and unit price"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}

function CloseRemainderSheet({
  order,
  onClose,
  onClosed,
  closeMutation,
}: {
  order: OrderRow;
  onClose: () => void;
  onClosed: () => void;
  closeMutation: (args: {
    orderId: Id<"purchaseOrders">;
    expectedRevision: number;
    reason: string;
    operationKey: string;
  }) => Promise<{ id: string }>;
}) {
  const [reviewedRevision, setReviewedRevision] = useState(order.revision);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [opKey, setOpKey] = useState(() => createOperationKey("po-close"));

  const { requestClose } = useStockDirtyGuard(reason.trim() !== "", onClose, saving);
  const isStale = order.revision !== reviewedRevision;

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");
    if (!reason.trim()) {
      setError("Enter a reason for closing the remaining units.");
      document.getElementById("close-rem-reason")?.focus();
      return;
    }
    if (isStale) {
      setError("This order changed while open. Review the latest order state above before closing remainder.");
      return;
    }
    setSaving(true);
    try {
      await closeMutation({
        orderId: order._id,
        expectedRevision: reviewedRevision,
        reason: reason.trim(),
        operationKey: opKey,
      });
      onClosed();
    } catch (cause) {
      setError(parseStockError(cause, "Could not close remainder.").message);
      setOpKey(createOperationKey("po-close"));
      setSaving(false);
    }
  }

  return (
    <EditorSheet
      open
      onClose={requestClose}
      header={
        <>
          <SheetTitle>Close remainder on {order.reference}</SheetTitle>
          <SheetDescription>
            Cancels all {order.dueUnits} remaining due units and sets On order for them to zero. Prior receipts and open holds remain intact.
          </SheetDescription>
        </>
      }
    >
      <SheetForm
        onSubmit={handleSubmit}
        onCancel={requestClose}
        saving={saving}
        error={error}
        submitLabel={order.acceptedUnits > 0 ? "Close short" : "Cancel order"}
      >
        {isStale ? (
          <StockStaleBanner
            title="Purchase order changed while open"
            description={`This order moved from revision ${reviewedRevision} to ${order.revision} (${order.dueUnits} still due). Your reason is preserved — review the latest state before closing.`}
            actionLabel="Review updated order"
            onReview={() => {
              setReviewedRevision(order.revision);
              setError("");
              setOpKey(createOperationKey("po-close"));
            }}
          />
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="close-rem-reason">Reason</Label>
          <Input
            id="close-rem-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Supplier discontinued remaining items"
          />
        </div>
      </SheetForm>
    </EditorSheet>
  );
}
