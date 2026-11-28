"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
  CheckCircle2,
  ClipboardCheck,
  PackageCheck,
  ShieldCheck,
  ShoppingCart,
  Smartphone,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  BulkActionBar,
  EmptyState,
  SearchBox,
  SelectCheckbox,
  SkeletonRows,
  useDebounced,
  useSelection,
} from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { Callout, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TONES } from "@/components/admin/status-tones";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MoreMenu } from "@/components/ui/more-menu";
import { StickyActionBar } from "@/components/ui/sticky-action-bar";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { ReceiveDeliverySheet } from "./ReceiveDeliverySheet";
import { balanceStatusBadges, STOCK_MAX_LINES, STOCK_PAGE_SIZE, stripSearchParams } from "./stock-format";
import {
  BranchStockAccessSheet,
  OpeningStockSheet,
  StockAdjustSheet,
  StockCountSheet,
} from "./StockBalanceSheets";
import { StockCountMode } from "./StockCountMode";
import { StockBinPanel } from "./StockBinPanel";
import { useResolvedStockVariants } from "./StockFormGuard";

type BalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];
type BatchSession = {
  kind: "countMode" | "count" | "opening";
  batch: BalanceRow[];
  remaining: BalanceRow[];
  batchNumber: number;
  totalBatches: number;
  scopeLabel: string;
};

function createBatchSession(kind: BatchSession["kind"], rows: BalanceRow[], scopeLabel: string, batchNumber = 1, totalBatches?: number): BatchSession | null {
  const source = kind === "countMode" ? rows.filter((row) => !row.lotTracked) : rows;
  if (source.length === 0) return null;
  const total = totalBatches ?? Math.max(1, Math.ceil(source.length / STOCK_MAX_LINES));
  return {
    kind,
    batch: source.slice(0, STOCK_MAX_LINES),
    remaining: source.slice(STOCK_MAX_LINES),
    batchNumber,
    totalBatches: total,
    scopeLabel,
  };
}

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

  // Active sheets (ordered targets frozen into batchSession at launch, capped at STOCK_MAX_LINES)
  const [binTarget, setBinTarget] = useState<{ branchId: Id<"branches">; row: BalanceRow } | null>(null);
  const [batchSession, setBatchSession] = useState<BatchSession | null>(null);
  const [nextBatchPrompt, setNextBatchPrompt] = useState<BatchSession | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<BalanceRow | null>(null);
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
          setBatchSession(createBatchSession("count", [item], "Linked item"));
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
  const allSelectedNeverStocked = useMemo(
    () => selectedRows.length > 0 && selectedRows.every((row) => !row.hasBalance),
    [selectedRows],
  );
  const countableVisibleRows = useMemo(
    () => results.filter((row) => !row.lotTracked),
    [results],
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

  const activeScopeLabel =
    view === "recount"
      ? "Needs recount"
      : debouncedSearch
        ? `Search “${debouncedSearch}”`
        : "Visible catalog";

  function openBatch(kind: BatchSession["kind"], rows: BalanceRow[], scopeLabel: string) {
    const session = createBatchSession(kind, rows, scopeLabel);
    if (!session) return;
    setNextBatchPrompt(null);
    setBatchSession(session);
  }

  function completeBatch(session: BatchSession, successMessage: string) {
    setBatchSession(null);
    selection.clear();
    show(successMessage, "success");
    if (session.remaining.length > 0) {
      setNextBatchPrompt(
        createBatchSession(
          session.kind,
          session.remaining,
          session.scopeLabel,
          session.batchNumber + 1,
          session.totalBatches,
        ),
      );
    } else {
      setNextBatchPrompt(null);
    }
  }

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />
      {nextBatchPrompt ? (
        <Callout
          tone="info"
          role="status"
          title={`Batch ${nextBatchPrompt.batchNumber - 1} of ${nextBatchPrompt.totalBatches} posted`}
          action={
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  setBatchSession(nextBatchPrompt);
                  setNextBatchPrompt(null);
                }}
              >
                Start batch {nextBatchPrompt.batchNumber} ({nextBatchPrompt.batch.length} of {nextBatchPrompt.batch.length + nextBatchPrompt.remaining.length} remaining)
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setNextBatchPrompt(null)}>
                Dismiss
              </Button>
            </div>
          }
        >
          {nextBatchPrompt.scopeLabel} had more than {STOCK_MAX_LINES} items, so it was split into {nextBatchPrompt.totalBatches} batches.
        </Callout>
      ) : null}
      {binTarget?.branchId === branch.id ? <StockBinPanel
        key={`${branch.id}:${binTarget.row.variantId}`} branchId={branch.id}
        variantId={binTarget.row.variantId} label={`${binTarget.row.productName} · ${binTarget.row.label}`}
        onClose={() => setBinTarget(null)} /> : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Balances</h2>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {access.receiver ? (
            <Button
              type="button"
              onClick={() => startPurchasingAction("receive", [])}
            >
              <PackageCheck aria-hidden className="size-4" />
              Receive
            </Button>
          ) : null}
          {access.requester ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => startPurchasingAction("request", [])}
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
                {
                  value: "recount",
                  label: (
                    <>
                      <span>Needs recount</span>
                      {(access.recountCount ?? 0) > 0 ? (
                        <span
                          className={cn(
                            "inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums leading-none",
                            TONES.warning.bg,
                            TONES.warning.text,
                            TONES.warning.border,
                          )}
                        >
                          {(access.recountCount ?? 0) > 100 ? "100+" : access.recountCount}
                        </span>
                      ) : null}
                    </>
                  ),
                },
              ]}
            />
            {view === "catalog" ? (
              <SearchBox
                value={search}
                onChange={setSearch}
                label="Search catalog by name or SKU"
                placeholder="Search item name or SKU…"
              />
            ) : results.length > 0 || status === "LoadingFirstPage" ? (
              <p className="text-xs text-muted-foreground">
                Showing items flagged for recount at {branch.name}. Post a verified count to clear the flag.
              </p>
            ) : null}
            <div className="flex items-center gap-2 lg:hidden">
              {access.receiver && countableVisibleRows.length > 0 ? (
                <Button
                  type="button"
                  variant="default"
                  size="sm"
                  className="min-h-11"
                  onClick={() => openBatch("countMode", countableVisibleRows, activeScopeLabel)}
                >
                  <Smartphone aria-hidden className="size-4" />
                  Count mode
                </Button>
              ) : null}
              <Button
                type="button"
                variant={mobileSelectMode ? "secondary" : "outline"}
                size="sm"
                className="min-h-11"
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
              {access.receiver && allSelectedNeverStocked ? (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => openBatch("opening", selectedRows, "Selected items")}
                >
                  <PackageCheck aria-hidden className="size-4" />
                  Record opening stock ({selectedRows.length})
                </Button>
              ) : null}
              {access.receiver ? (
                selectedUntrackedRows.length > 0 ? (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => openBatch("count", selectedRows, "Selected items")}
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
                    {selectedTrackedRows.length === 1 ? "Open lots" : "Open first in lot view"}
                  </ButtonLink>
                ) : null
              ) : null}
              {access.receiver ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("receive", selectedRows)}
                >
                  Receive {selectedRows.length}
                </Button>
              ) : null}
              {access.requester ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("request", selectedRows)}
                >
                  Request {selectedRows.length}
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

            {(access.receiver || access.lead) && selectedTrackedRows.length > 0 && !allSelectedNeverStocked ? (
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
                        Open lots: {row.productName} · {row.label}
                      </ButtonLink>
                    ))}
                  </div>
                </Callout>
              </div>
            ) : null}

            {status === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading stock balances" rows={6} />
            ) : results.length === 0 ? (
              view === "recount" ? (
                <div className="grid justify-items-center gap-2 px-4 py-8 text-center">
                  <span className={cn("grid size-10 place-items-center rounded-full border", TONES.success.bg, TONES.success.border, TONES.success.text)}>
                    <CheckCircle2 aria-hidden className="size-5" />
                  </span>
                  <p className="text-sm font-medium text-foreground">
                    0 items need a recount at {branch.name}
                  </p>
                  {access.lastVerifiedCountAt ? (
                    <p className="text-xs text-muted-foreground">
                      Last verified count: {staffDateTime(access.lastVerifiedCountAt)}
                    </p>
                  ) : null}
                  <Button type="button" variant="outline" size="sm" className="mt-1" onClick={() => setView("catalog")}>
                    View full catalog
                  </Button>
                </div>
              ) : (
                <EmptyState
                  action={
                    search ? (
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
                  {debouncedSearch
                    ? `No active items match “${debouncedSearch}”.`
                    : "No active products in the catalog yet."}
                </EmptyState>
              )
            ) : (
              <table className="block w-full text-left text-sm lg:table">
                <thead className="admin-eyebrow hidden border-b border-border bg-muted/40 lg:table-header-group">
                  <tr>
                    <th scope="col" className="w-10 px-2 py-2">
                      <SelectCheckbox
                        checked={selection.allSelected}
                        indeterminate={selection.someSelected}
                        onChange={selection.toggleAll}
                        label="Select all visible items"
                        className="lg:size-8 pointer-coarse:size-11"
                      />
                    </th>
                    <th scope="col" className="px-3 py-2">Item & SKU</th>
                    <th scope="col" className="px-3 py-2 text-right">On hand</th>
                    <th scope="col" className="px-3 py-2 text-right">On order</th>
                    <th scope="col" className="px-3 py-2">Status</th>
                    <th scope="col" className="px-3 py-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="block lg:table-row-group">
                  {results.map((row) => {
                    const checked = selection.isSelected(row.variantId);
                    const statusBadges = balanceStatusBadges(row);
                    const showCheckbox = mobileSelectMode || checked;
                    const showOpenLotsPrimary = row.hasBalance && row.lotTracked && (access.receiver || access.lead);
                    return (
                      <tr
                        key={row.variantId}
                        className={cn(
                          "group grid gap-x-3 gap-y-1.5 border-b border-border px-3.5 py-2.5 last:border-b-0 lg:table-row lg:p-0",
                          showCheckbox
                            ? "grid-cols-[auto_minmax(0,1fr)_auto]"
                            : "grid-cols-[minmax(0,1fr)_auto]",
                          checked && "bg-muted/40",
                        )}
                      >
                        <td
                          className={cn(
                            "lg:table-cell lg:w-10 lg:px-2 lg:py-1.5 lg:align-middle",
                            showCheckbox ? "col-start-1 row-start-1 flex items-start" : "hidden lg:table-cell",
                          )}
                        >
                          <SelectCheckbox
                            checked={checked}
                            onChange={() => selection.toggle(row.variantId)}
                            label={`Select ${row.productName} ${row.label}`}
                            className="lg:size-8 pointer-coarse:size-11"
                          />
                        </td>
                        <td
                          className={cn(
                            "min-w-0 lg:table-cell lg:px-3 lg:py-2 lg:align-middle",
                            showCheckbox ? "col-start-2 row-start-1" : "col-start-1 row-start-1",
                          )}
                        >
                          <span className="block truncate font-medium leading-tight text-foreground">
                            {row.productName}
                          </span>
                          <span className="mt-0.5 block truncate text-xs leading-tight text-muted-foreground">
                            {row.label}
                            {row.sku ? <span className="font-mono"> · {row.sku}</span> : null}
                          </span>
                        </td>
                        <td
                          className={cn(
                            "self-start text-right font-mono tabular-nums lg:table-cell lg:px-3 lg:py-2 lg:align-middle",
                            showCheckbox ? "col-start-3 row-start-1" : "col-start-2 row-start-1",
                            row.onHand < 0
                              ? "text-destructive"
                              : row.onHand === 0
                                ? "text-muted-foreground"
                                : "text-foreground",
                          )}
                        >
                          <span className="text-lg font-bold leading-tight lg:text-sm lg:font-semibold">
                            {row.onHand.toLocaleString("en-US")}
                          </span>
                          <span className="block font-sans text-[11px] font-normal leading-tight text-muted-foreground lg:hidden">
                            on hand
                          </span>
                        </td>
                        <td
                          className={cn(
                            "font-mono text-xs tabular-nums lg:table-cell lg:px-3 lg:py-2 lg:text-right lg:align-middle",
                            row.onOrder > 0
                              ? cn("row-start-2", showCheckbox ? "col-start-2" : "col-start-1")
                              : "hidden lg:table-cell",
                          )}
                        >
                          {row.onOrder > 0 ? (
                            <Link
                              href={`/admin/stock/purchasing?tab=orders&variantId=${row.variantId}&returnTo=${encodedReturnTo}`}
                              aria-label={`${row.onOrder.toLocaleString("en-US")} ${row.onOrder === 1 ? "unit" : "units"} on open orders`}
                              className="inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 font-mono text-xs font-medium whitespace-nowrap text-slate-700 transition-colors hover:border-foreground/40 hover:text-foreground dark:border-slate-400/30 dark:bg-slate-400/15 dark:text-slate-300"
                            >
                              +{row.onOrder.toLocaleString("en-US")} incoming
                            </Link>
                          ) : (
                            <span className="text-muted-foreground" aria-label="No units on open orders">—</span>
                          )}
                        </td>
                        <td
                          className={cn(
                            "lg:table-cell lg:px-3 lg:py-2 lg:align-middle",
                            statusBadges.length > 0 || row.lotTracked
                              ? row.onOrder > 0
                                ? "col-span-full"
                                : showCheckbox
                                  ? "col-start-2 col-span-2 row-start-2"
                                  : "col-span-full row-start-2"
                              : "hidden lg:table-cell",
                          )}
                        >
                          {statusBadges.length > 0 || row.lotTracked ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              {statusBadges.map((badge) => (
                                <StatusBadge key={badge.label} tone={badge.tone} label={badge.label} />
                              ))}
                              {row.lotTracked ? <StatusBadge tone="info" label="Lot-tracked" /> : null}
                            </div>
                          ) : (
                            <span className="sr-only">In stock</span>
                          )}
                        </td>
                        <td className="col-span-full pt-1 lg:table-cell lg:px-3 lg:py-1.5 lg:text-right lg:align-middle">
                          <div className="flex flex-wrap items-center gap-1.5 lg:flex-nowrap lg:justify-end">
                            {!row.hasBalance ? (
                              access.receiver ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="min-h-11 lg:min-h-0 lg:h-8 lg:px-2.5 lg:text-xs pointer-coarse:min-h-11"
                                  onClick={() => openBatch("opening", [row], "Single item")}
                                >
                                  Record opening stock
                                </Button>
                              ) : null
                            ) : showOpenLotsPrimary ? (
                              <ButtonLink
                                href={lotViewHref(row.variantId)}
                                variant="outline"
                                size="sm"
                                className="min-h-11 lg:min-h-0 lg:h-8 lg:px-2.5 lg:text-xs pointer-coarse:min-h-11"
                              >
                                Open lots
                              </ButtonLink>
                            ) : (
                              <>
                                {access.receiver ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="min-h-11 border border-border lg:min-h-0 lg:h-8 lg:border-transparent lg:px-2.5 lg:text-xs lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100 pointer-coarse:min-h-11 pointer-coarse:opacity-100"
                                    onClick={() => openBatch("count", [row], "Single item")}
                                  >
                                    Count
                                  </Button>
                                ) : null}
                                {access.lead ? (
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="sm"
                                    className="min-h-11 border border-border lg:min-h-0 lg:h-8 lg:border-transparent lg:px-2.5 lg:text-xs lg:opacity-0 lg:transition-opacity lg:group-hover:opacity-100 lg:group-focus-within:opacity-100 lg:focus-visible:opacity-100 pointer-coarse:min-h-11 pointer-coarse:opacity-100"
                                    onClick={() => setAdjustTarget(row)}
                                  >
                                    Adjust
                                  </Button>
                                ) : null}
                              </>
                            )}
                            <MoreMenu
                              label={`More actions for ${row.productName} ${row.label}`}
                              className="lg:size-8 pointer-coarse:size-11"
                              items={[
                                {
                                  label: "View bin custody",
                                  onSelect: () => setBinTarget({ branchId: branch.id, row }),
                                },
                                {
                                  label: "Count",
                                  hidden: row.hasBalance || !access.receiver || row.lotTracked,
                                  onSelect: () => openBatch("count", [row], "Single item"),
                                },
                                {
                                  label: "Adjust",
                                  hidden: row.hasBalance || !access.lead || row.lotTracked,
                                  onSelect: () => setAdjustTarget(row),
                                },
                                {
                                  label: "Open lots",
                                  hidden: !row.lotTracked || showOpenLotsPrimary,
                                  onSelect: () => router.push(lotViewHref(row.variantId)),
                                },
                                {
                                  label: "Receive delivery",
                                  hidden: !access.receiver,
                                  onSelect: () => startPurchasingAction("receive", [row]),
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
              {access.receiver && allSelectedNeverStocked ? (
                <Button type="button" size="sm" onClick={() => openBatch("opening", selectedRows, "Selected items")}>
                  Opening ({selectedRows.length})
                </Button>
              ) : access.receiver ? (
                selectedUntrackedRows.length > 0 ? (
                  <Button type="button" size="sm" onClick={() => openBatch("count", selectedRows, "Selected items")}>
                    {selectedTrackedRows.length > 0 ? "Count untracked" : "Count"}
                  </Button>
                ) : selectedTrackedRows.length > 0 ? (
                  <ButtonLink
                    href={lotViewHref(selectedTrackedRows[0].variantId)}
                    size="sm"
                  >
                    Open lots
                  </ButtonLink>
                ) : null
              ) : null}
              {access.receiver ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("receive", selectedRows)}
                >
                  Receive {selectedRows.length}
                </Button>
              ) : null}
              {access.requester ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => startPurchasingAction("request", selectedRows)}
                >
                  Request {selectedRows.length}
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

      {batchSession?.kind === "count" ? (
        <StockCountSheet
          key={`count-${batchSession.batchNumber}-${batchSession.batch.map((r) => r.variantId).join(",")}`}
          branchId={branch.id}
          branchName={branch.name}
          items={batchSession.batch}
          liveItems={results}
          staffKey={access.actorEmail}
          scopeLabel={
            batchSession.totalBatches > 1
              ? `${batchSession.scopeLabel} · Batch ${batchSession.batchNumber}/${batchSession.totalBatches}`
              : undefined
          }
          onClose={() => setBatchSession(null)}
          onSuccess={() => completeBatch(batchSession, "Stock count posted and recorded in Activity.")}
        />
      ) : null}

      {batchSession?.kind === "countMode" ? (
        <StockCountMode
          key={`countMode-${batchSession.batchNumber}-${batchSession.batch.map((r) => r.variantId).join(",")}`}
          branchId={branch.id}
          branchName={branch.name}
          items={batchSession.batch}
          liveItems={results}
          staffKey={access.actorEmail}
          scopeLabel={batchSession.scopeLabel}
          batchInfo={{
            batchNumber: batchSession.batchNumber,
            totalBatches: batchSession.totalBatches,
            remainingCount: batchSession.remaining.length,
          }}
          onClose={() => setBatchSession(null)}
          onSuccess={(count) =>
            completeBatch(batchSession, `Stock count posted for ${count} ${count === 1 ? "item" : "items"}.`)
          }
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

      {batchSession?.kind === "opening" ? (
        <OpeningStockSheet
          key={`opening-${batchSession.batchNumber}-${batchSession.batch.map((r) => r.variantId).join(",")}`}
          branchId={branch.id}
          branchName={branch.name}
          items={batchSession.batch}
          liveItems={results}
          scopeLabel={
            batchSession.totalBatches > 1
              ? `${batchSession.scopeLabel} · Batch ${batchSession.batchNumber}/${batchSession.totalBatches}`
              : undefined
          }
          onRedirectToCount={(row) => openBatch("count", [row], "Redirected from opening")}
          onClose={() => setBatchSession(null)}
          onSuccess={() => completeBatch(batchSession, "Opening stock recorded.")}
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
