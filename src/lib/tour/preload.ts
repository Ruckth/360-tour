import { markTourBench } from "@/lib/tour/bench";
import type { TourRenderer } from "@/lib/tour/renderer";

function importTourViewer(renderer: TourRenderer) {
  return renderer === "pannellum"
    ? import("@/components/tour/PannellumTourViewer")
    : import("@/components/tour/TourViewer");
}

export function loadTourViewer(renderer: TourRenderer = "three") {
  markTourBench("viewer_module_start");
  return importTourViewer(renderer).then((mod) => {
    markTourBench("viewer_module_ready");
    return mod.TourViewer;
  });
}

export function preloadTourRenderer(renderer: TourRenderer) {
  // An intent hint can fail quietly; opening the tour handles a failed load.
  void importTourViewer(renderer).catch(() => {});
}

export function preloadTourViewer() {
  preloadTourRenderer("three");
}
