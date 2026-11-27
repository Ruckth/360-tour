"use client";

import { lazy } from "react";
import { PannellumTourCanvas } from "@/components/tour/PannellumTourCanvas";
import { TourViewerContent, type TourViewerProps } from "@/components/tour/TourViewerContent";

const FallbackCanvas = lazy(() => import("@/components/tour/TourCanvas").then(
  ({ TourCanvas }) => ({ default: TourCanvas }),
));

export function TourViewer(props: TourViewerProps) {
  return <TourViewerContent {...props} Canvas={PannellumTourCanvas} FallbackCanvas={FallbackCanvas} />;
}
