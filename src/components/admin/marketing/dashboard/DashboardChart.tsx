"use client";

import { Card } from "@/components/ui/card";

import { Table2, BarChart3 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { thb } from "../marketing-format";
import { chartData, niceStep, type ChartMetric, type Prepared } from "./report-model";

// Stacked bars by source, in plain CSS. A table twin carries the same numbers for screen readers
// and for anyone who switches to "Show as table".

const num = (value: number) => value.toLocaleString("en-US");

export function formatChartTick(value: number, money: boolean): string {
  if (!money) return num(value);
  if (value < 0) return `−${formatChartTick(-value, true)}`;
  value /= 100;
  if (value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `฿${Math.round(value / 1000)}K`;
  return thb(value * 100);
}

export function DashboardChart({ p }: { p: Prepared }) {
  const [selection, setMetric] = useState<ChartMetric>(p.cash ? "collected" : "net");
  const metric = !p.cash && selection !== "paid" ? "net" : selection;
  const [inspected, setInspected] = useState(0);
  const inspector = useRef<HTMLSelectElement>(null);
  const [inspecting, setInspecting] = useState(false);
  const chart = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [asTable, setAsTable] = useState(false);
  const data = useMemo(() => chartData(p, metric), [p, metric]);
  const money = metric !== "paid";
  const visible = data.series.filter((s) => !hidden.has(s.key));
  const totals = data.buckets.map((b) => visible.reduce((sum, s) => sum + (b.values[s.key] ?? 0), 0));
  const extent = (sign: number) => Math.max(0, ...data.buckets.map((bucket) => visible.reduce((sum, series) => sum + Math.max(0, sign * (bucket.values[series.key] ?? 0)), 0)));
  const high = extent(1);
  const low = extent(-1);
  const step = niceStep(Math.max(high, low));
  const top = Math.ceil(high / step) * step || (low ? 0 : step);
  const bottom = Math.ceil(low / step) * step;
  const scale = top + bottom;
  const ticks = Array.from({ length: Math.round(scale / step) + 1 }, (_, i) => i * step - bottom);
  const bucketIndex = Math.min(inspected, data.buckets.length - 1);
  const bucket = data.buckets[bucketIndex];
  const labelEvery = Math.max(1, Math.ceil(data.buckets.length / 7));
  const fmt = (value: number) => (money ? thb(value) : num(value));
  const title = p.cash ? { collected: "Collected by source", paid: "First-payment sales by source", refunds: "Refunds by source", net: "Net by source" }[metric] : money ? "Net collected by source" : "Paid bookings by source";
  const dateBasis = !p.cash ? "by booking or sale date" : metric === "refunds" ? "by refund date" : metric === "net" ? "by payment and refund dates" : metric === "paid" ? "by first payment date" : "by payment date";
  const peak = totals.indexOf(Math.max(...totals));

  function inspectBucket(index: number) {
    setInspected(index);
    setInspecting(true);
    requestAnimationFrame(() => inspector.current?.focus());
  }

  const table = (
    <table className="w-full min-w-[28rem] text-left text-sm">
      <caption className="sr-only">
        {title}, {data.interval === "day" ? "daily" : "weekly"}
      </caption>
      <thead className="admin-eyebrow border-b border-border bg-muted/40">
        <tr>
          <th scope="col" className="px-4 py-2">
            {data.interval === "day" ? "Day" : "Week"}
          </th>
          {visible.map((s) => (
            <th key={s.key} scope="col" className="px-3 py-2 text-right">
              {s.label}
            </th>
          ))}
          <th scope="col" className="px-4 py-2 text-right">
            Total
          </th>
        </tr>
      </thead>
      <tbody>
        {data.buckets.map((b, i) => (
          <tr key={b.from} className="border-b border-border last:border-b-0">
            <th scope="row" className="whitespace-nowrap px-4 py-2 font-medium text-foreground">
              {b.long}
            </th>
            {visible.map((s) => (
              <td key={s.key} className="whitespace-nowrap px-3 py-2 text-right font-sans tabular-nums text-muted-foreground">
                {fmt(b.values[s.key] ?? 0)}
              </td>
            ))}
            <td className="whitespace-nowrap px-4 py-2 text-right font-semibold font-sans tabular-nums text-foreground">{fmt(totals[i])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <Card role="region" aria-labelledby="chart-title" className="flex min-w-0 flex-col overflow-hidden ">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="chart-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {data.interval === "day" ? "Daily" : "Weekly, Monday to Sunday"} · {dateBasis}
            {p.cash ? "" : ` · ${p.filters.touch === "first" ? "first touch" : "last touch"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup variant="segmented" tone="subtle" value={metric} onValueChange={setMetric} aria-label="Measure" className="flex-wrap">
            {p.cash ? <><ToggleGroupItem value="collected">Collected</ToggleGroupItem><ToggleGroupItem value="refunds">Refunds</ToggleGroupItem></> : null}
            <ToggleGroupItem value="net" className="whitespace-nowrap py-1.5">
              {p.cash ? "Net" : "Net collected"}
            </ToggleGroupItem>
            <ToggleGroupItem value="paid" className="whitespace-nowrap py-1.5">
              {p.cash ? "First paid" : "Paid bookings"}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} className="h-10 pointer-coarse:h-12 aria-pressed:bg-muted">
            {asTable ? <BarChart3 aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
            {asTable ? "Show chart" : "Show as table"}
          </Button>
        </div>
      </header>
      <p className="px-4 pt-3 text-xs text-muted-foreground"><span className="pointer-coarse:hidden">Select a source to hide or show it</span><span className="hidden pointer-coarse:inline">Tap a source to hide or show it</span></p>
      <div role="group" aria-label="Series (select to hide or show)" className="flex flex-wrap gap-1 px-3 pt-3">
        {data.series.map((s) => {
          const on = !hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              aria-pressed={on}
              onClick={() =>
                setHidden((current) => {
                  const next = new Set(current);
                  if (on) next.add(s.key);
                  else next.delete(s.key);
                  return next;
                })
              }
              className="inline-flex h-8 items-center gap-2 rounded-md border border-transparent aria-[pressed=true]:border-border px-2 text-xs font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[pressed=false]:text-muted-foreground pointer-coarse:min-h-11"
            >
              <span aria-hidden className={cn("size-2.5 rounded-sm border", on ? "border-transparent" : "border-muted-foreground bg-transparent")} style={on ? { background: s.color } : undefined} />
              <span className={cn(!on && "line-through")}>{s.label}</span>
            </button>
          );
        })}
      </div>
      {!visible.length ? (
        <p role="status" className="flex items-center gap-2 px-4 py-3 text-sm">All sources are hidden. <Button variant="outline" size="sm" onClick={() => setHidden(new Set())}>Show all</Button></p>
      ) : asTable ? (
        <div className="mt-3 max-h-80 overflow-auto border-t border-border">{table}</div>
      ) : (
        <>
          <div
            ref={chart}
            role="group"
            tabIndex={-1}
            aria-label={`${title}. ${data.buckets.length} ${data.interval === "day" ? "days" : "weeks"}, highest ${fmt(totals[peak] ?? 0)} (${data.buckets[peak]?.long ?? ""}). The table after the chart has every value.`}
            className="relative mx-3 mb-3 mt-2 h-60 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Plot box: y labels on the left, bars on the right, x labels in the 1.5rem below. */}
            <div className="absolute inset-x-0 bottom-6 top-3">
              {ticks.map((value) => (
                <span aria-hidden key={value} className="absolute left-0 w-10 -translate-y-1/2 pr-2 text-right text-xs font-sans tabular-nums text-muted-foreground" style={{ top: `${100 - ((value + bottom) / scale) * 100}%` }}>
                  {formatChartTick(value, money)}
                </span>
              ))}
              <div className="absolute inset-y-0 left-12 right-0">
                {ticks.map((value) => (
                  <span key={value} className={cn("absolute inset-x-0 border-t", value === 0 ? "border-border" : "border-border/60")} style={{ bottom: `${((value + bottom) / scale) * 100}%` }} />
                ))}
                <button
                  type="button"
                  aria-label="Inspect a date on the plot"
                  onClick={(event) => {
                    if (event.detail === 0) {
                      inspectBucket(bucketIndex);
                      return;
                    }
                    const { left, width } = event.currentTarget.getBoundingClientRect();
                    const index = Math.floor((event.clientX - left) / width * data.buckets.length);
                    inspectBucket(Math.max(0, Math.min(index, data.buckets.length - 1)));
                  }}
                  className="absolute inset-0 flex cursor-crosshair items-end rounded-md focus-visible:outline-2 focus-visible:outline-ring"
                >
                  {data.buckets.map((b, i) => (
                    <span aria-hidden key={b.from} title={`${b.long}, ${fmt(totals[i])}`} className="relative h-full min-w-0 flex-1 hover:bg-muted/60">
                      <span aria-hidden className="absolute inset-x-px flex flex-col-reverse" style={{ bottom: `${bottom / scale * 100}%`, height: `${top / scale * 100}%` }}>
                        {visible.map((series) => <span key={series.key} style={{ height: `${top ? Math.max(0, b.values[series.key] ?? 0) / top * 100 : 0}%`, background: series.color }} />)}
                      </span>
                      <span aria-hidden className="absolute inset-x-px flex flex-col" style={{ top: `${top / scale * 100}%`, height: `${bottom / scale * 100}%` }}>
                        {visible.map((series) => <span key={series.key} style={{ height: `${bottom ? Math.max(0, -(b.values[series.key] ?? 0)) / bottom * 100 : 0}%`, background: series.color }} />)}
                      </span>
                    </span>
                  ))}
                </button>
              </div>
            </div>
            <div aria-hidden className="absolute bottom-0 left-12 right-0 flex h-6 items-end gap-[2px] sm:gap-1">
              {data.buckets.map((b, i) => (
                <span key={b.from} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-xs font-sans tabular-nums text-muted-foreground">
                  {i % labelEvery === 0 ? (data.interval === "day" ? b.label : b.label.split("–")[0]) : ""}
                </span>
              ))}
            </div>
          </div>
          {bucket ? <div className="grid gap-2 border-t px-4 py-3 text-sm">
            {inspecting ? <>
            <label className="flex flex-wrap items-center gap-2">Inspect date
              <select
                ref={inspector}
                value={bucket.from}
                onChange={(event) => setInspected(event.currentTarget.selectedIndex)}
                onKeyDown={(event) => {
                  if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
                  if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
                  event.preventDefault();
                  const next = bucketIndex + (event.key === "ArrowDown" ? 1 : -1);
                  setInspected(Math.max(0, Math.min(next, data.buckets.length - 1)));
                }}
                className="rounded-md border border-input bg-background px-2 py-1.5 pointer-coarse:min-h-11"
              >
                {data.buckets.map((entry) => <option key={entry.from} value={entry.from}>{entry.long}</option>)}
              </select>
            </label>
            <p role="status" className="flex flex-wrap gap-x-4 gap-y-1"><strong>Total {fmt(totals[bucketIndex])}</strong>{visible.filter((series) => bucket.values[series.key]).map((series) => <span key={series.key}>{series.label} {fmt(bucket.values[series.key])}</span>)}</p>
            <Button type="button" size="sm" variant="ghost" className="w-fit" onClick={() => { setInspecting(false); chart.current?.focus(); }}>Close date inspector</Button>
            </> : <Button type="button" size="sm" variant="outline" className="w-fit" onClick={() => inspectBucket(bucketIndex)}>Inspect dates</Button>}
          </div> : null}
          <div className="sr-only">{table}</div>
        </>
      )}
    </Card>
  );
}
