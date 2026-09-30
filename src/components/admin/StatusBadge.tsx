import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";
import { TONES, type Tone } from "./status-tones";

/**
 * Status pill: tinted background, dot and a text label, so status never relies on colour alone.
 * Use with `statusMeta`: `<StatusBadge {...statusMeta("payment", booking.paymentStatus)} />`.
 */
export function StatusBadge({
  tone,
  label,
  className,
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone: Tone; label: string }) {
  const classes = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium",
        classes.bg,
        classes.text,
        classes.border,
        className,
      )}
      {...props}
    >
      <span aria-hidden className={cn("size-1.5 shrink-0 rounded-full", classes.dot)} />
      {label}
    </span>
  );
}
