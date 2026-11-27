import { markTourBench } from "@/lib/tour/bench";
import type { TourRenderer } from "@/lib/tour/renderer";

// With a conditional import expression Vite 8 combines the imports into one
// preload wrapper and can attach Three.js to the Pannellum request.
const importTourViewer = {
  three: () => import("@/components/tour/TourViewer"),
  pannellum: () => import("@/components/tour/PannellumTourViewer"),
};

export function loadTourViewer(renderer: TourRenderer = "three") {
  markTourBench("viewer_module_start");
  return importTourViewer[renderer]().then((mod) => {
    markTourBench("viewer_module_ready");
    return mod.TourViewer;
  });
}

export function preloadTourRenderer(renderer: TourRenderer) {
  // An intent hint can fail quietly; opening the tour handles a failed load.
  void importTourViewer[renderer]().catch(() => {});
}

export function preloadTourViewer() {
  preloadTourRenderer("three");
}
