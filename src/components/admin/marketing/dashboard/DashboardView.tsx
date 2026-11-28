"use client";

import { Card } from "@/components/ui/card";

import type { Id } from "convex/_generated/dataModel";
import type { ReportBasis, ReportData, SpendDraft } from "convex/shared/marketingReport";
import { BarChart3, CalendarRange, Check, ChevronDown, Download, Link2, Megaphone, RotateCw, SlidersHorizontal } from "lucide-react";
import { useId, useMemo, useRef, useState, type FormEvent, type Ref } from "react";
import { Button, ButtonLink } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
import { MoreMenu } from "@/components/ui/more-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { EmptyState } from "../../admin-bulk";
import { useMarketingAccess } from "../MarketingAccess";
import { Callout, FirstRunEmpty } from "../MarketingBits";
import { formatRange, formatStamp } from "../marketing-format";
import { SpendDialog } from "../SpendDialog";
import { DashboardBreakdown } from "./DashboardBreakdown";
import { DashboardChart } from "./DashboardChart";
import { DefinitionsSheet, ExportDialog, SalesSheet, type SalesSheetTarget } from "./DashboardSheets";
import { DashboardTiles } from "./DashboardTiles";
import { rememberRange, rememberedRange } from "./remembered-range";
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
  type Prepared,
  type PresetId,
  type RangeChoice,
  type Sort,
  type Touch,
} from "./report-model";

// The marketing dashboard on one getReport read. Prop-driven: DashboardScreen wires it to Convex,
// the unit tests and the browser fixture render it with fixture data.

export type ReportRequest = { range: RangeChoice; basis: ReportBasis; property?: string; touch?: Touch; breakdown?: BreakdownView };
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

/** The first request on this device: the range it last chose, else the default. */
export const initialRequest = (today: string): ReportRequest => {
  const range = rememberedRange(today);
  return range ? { ...DEFAULT_REQUEST(today), range } : DEFAULT_REQUEST(today);
};

function RangePicker({ range, today, onChange, triggerRef }: { range: RangeChoice; today: string; onChange: (range: RangeChoice) => void; triggerRef: Ref<HTMLButtonElement> }) {
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
        <Button ref={triggerRef} type="button" variant="outline" className="h-10 w-full min-w-0 justify-start gap-2 px-3 shadow-sm sm:h-10 pointer-coarse:h-12 sm:w-auto" aria-label={`Dates: ${label}, ${formatRange(range.from, range.to)}`}>
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
                  className="flex min-h-10 pointer-coarse:min-h-11 w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm text-foreground transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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

/** Rarely changed choices about how sales are credited, with what each one means. */
function ViewOptions({ touch, onTouch }: { touch: Touch; onTouch: (touch: Touch) => void }) {
  const id = useId();
  const label = touch === "first" ? "First touch" : "Last touch";
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="h-10 pointer-coarse:h-12">
          <SlidersHorizontal aria-hidden className="size-4" />
          Attribution · {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[min(22rem,calc(100vw-2rem))] gap-3 p-3">
        <div className="grid gap-2">
          <span id={id} className="text-sm font-medium text-foreground">
            Attribution
          </span>
          <ToggleGroup variant="segmented" tone="subtle" value={touch} onValueChange={onTouch} aria-labelledby={id} className="w-full">
            <ToggleGroupItem value="last" className="flex-1 py-1.5">
              Last touch
            </ToggleGroupItem>
            <ToggleGroupItem value="first" className="flex-1 py-1.5">
              First touch
            </ToggleGroupItem>
          </ToggleGroup>
        </div>
        <p className="text-xs leading-5 text-muted-foreground">
          {touch === "first"
            ? "Each sale goes to the first tracked link the guest opened. These are the same sales as last touch, credited differently, so never add the two together."
            : "Each sale goes to the last tracked link the guest opened within 30 days before booking. First touch credits the same sales to the first link, so never add the two together."}
        </p>
      </PopoverContent>
    </Popover>
  );
}

function LoadingBody() {
  return (
    <div role="status" className="grid gap-4">
      <span className="sr-only">Loading marketing results</span>
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        <Skeleton className="col-span-2 h-52 rounded-xl md:h-auto" />
        <div className="col-span-2 grid grid-cols-1 max-sm:divide-y max-sm:divide-border max-sm:rounded-xl max-sm:border max-sm:border-border max-sm:bg-card max-sm:px-4 sm:grid-cols-2 sm:gap-4 md:col-span-3 lg:grid-cols-3 sm:[&>*:last-child]:col-span-2">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="max-sm:py-3">
              <Skeleton className="h-[72px] rounded-lg sm:h-[132px] sm:rounded-xl" />
            </div>
          ))}
        </div>
      </div>
      <Card>
        <div className="border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-40" />
        </div>
        <div className="flex h-60 items-end gap-2 px-6 pb-6 pt-8">
          {[40, 62, 35, 70, 55, 80, 48, 66, 90, 58, 72, 44].map((h, i) => (
            <div key={i} aria-hidden className="flex-1 animate-pulse rounded-t-[4px] bg-muted" style={{ height: `${h}%` }} />
          ))}
        </div>
      </Card>
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
  const [localProperty, setLocalProperty] = useState("all");
  const [localTouch, setLocalTouch] = useState<Touch>("last");
  const [localView, setLocalView] = useState<BreakdownView>("source");
  const { property = localProperty, touch = localTouch, breakdown: view = localView } = request;
  const setProperty = (next: string) => request.property === undefined ? setLocalProperty(next) : onRequestChange({ ...request, property: next });
  const setTouch = (next: Touch) => request.touch === undefined ? setLocalTouch(next) : onRequestChange({ ...request, touch: next });
  const setView = (next: BreakdownView) => request.breakdown === undefined ? setLocalView(next) : onRequestChange({ ...request, breakdown: next });
  const [path, setPath] = useState<DrillStep[]>([]);
  const [drillNotice, setDrillNotice] = useState("");
  const [sort, setSort] = useState<Sort>({ key: "net", dir: "desc" });
  const [sheet, setSheet] = useState<(SalesSheetTarget & { snapshot: Prepared }) | null>(null);
  const [definitions, setDefinitions] = useState(false);
  const definitionsTrigger = useRef<HTMLButtonElement>(null);
  const rangeTrigger = useRef<HTMLButtonElement>(null);
  const [exporting, setExporting] = useState(false);
  const [spendFor, setSpendFor] = useState<string[] | null>(null);

  const { capabilities } = useMarketingAccess();
  const report = state.status === "ready" ? state.report : null;
  // A property that isn't in this read (it was removed) falls back to All properties.
  const propertyFilter = report?.properties.some((x) => x.id === property) ? property : "all";
  const p = useMemo(() => (report ? prepareReport(report, { property: propertyFilter, touch }) : null), [report, propertyFilter, touch]);
  const totals = useMemo(() => (p ? businessTotals(p) : null), [p]);
  const breakdown = useMemo(() => (p ? buildBreakdown(p, view, path, sort) : null), [p, view, path, sort]);
  if (breakdown && breakdown.path.length !== path.length) {
    setPath(breakdown.path);
    setDrillNotice("The selected drill is outside this report scope. Showing the nearest available level.");
  }
  if (breakdown && sort.key !== breakdown.sort.key) setSort(breakdown.sort);
  const propertyName = report?.properties.find((x) => x.id === propertyFilter)?.name ?? "All properties";
  const pathLabel = p ? (breakdown?.path ?? []).map((step) => stepName(p, step)).join(" › ") : "";

  // Marketing set-up and business activity are separate questions. Activity is read from the whole
  // answer, not the property filter: any sale (refund-only, coupon-only and zero-net ones too), money
  // event, visit or spend. A cut-short read is unknown, never empty.
  const noSetup = !!report && report.campaigns.length === 0 && report.links.length === 0;
  const activity = !!report && (report.sales.length > 0 || report.events.length > 0 || report.sessions.some((row) => row.count > 0) || report.spend.length > 0);
  const emptyWithoutSetup = noSetup && !activity && !report?.truncated;
  // Spend with no sales yet is a result too (ROAS 0×), not an empty range.
  const emptyRange = !!p && !emptyWithoutSetup && p.lines.length === 0 && p.sessions.tracked === 0 && p.spend.size === 0;
  const spendCampaigns = (spendFor ?? [])
    .map((id) => report?.campaigns.find((c) => c.id === id))
    .filter((c): c is ReportData["campaigns"][number] => !!c && c.status === "active")
    .map((c) => ({ id: c.id, name: c.name }));

  function openRow(row: BreakdownRow) {
    if (row.drill.level === "sales") {
      const campaignId = row.lines[0]?.touch?.campaignId;
      if (!p) return;
      setSheet({ snapshot: p, title: row.name, sub: row.sub, lines: row.lines, campaignId: row.key.startsWith("link:") ? campaignId : undefined });
    } else {
      setPath([...path, row.drill]);
    }
  }

  function addSpend(campaignIds: string[]) {
    if (campaignIds.some((id) => report?.campaigns.some((c) => c.id === id && c.status === "active"))) setSpendFor(campaignIds);
  }

  const busy = state.status === "loading" || (state.status === "ready" && !!state.refreshing);
  // Every range change is remembered on this device, so the dashboard opens on it next time.
  const changeRange = (range: RangeChoice) => {
    rememberRange(range);
    onRequestChange({ ...request, range });
  };
  const toolbar = (
    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
      <div className="min-w-0">
        <RangePicker range={request.range} today={today} onChange={changeRange} triggerRef={rangeTrigger} />
      </div>
      <div className="min-w-0">
        <Select value={propertyFilter} onValueChange={setProperty} disabled={!report}>
          <SelectTrigger aria-label="Property" className="h-10 w-full border-border shadow-none sm:h-10 pointer-coarse:h-12 sm:w-56">
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
      <div className="min-w-0 max-sm:col-span-2 max-sm:col-start-1 max-sm:row-start-2 max-sm:mr-14">
        <ToggleGroup variant="segmented" tone="subtle" value={request.basis} onValueChange={(basis) => onRequestChange({ ...request, basis })} aria-label="View" className="w-full">
          <ToggleGroupItem value="cohort" className="flex-1 py-1.5 sm:flex-none">
            <span>Marketing<small className="block font-normal">Attributed visits</small></span>
          </ToggleGroupItem>
          <ToggleGroupItem value="cash" className="flex-1 py-1.5 sm:flex-none">
            <span>Finance<small className="block font-normal">Payment and refund dates</small></span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <div className="flex justify-end gap-2 max-sm:col-start-2 max-sm:row-start-2 sm:ml-auto">
        {/* The phone menu keeps secondary report actions out of the filter controls. */}
        <Button type="button" variant="outline" size="sm" className="h-10 flex-1 max-sm:hidden sm:h-10 pointer-coarse:h-12 sm:flex-none" disabled={!p || emptyWithoutSetup} onClick={() => setExporting(true)}>
          <Download aria-hidden className="size-4" />
          Export CSV
        </Button>
        <MoreMenu
          label="More dashboard actions"
          className="size-10 pointer-coarse:size-12 border border-border sm:hidden"
          items={[
            { label: busy ? "Updating…" : "Refresh", disabled: busy, onSelect: onRetry },
            { label: "Export CSV", disabled: !p || emptyWithoutSetup, onSelect: () => setExporting(true) },
          ]}
        />
      </div>
    </div>
  );

  const context = report ? (
    <div className="grid gap-1 text-xs leading-5 text-muted-foreground">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span role="status" className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <span aria-hidden className={cn("size-1.5 rounded-full", busy ? "motion-safe:animate-pulse bg-amber-500" : "bg-emerald-500")} />
          {busy ? "Updating… · showing previous figures" : `Updated ${formatStamp(report.asOf)}`}
        </span>
        {propertyFilter !== "all" ? (
          <>
            <span>{propertyName}</span>
          </>
        ) : null}
        <button type="button" onClick={onRetry} disabled={busy} className="inline-flex items-center gap-1 rounded font-semibold text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 max-sm:hidden pointer-coarse:min-h-11">
          <RotateCw aria-hidden className={cn("size-3.5", busy && "animate-spin")} />
          {busy ? "Updating" : "Refresh"}
        </button>
      </p>

    </div>
  ) : (
    <div className="flex flex-wrap items-center gap-2">
      {state.status === "loading" && <p role="status" className="text-xs text-muted-foreground">Updating…</p>}
    </div>
  );

  let body;
  if (state.status === "loading") body = <LoadingBody />;
  else if (state.status === "error")
    body = (
      <Card className="p-4 sm:p-6">
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
      </Card>
    );
  else if (emptyWithoutSetup)
    body = (
      <Card>
        <FirstRunEmpty
          icon={BarChart3}
          title="No marketing activity in the selected dates"
          description={capabilities.draft ? "No campaigns or links are configured. Create a campaign and a link or QR code to measure future bookings." : "No campaigns or links are configured. Ask a manager to set them up to measure future bookings."}
        >
          <Button type="button" variant="outline" size="sm" onClick={() => rangeTrigger.current?.click()}>Choose different dates</Button>
          {capabilities.draft && <div className="flex flex-wrap justify-center gap-2">
            <ButtonLink href={campaignsHref} size="sm">
              <Megaphone aria-hidden className="size-4" />
              Create a campaign
            </ButtonLink>
            <ButtonLink href={linksHref} size="sm" variant="outline">
              <Link2 aria-hidden className="size-4" />
              Make a link
            </ButtonLink>
          </div>}
        </FirstRunEmpty>
      </Card>
    );
  else if (emptyRange && report?.truncated)
    body = (
      <Card>
        <EmptyState>Nothing was counted before this read reached its limit, so these dates may still have sales. Choose fewer days to see the figures.</EmptyState>
      </Card>
    );
  else if (emptyRange)
    body = (
      <Card>
        <EmptyState
          action={
            request.range.preset !== "last90" ? (
              <Button type="button" variant="outline" size="sm" onClick={() => changeRange({ preset: "last90", ...presetRange("last90", today) })}>
                Show the last 90 days
              </Button>
            ) : <Button type="button" variant="outline" size="sm" onClick={() => rangeTrigger.current?.click()}>Choose different dates</Button>
          }
        >
          {report?.basis === "cash"
            ? `No payments or refunds${propertyFilter !== "all" ? ` for ${propertyName}` : ""} in these dates.`
            : propertyFilter !== "all"
              ? `No sales for ${propertyName} in these dates.`
              : "No sales or tracked visits in these dates."}
        </EmptyState>
      </Card>
    );
  else if (p && totals && breakdown)
    body = (
      <>
        <DashboardTiles p={p} totals={totals} onAddSpend={addSpend} definitionsAction={<Button ref={definitionsTrigger} type="button" variant="outline" size="sm" onClick={() => setDefinitions(true)}>Metric definitions</Button>} campaignsHref={campaignsHref} />
        <DashboardChart p={p} />
        <DashboardBreakdown
          p={p}
          b={breakdown}
          sort={breakdown.sort}
          onSort={setSort}
          onView={(next) => {
            setView(next);
            setPath([]);
            setDrillNotice("");
          }}
          onPath={(next) => { setPath(next); setDrillNotice(""); }}
          onOpen={openRow}
          onAddSpend={addSpend}
        />
      </>
    );

  const trackingSetup = noSetup && !emptyWithoutSetup ? (
    <Callout
      role="status"
      title="No campaigns or links yet"
      action={capabilities.draft ? (
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <ButtonLink href={campaignsHref} size="sm" className="flex-1 sm:flex-none">
            <Megaphone aria-hidden className="size-4" />
            Create a campaign
          </ButtonLink>
          <ButtonLink href={linksHref} size="sm" variant="outline" className="flex-1 sm:flex-none">
            <Link2 aria-hidden className="size-4" />
            Make a link
          </ButtonLink>
        </div>
      ) : undefined}
    >
      {capabilities.draft
        ? "Until then, every sale counts as not tracked. Create a campaign, then a short link or QR code for each place you share it, to see which ones bring paid bookings."
        : "Until then, every sale counts as not tracked. Ask a manager to set up campaigns and links to see which ones bring paid bookings."}
    </Callout>
  ) : null;

  return (
    <div className={cn("mx-auto grid w-full min-w-0 max-w-7xl gap-4 px-4 py-4 sm:px-6", CHART_COLOR_VARS)}>
      <h1 className="text-xl font-semibold">Marketing dashboard</h1>
      {toolbar}
      <section aria-label="Report scope" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <p><strong>{formatRange(request.range.from, request.range.to)}</strong> · Bangkok · {request.basis === "cash" ? "Payments, refunds and coupon settlements dated in range" : "Sales made in range, with all their cash to date"}</p>
        <ViewOptions touch={touch} onTouch={setTouch} />
        {p && !emptyRange && !emptyWithoutSetup ? <a href="#marketing-breakdown" onClick={(event) => { event.preventDefault(); document.getElementById("marketing-breakdown")?.focus(); }} className="inline-flex items-center rounded underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-ring pointer-coarse:min-h-11 pointer-coarse:min-w-11">Jump to breakdown</a> : null}
      </section>
      {propertyFilter !== "all" ? <p className="text-sm text-muted-foreground">Sales without this property are excluded. Tracked visits, booked rate and ROAS are available for all properties. <button type="button" className="inline-flex items-center underline pointer-coarse:min-h-11 pointer-coarse:min-w-11" onClick={() => setProperty("all")}>Show all properties</button></p> : null}
      {context}
      <p role="status" className={drillNotice ? "text-xs text-muted-foreground" : "sr-only"}>{drillNotice}</p>
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
      {report && emptyRange && !noSetup && capabilities.spend && !report.campaigns.some((campaign) => campaign.status === "active") ? (
        <Callout action={<ButtonLink href={campaignsHref} size="sm" variant="outline">Review campaigns</ButtonLink>}>Add spend is available for active campaigns.</Callout>
      ) : null}
      {request.basis !== "cash" ? trackingSetup : null}
      <div role="region" aria-label="Report results" aria-busy={busy} className={cn("grid min-w-0 gap-4 transition-opacity", state.status === "ready" && state.refreshing && "opacity-60")}>
        {body}
      </div>
      {request.basis === "cash" ? trackingSetup : null}

      {sheet ? <SalesSheet target={sheet} p={sheet.snapshot} onClose={() => setSheet(null)} onOpenStay={onOpenStay} orderHref={orderHref} /> : null}
      {p && breakdown ? <ExportDialog open={exporting} onOpenChange={setExporting} p={p} breakdown={breakdown} pathLabel={pathLabel} propertyName={propertyName} stale={state.status === "ready" && !!state.refreshError} /> : null}
      <DefinitionsSheet open={definitions} onClose={() => setDefinitions(false)} onCloseAutoFocus={(event) => { event.preventDefault(); definitionsTrigger.current?.focus(); }} />
      <SpendDialog
        open={!!spendFor && spendCampaigns.length > 0}
        onOpenChange={(open) => !open && setSpendFor(null)}
        campaigns={spendCampaigns}
        reportScope={report ? { from: report.from, to: report.to, campaignsHref, entries: report.spend } : undefined}
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
