"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import type { CheckoutBackend } from "./backend";

/**
 * ?timing=1 on checkout or a receipt: every checkout write (sale, payment, refund, approval and the
 * commerce writers) is timed on this device, and a small staff-only panel shows each action's p95
 * over its last 100 runs. The desk-iPad rehearsal doubles as the real-iPad speed check (plan v27,
 * Speed gates). Samples stay on this device (localStorage) across reloads until Reset. Loaded only
 * when asked for; the customer display never loads it.
 */

const KEY = "checkout-timing";
const KEEP = 100;
type Samples = Record<string, number[]>;

function load(): Samples {
  try {
    const parsed: unknown = JSON.parse(window.localStorage.getItem(KEY) ?? "{}");
    return parsed && typeof parsed === "object" ? (parsed as Samples) : {};
  } catch {
    return {};
  }
}
let samples: Samples = typeof window === "undefined" ? {} : load();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());
function save() {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(samples));
  } catch {
    // Storage blocked: the panel still shows this page's runs.
  }
}

export function recordTiming(action: string, ms: number) {
  samples = { ...samples, [action]: [...(samples[action] ?? []), Math.round(ms)].slice(-KEEP) };
  save();
  emit();
}

export function resetTiming() {
  samples = {};
  save();
  emit();
}

/** Nearest-rank 95th percentile, in ms. */
export function p95(values: readonly number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
}

/** Each action's runs and p95, slowest first. */
export function timingRows(from: Samples = samples) {
  return Object.entries(from).map(([action, runs]) => ({ action, runs: runs.length, p95: p95(runs) })).sort((a, b) => b.p95 - a.p95);
}

const timed = new WeakMap<object, object>();
/** The same actions, each timed from call to its answer (or refusal). One wrapper per actions object. */
function timedActions<T extends object>(actions: T, prefix: string): T {
  const known = timed.get(actions);
  if (known) return known as T;
  const wrapped = Object.fromEntries(Object.entries(actions).map(([name, action]) => [name, typeof action !== "function" ? action : (...args: unknown[]) => {
    const started = performance.now();
    const settle = () => recordTiming(`${prefix}${name}`, performance.now() - started);
    const result: unknown = action(...args);
    if (result instanceof Promise) result.then(settle, settle);
    else settle();
    return result;
  }])) as T;
  timed.set(actions, wrapped);
  return wrapped;
}

/** The backend with timed writers. Adds no hooks, so swapping it in keeps every component's hook order. */
export function withTiming(backend: CheckoutBackend): CheckoutBackend {
  const commerce = backend.commerce;
  return {
    ...backend,
    useActions: () => timedActions(backend.useActions(), ""),
    ...(commerce ? { commerce: { ...commerce, useActions: () => timedActions(commerce.useActions(), "commerce.") } } : {}),
  };
}

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const read = () => samples;
const readNone = (): Samples => ({});

/** The staff-only panel: p95 per action on this device. */
export function TimingReadout() {
  const current = useSyncExternalStore(subscribe, read, readNone);
  const [open, setOpen] = useState(true);
  const rows = timingRows(current);
  return (
    <aside aria-label="Checkout timing" data-testid="checkout-timing" className="fixed bottom-3 left-3 z-50 grid max-w-[min(22rem,calc(100vw-1.5rem))] gap-1 rounded-xl border border-border bg-card/95 p-2 text-xs shadow-lg backdrop-blur print:hidden">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" size="sm" className="h-11 px-2 font-semibold" aria-expanded={open} onClick={() => setOpen(!open)}>Timing · p95 on this device</Button>
        {open ? <Button type="button" variant="ghost" size="sm" className="h-11 px-2" onClick={resetTiming}>Reset</Button> : null}
      </div>
      {open ? (
        rows.length ? (
          <table className="w-full tabular-nums">
            <thead className="text-muted-foreground"><tr><th className="px-2 text-left font-medium">Action</th><th className="px-2 text-right font-medium">p95</th><th className="px-2 text-right font-medium">Runs</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.action}><td className="px-2 py-0.5 [overflow-wrap:anywhere]">{row.action}</td><td className="px-2 text-right">{row.p95} ms</td><td className="px-2 text-right">{row.runs}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-2 pb-1 text-muted-foreground">Nothing timed yet. Each checkout action shows here once it runs.</p>
      ) : null}
    </aside>
  );
}
