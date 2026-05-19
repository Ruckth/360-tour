import { forwardRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const Alert = forwardRef<
  HTMLDivElement,
  HTMLAttributes<HTMLDivElement> & { variant?: "default" | "destructive" | "warning" }
>(({ className, variant = "default", ...props }, ref) => (
    <div
      ref={ref}
      role="alert"
      className={cn(
        "relative w-full rounded-lg border px-4 py-3 text-sm",
        variant === "default" && "border-border bg-muted/50 text-foreground",
        variant === "destructive" && "border-destructive/30 bg-destructive/10 text-destructive",
        variant === "warning" && "border-gold/40 bg-gold/10 text-foreground",
        className,
      )}
      {...props}
    />
));
Alert.displayName = "Alert";

export function AlertTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h5 className={cn("mb-1 font-semibold leading-none", className)} {...props} />;
}

export function AlertDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("text-sm leading-relaxed", className)} {...props} />;
}
