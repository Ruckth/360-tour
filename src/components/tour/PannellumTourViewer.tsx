"use client";

import { PannellumTourCanvas } from "@/components/tour/PannellumTourCanvas";
import { TourViewerContent, type TourViewerProps } from "@/components/tour/TourViewerContent";

const loadFallbackCanvas = () => import("@/components/tour/TourCanvas").then(({ TourCanvas }) => TourCanvas);

export function TourViewer(props: TourViewerProps) {
  return <TourViewerContent {...props} Canvas={PannellumTourCanvas} loadFallbackCanvas={loadFallbackCanvas} />;
}
