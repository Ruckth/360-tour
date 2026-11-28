"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Filter, PackageCheck, Plus, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { STOCK_TABLE } from "./stock-table";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { Callout, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { HeldGoodsPanel } from "./HeldGoodsPanel";
import { newRequestLine, OrderEditorSheet, RequestEditorSheet } from "./PurchasingEditorSheets";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import { PURCHASING_HUB_PATH, purchasingDetailHref, validatePurchasingSearch } from "./purchasing-location";
import {
  formatSatang,
  ORDER_STATUS_META,
  parseVariantIdsParam,
  RECEIPT_KIND_META,
  REQUEST_STATUS_META,
  STOCK_PAGE_SIZE,
  stockReturnLabel,
  stripSearchParams,
} from "./stock-format";
import type { StockLineDraft } from "./stock-types";
import { useResolvedStockVariants } from "./StockFormGuard";
import { StockVariantPickerDialog } from "./StockVariantPicker";
import { SupplierPickerField, SuppliersManagementPanel } from "./SupplierPicker";

import { ageLabel, itemSummaryLabel, relativeDate, URGENCY_CLASS } from "./purchasing-display";

export { OrderEditorSheet, RequestEditorSheet } from "./PurchasingEditorSheets";

type HoldRow = FunctionReturnType<typeof api.commerce.purchasing.holds>["page"][number];

type PendingPurchasingAutoOpen = {
  action: "request" | "order" | "receive";
  variantIds: Id<"productVariants">[];
  branchId: Id<"branches"> | null;
};

function resolveAutoOpenFromParams(
  tabParam: string | null,
  openNew: boolean,
  openReceive: boolean,
  variantsRaw: string | null,
  branchId: Id<"branches"> | null,
): PendingPurchasingAutoOpen | null {
  const variantIds = parseVariantIdsParam(variantsRaw) as Id<"productVariants">[];
  if (openReceive) return { action: "receive", variantIds, branchId };
  if (openNew && tabParam === "requests") return { action: "request", variantIds, branchId };
  if (openNew && tabParam === "orders") return { action: "order", variantIds, branchId };
  return null;
}

export function StockPurchasingHubView() {
  const { current: branch } = useAdminBranch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const queue = validatePurchasingSearch(Object.fromEntries(searchParams));
  const tabParam = queue.tab ?? null;
  const tab = queue.tab ?? "orders";
  const openNewFromParam = queue.new === "1";
  const openReceiveFromParam = queue.receive === "1";
  const variantsParam = queue.variants ?? null;
  const returnTo = queue.returnTo ?? null;
  const purchaseReference = queue.reference ?? "";
  const receiptReference = queue.receiptReference ?? "";

  function updateSearch(values: Partial<Record<keyof typeof queue, string | undefined>>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    router.replace(next.size ? `${PURCHASING_HUB_PATH}?${next}` : PURCHASING_HUB_PATH, { scroll: false });
  }
  const detailHref = (path: string) => purchasingDetailHref(`${PURCHASING_HUB_PATH}/${path}`, searchParams);

  const { notice, show, clear } = useNotice();
  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");
  const branchWideRequests = Boolean(access?.approver || access?.buyer || access?.lead);

  const requestFilter = queue.requestFilter ?? "default";
  const reqFilterMode = !branchWideRequests && (requestFilter === "approved" || requestFilter === "fully_ordered" || requestFilter === "all" || requestFilter === "awaiting_approval")
    ? "default" : requestFilter;
  const orderFilterMode = queue.orderFilter ?? (queue.variantId ? "item" : "open");
  const orderItemOpenOnly = queue.allItemOrders !== "1";
  const holdStatusFilter = queue.holdStatus ?? "open";

  const [reqItemPickerOpen, setReqItemPickerOpen] = useState(false);
  const [orderItemPickerOpen, setOrderItemPickerOpen] = useState(false);

  // One-shot auto-open intent consumed from URL params (stripped with replace so Back doesn't reopen)
  const [pendingAutoOpen, setPendingAutoOpen] = useState<PendingPurchasingAutoOpen | null>(() =>
    resolveAutoOpenFromParams(tabParam, openNewFromParam, openReceiveFromParam, variantsParam, branch?.id ?? null),
  );
  const [consumedAutoOpenKey, setConsumedAutoOpenKey] = useState(() =>
    openNewFromParam || openReceiveFromParam || variantsParam
      ? `${tabParam ?? ""}|${openNewFromParam ? "1" : "0"}|${openReceiveFromParam ? "1" : "0"}|${variantsParam ?? ""}`
      : "",
  );

  // Sheets + resolved prefill lines
  const [newRequestOpen, setNewRequestOpen] = useState(false);
  const [newRequestPrefill, setNewRequestPrefill] = useState<StockLineDraft[]>([]);
  const [newOrderOpen, setNewOrderOpen] = useState(false);
  const [newOrderPrefill, setNewOrderPrefill] = useState<StockLineDraft[]>([]);
  const [newOrderForHold, setNewOrderForHold] = useState<HoldRow | null>(null);
  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receivePrefill, setReceivePrefill] = useState<{
    lines: StockLineDraft[];
    variantIds: Id<"productVariants">[];
  }>({ lines: [], variantIds: [] });

  // Guarded render sync for newly arriving new / receive / variants flags
  const autoOpenKey =
    openNewFromParam || openReceiveFromParam || variantsParam
      ? `${tabParam ?? ""}|${openNewFromParam ? "1" : "0"}|${openReceiveFromParam ? "1" : "0"}|${variantsParam ?? ""}`
      : "";
  if (autoOpenKey && consumedAutoOpenKey !== autoOpenKey) {
    setConsumedAutoOpenKey(autoOpenKey);
    const next = resolveAutoOpenFromParams(
      tabParam,
      openNewFromParam,
      openReceiveFromParam,
      variantsParam,
      branch?.id ?? null,
    );
    if (next) setPendingAutoOpen(next);
  }

  // Strip one-shot flags from history with router.replace so Back doesn't reopen
  useEffect(() => {
    if (!openNewFromParam && !openReceiveFromParam && !variantsParam) return;
    router.replace(stripSearchParams("/admin/stock/purchasing", searchParams, ["new", "receive", "variants"]));
  }, [openNewFromParam, openReceiveFromParam, variantsParam, router, searchParams]);

  // Drop pending auto-open if branch switched before resolving
  if (branch && pendingAutoOpen?.branchId && pendingAutoOpen.branchId !== branch.id) {
    setPendingAutoOpen(null);
  }

  // Resolve variant prefills from authorized backend `selectedBalances`
  const prefillIds = useMemo(() => pendingAutoOpen?.variantIds ?? [], [pendingAutoOpen]);
  const {
    items: resolvedPrefillItems,
    missingIds: missingPrefillIds,
    loading: prefillLoading,
  } = useResolvedStockVariants(branch?.id ?? null, prefillIds, {
    enabled: Boolean(branch && access?.read && pendingAutoOpen && prefillIds.length > 0),
  });

  const rawVariant = tab === "requests" && reqFilterMode === "item" ? queue.requestVariantId
    : tab === "orders" && orderFilterMode === "item" ? queue.variantId : undefined;
  const rawSupplier = (tab === "orders" || tab === "receipts") && orderFilterMode === "supplier" ? queue.supplierId : undefined;
  const filter = useQuery(
    api.commerce.purchasing.queueFilter,
    branch && access?.read && (rawVariant || rawSupplier)
      ? { branchId: branch.id, variant: rawVariant, supplier: rawSupplier }
      : "skip",
  );
  const filterPending = Boolean((rawVariant || rawSupplier) && filter === undefined);
  const filterVariantId = filter?.variantId;
  const filterVariantIds = filterVariantId ? [filterVariantId] : [];
  const { items: resolvedFilterVariants } = useResolvedStockVariants(branch?.id ?? null, filterVariantIds, {
    enabled: Boolean(access?.read),
  });
  const filterVariant = resolvedFilterVariants[0];
  const filterItemLabel = filterVariant ? `${filterVariant.productName} · ${filterVariant.label}`
    : filterVariantId ? "Selected item" : "Pick item…";

  // Open the requested sheet once access + prefill variants have resolved
  if (pendingAutoOpen && branch && access !== undefined) {
    if (!access.read) {
      setPendingAutoOpen(null);
    } else if (!(pendingAutoOpen.variantIds.length > 0 && prefillLoading)) {
      setPendingAutoOpen(null);
      if (pendingAutoOpen.action === "request" && !access.requester) {
        show("Requester access is required to create a purchase request.", "danger");
      } else if (pendingAutoOpen.action === "order" && !access.directOrder) {
        show("Direct purchase order access is required for this branch.", "danger");
      } else if (pendingAutoOpen.action === "receive" && !access.receiver) {
        show("Receiver access is required to receive deliveries.", "danger");
      } else {
        if (missingPrefillIds.length > 0) {
          show(
            `${missingPrefillIds.length} selected ${missingPrefillIds.length === 1 ? "item was" : "items were"} skipped (archived or unavailable in ${branch.name}).`,
            "danger",
          );
        }
        if (pendingAutoOpen.action === "request") {
          setNewRequestPrefill(
            resolvedPrefillItems.map(newRequestLine),
          );
          setNewRequestOpen(true);
        } else if (pendingAutoOpen.action === "order") {
          setNewOrderForHold(null);
          setNewOrderPrefill(
            resolvedPrefillItems.map((item) => ({
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              onHand: item.onHand,
              onOrder: item.onOrder,
              quantityText: "1",
              unitCostText: "",
            })),
          );
          setNewOrderOpen(true);
        } else {
          setReceivePrefill({
            lines: resolvedPrefillItems.map((item) => ({
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              onHand: item.onHand,
              onOrder: item.onOrder,
              lotTracked: item.lotTracked,
              quantityText: "",
              unitCostText: "",
            })),
            variantIds: resolvedPrefillItems.map((item) => item.variantId),
          });
          setReceiveOpen(true);
        }
      }
    }
  }

  const requestCounts = useQuery(api.commerce.purchasing.myRequestCountsAt,
    branch && access?.read && tab === "requests" ? { branchId: branch.id } : "skip");
  const changesCount = requestCounts?.needsChanges;
  const changesLabel = changesCount === undefined ? "" : changesCount >= 100 ? " (100+)" : ` (${changesCount})`;
  const resolvedRequestView = (() => {
    if (reqFilterMode === "item" && filterVariantId) return { kind: "item" as const, variantId: filterVariantId };
    if (reqFilterMode === "mine") return { kind: "mine" as const };
    if (reqFilterMode === "needs_changes" || reqFilterMode === "draft" || reqFilterMode === "declined" || reqFilterMode === "closed") {
      return { kind: "mineStatus" as const, status: reqFilterMode };
    }
    if (reqFilterMode === "awaiting_approval") return { kind: "approvalQueue" as const };
    if (reqFilterMode === "approved" || reqFilterMode === "fully_ordered") return { kind: "approved" as const, fullyOrdered: reqFilterMode === "fully_ordered" };
    if (reqFilterMode === "all") return { kind: "all" as const };
    // Default: Needs approval for approvers, My requests for staff
    return access?.approver
      ? { kind: "approvalQueue" as const }
      : { kind: "mine" as const };
  })();

  const resolvedOrderView = (() => {
    if (orderFilterMode === "supplier" && filter?.supplier) {
      return { kind: "supplier" as const, supplierId: filter.supplier.id };
    }
    if (orderFilterMode === "item" && filterVariantId) {
      return { kind: "item" as const, variantId: filterVariantId, openOnly: orderItemOpenOnly };
    }
    if (orderFilterMode === "draft") return { kind: "phase" as const, phase: "draft" as const };
    if (orderFilterMode === "closed") return { kind: "phase" as const, phase: "closed" as const };
    if (orderFilterMode === "overdue") return { kind: "overdue" as const };
    if (orderFilterMode === "due_soon") return { kind: "dueSoon" as const };
    if (orderFilterMode === "awaiting_approval" || orderFilterMode === "received" || orderFilterMode === "closed_short" || orderFilterMode === "cancelled") {
      return { kind: "status" as const, status: orderFilterMode };
    }
    return { kind: "phase" as const, phase: "open" as const };
  })();

  const searchingPurchases = (tab === "requests" || tab === "orders") && purchaseReference.trim() !== "";
  const {
    results: requestRows,
    status: reqStatus,
    loadMore: loadMoreRequests,
  } = usePaginatedQuery(
    api.commerce.purchasing.requests,
    branch && access?.read && tab === "requests" && !searchingPurchases && !filterPending ? { branchId: branch.id, view: resolvedRequestView } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  const {
    results: orderRows,
    status: orderStatus,
    loadMore: loadMoreOrders,
  } = usePaginatedQuery(
    api.commerce.purchasing.orders,
    branch && access?.read && tab === "orders" && !searchingPurchases && !filterPending ? { branchId: branch.id, view: resolvedOrderView } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );


  const purchaseMatch = useQuery(
    api.commerce.purchasing.purchaseReference,
    branch && access?.read && searchingPurchases ? { branchId: branch.id, reference: purchaseReference } : "skip",
  );
  const receiptExceptions = queue.receiptFilter === "exceptions" && !rawSupplier;
  const receiptSearchArgs = branch && access?.read && tab === "receipts" && (!rawSupplier || filter?.supplier)
    ? { branchId: branch.id, supplierId: rawSupplier ? filter?.supplier?.id : undefined, ...(receiptExceptions ? { exceptionsOnly: true } : {}) } : null;
  const searchingReceipts = !rawSupplier && !receiptExceptions && receiptReference.trim() !== "";
  const receiptList = usePaginatedQuery(
    api.commerce.purchasing.receipts,
    receiptSearchArgs
      ? { ...receiptSearchArgs, match: searchingReceipts ? { kind: "delivery", reference: receiptReference } : undefined }
      : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );
  const receiptByReference = usePaginatedQuery(
    api.commerce.purchasing.receipts,
    receiptSearchArgs && searchingReceipts
      ? { ...receiptSearchArgs, match: { kind: "receipt", reference: receiptReference } }
      : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );
  const receiptRows = [...new Map([...receiptByReference.results, ...receiptList.results].map(row => [row._id, row])).values()];
  const receiptsLoading = Boolean(rawSupplier && filterPending) || receiptList.status === "LoadingFirstPage" || (searchingReceipts && receiptByReference.status === "LoadingFirstPage");

  if (!branch) return null;
  if (access === undefined) return <SkeletonRows label="Loading purchasing" rows={5} />;
  if (!access.read) {
    return (
      <Callout tone="warning" title="Stock access required">
        You do not have a stock role for {branch.name}. Ask an owner to grant branch purchasing access.
      </Callout>
    );
  }

  return (
    <div className="grid gap-3">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {returnTo ? (
            <ButtonLink href={returnTo} variant="ghost" size="sm" className="-ml-2 mb-1">
              <ArrowLeft aria-hidden className="size-4" />
              Back to {stockReturnLabel(returnTo, "Balances")}
            </ButtonLink>
          ) : null}
          <h2 className="font-serif text-xl font-semibold text-foreground">Purchasing</h2>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {access.receiver ? (
            <Button
              type="button"
              size="sm"
              variant={tab === "receipts" ? "default" : "ghost"}
              onClick={() => {
                setReceivePrefill({ lines: [], variantIds: [] });
                setReceiveOpen(true);
              }}
            >
              <PackageCheck aria-hidden className="hidden size-4 sm:inline" />
              Receive delivery
            </Button>
          ) : null}
          {access.requester ? (
            <Button
              type="button"
              size="sm"
              variant={tab === "requests" ? "default" : "ghost"}
              onClick={() => {
                setNewRequestPrefill([]);
                setNewRequestOpen(true);
              }}
            >
              <Plus aria-hidden className="hidden size-4 sm:inline" />
              Request stock
            </Button>
          ) : null}
          {access.directOrder ? (
            <Button
              type="button"
              size="sm"
              variant={tab === "orders" ? "default" : "ghost"}
              onClick={() => {
                setNewOrderForHold(null);
                setNewOrderPrefill([]);
                setNewOrderOpen(true);
              }}
            >
              <Plus aria-hidden className="hidden size-4 sm:inline" />
              Create order
            </Button>
          ) : null}
        </div>
      </div>

      <SegmentedTabs
        id="purchasing-hub"
        label="Purchasing sections"
        value={tab}
        onValueChange={(next) => updateSearch({ tab: next })}
        tabs={[
          { value: "requests", label: "Requests" },
          { value: "orders", label: "Orders" },
          { value: "receipts", label: "Receipts" },
          { value: "holds", label: "Held goods" },
          { value: "suppliers", label: "Suppliers" },
        ]}
      />

      {(tab === "requests" || tab === "orders") ? (
        <Label className="block max-w-sm">
          <span className="sr-only">Purchase reference</span>
          <Input type="search" value={purchaseReference} maxLength={64} placeholder="Find a PO or request by reference"
            onChange={(event) => updateSearch({ reference: event.target.value })} />
        </Label>
      ) : null}

      {searchingPurchases ? (
        <div {...tabPanelProps("purchasing-hub", tab)}>
          <Card className="overflow-hidden">
            {purchaseMatch === undefined ? (
              <SkeletonRows label="Looking up purchase reference" rows={1} />
            ) : purchaseMatch.requests.length === 0 && purchaseMatch.orders.length === 0 ? (
              <EmptyState>No purchase documents match this reference at {branch.name}.</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {purchaseMatch.requests.map((request) => (
                  <li key={request._id} className="flex flex-wrap items-center gap-2 p-4">
                    <Link className="font-mono underline underline-offset-4" href={detailHref(`requests/${request._id}`)}>
                      {request.reference}
                    </Link>
                    <span className="text-sm">{request.requesterLabel}</span>
                    <StatusBadge {...(request.status === "approved" && request.fullyOrdered ? { ...REQUEST_STATUS_META.approved, label: "Fully ordered" } : REQUEST_STATUS_META[request.status])} />
                  </li>
                ))}
                {purchaseMatch.orders.map((order) => (
                  <li key={order._id} className="flex flex-wrap items-center gap-3 p-4">
                    <Link className="font-mono underline underline-offset-4" href={detailHref(`orders/${order._id}`)}>
                      {order.reference}
                    </Link>
                    <span className="text-sm">{order.supplier.name}</span>
                    <StatusBadge {...ORDER_STATUS_META[order.status]} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      ) : tab === "requests" ? (
        <div {...tabPanelProps("purchasing-hub", "requests")} className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={reqFilterMode}
              onValueChange={(v) => updateSearch({ requestFilter: v })}
            >
              <SelectTrigger aria-label="Request filter" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {access.approver ? "Needs approval (default)" : "My requests (default)"}
                </SelectItem>
                <SelectItem value="mine">My requests</SelectItem>
                <SelectItem value="needs_changes">Needs my changes{changesLabel}</SelectItem>
                <SelectItem value="draft">My drafts</SelectItem>
                <SelectItem value="declined">My declined requests</SelectItem>
                <SelectItem value="closed">My closed requests</SelectItem>
                {access.approver || access.buyer || access.lead ? (
                  <>
                    <SelectItem value="awaiting_approval">Needs approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
                    <SelectItem value="fully_ordered">Fully ordered</SelectItem>
                    <SelectItem value="all">All branch requests</SelectItem>
                  </>
                ) : null}
                <SelectItem value="item">Filter by item</SelectItem>
              </SelectContent>
            </Select>

            {reqFilterMode === "item" ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setReqItemPickerOpen(true)}>
                  <Filter aria-hidden className="size-4" />
                  {filterItemLabel}
                </Button>
                {queue.requestVariantId ? (
                  <Button type="button" variant="ghost" size="icon" aria-label="Clear item filter" onClick={() => updateSearch({ requestVariantId: undefined })}>
                    <X aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <Card className="overflow-hidden">
            {filterPending || reqStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading purchase requests" rows={5} />
            ) : requestRows.length === 0 ? (
              <EmptyState
                action={
                  access.requester ? (
                    <Button type="button" size="sm" onClick={() => setNewRequestOpen(true)}>
                      New purchase request
                    </Button>
                  ) : null
                }
              >
                No purchase requests match this view.
              </EmptyState>
            ) : (
              <table className={STOCK_TABLE.table}>
                <thead className={STOCK_TABLE.head}>
                  <tr>
                    <th scope="col" className={STOCK_TABLE.th}>Reference</th>
                    <th scope="col" className={STOCK_TABLE.th}>Status</th>
                    <th scope="col" className={STOCK_TABLE.th}>Requester</th>
                    <th scope="col" className={STOCK_TABLE.th}>Need by</th>
                    <th scope="col" className={STOCK_TABLE.th}>Items</th>
                  </tr>
                </thead>
                <tbody className={STOCK_TABLE.body}>
                  {requestRows.map((req) => {
                    const due = relativeDate(req.needBy);
                    return (
                      <tr key={req._id} className={STOCK_TABLE.row}>
                        <td data-label="Reference" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                          <Link
                            href={detailHref(`requests/${req._id}`)}
                            className="font-mono text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                          >
                            {req.reference}
                          </Link>
                        </td>
                        <td data-label="Status" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                          <StatusBadge {...(req.status === "approved" && req.fullyOrdered ? { ...REQUEST_STATUS_META.approved, label: "Fully ordered" } : REQUEST_STATUS_META[req.status])} />
                        </td>
                        <td data-label="Requester" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "text-xs text-muted-foreground")}>
                          {req.requesterLabel}
                          {req.mine ? " (you)" : ""}
                          {req.submittedAt ? <span className="block">Submitted {ageLabel(req.submittedAt)}</span> : null}
                        </td>
                        <td data-label="Need by" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "text-xs tabular-nums text-muted-foreground")}>
                          {req.needBy ? <time dateTime={req.needBy} title={req.needBy} className={URGENCY_CLASS[due.urgency]}>{due.label}</time> : "—"}
                        </td>
                        <td data-label="Items" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "break-words text-xs")}>
                          {itemSummaryLabel(req.itemSummary, req.lineCount)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {reqStatus === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMoreRequests(STOCK_PAGE_SIZE)}>
                Load more requests
              </Button>
            </div>
          ) : null}
        </div>
      ) : tab === "orders" ? (
        <div {...tabPanelProps("purchasing-hub", "orders")} className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={orderFilterMode}
              onValueChange={(v) => updateSearch({ orderFilter: v })}
            >
              <SelectTrigger aria-label="Order filter" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open orders (default)</SelectItem>
                <SelectItem value="overdue">Overdue</SelectItem>
                <SelectItem value="due_soon">Due this week</SelectItem>
                <SelectItem value="awaiting_approval">Awaiting approval</SelectItem>
                <SelectItem value="draft">Draft orders</SelectItem>
                <SelectItem value="received">Received</SelectItem>
                <SelectItem value="closed_short">Closed short</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
                {orderFilterMode === "closed" ? <SelectItem value="closed">Received & closed (all)</SelectItem> : null}
                <SelectItem value="supplier">Filter by supplier</SelectItem>
                <SelectItem value="item">Filter by item</SelectItem>
              </SelectContent>
            </Select>

            {orderFilterMode === "supplier" ? (
              <div className="w-64">
                <SupplierPickerField
                  branchId={branch.id}
                  value={filter?.supplier?.id ?? null}
                  selectedName={filter?.supplier?.name}
                  onChange={(supplier) => updateSearch({ supplierId: supplier?.id })}
                />
              </div>
            ) : null}

            {orderFilterMode === "item" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setOrderItemPickerOpen(true)}>
                  <Filter aria-hidden className="size-4" />
                  {filterItemLabel}
                </Button>
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={orderItemOpenOnly}
                    onChange={(event) => updateSearch({ allItemOrders: event.target.checked ? undefined : "1" })}
                    className="size-4 accent-foreground"
                  />
                  Open orders only
                </label>
              </div>
            ) : null}
          </div>

          <Card className="overflow-hidden">
            {filterPending || orderStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading purchase orders" rows={5} />
            ) : orderRows.length === 0 ? (
              <EmptyState>No purchase orders match this view.</EmptyState>
            ) : (
              <table className={STOCK_TABLE.table}>
                <thead className={STOCK_TABLE.head}>
                  <tr>
                    <th scope="col" className={STOCK_TABLE.th}>Reference</th>
                    <th scope="col" className={STOCK_TABLE.th}>Supplier</th>
                    <th scope="col" className={STOCK_TABLE.th}>Status</th>
                    <th scope="col" className={STOCK_TABLE.th}>Expected</th>
                    <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Due / Ordered</th>
                    <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Total</th>
                    <th scope="col" className={cn(STOCK_TABLE.th, "text-right")}>Action</th>
                  </tr>
                </thead>
                <tbody className={STOCK_TABLE.body}>
                  {orderRows.map((po) => (
                    <tr key={po._id} className={STOCK_TABLE.row}>
                      <td data-label="Reference" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                        <Link
                          href={detailHref(`orders/${po._id}`)}
                          className="font-mono text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                        >
                          {po.reference}
                        </Link>
                      </td>
                      <td data-label="Supplier" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "text-sm")}>
                        {po.supplier.name}
                      </td>
                      <td data-label="Status" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled)}>
                        <StatusBadge {...ORDER_STATUS_META[po.status]} />
                      </td>
                      <td data-label="Expected" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "text-xs tabular-nums text-muted-foreground")}>
                        <ExpectedCell expectedDate={po.expectedDate} open={po.phase === "open"} />
                      </td>
                      <td data-label="Due / Ordered" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                        <strong className="text-foreground">{po.dueUnits}</strong> / {po.orderedUnits}
                        {po.openLineCount > 0 ? ` (${po.openLineCount} open)` : ""}
                      </td>
                      <td data-label="Total" className={cn(STOCK_TABLE.cell, STOCK_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                        {po.totalCost ? formatSatang(po.totalCost) : "—"}
                        {po.phase === "open" && po.outstandingValue !== undefined && po.outstandingValue > 0 ? (
                          <span className="block text-muted-foreground">Outstanding {formatSatang(po.outstandingValue)}</span>
                        ) : null}
                        {(po.unpricedLines ?? 0) > 0 ? (
                          <span className="mt-0.5 inline-block rounded bg-amber-100 px-1.5 py-0.5 font-sans text-[11px] font-medium text-amber-900 dark:bg-amber-900/40 dark:text-amber-200">
                            Price missing
                          </span>
                        ) : null}
                      </td>
                      <td className={cn(STOCK_TABLE.cell, "lg:text-right")}>
                        <ButtonLink href={detailHref(`orders/${po._id}`)} variant="outline" size="sm">
                          Open
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          {orderStatus === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMoreOrders(STOCK_PAGE_SIZE)}>
                Load more orders
              </Button>
            </div>
          ) : null}
        </div>
      ) : tab === "receipts" ? (
        <div {...tabPanelProps("purchasing-hub", "receipts")} className="grid gap-4">
          {rawSupplier ? (
            <div className="flex items-center gap-2">
              <span>Supplier · {filter?.supplier?.name ?? "Unknown supplier"}</span>
              <Button variant="outline" size="sm" onClick={() => updateSearch({ supplierId: undefined })}>Clear supplier</Button>
            </div>
          ) : (
            <div className="flex flex-wrap items-end gap-3">
              <Select value={queue.receiptFilter ?? "all"} onValueChange={(v) => updateSearch({ receiptFilter: v === "all" ? undefined : v })}>
                <SelectTrigger aria-label="Receipt filter" className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All receipts</SelectItem>
                  <SelectItem value="exceptions">Has rejections or holds</SelectItem>
                </SelectContent>
              </Select>
              {receiptExceptions ? null : (
                <Label className="grid max-w-sm gap-1.5">
                  Receipt or delivery reference
                  <Input type="search" value={receiptReference} maxLength={64}
                    onChange={(event) => updateSearch({ receiptReference: event.target.value })} />
                </Label>
              )}
            </div>
          )}
          <Card className="overflow-hidden">
            {receiptsLoading ? (
              <SkeletonRows label="Loading posted receipts" rows={5} />
            ) : receiptRows.length === 0 ? (
              <EmptyState>{rawSupplier ? "No posted receipts for this supplier at this branch." : searchingReceipts ? "No receipts match this reference." : `No posted receipts at ${branch.name}.`}</EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {receiptRows.map((receipt) => (
                  <li key={receipt._id} className="flex flex-wrap items-start justify-between gap-2 p-4">
                    <div className="grid gap-1">
                      <Link className="font-mono font-semibold underline-offset-4 hover:underline" href={detailHref(`receipts/${receipt._id}`)}>
                        {receipt.reference}
                      </Link>
                      <span className="text-sm">
                        {receipt.supplier?.name ?? "No supplier"}{receipt.deliveryReference ? ` · ${receipt.deliveryReference}` : ""}
                      </span>
                      <span className="font-mono text-xs text-muted-foreground">
                        <span title="Accepted">A {receipt.acceptedUnits}</span>
                        {" · "}
                        <span title="Rejected" className={receipt.rejectedUnits > 0 ? "text-destructive" : undefined}>R {receipt.rejectedUnits}</span>
                        {" · "}
                        <span title="Held" className={receipt.heldUnits > 0 ? "text-amber-700 dark:text-amber-400" : undefined}>H {receipt.heldUnits}</span>
                        {receipt.orderId ? (
                          <>
                            {" · "}
                            <Link className="underline underline-offset-4" href={detailHref(`orders/${receipt.orderId}`)}>
                              {receipt.orderReference ?? "Order"}
                            </Link>
                          </>
                        ) : null}
                      </span>
                    </div>
                    <div className="grid gap-1 text-xs text-muted-foreground">
                      <StatusBadge {...RECEIPT_KIND_META[receipt.kind]} />
                      <span>{staffDateTime(receipt.createdAt)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          {receiptList.status === "CanLoadMore" || receiptList.status === "LoadingMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" disabled={receiptList.status === "LoadingMore"}
                onClick={() => receiptList.loadMore(STOCK_PAGE_SIZE)}>
                {receiptList.status === "LoadingMore" ? "Loading receipts…" : "Load more receipts"}
              </Button>
            </div>
          ) : null}
        </div>
      ) : tab === "holds" ? (
        <div {...tabPanelProps("purchasing-hub", "holds")}>
          <HeldGoodsPanel
            branch={branch}
            access={access}
            status={holdStatusFilter}
            onStatusChange={(status) => updateSearch({ holdStatus: status })}
            detailHref={detailHref}
            onCreateLinkedOrder={(hold) => {
              setNewOrderForHold(hold);
              setNewOrderOpen(true);
            }}
            onNotice={(message) => show(message, "success")}
          />
        </div>
      ) : (
        <div {...tabPanelProps("purchasing-hub", "suppliers")}>
          <SuppliersManagementPanel branchId={branch.id} canEdit={access.buyer} />
        </div>
      )}

      <StockVariantPickerDialog
        open={reqItemPickerOpen}
        onOpenChange={setReqItemPickerOpen}
        branchId={branch.id}
        title="Filter requests by item"
        onSelect={(item) => updateSearch({ requestFilter: "item", requestVariantId: item.variantId })}
      />

      <StockVariantPickerDialog
        open={orderItemPickerOpen}
        onOpenChange={setOrderItemPickerOpen}
        branchId={branch.id}
        title="Filter orders by item"
        onSelect={(item) => updateSearch({ orderFilter: "item", variantId: item.variantId })}
      />

      {newRequestOpen ? (
        <RequestEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          canSetReorderPoint={access.lead}
          initialLines={newRequestPrefill}
          onClose={() => {
            setNewRequestOpen(false);
            setNewRequestPrefill([]);
          }}
          onSaved={(requestId) => {
            setNewRequestOpen(false);
            setNewRequestPrefill([]);
            router.push(detailHref(`requests/${requestId}`));
          }}
        />
      ) : null}

      {newOrderOpen ? (
        <OrderEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          canAddSupplier={access.buyer}
          initialLines={newOrderPrefill}
          forHold={newOrderForHold ?? undefined}
          onClose={() => {
            setNewOrderOpen(false);
            setNewOrderForHold(null);
            setNewOrderPrefill([]);
          }}
          onSaved={(orderId) => {
            setNewOrderOpen(false);
            setNewOrderForHold(null);
            setNewOrderPrefill([]);
            router.push(detailHref(`orders/${orderId}`));
          }}
        />
      ) : null}

      {receiveOpen ? (
        <ReceiveDeliverySheet
          branchId={branch.id}
          branchName={branch.name}
          allowDirectReceipt={access.directReceipt}
          canAddSupplier={access.buyer}
          initialLines={receivePrefill.lines}
          prefillVariantIds={receivePrefill.variantIds}
          onClose={() => {
            setReceiveOpen(false);
            setReceivePrefill({ lines: [], variantIds: [] });
          }}
          onPosted={(receiptId) => {
            setReceiveOpen(false);
            setReceivePrefill({ lines: [], variantIds: [] });
            router.push(detailHref(`receipts/${receiptId}`));
          }}
        />
      ) : null}


    </div>
  );
}

/** Expected date with its distance from resort today; open orders past it show an Overdue badge. */
function ExpectedCell({ expectedDate, open }: { expectedDate?: string; open: boolean }) {
  if (!expectedDate) return <>—</>;
  const relative = relativeDate(expectedDate);
  return (
    <span className="grid gap-0.5">
      <time dateTime={expectedDate}>{expectedDate}</time>
      {open ? (
        relative.urgency === "overdue" ? (
          <span className="inline-block w-fit rounded bg-destructive/10 px-1.5 py-0.5 text-[11px] font-medium text-destructive">
            Overdue {-(relative.days ?? 0)} d
          </span>
        ) : (
          <span className={URGENCY_CLASS[relative.urgency]}>{relative.label}</span>
        )
      ) : null}
    </span>
  );
}
