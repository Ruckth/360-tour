"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CheckoutBackend } from "./backend";

type TimingModule = typeof import("./timing");

const SESSION_KEY = "checkout-timing-on";

/**
 * Whether timing is on in this tab. ?timing=1 turns it on until the tab closes (or ?timing=0), so
 * it survives checkout's own navigation (a new order, its receipt, payment) that drops the query.
 */
export function timingOptIn(param: string | null): boolean {
  if (typeof window === "undefined") return param === "1";
  try {
    if (param === "1") window.sessionStorage.setItem(SESSION_KEY, "1");
    else if (param === "0") window.sessionStorage.removeItem(SESSION_KEY);
    return param === "1" || window.sessionStorage.getItem(SESSION_KEY) === "1";
  } catch {
    // Storage blocked: only the URL turns it on.
    return param === "1";
  }
}

/**
 * The checkout backend, timed when this tab opted in with ?timing=1 (staff pages only), and the
 * readout to show. Off, it costs one URL and one session-storage read: the timing code is a
 * separate chunk loaded only when asked for.
 */
export function useCheckoutTiming(backend: CheckoutBackend): { backend: CheckoutBackend; readout: ReactNode } {
  const param = useSearchParams().get("timing");
  const on = useMemo(() => timingOptIn(param), [param]);
  const [timing, setTiming] = useState<TimingModule | null>(null);
  useEffect(() => {
    if (on && !timing) void import("./timing").then(setTiming);
  }, [on, timing]);
  const active = on ? timing : null;
  const timed = useMemo(() => (active ? active.withTiming(backend) : backend), [active, backend]);
  return { backend: timed, readout: active ? <active.TimingReadout /> : null };
}
