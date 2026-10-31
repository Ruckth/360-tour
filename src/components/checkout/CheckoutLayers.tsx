"use client";

import type { ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { TOUCH_TARGETS } from "./checkout-ui";

/*
 * Dialogs and sheets portal outside the checkout screen, so they don't inherit its touch sizes.
 * These carry them, so every checkout layer gets the same 44px targets on touch screens. Colours
 * come from the app theme on <html>, like the rest of admin.
 */

export function CheckoutDialogContent({ className, ...props }: ComponentProps<typeof DialogContent>) {
  return <DialogContent className={cn(className, TOUCH_TARGETS)} {...props} />;
}

export function CheckoutSheetContent({ className, ...props }: ComponentProps<typeof SheetContent>) {
  return <SheetContent className={cn(className, TOUCH_TARGETS)} {...props} />;
}
