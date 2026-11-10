"use client";

import type { Id } from "convex/_generated/dataModel";
import type { ReportBasis, ReportData, SpendDraft } from "convex/lib/marketingReport";
import { BarChart3, BookOpen, CalendarRange, Check, ChevronDown, Download, Link2, Megaphone, RotateCw } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EmptyState } from "../../admin-bulk";
import { Callout, FirstRunEmpty } from "../MarketingBits";
import { formatRange, formatStamp } from "../marketing-format";
import { SpendDialog } from "../SpendDialog";
import { DashboardBreakdown } from "./DashboardBreakdown";
import { DashboardChart } from "./DashboardChart";
import { DefinitionsSheet, ExportDialog, SalesSheet, type SalesSheetTarget } from "./DashboardSheets";
import { DashboardTiles } from "./DashboardTiles";
import {
  CHART_COLOR_VARS,
  PRESETS,
  buildBreakdown,
  businessTotals,
  customRangeProblem,
  prepareReport,
  presetRange,
  stepName,
  type BreakdownRow,
  type BreakdownView,
  type DrillStep,
  type PresetId,
  type RangeChoice,
  type Sort,
  type Touch,
} from "./report-model";

// The marketing dashboard on one getReport read. Prop-driven: DashboardScreen wires it to Convex,
// the unit tests and the browser fixture render it with fixture data.

export type ReportRequest = { range: RangeChoice; basis: ReportBasis };
export type ReportState =
  | { status: "loading" }
  | { status: "error"; message: string }
  /** `refreshError`: the last re-read of these dates failed, so the figures are the earlier ones. */
  | { status: "ready"; report: ReportData; refreshing?: boolean; refreshError?: string };

export type DashboardViewProps = {
  request: ReportRequest;
  onRequestChange: (request: ReportRequest) => void;
  state: ReportState;
  onRetry: () => void;
  /** Today in Asia/Bangkok (YYYY-MM-DD). */
  today: string;
  campaignsHref: string;
  linksHref: string;
  orderHref: (orderId: string) => string;
  onOpenStay: (bookingId: string) => void;
  onSaveSpend: (draft: SpendDraft & { id?: Id<"marketingSpend"> }) => Promise<void>;
  /** Fixed clock for the spend dialog in tests. */
  now?: number;
};

export const DEFAULT_REQUEST = (today: string): ReportRequest => ({ range: { preset: "last30", ...presetRange("last30", today) }, basis: "cohort" });

const ATTRIBUTION_RULE = "last_touch_30d@1";

function RangePicker({ range, today, onChange }: { range: RangeChoice; today: string; onChange: (range: RangeChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [problem, setProblem] = useState<string | null>(null);
  const label = range.preset === "custom" ? formatRange(range.from, range.to) : PRESETS.find((x) => x.id === range.preset)!.label;
  function apply(event: FormEvent) {
    event.preventDefault();
    const issue = customRangeProblem(from, to, today);
    setProblem(issue);
    if (issue) return;
    onChange({ preset: "custom", from, to });
    setOpen(false);
  }
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setFrom(range.from);
          setTo(range.to);
          setProblem(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-10 w-full min-w-0 justify-start gap-2 px-3 shadow-sm sm:h-9 sm:w-auto" aria-label={`Dates: ${label}, ${formatRange(range.from, range.to)}`}>
          <CalendarRange aria-hidden className="size-4 text-muted-foreground" />
          <span className="truncate">{label}</span>
          <ChevronDown aria-hidden className="ml-auto size-4 opacity-75" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(20rem,calc(100vw-2rem))] p-1">
        <ul aria-label="Date range presets" className="grid">
          {PRESETS.map((preset) => {
            const r = presetRange(preset.id, today);
            const selected = range.preset === preset.id;
            return (
              <li key={preset.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  onClick={() => {
                    onChange({ preset: preset.id as PresetId, ...r });
                    setOpen(false);
                  }}
                  className="flex min-h-10 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex size-4 items-center justify-center">{selected ? <Check aria-hidden className="size-4" /> : null}</span>
                  <span className={cn("flex-1", selected && "font-semibold")}>{preset.label}</span>
                  <span className="text-xs text-muted-foreground">{formatRange(r.from, r.to)}</span>
                </button>
              </li>
            );
          })}
        </ul>
        <form noValidate onSubmit={apply} className="mt-1 grid gap-2 border-t border-border p-2">
          <p className="text-xs font-semibold text-muted-foreground">Custom range</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid min-w-0 gap-1">
              <label htmlFor="range-from" className="text-xs text-muted-foreground">
                From
              </label>
              <DatePicker id="range-from" value={from} onValueChange={setFrom} max={today} aria-label="From" className="w-full" />
            </div>
            <div className="grid min-w-0 gap-1">
              <label htmlFor="range-to" className="text-xs text-muted-foreground">
                To
              </label>
              <DatePicker id="range-to" value={to} onValueChange={setTo} max={today} aria-label="To" className="w-full" />
            </div>
          </div>
          {problem ? (
            <p role="alert" className="text-xs font-medium text-destructive">
              {problem}
            </p>
          ) : null}
          <p className="text-xs text-muted-foreground">Up to 92 days at a time.</p>
          <Button type="submit" size="sm">
            Apply range
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function LoadingBody() {
  return (
    <div role="status" className="grid gap-4">
      <span className="sr-only">Loading marketing results</span>
      <section className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-48" />
        </div>
        <div className="grid grid-cols-2 gap-px bg-border md:grid-cols-3 xl:grid-cols-6">
          {Array.from({ length: 6 }, (_, i) => (
            <div key={i} className="grid gap-2 bg-card p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-20" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      </section>
      <section className="border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex h-60 items-end gap-2 px-6 pb-6 pt-8">
          {[40, 62, 35, 70, 55, 80, 48, 66, 90, 58, 72, 44].map((h, i) => (
            <div key={i} aria-hidden className="flex-1 animate-pulse rounded-t-[4px] bg-muted" style={{ height: `${h}%` }} />
          ))}
        </div>
      </section>
    </div>
  );
}

export function DashboardView({
  request,
  onRequestChange,
  state,
  onRetry,
  today,
  campaignsHref,
  linksHref,
  orderHref,
  onOpenStay,
  onSaveSpend,
  now,
}: DashboardViewProps) {
  const [property, setProperty] = useState("all");
  const [touch, setTouch] = useState<Touch>("last");
  const [view, setView] = useState<BreakdownView>("source");
  const [path, setPath] = useState<DrillStep[]>([]);
  const [sort, setSort] = useState<Sort>({ key: "net", dir: "desc" });
  const [sheet, setSheet] = useState<SalesSheetTarget | null>(null);
  const [definitions, setDefinitions] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [spendFor, setSpendFor] = useState<string[] | null>(null);

  const report = state.status === "ready" ? state.report : null;
  // A property that isn't in this read (it was removed) falls back to All properties.
  const propertyFilter = report?.properties.some((x) => x.id === property) ? property : "all";
  const p = useMemo(() => (report ? prepareReport(report, { property: propertyFilter, touch }) : null), [report, propertyFilter, touch]);
  const totals = useMemo(() => (p ? businessTotals(p) : null), [p]);
  const breakdown = useMemo(() => (p ? buildBreakdown(p, view, path, sort) : null), [p, view, path, sort]);
  const propertyName = report?.properties.find((x) => x.id === propertyFilter)?.name ?? "All properties";
  const pathLabel = p ? path.map((step) => stepName(p, step)).join(" › ") : "";

  const firstRun = !!report && report.campaigns.length === 0 && report.links.length === 0;
  // Spend with no sales yet is a result too (ROAS 0×), not an empty range.
  const emptyRange = !!p && !firstRun && p.lines.length === 0 && p.sessions.tracked === 0 && p.spend.size === 0;
  const spendCampaigns = (spendFor ?? [])
    .map((id) => report?.campaigns.find((c) => c.id === id))
    .filter((c): c is ReportData["campaigns"][number] => !!c && c.status !== "archived")
    .map((c) => ({ id: c.id, name: c.name }));

  function openRow(row: BreakdownRow) {
    if (row.drill.level === "sales") {
      const campaignId = row.lines[0]?.touch?.campaignId;
      setSheet({ title: row.name, sub: row.sub, lines: row.lines, campaignId: row.key.startsWith("link:") ? campaignId : undefined });
    } else {
      setPath([...path, row.drill]);
    }
  }

  function addSpend(campaignIds: string[]) {
    if (campaignIds.some((id) => report?.campaigns.some((c) => c.id === id && c.status !== "archived"))) setSpendFor(campaignIds);
  }

  const busy = state.status === "loading" || (state.status === "ready" && !!state.refreshing);
  const toolbar = (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="min-w-0">
        <RangePicker range={request.range} today={today} onChange={(range) => onRequestChange({ ...request, range })} />
      </div>
      <div className="min-w-0">
        <Select value={propertyFilter} onValueChange={setProperty} disabled={!report}>
          <SelectTrigger aria-label="Property" className="h-10 w-full sm:h-9 sm:w-56">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All properties</SelectItem>
            {(report?.properties ?? []).map((x) => (
              <SelectItem key={x.id} value={x.id}>
                {x.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="col-span-2 flex items-center rounded-lg border border-border bg-background p-[3px] sm:col-span-1">
        <span id="touch-label" className="px-2 text-xs font-medium text-muted-foreground">
          Attribution
        </span>
        <ToggleGroup value={touch} onValueChange={setTouch} aria-labelledby="touch-label" className="flex-1 border-0 p-0">
          <ToggleGroupItem value="last" className="flex-1 py-1.5 sm:flex-none">
            Last touch
          </ToggleGroupItem>
          <ToggleGroupItem value="first" className="flex-1 py-1.5 sm:flex-none">
            First touch
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="col-span-2 flex items-center rounded-lg border border-border bg-background p-[3px] sm:col-span-1">
        <span id="basis-label" className="px-2 text-xs font-medium text-muted-foreground">
          View
        </span>
        <ToggleGroup value={request.basis} onValueChange={(basis) => onRequestChange({ ...request, basis })} aria-labelledby="basis-label" className="flex-1 border-0 p-0">
          <ToggleGroupItem value="cohort" className="flex-1 py-1.5 sm:flex-none">
            Marketing
          </ToggleGroupItem>
          <ToggleGroupItem value="cash" className="flex-1 py-1.5 sm:flex-none">
            Finance
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="col-span-2 flex gap-2 sm:ml-auto">
        <Button type="button" variant="outline" size="sm" className="h-10 flex-1 sm:h-9 sm:flex-none" onClick={() => setDefinitions(true)}>
          <BookOpen aria-hidden className="size-4" />
          Definitions
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-10 flex-1 sm:h-9 sm:flex-none" disabled={!p || firstRun} onClick={() => setExporting(true)}>
          <Download aria-hidden className="size-4" />
          Export CSV
        </Button>
      </div>
    </div>
  );

  const context = report ? (
    <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span role="status" className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", busy ? "animate-pulse bg-amber-500" : "bg-emerald-500")} />
          As of {formatStamp(report.asOf)}
        </span>
        <span>Asia/Bangkok · THB</span>
        <span aria-hidden>·</span>
        <span>
          {report.basis === "cash" ? "Paid or refunded" : "Sales made"} {formatRange(report.from, report.to)}
        </span>
        {propertyFilter !== "all" ? (
          <>
            <span aria-hidden>·</span>
            <span>{propertyName}</span>
          </>
        ) : null}
        <button type="button" onClick={onRetry} disabled={busy} className="inline-flex items-center gap-1 rounded font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 pointer-coarse:min-h-11">
          <RotateCw aria-hidden className={cn("size-3.5", busy && "animate-spin")} />
          {busy ? "Updating" : "Refresh"}
        </button>
      </p>
      <p>
        <span className="font-semibold text-foreground">{touch === "first" ? "First touch" : "Last touch"} ({ATTRIBUTION_RULE}):</span>{" "}
        {touch === "first"
          ? "each sale is credited to the first tracked link the guest opened. These are the same sales as last touch, credited differently, so never add the two together."
          : "each sale is credited to the last tracked link the guest opened within 30 days before booking. First touch credits the same sales to the first link instead, so never add the two together."}
      </p>
      {report.basis === "cash" ? (
        <p>
          <span className="font-semibold text-foreground">Finance view (cash date):</span> money counts on the day it was paid or refunded, so it includes payments for older sales. Sessions and
          conversion only exist in the Marketing view.
        </p>
      ) : null}
    </div>
  ) : null;

  let body;
  if (state.status === "loading") body = <LoadingBody />;
  else if (state.status === "error")
    body = (
      <section className="border border-border bg-card p-4 sm:p-6">
        <Callout
          tone="danger"
          role="alert"
          title="Couldn’t load marketing results"
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden className="size-4" />
              Try again
            </Button>
          }
        >
          {state.message} Bookings and payments aren’t affected; only this report failed to load.
        </Callout>
      </section>
    );
  else if (firstRun)
    body = (
      <section className="border border-border bg-card">
        <FirstRunEmpty
          icon={BarChart3}
          title="See which links bring paid bookings"
          description="Create a campaign, then a short link or QR code for each place you share it. Paid bookings and money from those links show up here, next to bookings that came in without a link."
        >
          <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href={campaignsHref} size="sm">
              <Megaphone aria-hidden className="size-4" />
              Create a campaign
            </ButtonLink>
            <ButtonLink href={linksHref} size="sm" variant="outline">
              <Link2 aria-hidden className="size-4" />
              Make a link
            </ButtonLink>
          </div>
        </FirstRunEmpty>
      </section>
    );
  else if (emptyRange)
    body = (
      <section className="border border-border bg-card">
        <EmptyState
          action={
            request.range.preset !== "last90" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => onRequestChange({ ...request, range: { preset: "last90", ...presetRange("last90", today) } })}>
                Show the last 90 days
              </Button>
            ) : undefined
          }
        >
          {report?.basis === "cash"
            ? `No payments or refunds${propertyFilter !== "all" ? ` for ${propertyName}` : ""} in these dates.`
            : propertyFilter !== "all"
              ? `No sales for ${propertyName} in these dates.`
              : "No sales or tracked visits in these dates."}
        </EmptyState>
      </section>
    );
  else if (p && totals && breakdown)
    body = (
      <>
        <DashboardTiles p={p} totals={totals} onAddSpend={addSpend} onDefinitions={() => setDefinitions(true)} />
        <DashboardChart p={p} />
        <DashboardBreakdown
          p={p}
          b={breakdown}
          sort={sort}
          onSort={setSort}
          onView={(next) => {
            setView(next);
            setPath([]);
          }}
          onPath={setPath}
          onOpen={openRow}
          onAddSpend={addSpend}
        />
      </>
    );

  return (
    <div className={cn("mx-auto grid w-full min-w-0 max-w-7xl gap-4 px-4 py-4 sm:px-6", CHART_COLOR_VARS)}>
      <h1 className="sr-only">Marketing dashboard</h1>
      {toolbar}
      {context}
      {state.status === "ready" && state.refreshError ? (
        <Callout
          tone="warning"
          role="alert"
          title="Couldn’t update the figures"
          action={
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              <RotateCw aria-hidden className="size-4" />
              Try again
            </Button>
          }
        >
          {state.refreshError} These are the figures as of {formatStamp(state.report.asOf)}.
        </Callout>
      ) : null}
      {report?.truncated ? (
        <Callout tone="warning" role="status" title="These figures are incomplete">
          This range has more sales than one read can cover, so some are missing. Choose fewer days to see complete figures.
        </Callout>
      ) : null}
      {report?.excluded.nonThb ? (
        <Callout role="status">
          {report.excluded.nonThb === 1 ? "1 sale" : `${report.excluded.nonThb} sales`} in another currency {report.excluded.nonThb === 1 ? "is" : "are"} left out. Figures are THB only.
        </Callout>
      ) : null}
      <div aria-busy={busy} className={cn("grid min-w-0 gap-4 transition-opacity", state.status === "ready" && state.refreshing && "opacity-60")}>
        {body}
      </div>

      {p ? (
        <>
          <SalesSheet target={sheet} p={p} onClose={() => setSheet(null)} onOpenStay={onOpenStay} orderHref={orderHref} />
          {breakdown ? <ExportDialog open={exporting} onOpenChange={setExporting} p={p} breakdown={breakdown} pathLabel={pathLabel} propertyName={propertyName} /> : null}
        </>
      ) : null}
      <DefinitionsSheet open={definitions} onClose={() => setDefinitions(false)} />
      <SpendDialog
        open={!!spendFor && spendCampaigns.length > 0}
        onOpenChange={(open) => !open && setSpendFor(null)}
        campaigns={spendCampaigns}
        defaults={spendCampaigns[0] && report ? { campaignId: spendCampaigns[0].id, from: report.from, to: report.to } : undefined}
        onSave={async (draft) => {
          await onSaveSpend(draft);
          setSpendFor(null);
        }}
        now={now}
      />
    </div>
  );
}
