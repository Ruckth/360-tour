"use client";

import { TourCanvas } from "@/components/tour/TourCanvas";
import { TourViewerContent, type TourViewerProps } from "@/components/tour/TourViewerContent";

export function TourViewer(props: TourViewerProps) {
  return <TourViewerContent {...props} Canvas={TourCanvas} />;
}
