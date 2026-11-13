"use client";

import { ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

type DisclosureProps = {
  /** "More" for extra fields or options, "History" for a record's history. */
  label: ReactNode;
  /** What is inside, after the label: "More · dates, minimums". */
  hint?: ReactNode;
  children: ReactNode;
  /** Open on first render (uncontrolled), or the open state when `onOpenChange` is given. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * "first-open": mount the content the first time it opens and keep it (history lists, whose
   * subscriptions should start only on demand). "while-open": mount it only while open.
   */
  lazy?: false | "first-open" | "while-open";
  className?: string;
  contentClassName?: string;
  summaryId?: string;
  "aria-label"?: string;
  "data-testid"?: string;
};

/**
 * The admin's one fold-out: native <details>/<summary> (keyboard and screen-reader support come
 * from the browser), a chevron that turns when open, the label and an optional hint after it.
 * Content sits in one wrapper directly inside <details>, so the browser hides it while closed.
 */
export function Disclosure({
  label,
  hint,
  children,
  open,
  onOpenChange,
  lazy = false,
  className,
  contentClassName,
  summaryId,
  "aria-label": ariaLabel,
  "data-testid": testId,
}: DisclosureProps) {
  const [shown, setShown] = useState(Boolean(open));
  const [opened, setOpened] = useState(Boolean(open));
  const mounted = lazy === "while-open" ? shown : lazy === "first-open" ? opened : true;
  return (
    <details
      data-slot="disclosure"
      data-testid={testId}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabel ? undefined : summaryId}
      open={open || undefined}
      className={cn("w-full text-sm", className)}
      onToggle={(event) => {
        const next = event.currentTarget.open;
        setShown(next);
        if (next) setOpened(true);
        if (next !== Boolean(open)) onOpenChange?.(next);
      }}
    >
      <summary
        id={summaryId}
        className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-sm py-2 font-medium text-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden"
      >
        {/* Turns with its own <details> only, so a closed fold-out inside an open one stays closed-looking. */}
        <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform motion-reduce:transition-none [details[open]>summary>&]:rotate-90" />
        <span className="min-w-0 break-words">
          {label}
          {hint ? <span className="font-normal text-muted-foreground"> · {hint}</span> : null}
        </span>
      </summary>
      {mounted ? <div className={cn("pb-3", contentClassName)}>{children}</div> : null}
    </details>
  );
}
