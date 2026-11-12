"use client";

import * as TooltipPrimitive from "@radix-ui/react-tooltip";
// The one icon import: swap for ReUI's information-circle once its registry key is set up.
import { Info as InfoIcon } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { TooltipContent } from "./tooltip";

/**
 * A small ⓘ button that explains the label beside it. Hover or focus shows the text; a tap or
 * Enter/Space toggles it, so it works on touch screens; Escape or a tap elsewhere closes it. The
 * tooltip flips and shifts to stay inside the viewport. `label` names the button for screen
 * readers ("About the discount limit"); the text is also its accessible description.
 */
export function InfoTip({
  children,
  label = "More info",
  side = "top",
  className,
}: {
  children: ReactNode;
  label?: string;
  side?: "top" | "right" | "bottom" | "left";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  // When hover or focus opened it just before the tap, the tap keeps it open rather than closing it.
  const openedAt = useRef(0);
  // Inside a dialog the tooltip portals into it, so the dialog's modal layer doesn't hide it.
  const [container, setContainer] = useState<HTMLElement | undefined>();
  const change = (next: boolean) => {
    if (next) {
      openedAt.current = Date.now();
      setContainer(trigger.current?.closest<HTMLElement>('[role="dialog"], [role="alertdialog"]') ?? undefined);
    }
    setOpen(next);
  };
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root open={open} onOpenChange={change}>
        <TooltipPrimitive.Trigger asChild>
          <button
            ref={trigger}
            type="button"
            aria-label={label}
            data-info-tip=""
            // Radix closes a tooltip on press; a tap here toggles it instead.
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => {
              event.preventDefault();
              change(!open || Date.now() - openedAt.current < 400);
            }}
            className={cn(
              "relative inline-grid size-5 shrink-0 place-items-center rounded-full align-middle text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              // A 44px touch target without moving the layout.
              "after:absolute after:-inset-3 after:content-['']",
              className,
            )}
          >
            <InfoIcon aria-hidden className="size-4" />
          </button>
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal container={container}>
          <TooltipContent
            side={side}
            collisionPadding={8}
            onPointerDownOutside={(event) => {
              // The trigger's own tap toggles; don't let it count as "outside" first.
              if (trigger.current?.contains(event.target as Node)) event.preventDefault();
            }}
            className="z-[60] max-w-[min(18rem,calc(100vw-1rem))] text-xs leading-5 font-normal text-balance whitespace-normal"
          >
            {children}
          </TooltipContent>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  );
}

/**
 * For a dialog holding InfoTips: Escape closes an open tip first, not the dialog under it. Pass to
 * the dialog's `onEscapeKeyDown`.
 */
export function escapeClosesInfoTipFirst(event: KeyboardEvent) {
  if (document.querySelector('[data-info-tip][data-state$="open"]')) event.preventDefault();
}
