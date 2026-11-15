"use client";

import { ConvexClientProvider } from "@/lib/react/convex";
import type { ReactNode } from "react";
import { AnalyticsConsent } from "@/components/global/AnalyticsConsent";
import { MarketingCapture } from "@/components/global/MarketingCapture";

export function Providers({
  children,
  convexUrl,
}: {
  children: ReactNode;
  convexUrl: string;
}) {
  return (
    <ConvexClientProvider convexUrl={convexUrl}>
      {children}
      <AnalyticsConsent />
      <MarketingCapture />
    </ConvexClientProvider>
  );
}
