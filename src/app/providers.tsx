"use client";

import { OptionalConvexProvider } from "@/lib/react/convex";
import type { ReactNode } from "react";
import { AnalyticsConsent } from "@/components/global/AnalyticsConsent";

export function Providers({
  children,
  clerkEnabled = false,
  convexUrl,
}: {
  children: ReactNode;
  clerkEnabled?: boolean;
  convexUrl?: string;
}) {
  return (
    <OptionalConvexProvider convexUrl={convexUrl} clerkEnabled={clerkEnabled}>
      {children}
      <AnalyticsConsent />
    </OptionalConvexProvider>
  );
}
