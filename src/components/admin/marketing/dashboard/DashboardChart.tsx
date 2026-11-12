"use client";

import { Table2, BarChart3 } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";
import { thb } from "../marketing-format";
import { chartData, niceStep, type ChartMetric, type Prepared } from "./report-model";

// Stacked bars by source, in plain CSS. A table twin carries the same numbers for screen readers
// and for anyone who switches to "Show as table".

const num = (value: number) => value.toLocaleString("en-US");

function tick(value: number, money: boolean) {
  if (!money) return num(value);
  value /= 100;
  if (value >= 1_000_000) return `฿${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (value >= 10_000) return `฿${Math.round(value / 1000)}K`;
  return thb(value);
}

export function DashboardChart({ p }: { p: Prepared }) {
  const [metric, setMetric] = useState<ChartMetric>("net");
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [asTable, setAsTable] = useState(false);
  const data = useMemo(() => chartData(p, metric), [p, metric]);
  const money = metric === "net";
  const visible = data.series.filter((s) => !hidden.has(s.key));
  const totals = data.buckets.map((b) => visible.reduce((sum, s) => sum + Math.max(0, b.values[s.key] ?? 0), 0));
  const step = niceStep(Math.max(...totals, 0));
  const top = Math.max(step, Math.ceil(Math.max(...totals, 0) / step) * step);
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);
  const labelEvery = Math.max(1, Math.ceil(data.buckets.length / 7));
  const fmt = (value: number) => (money ? thb(Math.round(value)) : num(value));
  const title = p.cash ? (money ? "Collected by source" : "First-payment sales by source") : money ? "Net collected by source" : "Paid bookings by source";
  const peak = totals.indexOf(Math.max(...totals));

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
              <td key={s.key} className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-muted-foreground">
                {fmt(b.values[s.key] ?? 0)}
              </td>
            ))}
            <td className="whitespace-nowrap px-4 py-2 text-right font-semibold tabular-nums text-foreground">{fmt(totals[i])}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  return (
    <section aria-labelledby="chart-title" className="flex min-w-0 flex-col overflow-hidden border border-border bg-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3">
        <div className="min-w-0 flex-1 basis-48">
          <h2 id="chart-title" className="text-base font-semibold text-foreground">
            {title}
          </h2>
          <p className="text-xs text-muted-foreground">
            {data.interval === "day" ? "Daily" : "Weekly, Monday to Sunday"} · {p.cash ? "by payment date" : "by booking date"}
            {p.cash ? "" : ` · ${p.filters.touch === "first" ? "first touch" : "last touch"}`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup value={metric} onValueChange={setMetric} aria-label="Measure" className="p-[3px]">
            <ToggleGroupItem value="net" className="py-1.5">
              {p.cash ? "Collected" : "Net collected"}
            </ToggleGroupItem>
            <ToggleGroupItem value="paid" className="py-1.5">
              {p.cash ? "First paid" : "Paid bookings"}
            </ToggleGroupItem>
          </ToggleGroup>
          <Button type="button" variant="ghost" size="sm" aria-pressed={asTable} onClick={() => setAsTable((v) => !v)} className="aria-pressed:bg-muted">
            {asTable ? <BarChart3 aria-hidden className="size-4" /> : <Table2 aria-hidden className="size-4" />}
            {asTable ? "Show chart" : "Show as table"}
          </Button>
        </div>
      </header>
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
              className="inline-flex h-8 items-center gap-2 rounded-md px-2 text-xs font-medium text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-[pressed=false]:text-muted-foreground pointer-coarse:min-h-11"
            >
              <span aria-hidden className={cn("size-2.5 rounded-sm border", on ? "border-transparent" : "border-muted-foreground bg-transparent")} style={on ? { background: s.color } : undefined} />
              <span className={cn(!on && "line-through")}>{s.label}</span>
            </button>
          );
        })}
      </div>
      {asTable ? (
        <div className="mt-3 max-h-80 overflow-auto border-t border-border">{table}</div>
      ) : (
        <>
          <div
            role="img"
            tabIndex={0}
            aria-label={`${title}. ${data.buckets.length} ${data.interval === "day" ? "days" : "weeks"}, highest ${fmt(totals[peak] ?? 0)} (${data.buckets[peak]?.long ?? ""}). The table after the chart has every value.`}
            className="relative mx-3 mb-3 mt-2 h-60 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {/* Plot box: y labels on the left, bars on the right, x labels in the 1.5rem below. */}
            <div aria-hidden className="absolute inset-x-0 bottom-6 top-3">
              {ticks.map((value) => (
                <span key={value} className="absolute left-0 w-10 -translate-y-1/2 pr-2 text-right text-[11px] tabular-nums text-muted-foreground" style={{ top: `${100 - (value / top) * 100}%` }}>
                  {tick(value, money)}
                </span>
              ))}
              <div className="absolute inset-y-0 left-12 right-0">
                {ticks.map((value) => (
                  <span key={value} className={cn("absolute inset-x-0 border-t", value === 0 ? "border-border" : "border-border/60")} style={{ bottom: `${(value / top) * 100}%` }} />
                ))}
                <div className="absolute inset-0 flex items-end gap-[2px] sm:gap-1">
                  {data.buckets.map((b, i) => (
                    <div key={b.from} title={`${b.long}: ${fmt(totals[i])}`} className="flex h-full min-w-0 flex-1 flex-col justify-end rounded-t-[3px] hover:bg-muted/60">
                      {visible
                        .slice()
                        .reverse()
                        .map((s) => {
                          const value = Math.max(0, b.values[s.key] ?? 0);
                          return value ? <span key={s.key} className="block w-full first:rounded-t-[3px]" style={{ height: `${(value / top) * 100}%`, background: s.color }} /> : null;
                        })}
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div aria-hidden className="absolute bottom-0 left-12 right-0 flex h-6 items-end gap-[2px] sm:gap-1">
              {data.buckets.map((b, i) => (
                <span key={b.from} className="min-w-0 flex-1 overflow-visible whitespace-nowrap text-center text-[11px] tabular-nums text-muted-foreground">
                  {i % labelEvery === 0 ? (data.interval === "day" ? b.label : b.label.split("–")[0]) : ""}
                </span>
              ))}
            </div>
          </div>
          <div className="sr-only">{table}</div>
        </>
      )}
    </section>
  );
}
