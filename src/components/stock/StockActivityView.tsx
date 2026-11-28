"use client";

import { usePaginatedQuery, useQueries, useQuery, type RequestForQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Filter } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { Callout, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resortDateTime, resortMidnight } from "@/lib/staff-bookings";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { MovementInspectSheet } from "./MovementInspectSheet";
import {
  formatSignedDelta,
  STOCK_ACTIVITY_REASONS,
  MOVEMENT_KIND_META,
  PROBLEM_STATUS_META,
  sanitizeStockReturnTo,
  STOCK_PAGE_SIZE,
  stockReturnLabel,
} from "./stock-format";
import type { StockMovementKind, StockProblemStatus } from "./stock-types";
import { useResolvedStockVariants } from "./StockFormGuard";
import { StockVariantPickerDialog, type BalancePickerRow } from "./StockVariantPicker";

type ProblemReportRow = FunctionReturnType<typeof api.commerce.stock.listReports>["page"][number];

const ALL_MOVEMENT_KINDS = Object.keys(MOVEMENT_KIND_META) as StockMovementKind[];

function deltaClass(delta: number) {
  return cn("font-mono font-semibold tabular-nums", delta > 0 && "text-emerald-700 dark:text-emerald-300", delta < 0 && "text-red-700 dark:text-red-300");
}

function operationLabel(movement: { kind: StockMovementKind; sourceId?: string; sourceRef?: string }) {
  const { sourceId, sourceRef } = movement;
  return sourceRef && sourceRef !== sourceId && !sourceRef.startsWith("[")
    ? sourceRef
    : MOVEMENT_KIND_META[movement.kind].label;
}

export function StockActivityView() {
  const { current: branch } = useAdminBranch();
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialVariantId = searchParams.get("variantId") as Id<"productVariants"> | null;
  const linkedMovementId = searchParams.get("movementId") as Id<"stockMovements"> | null;
  const initialView = searchParams.get("view") === "needs-review" ? "reports" : "movements";
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));

  const [selectedTab, setTab] = useState<"movements" | "reports">(initialView);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [rawSelectedVariant, setSelectedVariant] = useState<{ id: Id<"productVariants">; label: string } | null>(
    initialVariantId ? { id: initialVariantId, label: "Selected item" } : null,
  );
  const [kindFilter, setKindFilter] = useState<StockMovementKind | "all">("all");
  const [actorFilter, setActorFilter] = useState("");
  const [reasonCodeFilter, setReasonCodeFilter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<StockProblemStatus>("open");
  const [selectedMovementId, setActiveMovementId] = useState<Id<"stockMovements"> | null>(null);
  const [activeReportContext, setActiveReportContext] = useState<ProblemReportRow | null>(null);

  const { notice, show, clear } = useNotice();

  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");
  const branchId = branch?.id;
  const linkedMovementQuery = useMemo((): RequestForQueries => {
    if (!branchId || !access?.read || !linkedMovementId) return {};
    return { movement: { query: api.commerce.stock.getMovement, args: { branchId, movementId: linkedMovementId } } };
  }, [access?.read, branchId, linkedMovementId]);
  const linkedMovement = useQueries(linkedMovementQuery).movement;
  const activeMovementId = selectedMovementId ?? (linkedMovement && !(linkedMovement instanceof Error) ? linkedMovementId : null);
  const movementParams = new URLSearchParams(searchParams);
  if (activeMovementId) movementParams.set("movementId", activeMovementId);

  const tab = access?.lead ? selectedTab : "movements";

  const initialVariantIds = useMemo(
    () => (initialVariantId ? [initialVariantId] : []),
    [initialVariantId],
  );
  const { items: resolvedInitialVariants } = useResolvedStockVariants(
    branch?.id ?? null,
    initialVariantIds,
    { enabled: Boolean(branch && access?.read && rawSelectedVariant?.id === initialVariantId && rawSelectedVariant?.label === "Selected item") },
  );

  const selectedVariant = useMemo(() => {
    const resolved = resolvedInitialVariants[0];
    if (rawSelectedVariant && rawSelectedVariant.label === "Selected item" && resolved?.variantId === rawSelectedVariant.id) {
      return {
        id: resolved.variantId,
        label: `${resolved.productName} · ${resolved.label}${resolved.sku ? ` (${resolved.sku})` : ""}`,
      };
    }
    return rawSelectedVariant;
  }, [rawSelectedVariant, resolvedInitialVariants]);

  const queryArgs = useMemo(() => {
    if (!branch || !access?.read) return "skip" as const;
    const from = fromDate ? resortMidnight(fromDate) : undefined;
    const to = toDate ? resortDateTime(toDate, "23:59") + 59_999 : undefined;
    if (from !== undefined && to !== undefined && to < from) return "skip" as const;
    return {
      branchId: branch.id,
      ...(from !== undefined ? { from } : {}),
      ...(to !== undefined ? { to } : {}),
      ...(selectedVariant ? { variantId: selectedVariant.id } : {}),
      ...(kindFilter !== "all" ? { kind: kindFilter } : {}),
      ...(actorFilter.trim() ? { actor: actorFilter.trim() } : {}),
      ...(reasonCodeFilter ? { reasonCode: reasonCodeFilter.trim() } : {}),
    };
  }, [branch, access?.read, fromDate, toDate, selectedVariant, kindFilter, actorFilter, reasonCodeFilter]);

  const dateRangeInvalid = Boolean(fromDate && toDate && toDate < fromDate);

  const {
    results: movements,
    status: movementStatus,
    loadMore: loadMoreMovements,
  } = usePaginatedQuery(api.commerce.stock.listActivity, queryArgs, { initialNumItems: STOCK_PAGE_SIZE });

  const {
    results: reports,
    status: reportQueryStatus,
    loadMore: loadMoreReports,
  } = usePaginatedQuery(
    api.commerce.stock.listReports,
    branch && access?.lead && tab === "reports" ? { branchId: branch.id, status: reportStatus } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  const openCount = access?.openReportCount;
  const hasFilters = Boolean(fromDate || toDate || selectedVariant || kindFilter !== "all" || actorFilter || reasonCodeFilter);
  const groups = new Map<string, typeof movements>();
  for (const row of movements) {
    const key = row.sourceId || row._id;
    const group = groups.get(key);
    if (group) group.push(row);
    else groups.set(key, [row]);
  }

  if (!branch) return null;

  if (access === undefined) {
    return <SkeletonRows label="Loading stock activity" rows={5} />;
  }

  if (!access.read) {
    return (
      <Callout tone="warning" title="Stock access required">
        You do not have a stock role for {branch.name}. Ask an owner to grant branch stock access.
      </Callout>
    );
  }

  function openMovement(id: Id<"stockMovements">) {
    setActiveReportContext(null);
    setActiveMovementId(id);
  }

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setKindFilter("all");
    setSelectedVariant(null);
    setActorFilter("");
    setReasonCodeFilter("");
    if (initialVariantId) {
      const params = new URLSearchParams(searchParams.toString());
      params.delete("variantId");
      router.replace(params.size ? `/admin/stock/activity?${params}` : "/admin/stock/activity");
    }
  }

  const tabs = [
    { value: "movements" as const, label: "All activity" },
    ...(access.lead ? [{ value: "reports" as const, label: <>Needs review{openCount ? <span className="ml-1 rounded-full bg-muted px-2 text-xs">{openCount > 100 ? "100+" : openCount}</span> : null}</> }] : []),
  ];

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />
      {linkedMovementId ? linkedMovement === undefined ? (
        <SkeletonRows label="Loading linked stock movement" rows={1} />
      ) : linkedMovement instanceof Error || linkedMovement === null ? (
        <Callout tone="warning" title="Movement unavailable">
          The linked movement is unavailable at {branch.name}. Check the selected branch or browse recent activity below.
        </Callout>
      ) : null : null}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Stock activity</h2>
        </div>
        {returnTo ? <ButtonLink href={returnTo} variant="outline" size="sm">
          Back to {stockReturnLabel(returnTo, "Balances")}
        </ButtonLink> : null}
      </div>

      {tabs.length > 1 ? (
        <SegmentedTabs
          id="stock-activity"
          label="Activity views"
          value={tab}
          onValueChange={setTab}
          tabs={tabs}
        />
      ) : null}

      {tab === "movements" ? (
        <div {...tabPanelProps("stock-activity", "movements")} className="grid gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="outline" className="max-w-56" onClick={() => setPickerOpen(true)}>
              <Filter aria-hidden className="size-4 shrink-0" />
              <span className="truncate">{selectedVariant?.label ?? "Item / SKU"}</span>
            </Button>
            {selectedVariant ? <Button variant="ghost" size="sm" onClick={() => setSelectedVariant(null)}>Clear item</Button> : null}
            <Select value={kindFilter} onValueChange={(value) => setKindFilter(value as StockMovementKind | "all")}>
              <SelectTrigger aria-label="Movement type"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {ALL_MOVEMENT_KINDS.map(kind => <SelectItem key={kind} value={kind}>{MOVEMENT_KIND_META[kind].label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={reasonCodeFilter || "all"} onValueChange={value => setReasonCodeFilter(value === "all" ? "" : value)}>
              <SelectTrigger aria-label="Reason"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All reasons</SelectItem>
                {Object.entries(STOCK_ACTIVITY_REASONS).map(([code, label]) => <SelectItem key={code} value={code}>{label}</SelectItem>)}
              </SelectContent>
            </Select>
            <Popover>
              <PopoverTrigger asChild><Button variant="outline" className="max-w-40 truncate">{actorFilter || "Staff"}</Button></PopoverTrigger>
              <PopoverContent><Input aria-label="Staff name or email" value={actorFilter} onChange={event => setActorFilter(event.target.value)} /></PopoverContent>
            </Popover>
            <Popover>
              <PopoverTrigger asChild><Button variant="outline">{fromDate || toDate ? "Date range set" : "Date"}</Button></PopoverTrigger>
              <PopoverContent className="grid gap-2">
                <DatePicker id="activity-from" value={fromDate} onValueChange={setFromDate} clearable placeholder="Any start date" />
                <DatePicker id="activity-to" value={toDate} onValueChange={setToDate} clearable placeholder="Any end date" />
              </PopoverContent>
            </Popover>
            {hasFilters ? <Button variant="ghost" size="sm" onClick={clearFilters}>Reset filters</Button> : null}
          </div>
          {dateRangeInvalid ? <p role="alert" className="text-sm text-destructive">End date must be on or after the start date.</p> : null}

          <Card className="overflow-hidden">
            {dateRangeInvalid ? (
              <EmptyState>Adjust the date range to load movements.</EmptyState>
            ) : movementStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading stock movements" rows={6} />
            ) : movements.length === 0 ? (
              <EmptyState
                action={
                  hasFilters ? (
                    <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : null
                }
              >
                {movementStatus === "CanLoadMore" || movementStatus === "LoadingMore"
                  ? "No matches in this page. Older movements are available."
                  : "No stock movements match the current filters."}
              </EmptyState>
            ) : (
              <>
                <div className="divide-y lg:hidden">
                  {[...groups].map(([key, rows]) => (
                    <div key={key} className="divide-y">
                      {rows.length > 1 ? <p className="bg-muted/40 px-3 py-1 text-xs">{operationLabel(rows[0])} · {rows.length} movements</p> : null}
                      {rows.map(row => (
                        <button key={row._id} type="button" className="grid min-h-12 w-full grid-cols-[minmax(0,1fr)_auto] gap-x-2 px-3 py-2 text-left hover:bg-muted/40" onClick={() => openMovement(row._id)}>
                          <span className="truncate text-sm font-medium">{row.itemLabel}</span>
                          <span className={deltaClass(row.delta)}>{formatSignedDelta(row.delta)}</span>
                          <span className="truncate text-xs text-muted-foreground">{MOVEMENT_KIND_META[row.kind].label} · {staffDateTime(row.createdAt)}</span>
                          <span className="truncate font-mono text-xs text-muted-foreground">{row.before} → {row.after}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </div>
                <table className="hidden w-full table-fixed text-left text-sm lg:table">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      {["Time", "Item", "Type & Qty", "Before → After", "Staff", "Reason"].map((label, index) =>
                        <th key={label} scope="col" className={cn("whitespace-nowrap px-3 py-2", ["w-[16%]", "w-[27%]", "w-[16%]", "w-[12%]", "w-[15%]", "w-[14%]"][index])}>{label}</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {[...groups].map(([key, rows]) => (
                      <Fragment key={key}>
                        {rows.length > 1 ? <tr><th colSpan={6} className="bg-muted/40 px-3 py-1 text-xs font-medium">{operationLabel(rows[0])} · {rows.length} movements</th></tr> : null}
                        {rows.map(row => (
                          <tr key={row._id} className="cursor-pointer hover:bg-muted/40" onClick={() => openMovement(row._id)}>
                            <td className="truncate whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{staffDateTime(row.createdAt)}</td>
                            <td className="px-3 py-2">
                              <button type="button" className="block w-full truncate text-left font-medium" title={row.itemLabel} onClick={event => { event.stopPropagation(); openMovement(row._id); }}>{row.itemLabel}</button>
                              {row.sku ? <span className="block truncate whitespace-nowrap font-mono text-xs text-muted-foreground" title={row.sku}>{row.sku}</span> : null}
                            </td>
                            <td className="px-3 py-2">
                              <span className="block truncate text-xs">{MOVEMENT_KIND_META[row.kind].label}</span>
                              <span className={deltaClass(row.delta)}>{formatSignedDelta(row.delta)}</span>
                            </td>
                            <td className="truncate whitespace-nowrap px-3 py-2 font-mono text-xs">{row.before} → {row.after}</td>
                            <td className="truncate px-3 py-2 text-xs text-muted-foreground" title={row.actorLabel}>{row.actorLabel}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground"><span className="line-clamp-2 wrap-anywhere">{row.reason ?? (row.reasonCode ? row.reasonCode.replaceAll("_", " ") : "—")}</span></td>
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </Card>

          {movementStatus === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMoreMovements(STOCK_PAGE_SIZE)}>
                Load older movements
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div {...tabPanelProps("stock-activity", "reports")} className="grid gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              Reports raised by staff or negative-balance reconciliation holds waiting for stock lead review.
            </p>
            <Select value={reportStatus} onValueChange={(v) => setReportStatus(v as StockProblemStatus)}>
              <SelectTrigger aria-label="Report status filter" className="w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Needs review</SelectItem>
                <SelectItem value="resolved">Resolved</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Card className="overflow-hidden">
            {reportQueryStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading problem reports" rows={4} />
            ) : reports.length === 0 ? (
              <EmptyState>
                {reportStatus === "open"
                  ? "No open stock reports waiting for review in this branch."
                  : "No resolved reports yet."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {reports.map((report) => (
                  <li key={report._id} className="flex flex-wrap items-start justify-between gap-4 p-4">
                    <div className="grid min-w-0 flex-1 gap-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <StatusBadge {...PROBLEM_STATUS_META[report.status]} />
                        <span className="max-w-full truncate text-xs text-muted-foreground" title={report.actorLabel}>
                          {report.actorLabel} · {staffDateTime(report.createdAt)}
                        </span>
                        {report.requestedQuantity !== undefined ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                            Reconciliation qty: {report.requestedQuantity}
                          </span>
                        ) : null}
                      </div>
                      {report.movement ? (
                        <p className="truncate text-sm font-medium">
                          {report.movement.itemLabel} · {MOVEMENT_KIND_META[report.movement.kind].label} · {formatSignedDelta(report.movement.delta)}
                        </p>
                      ) : <p className="text-sm text-muted-foreground">Movement unavailable</p>}
                      <p className="text-sm text-foreground">{report.reason}</p>
                      {report.resolution ? (
                        <p className="text-xs text-muted-foreground">
                          Resolution: {report.resolution}
                          {report.resolvedAt ? ` · ${staffDateTime(report.resolvedAt)}` : ""}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          setActiveReportContext(report);
                          setActiveMovementId(report.movementId);
                        }}
                      >
                        Review movement
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {reportQueryStatus === "CanLoadMore" ? (
            <div className="flex justify-center">
              <Button type="button" variant="outline" onClick={() => loadMoreReports(STOCK_PAGE_SIZE)}>
                Load more reports
              </Button>
            </div>
          ) : null}
        </div>
      )}

      <StockVariantPickerDialog
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        branchId={branch.id}
        selectedIds={selectedVariant ? [selectedVariant.id] : []}
        title="Filter activity by item"
        onSelect={(item: BalancePickerRow) => {
          setSelectedVariant({
            id: item.variantId,
            label: `${item.productName} · ${item.label}${item.sku ? ` (${item.sku})` : ""}`,
          });
        }}
      />

      {activeMovementId ? (
        <MovementInspectSheet
          key={`${branch.id}:${activeMovementId}:${activeReportContext?._id ?? ""}`}
          branchId={branch.id}
          movementId={activeMovementId}
          access={access}
          reportContext={activeReportContext}
          returnTo={`/admin/stock/activity?${movementParams}`}
          onClose={() => {
            setActiveMovementId(null);
            setActiveReportContext(null);
            if (linkedMovementId) {
              const params = new URLSearchParams(searchParams.toString());
              params.delete("movementId");
              router.replace(params.size ? `/admin/stock/activity?${params}` : "/admin/stock/activity", { scroll: false });
            }
          }}
          onSuccess={(message) => show(message, "success")}
        />
      ) : null}
    </div>
  );
}
