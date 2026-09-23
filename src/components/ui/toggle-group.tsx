"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Single-select segmented control. One option always stays selected. */
export function ToggleGroup<T extends string>({
  className,
  value,
  onValueChange,
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type" | "value" | "onValueChange"> & {
  value: T;
  onValueChange: (value: T) => void;
}) {
  return (
    <ToggleGroupPrimitive.Root
      type="single"
      value={value}
      onValueChange={(next) => {
        if (next) onValueChange(next as T);
      }}
      className={cn("flex rounded-lg border border-border bg-background p-1", className)}
      {...props}
    />
  );
}

export function ToggleGroupItem({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof ToggleGroupPrimitive.Item>) {
  return (
    <ToggleGroupPrimitive.Item
      className={cn(
        "inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-semibold text-muted-foreground transition data-[state=off]:hover:bg-muted data-[state=off]:hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 data-[state=on]:bg-navy data-[state=on]:text-white data-[state=on]:shadow-sm",
        className,
      )}
      {...props}
    />
  );
}
