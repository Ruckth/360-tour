"use client";

import { Timer } from "lucide-react";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { CheckoutBackend } from "./backend";

/**
 * ?timing=1 on checkout or a receipt: every checkout write (sale, payment, refund, approval and the
 * commerce writers) is timed on this device, and a small staff-only panel shows each action's p95
 * over its last 100 runs, from a Timing button in the admin header. The desk-iPad rehearsal doubles as the real-iPad speed check (plan v27,
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

/** The admin header's slot for page tools (AdminShell); absent outside the admin shell. */
export const HEADER_TOOLS = "data-admin-header-tools";
const noSubscribe = () => () => {};
const headerSlot = () => document.querySelector<HTMLElement>(`[${HEADER_TOOLS}]`);

/**
 * The staff-only readout: a Timing button in the admin header that opens p95 per action on this
 * device. It never sits over the page: closed it is only the header button, and open it is a
 * non-modal popover, so a tap on the till outside it closes it and still reaches its control.
 */
export function TimingReadout() {
  const current = useSyncExternalStore(subscribe, read, readNone);
  const slot = useSyncExternalStore(noSubscribe, headerSlot, () => null);
  const rows = timingRows(current);
  const readout = (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" className="h-11 shrink-0 px-3" data-testid="checkout-timing" aria-label="Checkout timing">
          <Timer aria-hidden className="size-4" />
          <span className="max-sm:sr-only">Timing</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="grid w-[min(22rem,calc(100vw-1.5rem))] gap-1 p-2 text-xs print:hidden" aria-label="Checkout timing" data-testid="checkout-timing-panel">
        <div className="flex items-center justify-between gap-2">
          <p className="px-2 font-semibold">Timing · p95 on this device</p>
          <Button type="button" variant="ghost" size="sm" className="h-11 px-2" onClick={resetTiming}>Reset</Button>
        </div>
        {rows.length ? (
          <table className="w-full tabular-nums">
            <thead className="text-muted-foreground"><tr><th className="px-2 text-left font-medium">Action</th><th className="px-2 text-right font-medium">p95</th><th className="px-2 text-right font-medium">Runs</th></tr></thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.action}><td className="px-2 py-0.5 [overflow-wrap:anywhere]">{row.action}</td><td className="px-2 text-right">{row.p95} ms</td><td className="px-2 text-right">{row.runs}</td></tr>
              ))}
            </tbody>
          </table>
        ) : <p className="px-2 pb-1 text-muted-foreground">Nothing timed yet. Each checkout action shows here once it runs.</p>}
      </PopoverContent>
    </Popover>
  );
  // Outside the admin shell (a test, a bare page) it sits where it is rendered, in the page's flow.
  return slot ? createPortal(readout, slot) : readout;
}
