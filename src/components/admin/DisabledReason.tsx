"use client";

import { useState, type ReactElement } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

/**
 * Says why a control is disabled. Disabled buttons get no pointer or focus events, so the
 * tooltip hangs off a focusable wrapper: hover or focus shows it, and so does a tap, since touch
 * screens have no hover. With no reason, the child renders as-is.
 */
export function DisabledReason({ reason, children }: { reason?: string | null | false; children: ReactElement }) {
  const [open, setOpen] = useState(false);
  if (!reason) return children;
  return (
    <Tooltip open={open} onOpenChange={setOpen}>
      <TooltipTrigger asChild>
        <span
          tabIndex={0}
          // preventDefault keeps Radix from closing the tooltip on the same click.
          onClick={(event) => {
            event.preventDefault();
            setOpen(true);
          }}
          onBlur={() => setOpen(false)}
          className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-64 text-xs">{reason}</TooltipContent>
    </Tooltip>
  );
}
