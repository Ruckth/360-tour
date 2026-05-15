"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { OptionalConvexProvider } from "@/lib/react/convex";
import type { ReactNode } from "react";

export function Providers({
  children,
  clerkPublishableKey,
  convexUrl,
}: {
  children: ReactNode;
  clerkPublishableKey?: string;
  convexUrl?: string;
}) {
  const clerkEnabled =
    Boolean(clerkPublishableKey) && !clerkPublishableKey?.includes("placeholder");

  const app = (
    <OptionalConvexProvider convexUrl={convexUrl}>
      {children}
    </OptionalConvexProvider>
  );

  if (!clerkEnabled) return app;

  return (
    <ClerkProvider publishableKey={clerkPublishableKey}>
      {app}
    </ClerkProvider>
  );
}
