"use client";

import { useCallback, useEffect, useRef } from "react";
import { consentGeneration, mayCapture } from "@/lib/marketing/capture";
import { captureGuestPerformance } from "@/lib/marketing/analytics";
import type { TourRenderer } from "@/lib/tour/renderer";

export type TourOpenEntry = "direct" | "tap" | "reopen";
type Pending = { entry: TourOpenEntry; startedAt: number; consent: number };
type Report = (entry: TourOpenEntry, renderer: TourRenderer, durationMs: number, consent: number) => void;
const measuredDocuments = new WeakSet<PerformanceEntry>();
const reportTourOpen: Report = (entry, renderer, durationMs, consent) => {
  void captureGuestPerformance({ metric: "tour_ready", entry, renderer, durationMs }, consent);
};

/** Start at the trusted click or the actual direct navigation and stop when the selected canvas accepts input. */
export function useTourOpenTiming(directOnMount: boolean, report: Report = reportTourOpen) {
  const pending = useRef<Pending | null>(null);
  const completed = useRef(false);

  const start = useCallback((entry: TourOpenEntry, startedAt: number) => {
    const consent = consentGeneration();
    pending.current = mayCapture(consent) ? { entry, startedAt, consent } : null;
  }, []);

  useEffect(() => {
    if (!directOnMount) return;
    const [navigation] = performance.getEntriesByType("navigation");
    if (!navigation?.name || measuredDocuments.has(navigation)) return;
    const original = new URL(navigation.name);
    const location = window.location;
    // A soft link or a history toggle cannot reuse the document's old time origin.
    if (original.pathname === location.pathname && original.searchParams.get("tour") === "1"
        && new URLSearchParams(location.search).get("tour") === "1") {
      measuredDocuments.add(navigation);
      start("direct", navigation.startTime);
    }
  }, [directOnMount, start]);

  const begin = () => start(completed.current ? "reopen" : "tap", performance.now());
  const cancel = useCallback(() => { pending.current = null; }, []);
  const finish = useCallback((renderer: TourRenderer) => {
    const measurement = pending.current;
    pending.current = null;
    completed.current = true;
    if (measurement && mayCapture(measurement.consent)) {
      report(measurement.entry, renderer, performance.now() - measurement.startedAt, measurement.consent);
    }
  }, [report]);

  return { begin, cancel, finish };
}
