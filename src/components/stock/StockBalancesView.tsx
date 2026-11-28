"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
  ClipboardCheck,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BulkActionBar,
  EmptyState,
  SearchBox,
  SelectCheckbox,
  SkeletonRows,
  STACKED_TABLE,
  useDebounced,
  useSelection,
} from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { Callout, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoreMenu } from "@/components/ui/more-menu";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import { STOCK_PAGE_SIZE, stripSearchParams } from "./stock-format";
import {
  BranchStockAccessSheet,
  OpeningStockSheet,
  StockAdjustSheet,
  StockCountSheet,
} from "./StockBalanceSheets";
import { useResolvedStockVariants } from "./StockFormGuard";

type BalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];

function lotViewHref(variantId: Id<"productVariants">) {
  return `/admin/stock/expansion?variantId=${encodeURIComponent(variantId)}`;
}

export function StockBalancesView() {
  const { current: branch } = useAdminBranch();
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialView = searchParams.get("view") === "recount" ? "recount" : "catalog";
  const initialSearch = searchParams.get("q") ?? "";
  const receiveVariantParam = searchParams.get("receiveVariantId") as Id<"productVariants"> | null;
  const countVariantParam = searchParams.get("countVariantId") as Id<"productVariants"> | null;

  const [view, setView] = useState<"catalog" | "recount">(initialView);
  const [search, setSearch] = useState(initialSearch);
  const debouncedSearch = useDebounced(search.trim(), 200);
  const [mobileSelectMode, setMobileSelectMode] = useState(false);

  // Active sheets
  const [countTargets, setCountTargets] = useState<BalanceRow[] | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<BalanceRow | null>(null);
  const [openingTarget, setOpeningTarget] = useState<BalanceRow | null>(null);
  const [receivePrefillItems, setReceivePrefillItems] = useState<BalanceRow[] | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [expansionRedirectId, setExpansionRedirectId] = useState<Id<"productVariants"> | null>(null);

  // Consumed one-shot route prefill flags (stripped from URL with replace so Back doesn't reopen)
  const [pendingRouteAction, setPendingRouteAction] = useState<{
    kind: "receive" | "count";
    variantId: Id<"productVariants">;
    branchId: Id<"branches"> | null;
  } | null>(() =>
    receiveVariantParam
      ? { kind: "receive", variantId: receiveVariantParam, branchId: branch?.id ?? null }
      : countVariantParam
        ? { kind: "count", variantId: countVariantParam, branchId: branch?.id ?? null }
        : null,
  );
  const [consumedRouteFlagKey, setConsumedRouteFlagKey] = useState(() =>
    receiveVariantParam || countVariantParam ? `${receiveVariantParam ?? ""}|${countVariantParam ?? ""}` : "",
  );

  const { notice, show, clear } = useNotice();

  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");

  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.listBalances,
    branch && access?.read
      ? {
          branchId: branch.id,
          ...(view === "recount"
            ? { recountOnly: true }
            : debouncedSearch
              ? { search: debouncedSearch }
              : {}),
        }
      : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  // Guarded render sync for newly arriving receiveVariantId / countVariantId route flags
  const routeFlagKey =
    receiveVariantParam || countVariantParam ? `${receiveVariantParam ?? ""}|${countVariantParam ?? ""}` : "";
  if (consumedRouteFlagKey !== routeFlagKey) {
    setConsumedRouteFlagKey(routeFlagKey);
    setExpansionRedirectId(null);
    if (receiveVariantParam) {
      setPendingRouteAction({ kind: "receive", variantId: receiveVariantParam, branchId: branch?.id ?? null });
    } else if (countVariantParam) {
      setPendingRouteAction({ kind: "count", variantId: countVariantParam, branchId: branch?.id ?? null });
    }
  }

  // Consume the action only after the selected branch resolves the requested item.
  useEffect(() => {
    if (!routeFlagKey || pendingRouteAction) return;
    router.replace(
      expansionRedirectId
        ? lotViewHref(expansionRedirectId)
        : stripSearchParams("/admin/stock/balances", searchParams, ["receiveVariantId", "countVariantId"]),
    );
  }, [expansionRedirectId, pendingRouteAction, routeFlagKey, router, searchParams]);

  if (branch && pendingRouteAction) {
    if (pendingRouteAction.branchId === null) {
      setPendingRouteAction({ ...pendingRouteAction, branchId: branch.id });
    } else if (pendingRouteAction.branchId !== branch.id) {
      setPendingRouteAction(null);
    }
  }

  const prefillVariantIds = useMemo(
    () => (pendingRouteAction ? [pendingRouteAction.variantId] : []),
    [pendingRouteAction],
  );
  const { items: resolvedRouteItems, loading: routePrefillLoading } = useResolvedStockVariants(
    branch?.id ?? null,
    prefillVariantIds,
    {
      enabled: Boolean(branch && access?.read && pendingRouteAction?.branchId === branch.id),
      includeRecountFallback: pendingRouteAction?.kind === "count",
    },
  );

  if (pendingRouteAction && branch && pendingRouteAction.branchId === branch.id && access !== undefined) {
    if (!access.read) {
      setPendingRouteAction(null);
    } else if (pendingRouteAction.kind === "receive" && !access.receiver) {
      setPendingRouteAction(null);
      show("Receiver / Counter access is required for that stock action.", "danger");
    } else if (!routePrefillLoading) {
      const item = resolvedRouteItems[0];
      setPendingRouteAction(null);
      if (!item) {
        show("That item could not be prefilled — it may be archived or unavailable for this branch.", "danger");
      } else if (pendingRouteAction.kind === "count") {
        if (item.lotTracked) {
          if (!access.lead && !access.receiver) {
            show("Stock lead access is required to count lot-tracked items.", "danger");
          } else {
            setExpansionRedirectId(item.variantId);
          }
        } else if (!access.receiver) {
          show("Receiver / Counter access is required for that stock action.", "danger");
        } else {
          setCountTargets([item]);
        }
      } else {
        setReceivePrefillItems([item]);
      }
    }
  }

  const visibleKeys = useMemo(() => results.map((row) => row.variantId), [results]);
  const selection = useSelection(visibleKeys);
  const selectedRows = useMemo(
    () => results.filter((row) => selection.isSelected(row.variantId)),
    [results, selection],
  );
  const selectedTrackedRows = useMemo(
    () => selectedRows.filter((row) => row.lotTracked),
    [selectedRows],
  );
  const selectedUntrackedRows = useMemo(
    () => selectedRows.filter((row) => !row.lotTracked),
    [selectedRows],
  );
  const selectedIncoming = useQuery(
    api.commerce.purchasing.incoming,
    branch && access?.read && selectedRows.length > 0
      ? { branchId: branch.id, variantIds: selectedRows.map((row) => row.variantId) }
      : "skip",
  );
  const selectedOnOrderTotal = useMemo(
    () => (selectedIncoming ?? []).reduce((sum, row) => sum + row.quantity, 0),
    [selectedIncoming],
  );

  if (!branch) return null;
  if (access === undefined) return <SkeletonRows label="Loading stock balances" rows={5} />;

  if (!access.read && !access.canManageGrants) {
    return (
      <Callout tone="warning" title="Stock access required">
        You do not have a stock role for {branch.name}. Ask an owner to grant Requester, Approver, Buyer, Receiver/Counter, or Stock lead access.
      </Callout>
    );
  }

  const currentBalancesHref = (() => {
    const params = new URLSearchParams();
    if (view === "recount") params.set("view", "recount");
    else if (search.trim()) params.set("q", search.trim());
    const qs = params.toString();
    return qs ? `/admin/stock/balances?${qs}` : "/admin/stock/balances";
  })();
  const encodedReturnTo = encodeURIComponent(currentBalancesHref);

  function startPurchasingAction(action: "request" | "order" | "receive", rows: BalanceRow[]) {
    const ids = rows.map((row) => row.variantId).join(",");
    const variantQuery = ids ? `&variants=${encodeURIComponent(ids)}` : "";
    const returnQuery = `&returnTo=${encodedReturnTo}`;
    if (action === "request") {
      router.push(`/admin/stock/purchasing?tab=requests&new=1${variantQuery}${returnQuery}`);
    } else if (action === "order") {
      router.push(`/admin/stock/purchasing?tab=orders&new=1${variantQuery}${returnQuery}`);
    } else {
      router.push(`/admin/stock/purchasing?tab=orders&receive=1${variantQuery}${returnQuery}`);
    }
  }

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Balances</h2>
          <p className="text-sm text-muted-foreground">
            Search the full catalog by name or SKU for {branch.name}, including items never stocked here.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {access.receiver ? (
            <Button
              type="button"
              onClick={() => startPurchasingAction("receive", selectedRows)}
            >
              <PackageCheck aria-hidden className="size-4" />
              Receive
            </Button>
          ) : null}
          {access.requester ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => startPurchasingAction("request", selectedRows)}
            >
              <ShoppingCart aria-hidden className="size-4" />
              Request stock
            </Button>
          ) : null}
          {access.canManageGrants ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setSettingsOpen(true)}>
              <ShieldCheck aria-hidden className="size-4" />
              Branch stock access
            </Button>
          ) : null}
        </div>
      </div>

      {!access.read && access.canManageGrants ? (
        <Callout
          tone="info"
          title="No personal stock grant on this branch yet"
          action={
            <Button type="button" size="sm" onClick={() => setSettingsOpen(true)}>
              Configure grants
            </Button>
          }
        >
          Assign yourself or branch staff stock roles (Requester, Approver, Buyer, Receiver, Stock lead) and enable direct order/receipt policies if needed.
        </Callout>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <SegmentedTabs
              label="Balance views"
              value={view}
              onValueChange={(next) => {
                setView(next);
                if (next === "recount") setSearch("");
                selection.clear();
              }}
              tabs={[
                { value: "catalog", label: "Catalog" },
                { value: "recount", label: "Needs recount" },
              ]}
            />
            {view === "catalog" ? (
              <SearchBox
                value={search}
                onChange={setSearch}
                label="Search catalog by name or SKU"
                placeholder="Search item name or SKU…"
              />
            ) : (
              <p className="text-xs text-muted-foreground">
                Showing items flagged for recount at {branch.name}. Post a verified count to clear the flag.
              </p>
            )}
            <Button
              type="button"
              variant={mobileSelectMode ? "secondary" : "outline"}
              size="sm"
              className="lg:hidden"
              onClick={() => {
                setMobileSelectMode((current) => {
                  if (current) selection.clear();
                  return !current;
                });
              }}
            >
              {mobileSelectMode ? "Done selecting" : "Select"}
            </Button>
          </div>

          <Card className="overflow-hidden">
            <BulkActionBar
              count={selection.selectedKeys.length}
              noun={selection.selectedKeys.length === 1 ? "item" : "items"}
              onClear={selection.clear}
            >
              {selectedOnOrderTotal > 0 ? (
                <span className="text-xs tabular-nums text-muted-foreground">
                  ({selectedOnOrderTotal.toLocaleString("en-US")} already on order)
                </span>
              ) : null}
              {access.receiver ? (
                selectedUntrackedRows.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => setCountTargets(selectedRows)}
                  >
                    <ClipboardCheck aria-hidden className="size-4" />
                    {selectedTrackedRows.length > 0
                      ? `Count untracked (${selectedUntrackedRows.length})`
                      : "Count selected"}
                  </Button>
                ) : selectedTrackedRows.length > 0 ? (
                  <ButtonLink
                    href={lotViewHref(selectedTrackedRows[0].variantId)}
                    size="sm"
                    variant="outline"
                  >
                    <ClipboardCheck aria-hidden className="size-4" />
                    {selectedTrackedRows.length === 1 ? "Count in lot view" : "Open first in lot view"}
                  </ButtonLink>
                ) : null
              ) : null}
              {access.requester ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("request", selectedRows)}
                >
                  Request stock
                </Button>
              ) : null}
              {access.directOrder ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("order", selectedRows)}
                >
                  Create order
                </Button>
              ) : null}
            </BulkActionBar>

            {(access.receiver || access.lead) && selectedTrackedRows.length > 0 ? (
              <div className="border-b border-border bg-muted/20 px-4 py-3">
                <Callout tone="info" role="status" title="Lot-tracked items use per-lot counting">
                  <p className="text-xs">
                    {access.receiver && selectedUntrackedRows.length > 0
                      ? `Bulk Count applies only to the ${selectedUntrackedRows.length} untracked ${selectedUntrackedRows.length === 1 ? "item" : "items"}. Open lot view to count each lot-tracked item:`
                      : "Lot-tracked items must be counted per lot in Transfers & Lots:"}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {selectedTrackedRows.map((row) => (
                      <ButtonLink
                        key={row.variantId}
                        href={lotViewHref(row.variantId)}
                        size="sm"
                        variant="outline"
                      >
                        Open lot view: {row.productName} · {row.label}
                      </ButtonLink>
                    ))}
                  </div>
                </Callout>
              </div>
            ) : null}

            {status === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading stock balances" rows={6} />
            ) : results.length === 0 ? (
              <EmptyState
                action={
                  view === "recount" ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setView("catalog")}>
                      View full catalog
                    </Button>
                  ) : search ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setSearch("")}>
                      Clear search
                    </Button>
                  ) : (
                    <ButtonLink href="/admin/stock/products" variant="outline" size="sm">
                      Set up products
                    </ButtonLink>
                  )
                }
              >
                {view === "recount"
                  ? `No items currently need a recount at ${branch.name}.`
                  : debouncedSearch
                    ? `No active items match “${debouncedSearch}”.`
                    : "No active products in the catalog yet."}
              </EmptyState>
            ) : (
              <table className={STACKED_TABLE.table}>
                <thead className={STACKED_TABLE.head}>
                  <tr>
                    <th scope="col" className="w-12 px-2 py-2">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected}
                        onChange={selection.toggleAll}
                        label="Select all visible items"
                      />
                    </th>
                    <th scope="col" className={STACKED_TABLE.th}>Item & SKU</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>On hand</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>On order</th>
                    <th scope="col" className={STACKED_TABLE.th}>Status</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody className={STACKED_TABLE.body}>
                  {results.map((row) => {
                    const checked = selection.isSelected(row.variantId);
                    return (
                      <tr
                        key={row.variantId}
                        className={cn(
                          STACKED_TABLE.row,
                          (mobileSelectMode || checked) && STACKED_TABLE.selectableRow,
                          checked && "bg-muted/40",
                        )}
                      >
                        <td
                          className={cn(
                            STACKED_TABLE.cell,
                            "lg:w-12 lg:px-2 lg:py-2",
                            !mobileSelectMode && !checked && "hidden lg:table-cell",
                          )}
                        >
                          <SelectCheckbox
                            checked={checked}
                            onChange={() => selection.toggle(row.variantId)}
                            label={`Select ${row.productName} ${row.label}`}
                          />
                        </td>
                        <td data-label="Item" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                          <span className="block font-medium text-foreground">{row.productName}</span>
                          <span className="block text-xs text-muted-foreground">
                            {row.label}
                            {row.sku ? ` · ${row.sku}` : ""}
                          </span>
                        </td>
                        <td
                          data-label="On hand"
                          className={cn(
                            STACKED_TABLE.cell,
                            STACKED_TABLE.labelled,
                            "font-mono text-sm font-semibold tabular-nums lg:text-right",
                            row.onHand < 0
                              ? "text-destructive"
                              : row.onHand === 0
                                ? "text-muted-foreground"
                                : "text-foreground",
                          )}
                        >
                          {row.onHand.toLocaleString("en-US")}
                        </td>
                        <td
                          data-label="On order"
                          className={cn(
                            STACKED_TABLE.cell,
                            STACKED_TABLE.labelled,
                            "font-mono text-sm tabular-nums lg:text-right",
                          )}
                        >
                          {row.onOrder > 0 ? (
                            <Link
                              href={`/admin/stock/purchasing?tab=orders&variantId=${row.variantId}&returnTo=${encodedReturnTo}`}
                              className="font-medium text-foreground underline underline-offset-4 hover:text-primary"
                            >
                              {row.onOrder.toLocaleString("en-US")} open
                            </Link>
                          ) : (
                            <span className="text-muted-foreground">0</span>
                          )}
                        </td>
                        <td data-label="Status" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            {row.needsRecount ? (
                              <StatusBadge tone="warning" label="Needs recount" />
                            ) : !row.hasBalance ? (
                              <StatusBadge tone="neutral" label="Never stocked" />
                            ) : (
                              <StatusBadge tone="success" label="Tracked" />
                            )}
                            {row.lotTracked ? <StatusBadge tone="info" label="Lot-tracked" /> : null}
                          </div>
                        </td>
                        <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                          <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                            {(access.receiver || (row.lotTracked && access.lead)) ? (
                              row.lotTracked ? (
                                <ButtonLink
                                  href={lotViewHref(row.variantId)}
                                  variant="outline"
                                  size="sm"
                                >
                                  Count
                                </ButtonLink>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setCountTargets([row])}
                                >
                                  Count
                                </Button>
                              )
                            ) : null}
                            {access.lead ? (
                              row.lotTracked ? (
                                <ButtonLink
                                  href={lotViewHref(row.variantId)}
                                  variant="outline"
                                  size="sm"
                                >
                                  Adjust
                                </ButtonLink>
                              ) : (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  onClick={() => setAdjustTarget(row)}
                                >
                                  Adjust
                                </Button>
                              )
                            ) : null}
                            <MoreMenu
                              label={`More actions for ${row.productName} ${row.label}`}
                              items={[
                                {
                                  label: "Inspect lots & expiry",
                                  hidden: !row.lotTracked,
                                  onSelect: () =>
                                    router.push(lotViewHref(row.variantId)),
                                },
                                {
                                  label: "Receive delivery",
                                  hidden: !access.receiver,
                                  onSelect: () => startPurchasingAction("receive", [row]),
                                },
                                {
                                  label: "Record opening stock",
                                  hidden: !access.receiver || row.hasBalance,
                                  onSelect: () => setOpeningTarget(row),
                                },
                                {
                                  label: "Request stock",
                                  hidden: !access.requester,
                                  onSelect: () => startPurchasingAction("request", [row]),
                                },
                                {
                                  label: "Create order",
                                  hidden: !access.directOrder,
                                  onSelect: () => startPurchasingAction("order", [row]),
                                },
                                {
                                  label: "View open orders",
                                  onSelect: () =>
                                    router.push(`/admin/stock/purchasing?tab=orders&variantId=${row.variantId}&returnTo=${encodedReturnTo}`),
                                },
                                {
                                  label: "View Activity",
                                  onSelect: () =>
                                    router.push(`/admin/stock/activity?variantId=${row.variantId}&returnTo=${encodedReturnTo}`),
                                },
                              ]}
                            />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Card>

          {status === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
                Load more items
              </Button>
            </div>
          ) : null}

          {mobileSelectMode && selection.selectedKeys.length > 0 ? (
            <StickyActionBar position="fixed" className="lg:hidden">
              <span className="text-sm font-medium text-foreground">
                {selection.selectedKeys.length} selected
              </span>
              {access.receiver ? (
                selectedUntrackedRows.length > 0 ? (
                  <Button type="button" size="sm" onClick={() => setCountTargets(selectedRows)}>
                    {selectedTrackedRows.length > 0 ? "Count untracked" : "Count"}
                  </Button>
                ) : selectedTrackedRows.length > 0 ? (
                  <ButtonLink
                    href={lotViewHref(selectedTrackedRows[0].variantId)}
                    size="sm"
                  >
                    Lot view
                  </ButtonLink>
                ) : null
              ) : null}
              {access.requester ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("request", selectedRows)}
                >
                  Request
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="ml-auto"
                onClick={() => {
                  selection.clear();
                  setMobileSelectMode(false);
                }}
              >
                <X aria-hidden className="size-4" />
                Clear
              </Button>
            </StickyActionBar>
          ) : null}
        </>
      )}

      {receivePrefillItems ? (
        <ReceiveDeliverySheet
          branchId={branch.id}
          branchName={branch.name}
          allowDirectReceipt={access.directReceipt}
          canAddSupplier={access.buyer}
          initialMode="direct"
          prefillVariantIds={receivePrefillItems.map((item) => item.variantId)}
          initialLines={receivePrefillItems.map((item) => ({
            variantId: item.variantId,
            productName: item.productName,
            variantLabel: item.label,
            sku: item.sku,
            onHand: item.onHand,
            onOrder: item.onOrder,
            lotTracked: item.lotTracked,
            quantityText: "",
            unitCostText: "",
          }))}
          onClose={() => setReceivePrefillItems(null)}
          onPosted={(receiptId) => {
            setReceivePrefillItems(null);
            router.push(`/admin/stock/purchasing/receipts/${receiptId}?returnTo=${encodedReturnTo}`);
          }}
        />
      ) : null}

      {countTargets ? (
        <StockCountSheet
          branchId={branch.id}
          branchName={branch.name}
          items={countTargets}
          liveItems={results}
          onClose={() => setCountTargets(null)}
          onSuccess={() => {
            setCountTargets(null);
            selection.clear();
            show("Stock count posted and recorded in Activity.", "success");
          }}
        />
      ) : null}

      {adjustTarget ? (
        <StockAdjustSheet
          branchId={branch.id}
          branchName={branch.name}
          item={adjustTarget}
          liveItem={results.find((row) => row.variantId === adjustTarget.variantId)}
          onClose={() => setAdjustTarget(null)}
          onSuccess={() => {
            setAdjustTarget(null);
            show("Stock adjustment posted.", "success");
          }}
        />
      ) : null}

      {openingTarget ? (
        <OpeningStockSheet
          branchId={branch.id}
          branchName={branch.name}
          item={openingTarget}
          liveItem={results.find((row) => row.variantId === openingTarget.variantId)}
          onClose={() => setOpeningTarget(null)}
          onSuccess={() => {
            setOpeningTarget(null);
            show("Opening stock recorded.", "success");
          }}
        />
      ) : null}

      {settingsOpen && access.canManageGrants ? (
        <BranchStockAccessSheet
          branchId={branch.id}
          branchName={branch.name}
          onClose={() => setSettingsOpen(false)}
          onSaved={(msg) => show(msg, "success")}
        />
      ) : null}
    </div>
  );
}
