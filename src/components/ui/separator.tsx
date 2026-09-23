import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Separator = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { decorative?: boolean }
>(function Separator({ className, decorative = true, ...props }, ref) {
  return (
    <div
      ref={ref}
      role={decorative ? "none" : "separator"}
      className={cn("h-px w-full shrink-0 bg-border", className)}
      {...props}
    />
  );
});
