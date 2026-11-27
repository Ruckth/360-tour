"use client";

import { usePaginatedQuery, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Filter, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EmptyState, SkeletonRows, STACKED_TABLE } from "@/components/admin/admin-bulk";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { Callout, NoticeBar, useNotice } from "@/components/admin/marketing/MarketingBits";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { resortDateTime, resortMidnight } from "@/lib/staff-bookings";
import { staffDateTime } from "@/lib/staff-time";
import { cn } from "@/lib/utils";
import { useSearchParams } from "@/platform/navigation";
import { MovementInspectSheet } from "./MovementInspectSheet";
import {
  formatSignedDelta,
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

type FacetMode = "none" | "variant" | "kind" | "actor" | "reasonCode";

const ALL_MOVEMENT_KINDS = Object.keys(MOVEMENT_KIND_META) as StockMovementKind[];

export function StockActivityView() {
  const { current: branch } = useAdminBranch();
  const searchParams = useSearchParams();
  const initialVariantId = searchParams.get("variantId") as Id<"productVariants"> | null;
  const initialView = searchParams.get("view") === "needs-review" ? "reports" : "movements";
  const returnTo = sanitizeStockReturnTo(searchParams.get("returnTo"));

  const [tab, setTab] = useState<"movements" | "reports">(initialView);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [facetMode, setFacetMode] = useState<FacetMode>(initialVariantId ? "variant" : "none");
  const [rawSelectedVariant, setSelectedVariant] = useState<{ id: Id<"productVariants">; label: string } | null>(
    initialVariantId ? { id: initialVariantId, label: "Selected item" } : null,
  );
  const [kindFilter, setKindFilter] = useState<StockMovementKind>("adjust");
  const [actorFilter, setActorFilter] = useState("");
  const [reasonCodeFilter, setReasonCodeFilter] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);
  const [reportStatus, setReportStatus] = useState<StockProblemStatus>("open");
  const [activeMovementId, setActiveMovementId] = useState<Id<"stockMovements"> | null>(null);
  const [activeReportContext, setActiveReportContext] = useState<ProblemReportRow | null>(null);

  const { notice, show, clear } = useNotice();

  const access = useQuery(api.commerce.stock.access, branch ? { branchId: branch.id } : "skip");

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
      ...(facetMode === "variant" && selectedVariant ? { variantId: selectedVariant.id } : {}),
      ...(facetMode === "kind" ? { kind: kindFilter } : {}),
      ...(facetMode === "actor" && actorFilter.trim() ? { actor: actorFilter.trim() } : {}),
      ...(facetMode === "reasonCode" && reasonCodeFilter.trim() ? { reasonCode: reasonCodeFilter.trim() } : {}),
    };
  }, [branch, access?.read, fromDate, toDate, facetMode, selectedVariant, kindFilter, actorFilter, reasonCodeFilter]);

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

  function clearFilters() {
    setFromDate("");
    setToDate("");
    setFacetMode("none");
    setSelectedVariant(null);
    setActorFilter("");
    setReasonCodeFilter("");
  }

  const tabs = [
    { value: "movements" as const, label: "All activity" },
    ...(access.lead ? [{ value: "reports" as const, label: "Needs review" }] : []),
  ];

  return (
    <div className="grid gap-5">
      <NoticeBar notice={notice} onClose={clear} />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-serif text-xl font-semibold text-foreground">Stock activity</h2>
          <p className="text-sm text-muted-foreground">
            Every movement at {branch.name}, newest first. Open any entry to inspect its source, report a problem, or post a linked correction.
          </p>
        </div>
        <ButtonLink href={returnTo ?? "/admin/stock/balances"} variant="outline" size="sm">
          Back to {stockReturnLabel(returnTo, "Balances")}
        </ButtonLink>
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
          <Card className="p-4">
            <div className="grid gap-3 md:grid-cols-4">
              <div className="grid gap-1.5">
                <Label htmlFor="activity-from">From date</Label>
                <DatePicker
                  id="activity-from"
                  value={fromDate}
                  onValueChange={setFromDate}
                  clearable
                  placeholder="Any start date"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="activity-to">To date</Label>
                <DatePicker
                  id="activity-to"
                  value={toDate}
                  onValueChange={setToDate}
                  clearable
                  placeholder="Any end date"
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="activity-facet">Filter by (one at a time)</Label>
                <Select
                  value={facetMode}
                  onValueChange={(value) => setFacetMode(value as FacetMode)}
                >
                  <SelectTrigger id="activity-facet">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">All movements</SelectItem>
                    <SelectItem value="variant">Item / variant</SelectItem>
                    <SelectItem value="kind">Movement type</SelectItem>
                    <SelectItem value="actor">Staff member</SelectItem>
                    <SelectItem value="reasonCode">Reason code</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                {facetMode === "variant" ? (
                  <>
                    <Label>Selected item</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="flex-1 justify-start truncate"
                        onClick={() => setPickerOpen(true)}
                      >
                        <Filter aria-hidden className="size-4 shrink-0" />
                        <span className="truncate">{selectedVariant?.label ?? "Pick item…"}</span>
                      </Button>
                      {selectedVariant ? (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label="Clear selected item"
                          onClick={() => setSelectedVariant(null)}
                        >
                          <X aria-hidden className="size-4" />
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : facetMode === "kind" ? (
                  <>
                    <Label htmlFor="activity-kind">Movement type</Label>
                    <Select value={kindFilter} onValueChange={(v) => setKindFilter(v as StockMovementKind)}>
                      <SelectTrigger id="activity-kind">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ALL_MOVEMENT_KINDS.map((kind) => (
                          <SelectItem key={kind} value={kind}>
                            {MOVEMENT_KIND_META[kind].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </>
                ) : facetMode === "actor" ? (
                  <>
                    <Label htmlFor="activity-actor">Staff name or email</Label>
                    <Input
                      id="activity-actor"
                      value={actorFilter}
                      onChange={(event) => setActorFilter(event.target.value)}
                      placeholder="Enter the name or email shown in Activity"
                    />
                  </>
                ) : facetMode === "reasonCode" ? (
                  <>
                    <Label htmlFor="activity-reason-code">Reason code</Label>
                    <Input
                      id="activity-reason-code"
                      value={reasonCodeFilter}
                      onChange={(event) => setReasonCodeFilter(event.target.value)}
                      placeholder="e.g. damaged, opening_stock"
                    />
                  </>
                ) : (
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!fromDate && !toDate && facetMode === "none"}
                      onClick={clearFilters}
                    >
                      Reset filters
                    </Button>
                  </div>
                )}
              </div>
            </div>
            {dateRangeInvalid ? (
              <p role="alert" className="mt-2 text-xs font-medium text-destructive">
                End date must be on or after the start date.
              </p>
            ) : null}
          </Card>

          <Card className="overflow-hidden">
            {dateRangeInvalid ? (
              <EmptyState>Adjust the date range to load movements.</EmptyState>
            ) : movementStatus === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading stock movements" rows={6} />
            ) : movements.length === 0 ? (
              <EmptyState
                action={
                  fromDate || toDate || facetMode !== "none" ? (
                    <Button type="button" variant="outline" size="sm" onClick={clearFilters}>
                      Clear filters
                    </Button>
                  ) : null
                }
              >
                No stock movements match the current filters.
              </EmptyState>
            ) : (
              <table className={STACKED_TABLE.table}>
                <thead className={STACKED_TABLE.head}>
                  <tr>
                    <th scope="col" className={STACKED_TABLE.th}>Time</th>
                    <th scope="col" className={STACKED_TABLE.th}>Item</th>
                    <th scope="col" className={STACKED_TABLE.th}>Type & Qty</th>
                    <th scope="col" className={STACKED_TABLE.th}>Before → After</th>
                    <th scope="col" className={STACKED_TABLE.th}>Staff</th>
                    <th scope="col" className={STACKED_TABLE.th}>Reason</th>
                    <th scope="col" className={cn(STACKED_TABLE.th, "text-right")}>Action</th>
                  </tr>
                </thead>
                <tbody className={STACKED_TABLE.body}>
                  {movements.map((row) => {
                    const meta = MOVEMENT_KIND_META[row.kind] ?? { label: row.kind, tone: "neutral" as const };
                    return (
                      <tr key={row._id} className={STACKED_TABLE.row}>
                        <td data-label="Time" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "whitespace-nowrap tabular-nums text-xs text-muted-foreground")}>
                          <time dateTime={new Date(row.createdAt).toISOString()}>
                            {staffDateTime(row.createdAt)}
                          </time>
                        </td>
                        <td data-label="Item" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                          <span className="block font-medium text-foreground">{row.itemLabel}</span>
                          {row.sku ? <span className="font-mono text-xs text-muted-foreground">{row.sku}</span> : null}
                        </td>
                        <td data-label="Type & Qty" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled)}>
                          <div className="flex flex-wrap items-center gap-2">
                            <StatusBadge tone={meta.tone} label={meta.label} />
                            <span
                              className={cn(
                                "font-mono text-sm font-semibold tabular-nums",
                                row.delta > 0
                                  ? "text-emerald-700 dark:text-emerald-300"
                                  : row.delta < 0
                                    ? "text-red-700 dark:text-red-300"
                                    : "text-muted-foreground",
                              )}
                            >
                              {formatSignedDelta(row.delta)}
                            </span>
                          </div>
                        </td>
                        <td data-label="Before → After" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "whitespace-nowrap font-mono text-xs tabular-nums")}>
                          {row.before} → <strong className="text-foreground">{row.after}</strong>
                        </td>
                        <td data-label="Staff" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs text-muted-foreground")}>
                          {row.actorLabel}
                        </td>
                        <td data-label="Reason" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "max-w-xs text-xs text-muted-foreground")}>
                          {row.reason ?? (row.reasonCode ? row.reasonCode.replaceAll("_", " ") : "—")}
                        </td>
                        <td className={cn(STACKED_TABLE.cell, "lg:text-right")}>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => {
                              setActiveReportContext(null);
                              setActiveMovementId(row._id);
                            }}
                          >
                            Inspect
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
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
                        <span className="text-xs text-muted-foreground">
                          {report.actorLabel} · {staffDateTime(report.createdAt)}
                        </span>
                        {report.requestedQuantity !== undefined ? (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-xs font-medium text-amber-800 dark:text-amber-300">
                            Reconciliation qty: {report.requestedQuantity}
                          </span>
                        ) : null}
                      </div>
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
          setFacetMode("variant");
        }}
      />

      {activeMovementId ? (
        <MovementInspectSheet
          branchId={branch.id}
          movementId={activeMovementId}
          access={access}
          reportContext={activeReportContext}
          onClose={() => {
            setActiveMovementId(null);
            setActiveReportContext(null);
          }}
          onSuccess={(message) => show(message, "success")}
        />
      ) : null}
    </div>
  );
}
