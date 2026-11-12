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

export function CheckoutSheetContent({ className, onEscapeKeyDown, ...props }: ComponentProps<typeof SheetContent>) {
  return <SheetContent className={cn(className, TOUCH_TARGETS)} onEscapeKeyDown={escape(onEscapeKeyDown)} {...props} />;
}
