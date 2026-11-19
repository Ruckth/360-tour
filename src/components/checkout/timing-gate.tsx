"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { CheckoutBackend } from "./backend";

type TimingModule = typeof import("./timing");

/**
 * The checkout backend, timed when the URL has ?timing=1 (staff pages only), and the readout to
 * show. Off, it costs one URL read: the timing code is a separate chunk loaded only when asked for.
 */
export function useCheckoutTiming(backend: CheckoutBackend): { backend: CheckoutBackend; readout: ReactNode } {
  const on = useSearchParams().get("timing") === "1";
  const [timing, setTiming] = useState<TimingModule | null>(null);
  useEffect(() => {
    if (on && !timing) void import("./timing").then(setTiming);
  }, [on, timing]);
  const active = on ? timing : null;
  const timed = useMemo(() => (active ? active.withTiming(backend) : backend), [active, backend]);
  return { backend: timed, readout: active ? <active.TimingReadout /> : null };
}
