"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, ChevronRight, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SegmentedTabs, tabPanelProps } from "../../SegmentedTabs";
import { StatusBadge } from "../../StatusBadge";
import type { Tone } from "../../status-tones";
import { useMarketingAccess } from "../MarketingAccess";
import { thb } from "../marketing-format";
import {
  formatPercent,
  formatRoas,
  stepName,
  type Breakdown,
  type BreakdownRow,
  type BreakdownView,
  type DrillStep,
  type Prepared,
  type Roas,
  type Sort,
  type SortKey,
  type TotalRow,
} from "./report-model";

// The breakdown with Source / Campaign / Link / Coupon tabs and drill-down breadcrumbs: a table
// where the section is wide enough to show every column (TABLE / CARDS, a container query, since the
// admin sidebar takes 16rem of a laptop screen), cards everywhere else.

export const VIEWS: { value: BreakdownView; label: string }[] = [
  { value: "source", label: "Source" },
  { value: "campaign", label: "Campaign" },
  { value: "link", label: "Link" },
  { value: "coupon", label: "Coupon" },
];

const NOTES: Record<BreakdownView, string> = {
  source: "Source is the link’s configured origin: a /f link opened from LINE still counts as facebook.",
  campaign: "ROAS is the net of a campaign’s sales ÷ its spend for these dates. Without spend it shows Add spend, never ฿0.",
  link: "One row per short link. Paused and ended links stay listed while they have results.",
  coupon:
    "Coupons regroup the same sales by the coupon used, tracked or not, so this table overlaps the others: never add it to the Source table. Sessions don’t apply to coupons.",
};

const STATUS_TONE: Record<string, Tone> = { draft: "neutral", paused: "muted", ended: "muted", archived: "muted", expired: "muted" };
const statusLabel = (status: string) => status.charAt(0).toUpperCase() + status.slice(1);

/** Opaque tint for the header, footers and row hover, so the sticky name column matches its row. */
const TINT = "bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";
const HOVER_TINT = "hover:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";
const GROUP_HOVER_TINT = "group-hover/row:bg-[color-mix(in_oklab,var(--muted)_40%,var(--card))]";

const TABLE = "hidden max-w-full overflow-x-auto @[68rem]:block";
const CARDS = "@[68rem]:hidden";

const num = (value: number) => value.toLocaleString("en-US");
const Dash = ({ title }: { title?: string }) => (
  <span className="text-muted-foreground" title={title}>
    —
  </span>
);

type Column = { key: SortKey; label: string };

function columns(b: Breakdown, cash: boolean): Column[] {
  const label = VIEWS.find((v) => v.value === b.view)!.label;
  return [
    { key: "name", label: b.path.length ? (b.path[b.path.length - 1].level === "source" ? "Campaign" : "Link") : label },
    ...(b.showSessions ? [{ key: "sessions" as const, label: "Sessions" }] : []),
    { key: "paid", label: cash ? "First paid" : b.view === "coupon" ? "Paid uses" : "Paid" },
    ...(b.showSessions ? [{ key: "conv" as const, label: "Conversion" }] : []),
    { key: "discount", label: "Discounts" },
    { key: "collected", label: "Collected" },
    { key: "refunded", label: "Refunds" },
    { key: "net", label: "Net" },
    ...(b.showRoas ? [{ key: "roas" as const, label: "ROAS" }] : []),
  ];
}

function RoasCell({ roas, onAddSpend, tracked }: { roas?: Roas; onAddSpend?: (ids: string[]) => void; tracked: boolean }) {
  const { capabilities } = useMarketingAccess();
  if (!roas || !tracked) return <Dash />;
  if (roas.kind === "all_properties_only") return <span className="text-xs text-muted-foreground">All properties only</span>;
  if (roas.kind === "missing") {
    if (!capabilities.spend || !onAddSpend || !roas.campaignIds.length) return <Dash title="No spend entered for these dates" />;
    return (
      <button
        type="button"
        onClick={() => onAddSpend(roas.campaignIds)}
        className="relative z-10 inline-flex h-8 items-center gap-1 rounded-md border border-dashed border-border px-2 text-xs font-semibold text-foreground transition hover:border-solid hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11"
      >
        <Plus aria-hidden className="size-3.5" />
        Add spend
      </button>
    );
  }
  return (
    <>
      <span className="font-semibold text-foreground">{formatRoas(roas.value)}</span>
      <span className="block whitespace-nowrap text-xs text-muted-foreground">{thb(Math.round(roas.spend))} spend</span>
    </>
  );
}

function Cell({ row, col, onAddSpend }: { row: BreakdownRow | TotalRow; col: SortKey; onAddSpend?: (ids: string[]) => void }) {
  const kind = "kind" in row ? row.kind : "total";
  const untracked = kind === "unknown" || kind === "staff" || kind === "messaging" || kind === "none";
  switch (col) {
    case "sessions":
      return row.sessions === null ? <Dash /> : <>{num(row.sessions)}</>;
    case "conv":
      if (untracked) return <span className="text-xs text-muted-foreground">Excluded</span>;
      return row.conv === null ? <Dash /> : <>{formatPercent(row.conv)}</>;
    case "paid":
      return (
        <>
          {num(row.paid)}
          {row.couponOnlySettlements ? <span className="block text-xs font-normal text-muted-foreground">+{num(row.couponOnlySettlements)} coupon-only</span> : null}
          {row.paidOther ? <span className="block whitespace-nowrap text-xs font-normal text-muted-foreground">+{num(row.paidOther)} {row.paidOther === 1 ? "order" : "orders"}</span> : null}
        </>
      );
    case "discount":
      return row.discount ? <>{thb(row.discount)}</> : <Dash />;
    case "collected":
      return <>{thb(row.collected)}</>;
    case "refunded":
      return row.refunded ? <span className="text-muted-foreground">{thb(row.refunded)}</span> : <Dash />;
    case "net":
      return <span className="font-semibold text-foreground">{thb(row.net)}</span>;
    case "roas":
      return <RoasCell roas={row.roas} onAddSpend={kind === "total" ? undefined : onAddSpend} tracked={!untracked} />;
    default:
      return null;
  }
}

function drillHint(row: BreakdownRow) {
  return row.drill.level === "sales" ? "Show sales" : row.drill.level === "source" ? "Show campaigns" : "Show links";
}

function NameButton({ row, onOpen, card = false }: { row: BreakdownRow; onOpen: (row: BreakdownRow) => void; card?: boolean }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(row)}
      className={cn(
        "group flex w-full min-w-0 items-start gap-2 rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        card && "after:absolute after:inset-0 after:content-['']",
      )}
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn("font-medium text-foreground group-hover:underline group-hover:underline-offset-2", row.mono && "font-mono text-[13px]")}>{row.name}</span>
          {row.status ? <StatusBadge tone={STATUS_TONE[row.status] ?? "neutral"} label={statusLabel(row.status)} /> : null}
        </span>
        {row.sub ? <span className="text-xs text-muted-foreground">{row.sub}</span> : null}
        <span className="sr-only">. {drillHint(row)}</span>
      </span>
      {card ? null : <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />}
    </button>
  );
}

function Divider({ view, cash, colSpan }: { view: BreakdownView; cash: boolean; colSpan?: number }) {
  const text =
    view === "coupon" ? (
      <>
        <span className="admin-eyebrow mr-2">No coupon</span>Sales without a coupon, so the column totals match the business total
      </>
    ) : (
      <>
        <span className="admin-eyebrow mr-2">Not tracked</span>Counted in business totals{cash ? "" : ", left out of conversion"}
      </>
    );
  return colSpan ? (
    <tr className="border-b border-border">
      <td colSpan={colSpan} className="bg-muted/20 px-4 py-2 text-xs text-muted-foreground">
        {text}
      </td>
    </tr>
  ) : (
    <li className="px-4 py-2 text-xs text-muted-foreground [background:color-mix(in_oklab,var(--muted)_30%,var(--card))] md:col-span-2">{text}</li>
  );
}

export function DashboardBreakdown({
  p,
  b,
  sort,
  onSort,
  onView,
  onPath,
  onOpen,
  onAddSpend,
}: {
  p: Prepared;
  b: Breakdown;
  sort: Sort;
  onSort: (sort: Sort) => void;
  onView: (view: BreakdownView) => void;
  onPath: (path: DrillStep[]) => void;
  onOpen: (row: BreakdownRow) => void;
  onAddSpend: (campaignIds: string[]) => void;
}) {
  const cols = columns(b, p.cash);
  const empty = !b.rows.length && !b.pinned.length;
  const scope = p.cash ? "Finance view · by payment and coupon settlement date" : `${p.filters.touch === "first" ? "First touch" : "Last touch"} · sales made in these dates`;
  const toggleSort = (key: SortKey) => onSort(sort.key === key ? { key, dir: sort.dir === "asc" ? "desc" : "asc" } : { key, dir: key === "name" ? "asc" : "desc" });

  const th = (col: Column) => {
    const active = sort.key === col.key;
    const Icon = !active ? ArrowUpDown : sort.dir === "asc" ? ArrowUp : ArrowDown;
    return (
      <th
        key={col.key}
        scope="col"
        aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
        className={cn("py-3 font-semibold", col.key === "name" ? cn("sticky left-0 z-10 min-w-52 px-4 text-left", TINT) : "px-2.5 text-right")}
      >
        <button type="button" onClick={() => toggleSort(col.key)} className={cn("inline-flex items-center gap-1 rounded uppercase tracking-[0.1em] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring", active && "text-foreground")}>
          {col.label}
          <Icon aria-hidden className={cn("size-3.5", !active && "opacity-50")} />
        </button>
      </th>
    );
  };

  const tr = (row: BreakdownRow) => (
    <tr key={row.key} className={cn("group/row border-b border-border transition-colors", HOVER_TINT)}>
      {cols.map((col) =>
        col.key === "name" ? (
          <td key={col.key} className={cn("sticky left-0 z-10 bg-card px-4 py-3 align-top transition-colors", GROUP_HOVER_TINT)}>
            <NameButton row={row} onOpen={onOpen} />
          </td>
        ) : (
          <td key={col.key} className="whitespace-nowrap px-2.5 py-3 text-right align-top tabular-nums">
            <Cell row={row} col={col.key} onAddSpend={onAddSpend} />
          </td>
        ),
      )}
    </tr>
  );

  const footRow = (row: TotalRow) => (
    <tr key={row.key} className={cn("border-b border-border last:border-b-0", TINT)}>
      {cols.map((col) =>
        col.key === "name" ? (
          <th key={col.key} scope="row" className={cn("sticky left-0 z-10 px-4 py-3 text-left text-sm font-semibold text-foreground", TINT)}>
            {row.name}
            {row.note ? <span className="block text-xs font-normal text-muted-foreground">{row.note}</span> : null}
          </th>
        ) : (
          <td key={col.key} className="whitespace-nowrap px-2.5 py-3 text-right font-semibold tabular-nums">
            {col.key === "roas" && !row.roas ? null : <Cell row={row} col={col.key} />}
          </td>
        ),
      )}
    </tr>
  );

  const metricCols = cols.filter((c) => c.key !== "name" && c.key !== "net");
  const card = (row: BreakdownRow) => (
    <li key={row.key} className="relative bg-card transition-colors active:bg-muted/40">
      <div className="grid gap-3 px-4 py-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <NameButton row={row} onOpen={onOpen} card />
          </div>
          <div className="shrink-0 text-right">
            <p className="text-base font-semibold tabular-nums text-foreground">{thb(row.net)}</p>
            <p className="text-xs text-muted-foreground">net</p>
          </div>
          <ChevronRight aria-hidden className="mt-1 size-4 shrink-0 text-muted-foreground" />
        </div>
        <dl className="grid grid-cols-3 gap-x-3 gap-y-2 text-xs">
          {metricCols.map((col) => (
            <div key={col.key} className={cn("min-w-0", col.key === "roas" && "col-span-3")}>
              <dt className="text-muted-foreground">{col.label}</dt>
              <dd className="font-medium tabular-nums text-foreground">
                <Cell row={row} col={col.key} onAddSpend={onAddSpend} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </li>
  );

  const crumbs = b.path.length ? (
    <nav aria-label="Drill-down" className="flex flex-wrap items-center gap-1 border-b border-border bg-muted/20 px-4 py-2 text-sm">
      <button type="button" onClick={() => onPath([])} className="rounded px-1 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
        All {b.view === "source" ? "sources" : "campaigns"}
      </button>
      {b.path.map((step, i) => (
        <span key={`${step.level}:${step.id}`} className="inline-flex items-center gap-1">
          <ChevronRight aria-hidden className="size-3.5 text-muted-foreground" />
          {i === b.path.length - 1 ? (
            <span aria-current="page" className="px-1 font-semibold text-foreground">
              {stepName(p, step)}
            </span>
          ) : (
            <button type="button" onClick={() => onPath(b.path.slice(0, i + 1))} className="rounded px-1 font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:min-h-11">
              {stepName(p, step)}
            </button>
          )}
        </span>
      ))}
    </nav>
  ) : null;

  const sortLabel = sort.key === "name" ? (sort.dir === "asc" ? "A to Z" : "Z to A") : sort.dir === "asc" ? "Low to high" : "High to low";
  let body: ReactNode;
  if (empty) {
    body = <p className="px-4 py-10 text-center text-sm text-muted-foreground">Nothing in these dates for this filter.</p>;
  } else {
    body = (
      <>
        <div className={TABLE}>
          <table className="w-full min-w-[820px] text-left text-sm">
            <thead className={cn("admin-eyebrow border-b border-border", TINT)}>
              <tr>{cols.map(th)}</tr>
            </thead>
            <tbody>
              {b.rows.map(tr)}
              {b.pinned.length ? <Divider view={b.view} cash={p.cash} colSpan={cols.length} /> : null}
              {b.pinned.map(tr)}
            </tbody>
            <tfoot className="border-t-2 border-border">{b.totals.map(footRow)}</tfoot>
          </table>
        </div>
        <div className={CARDS}>
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
            <label htmlFor="breakdown-sort" className="whitespace-nowrap text-xs font-medium text-muted-foreground">
              Sort by
            </label>
            <div className="relative">
              <select
                id="breakdown-sort"
                value={sort.key}
                onChange={(event) => onSort({ key: event.target.value as SortKey, dir: event.target.value === "name" ? "asc" : "desc" })}
                className="h-10 appearance-none rounded-lg border border-input bg-background pl-3 pr-8 text-sm font-semibold text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:[color-scheme:dark]"
              >
                {cols.map((col) => (
                  <option key={col.key} value={col.key}>
                    {col.key === "name" ? "Name" : col.label}
                  </option>
                ))}
              </select>
              <ChevronDown aria-hidden className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 opacity-75" />
            </div>
            <button
              type="button"
              onClick={() => onSort({ ...sort, dir: sort.dir === "asc" ? "desc" : "asc" })}
              className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-xs font-semibold text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {sort.dir === "asc" ? <ArrowUp aria-hidden className="size-4" /> : <ArrowDown aria-hidden className="size-4" />}
              {sortLabel}
            </button>
          </div>
          <ul className="grid gap-px bg-border md:grid-cols-2">
            {b.rows.map(card)}
            {b.rows.length % 2 ? <li aria-hidden className="hidden bg-card md:block" /> : null}
            {b.pinned.length ? <Divider view={b.view} cash={p.cash} /> : null}
            {b.pinned.map(card)}
            {b.pinned.length % 2 ? <li aria-hidden className="hidden bg-card md:block" /> : null}
          </ul>
          <dl className="grid gap-2 border-t-2 border-border bg-muted/30 px-4 py-3 text-sm md:grid-cols-2 md:gap-x-8">
            {b.totals.map((row) => (
              <div key={row.key} className="flex items-baseline justify-between gap-3">
                <dt className="font-semibold text-foreground">{row.name}</dt>
                <dd className="text-right tabular-nums">
                  <span className="font-semibold text-foreground">{thb(row.net)}</span>
                  <span className="block text-xs text-muted-foreground">
                    {num(row.paid)} {p.cash ? "first paid" : "paid"}
                    {row.couponOnlySettlements ? ` + ${num(row.couponOnlySettlements)} coupon-only` : ""}
                    {row.paidOther ? ` + ${num(row.paidOther)} orders` : ""}
                    {row.sessions !== null && b.showSessions ? ` · ${num(row.sessions)} sessions · ${formatPercent(row.conv)}` : ""}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </div>
      </>
    );
  }

  return (
    <section id="breakdown" aria-labelledby="breakdown-title" className="@container min-w-0 border border-border bg-card">
      <div className="grid gap-3 border-b border-border px-4 pt-3">
        <div className="min-w-0">
          <h2 id="breakdown-title" className="text-base font-semibold text-foreground">
            Breakdown
          </h2>
          <p className="text-xs text-muted-foreground">{scope} · select a row to drill down</p>
        </div>
        <SegmentedTabs tabs={VIEWS} value={b.view} onValueChange={onView} label="Breakdown by" id="breakdown" className="-mb-px shadow-none" />
      </div>
      {crumbs}
      <div {...tabPanelProps("breakdown", b.view)}>{body}</div>
      <p className="border-t border-border px-4 py-2.5 text-xs leading-5 text-muted-foreground">
        {NOTES[b.view]}
        {p.cash && b.view !== "coupon" ? " First paid counts sales receiving their first payment; coupon-only counts checkout settlements with no own cash received. The Finance view hides sessions and conversion: they belong to visits." : ""}
        {!p.allProperties && b.showSessions ? " Sessions, conversion and ROAS are for All properties only." : ""}
      </p>
    </section>
  );
}
