"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

export function ExpandableChat({
  open,
  mounted,
  children,
}: {
  open: boolean;
  mounted: boolean;
  children: React.ReactNode;
}) {
  if (!mounted) return null;
  return createPortal(
    <div
      className={cn(
        "fixed inset-0 z-50 bg-background/85 backdrop-blur-sm transition-opacity duration-200 motion-reduce:transition-none md:pointer-events-none md:bg-transparent md:backdrop-blur-0",
        open ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
