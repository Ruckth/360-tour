import { markTourBench } from "@/lib/tour/bench";

export function loadTourViewer() {
  markTourBench("viewer_module_start");
  return import("@/components/tour/TourViewer").then((mod) => {
    markTourBench("viewer_module_ready");
    return mod.TourViewer;
  });
}

export function preloadTourViewer() {
  void import("@/components/tour/TourViewer");
}
