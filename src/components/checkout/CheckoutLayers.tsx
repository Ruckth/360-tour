"use client";

import type { ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { escapeClosesInfoTipFirst } from "@/components/ui/info-tip";
import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { TOUCH_TARGETS } from "./checkout-ui";

/*
 * Dialogs and sheets portal outside the checkout screen, so they don't inherit its touch sizes.
 * These carry them, so every checkout layer gets the same 44px targets on touch screens. Colours
 * come from the app theme on <html>, like the rest of admin.
 */

// Escape closes an open ⓘ tip first, then the layer.
const escape = (own?: (event: KeyboardEvent) => void) => (event: KeyboardEvent) => {
  escapeClosesInfoTipFirst(event);
  if (!event.defaultPrevented) own?.(event);
};

export function CheckoutDialogContent({ className, onEscapeKeyDown, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent className={cn(className, TOUCH_TARGETS)} onEscapeKeyDown={escape(onEscapeKeyDown)} {...props} />;
}

export function CheckoutSheetContent({ className, onEscapeKeyDown, onInteractOutside, onFocusOutside, ...props }: ComponentProps<typeof SheetContent>) {
  return (
    <SheetContent
      className={cn(className, TOUCH_TARGETS)}
      onEscapeKeyDown={escape(onEscapeKeyDown)}
      // Using the header's Approvals (button or panel) leaves an open checkout sheet as it is.
      onInteractOutside={(event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (target?.closest("[data-approvals]")) event.preventDefault();
        else onInteractOutside?.(event);
      }}
      // Tabbing out of a non-modal sheet (an approver's phone order) doesn't close it.
      onFocusOutside={(event) => {
        event.preventDefault();
        onFocusOutside?.(event);
      }}
      {...props}
    />
  );
}
