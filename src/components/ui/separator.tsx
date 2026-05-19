import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Separator({
  className,
  decorative = true,
  ...props
}: HTMLAttributes<HTMLDivElement> & { decorative?: boolean }) {
  return (
    <div
      role={decorative ? "none" : "separator"}
      className={cn("h-px w-full shrink-0 bg-border", className)}
      {...props}
    />
  );
}
