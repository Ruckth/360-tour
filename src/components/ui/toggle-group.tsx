"use client";

import * as ToggleGroupPrimitive from "@radix-ui/react-toggle-group";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Single-select segmented control. One option always stays selected. */
export function ToggleGroup<T extends string>({
  className,
  value,
  onValueChange,
  variant = "default",
  tone = "strong",
  ...props
}: Omit<ToggleGroupPrimitive.ToggleGroupSingleProps, "type" | "value" | "onValueChange"> & {
  variant?: "default" | "segmented";
  tone?: "strong" | "subtle";
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
      data-variant={variant}
      data-tone={tone}
      className={cn("group/toggle flex rounded-lg border border-border bg-background p-1", variant === "segmented" && "rounded-full border-0 bg-muted p-0.5", className)}
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
        "inline-flex items-center justify-center gap-1 rounded-md px-3 py-2 text-xs font-semibold pointer-coarse:min-h-11 pointer-coarse:min-w-11 text-muted-foreground transition data-[state=off]:hover:bg-muted data-[state=off]:hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=on]:bg-primary data-[state=on]:text-primary-foreground data-[state=on]:shadow-sm",
        "group-data-[variant=segmented]/toggle:h-9 pointer-coarse:group-data-[variant=segmented]/toggle:h-11 group-data-[variant=segmented]/toggle:flex-1 group-data-[variant=segmented]/toggle:rounded-full group-data-[variant=segmented]/toggle:text-sm group-data-[tone=strong]/toggle:group-data-[variant=segmented]/toggle:data-[state=on]:bg-foreground group-data-[tone=strong]/toggle:group-data-[variant=segmented]/toggle:data-[state=on]:text-background",
        "group-data-[tone=subtle]/toggle:data-[state=on]:bg-background group-data-[tone=subtle]/toggle:data-[state=on]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}
