"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { ArrowLeft, Filter, PackageCheck, Plus, ShieldAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { EmptyState, SkeletonRows, STACKED_TABLE } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { Callout, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { DeclineHoldSheet, OrderEditorSheet, RequestEditorSheet } from "./PurchasingEditorSheets";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import {
  formatSatang,
  HOLD_STATUS_META,
  ORDER_STATUS_META,
  parseVariantIdsParam,
  REQUEST_STATUS_META,
  sanitizeStockReturnTo,
  STOCK_PAGE_SIZE,
  stockReturnLabel,
  stripSearchParams,
} from "./stock-format";
import type { PurchaseHoldStatus, StockLineDraft } from "./stock-types";
import { useResolvedStockVariants } from "./StockFormGuard";
import { StockVariantPickerDialog } from "./StockVariantPicker";
import { SupplierPickerField, SuppliersManagementPanel } from "./SupplierPicker";

export { OrderEditorSheet, RequestEditorSheet } from "./PurchasingEditorSheets";

type HoldRow = FunctionReturnType<typeof api.commerce.purchasing.holds>["page"][number];

type PurchasingTab = "requests" | "orders" | "holds" | "suppliers";

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
  const tabParam = searchParams.get("tab");
  const initialTab = (tabParam as PurchasingTab | null) ?? "orders";
  const initialVariantId = searchParams.get("variantId") as Id<"productVariants"> | null;
  const openNewFromParam = searchParams.get("new") === "1";
  const openReceiveFromParam = searchParams.get("receive") === "1";
  const variantsParam = searchParams.get("variants");
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));

  const [tab, setTab] = useState<PurchasingTab>(
    ["requests", "orders", "holds", "suppliers"].includes(initialTab) ? initialTab : "orders",
  );
  const { notice, show, clear } = useNotice();

  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");

  // Requests filter state
  const [reqFilterMode, setReqFilterMode] = useState<"default" | "mine" | "awaiting_approval" | "approved" | "all" | "item">("default");
  const [reqItem, setReqItem] = useState<{ id: Id<"productVariants">; label: string } | null>(null);
  const [reqItemPickerOpen, setReqItemPickerOpen] = useState(false);

  // Orders filter state (one filter at a time)
  const [orderFilterMode, setOrderFilterMode] = useState<"open" | "draft" | "closed" | "supplier" | "item">(
    initialVariantId ? "item" : "open",
  );
  const [orderSupplier, setOrderSupplier] = useState<{ id: Id<"suppliers">; name: string } | null>(null);
  const [rawOrderItem, setOrderItem] = useState<{ id: Id<"productVariants">; label: string } | null>(
    initialVariantId ? { id: initialVariantId, label: "Selected item" } : null,
  );
  const [orderItemOpenOnly, setOrderItemOpenOnly] = useState(true);
  const [orderItemPickerOpen, setOrderItemPickerOpen] = useState(false);

  // Holds state
  const [holdStatusFilter, setHoldStatusFilter] = useState<PurchaseHoldStatus>("open");
  const [decliningHold, setDecliningHold] = useState<HoldRow | null>(null);

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

  // Resolve filter `variantId` label from authorized backend
  const filterVariantIds = useMemo(
    () => (initialVariantId ? [initialVariantId] : []),
    [initialVariantId],
  );
  const { items: resolvedFilterVariants } = useResolvedStockVariants(branch?.id ?? null, filterVariantIds, {
    enabled: Boolean(branch && access?.read && rawOrderItem?.id === initialVariantId && rawOrderItem?.label === "Selected item"),
  });

  const orderItem = useMemo(() => {
    const resolved = resolvedFilterVariants[0];
    if (rawOrderItem && rawOrderItem.label === "Selected item" && resolved?.variantId === rawOrderItem.id) {
      return {
        id: resolved.variantId,
        label: `${resolved.productName} · ${resolved.label}${resolved.sku ? ` (${resolved.sku})` : ""}`,
      };
    }
    return rawOrderItem;
  }, [rawOrderItem, resolvedFilterVariants]);

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
          setTab("requests");
          setNewRequestPrefill(
            resolvedPrefillItems.map((item) => ({
              variantId: item.variantId,
              productName: item.productName,
              variantLabel: item.label,
              sku: item.sku,
              onHand: item.onHand,
              onOrder: item.onOrder,
              quantityText: "1",
            })),
          );
          setNewRequestOpen(true);
        } else if (pendingAutoOpen.action === "order") {
          setTab("orders");
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
          setTab("orders");
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

  const resolvedRequestView = (() => {
    if (reqFilterMode === "item" && reqItem) return { kind: "item" as const, variantId: reqItem.id };
    if (reqFilterMode === "mine") return { kind: "mine" as const };
    if (reqFilterMode === "awaiting_approval") return { kind: "status" as const, status: "awaiting_approval" as const };
    if (reqFilterMode === "approved") return { kind: "status" as const, status: "approved" as const };
    if (reqFilterMode === "all") return { kind: "all" as const };
    // Default: Needs approval for approvers, My requests for staff
    return access?.approver
      ? { kind: "status" as const, status: "awaiting_approval" as const }
      : { kind: "mine" as const };
  })();

  const resolvedOrderView = (() => {
    if (orderFilterMode === "supplier" && orderSupplier) {
      return { kind: "supplier" as const, supplierId: orderSupplier.id };
    }
    if (orderFilterMode === "item" && orderItem) {
      return { kind: "item" as const, variantId: orderItem.id, openOnly: orderItemOpenOnly };
    }
    if (orderFilterMode === "draft") return { kind: "phase" as const, phase: "draft" as const };
    if (orderFilterMode === "closed") return { kind: "phase" as const, phase: "closed" as const };
    return { kind: "phase" as const, phase: "open" as const };
  })();

  const {
    results: requestRows,
    status: reqStatus,
    loadMore: loadMoreRequests,
  } = usePaginatedQuery(
    api.commerce.purchasing.requests,
    branch && access?.read && tab === "requests" ? { branchId: branch.id, view: resolvedRequestView } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  const {
    results: orderRows,
    status: orderStatus,
    loadMore: loadMoreOrders,
  } = usePaginatedQuery(
    api.commerce.purchasing.orders,
    branch && access?.read && tab === "orders" ? { branchId: branch.id, view: resolvedOrderView } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  const {
    results: holdRows,
    status: holdQueryStatus,
    loadMore: loadMoreHolds,
  } = usePaginatedQuery(
    api.commerce.purchasing.holds,
    branch && access?.read && tab === "holds" ? { branchId: branch.id, status: holdStatusFilter } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

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
    <div className="grid gap-5">
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
          <p className="text-sm text-muted-foreground">
            Request stock, approve demand, issue purchase orders, receive deliveries, and resolve held goods for {branch.name}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {access.receiver ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setReceivePrefill({ lines: [], variantIds: [] });
                setReceiveOpen(true);
              }}
            >
              <PackageCheck aria-hidden className="size-4" />
              Receive delivery
            </Button>
          ) : null}
          {access.requester ? (
            <Button
              type="button"
              variant={tab === "requests" ? "default" : "outline"}
              onClick={() => {
                setNewRequestPrefill([]);
                setNewRequestOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              Request stock
            </Button>
          ) : null}
          {access.directOrder ? (
            <Button
              type="button"
              variant={tab === "orders" ? "default" : "outline"}
              onClick={() => {
                setNewOrderForHold(null);
                setNewOrderPrefill([]);
                setNewOrderOpen(true);
              }}
            >
              <Plus aria-hidden className="size-4" />
              Create order
            </Button>
          ) : null}
        </div>
      </div>

      <SegmentedTabs
        id="purchasing-hub"
        label="Purchasing sections"
        value={tab}
        onValueChange={setTab}
        tabs={[
          { value: "requests", label: "Requests" },
          { value: "orders", label: "Orders" },
          { value: "holds", label: "Held goods" },
          { value: "suppliers", label: "Suppliers" },
        ]}
      />

      {tab === "requests" ? (
        <div {...tabPanelProps("purchasing-hub", "requests")} className="grid gap-4">
          <div className="flex flex-wrap items-center gap-3">
            <Select
              value={reqFilterMode}
              onValueChange={(v) => setReqFilterMode(v as typeof reqFilterMode)}
            >
              <SelectTrigger aria-label="Request filter" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="default">
                  {access.approver ? "Needs approval (default)" : "My requests (default)"}
                </SelectItem>
                <SelectItem value="mine">My requests</SelectItem>
                {access.approver || access.buyer || access.lead ? (
                  <>
                    <SelectItem value="awaiting_approval">Needs approval</SelectItem>
                    <SelectItem value="approved">Approved</SelectItem>
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
                  {reqItem?.label ?? "Pick item…"}
                </Button>
                {reqItem ? (
                  <Button type="button" variant="ghost" size="icon" aria-label="Clear item filter" onClick={() => setReqItem(null)}>
                    <X aria-hidden className="size-4" />
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>

          <Card className="overflow-hidden">
            {reqStatus === "LoadingFirstPage" ? (
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
              <table className={STACKED_TABLE.table}>
                <thead className={STACKED_TABLE.head}>
                  <tr>
                    <th scope="col" className={STACKED_TABLE.th}>Reference</th>
                    <th scope="col" className={STACKED_TABLE.th}>Status</th>
                    <th scope="col" className={STACKED_TABLE.th}>Requester</th>
                    <th scope="col" className={STACKED_TABLE.th}>Need by</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Lines</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Action</th>
                  </tr>
                </thead>
                <tbody className={STACKED_TABLE.body}>
                  {requestRows.map((req) => (
                    <tr key={req._id} className={STACKED_TABLE.row}>
                      <td data-label="Reference" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                        <Link
                          href={`/admin/stock/purchasing/requests/${req._id}`}
                          className="font-mono text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                        >
                          {req.reference}
                        </Link>
                      </td>
                      <td data-label="Status" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                        <StatusBadge {...REQUEST_STATUS_META[req.status]} />
                      </td>
                      <td data-label="Requester" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs text-muted-foreground")}>
                        {req.requesterLabel}
                        {req.mine ? " (you)" : ""}
                      </td>
                      <td data-label="Need by" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs tabular-nums text-muted-foreground")}>
                        {req.needBy ?? "—"}
                      </td>
                      <td data-label="Lines" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                        {req.lineCount}
                      </td>
                      <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                        <ButtonLink href={`/admin/stock/purchasing/requests/${req._id}`} variant="outline" size="sm">
                          Open
                        </ButtonLink>
                      </td>
                    </tr>
                  ))}
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
              onValueChange={(v) => setOrderFilterMode(v as typeof orderFilterMode)}
            >
              <SelectTrigger aria-label="Order filter" className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open orders (default)</SelectItem>
                <SelectItem value="draft">Draft orders</SelectItem>
                <SelectItem value="closed">Received & closed</SelectItem>
                <SelectItem value="supplier">Filter by supplier</SelectItem>
                <SelectItem value="item">Filter by item</SelectItem>
              </SelectContent>
            </Select>

            {orderFilterMode === "supplier" ? (
              <div className="w-64">
                <SupplierPickerField
                  branchId={branch.id}
                  value={orderSupplier?.id ?? null}
                  selectedName={orderSupplier?.name}
                  onChange={setOrderSupplier}
                />
              </div>
            ) : null}

            {orderFilterMode === "item" ? (
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setOrderItemPickerOpen(true)}>
                  <Filter aria-hidden className="size-4" />
                  {orderItem?.label ?? "Pick item…"}
                </Button>
                <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={orderItemOpenOnly}
                    onChange={(event) => setOrderItemOpenOnly(event.target.checked)}
                    className="size-4 accent-foreground"
                  />
                  Open orders only
                </label>
              </div>
            ) : null}
          </div>

          <Card className="overflow-hidden">
            {orderStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading purchase orders" rows={5} />
            ) : orderRows.length === 0 ? (
              <EmptyState>No purchase orders match this view.</EmptyState>
            ) : (
              <table className={STACKED_TABLE.table}>
                <thead className={STACKED_TABLE.head}>
                  <tr>
                    <th scope="col" className={STACKED_TABLE.th}>Reference</th>
                    <th scope="col" className={STACKED_TABLE.th}>Supplier</th>
                    <th scope="col" className={STACKED_TABLE.th}>Status</th>
                    <th scope="col" className={STACKED_TABLE.th}>Expected</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Due / Ordered</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Total</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Action</th>
                  </tr>
                </thead>
                <tbody className={STACKED_TABLE.body}>
                  {orderRows.map((po) => (
                    <tr key={po._id} className={STACKED_TABLE.row}>
                      <td data-label="Reference" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                        <Link
                          href={`/admin/stock/purchasing/orders/${po._id}`}
                          className="font-mono text-sm font-semibold text-foreground underline-offset-4 hover:underline"
                        >
                          {po.reference}
                        </Link>
                      </td>
                      <td data-label="Supplier" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-sm")}>
                        {po.supplier.name}
                      </td>
                      <td data-label="Status" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                        <StatusBadge {...ORDER_STATUS_META[po.status]} />
                      </td>
                      <td data-label="Expected" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs tabular-nums text-muted-foreground")}>
                        {po.expectedDate ?? "—"}
                      </td>
                      <td data-label="Due / Ordered" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                        <strong className="text-foreground">{po.dueUnits}</strong> / {po.orderedUnits}
                        {po.openLineCount > 0 ? ` (${po.openLineCount} open)` : ""}
                      </td>
                      <td data-label="Total" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "font-mono text-xs tabular-nums lg:text-right")}>
                        {po.totalCost > 0 ? formatSatang(po.totalCost) : "—"}
                      </td>
                      <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                        <ButtonLink href={`/admin/stock/purchasing/orders/${po._id}`} variant="outline" size="sm">
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
      ) : tab === "holds" ? (
        <div {...tabPanelProps("purchasing-hub", "holds")} className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Excess or substitute deliveries held outside On hand across orders of any status.
            </p>
            <Select value={holdStatusFilter} onValueChange={(v) => setHoldStatusFilter(v as PurchaseHoldStatus)}>
              <SelectTrigger aria-label="Held goods status" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Unresolved holds</SelectItem>
                <SelectItem value="accepted">Accepted</SelectItem>
                <SelectItem value="declined">Declined</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="overflow-hidden">
            {holdQueryStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading held goods" rows={4} />
            ) : holdRows.length === 0 ? (
              <EmptyState>
                {holdStatusFilter === "open"
                  ? `No unresolved held goods at ${branch.name}.`
                  : `No ${holdStatusFilter} holds found.`}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {holdRows.map((hold) => (
                  <li key={hold._id} className="flex flex-wrap items-start justify-between gap-4 p-4">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge {...HOLD_STATUS_META[hold.status]} />
                        <span className="font-medium text-foreground">
                          {hold.item.productName} · {hold.item.variantLabel}
                        </span>
                        <span className="font-mono text-xs text-muted-foreground">
                          Qty {hold.quantity} (accepted {hold.acceptedQuantity})
                        </span>
                      </div>
                      <p className="text-sm text-foreground">{hold.reason}</p>
                      <p className="text-xs text-muted-foreground">
                        Receipt{" "}
                        <Link
                          href={`/admin/stock/purchasing/receipts/${hold.receiptId}`}
                          className="font-mono underline underline-offset-4"
                        >
                          {hold.receiptReference}
                        </Link>
                        {hold.orderId ? (
                          <>
                            {" · Order "}
                            <Link
                              href={`/admin/stock/purchasing/orders/${hold.orderId}`}
                              className="font-mono underline underline-offset-4"
                            >
                              {hold.orderReference ?? hold.orderId}
                            </Link>
                          </>
                        ) : null}
                        {" · "}
                        {staffDateTime(hold.createdAt)}
                      </p>
                      {hold.resolution ? (
                        <p className="text-xs text-muted-foreground">
                          Resolution: {hold.resolution}
                          {hold.resolvedByLabel ? ` (${hold.resolvedByLabel})` : ""}
                        </p>
                      ) : null}
                    </div>
                    {hold.status === "open" && access.buyer ? (
                      <div className="flex shrink-0 flex-wrap gap-2">
                        {access.directOrder ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setNewOrderForHold(hold);
                              setNewOrderOpen(true);
                            }}
                          >
                            Create linked order
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          className="text-destructive hover:text-destructive"
                          onClick={() => setDecliningHold(hold)}
                        >
                          <ShieldAlert aria-hidden className="size-3.5" />
                          Decline & return
                        </Button>
                      </div>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {holdQueryStatus === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMoreHolds(STOCK_PAGE_SIZE)}>
                Load more holds
              </Button>
            </div>
          ) : null}
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
        onSelect={(item) => {
          setReqItem({ id: item.variantId, label: `${item.productName} · ${item.label}` });
          setReqFilterMode("item");
        }}
      />

      <StockVariantPickerDialog
        open={orderItemPickerOpen}
        onOpenChange={setOrderItemPickerOpen}
        branchId={branch.id}
        title="Filter orders by item"
        onSelect={(item) => {
          setOrderItem({ id: item.variantId, label: `${item.productName} · ${item.label}` });
          setOrderFilterMode("item");
        }}
      />

      {newRequestOpen ? (
        <RequestEditorSheet
          branchId={branch.id}
          branchName={branch.name}
          initialLines={newRequestPrefill}
          onClose={() => {
            setNewRequestOpen(false);
            setNewRequestPrefill([]);
          }}
          onSaved={(requestId) => {
            setNewRequestOpen(false);
            setNewRequestPrefill([]);
            router.push(`/admin/stock/purchasing/requests/${requestId}`);
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
            router.push(`/admin/stock/purchasing/orders/${orderId}`);
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
            router.push(`/admin/stock/purchasing/receipts/${receiptId}`);
          }}
        />
      ) : null}

      {decliningHold ? (
        <DeclineHoldSheet
          hold={holdRows.find((row) => row._id === decliningHold._id) ?? decliningHold}
          onClose={() => setDecliningHold(null)}
          onDone={() => {
            setDecliningHold(null);
            show("Held goods marked declined and returned.", "success");
          }}
        />
      ) : null}
    </div>
  );
}
