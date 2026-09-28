import { Loader2 } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

/** Loading indicator that screen readers announce. Pass `label` to say what is loading. */
export function Spinner({
  className,
  label = "Loading",
  ...props
}: Omit<ComponentPropsWithoutRef<typeof Loader2>, "role" | "aria-label"> & { label?: string }) {
  return (
    <Loader2
      role="status"
      aria-label={label}
      className={cn("size-4 animate-spin text-muted-foreground", className)}
      {...props}
    />
  );
}
