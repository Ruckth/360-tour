"use client";

import { useState, type ReactNode } from "react";
import { useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";

/** Configuration errors are fatal: every product view uses the actual backend. */
export function ConvexClientProvider({
  convexUrl,
  children,
}: {
  convexUrl: string;
  children: ReactNode;
}) {
  const [client] = useState(() => new ConvexReactClient(convexUrl));
  return (
    <ConvexProviderWithClerk client={client} useAuth={useAuth}>
      {children}
    </ConvexProviderWithClerk>
  );
}
