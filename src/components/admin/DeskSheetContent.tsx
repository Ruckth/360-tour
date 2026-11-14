"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ComponentPropsWithoutRef } from "react";
import { SheetOverlay, SheetPortal } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";

/** Desk sheets keep the calendar visible on iPad without changing the shared sheet primitive. */
export function DeskSheetContent({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: false;
}) {
  const { showCloseButton: _showCloseButton, ...contentProps } = props;
  void _showCloseButton;
  return (
    <SheetPortal>
      <SheetOverlay className="sm:bg-black/20 sm:backdrop-blur-none" />
      <DialogPrimitive.Content
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex h-full flex-col gap-4 overflow-y-auto overscroll-contain border-l border-border bg-card p-5 pt-[max(1.25rem,env(safe-area-inset-top))] pb-[max(1.25rem,env(safe-area-inset-bottom))] text-card-foreground shadow-2xl outline-none",
          className,
        )}
        {...contentProps}
      />
    </SheetPortal>
  );
}
