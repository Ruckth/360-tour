"use client";

import type { ComponentProps } from "react";
import { DialogContent } from "@/components/ui/dialog";
import { SheetContent } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { CHECKOUT_LAYER, CHECKOUT_THEME } from "./checkout-ui";

/*
 * Dialogs and sheets portal outside the checkout screen, so neither the panel nor the overlay
 * rendered beside it inherits the checkout theme. These carry it on both, plus the touch sizes,
 * so a checkout layer can't theme one and forget the other.
 */

export function CheckoutDialogContent({ className, ...props }: Omit<ComponentProps<typeof DialogContent>, "overlayClassName">) {
  return <DialogContent overlayClassName={CHECKOUT_THEME} className={cn(className, CHECKOUT_LAYER)} {...props} />;
}

export function CheckoutSheetContent({ className, ...props }: Omit<ComponentProps<typeof SheetContent>, "overlayClassName">) {
  return <SheetContent overlayClassName={CHECKOUT_THEME} className={cn(className, CHECKOUT_LAYER)} {...props} />;
}
