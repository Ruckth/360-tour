"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

export function SheetOverlay({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      className={cn(
        "fixed inset-0 z-50 bg-background/80 backdrop-blur-sm transition-opacity data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
        className,
      )}
      {...props}
    />
  );
}

export function SheetContent({
  side = "right",
  className,
  children,
  showCloseButton = true,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left";
  showCloseButton?: boolean;
}) {
  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        className={cn(
          // Scrolls on its own and keeps clear of notches and the home indicator.
          "fixed z-50 flex flex-col gap-4 overflow-y-auto overscroll-contain border-border bg-card p-6 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))] text-card-foreground shadow-2xl outline-none transition ease-out data-[state=closed]:opacity-0 data-[state=open]:opacity-100",
          side === "right" && "inset-y-0 right-0 h-full w-80 max-w-[calc(100vw-2rem)] border-l data-[state=closed]:translate-x-full data-[state=open]:translate-x-0",
          side === "left" && "inset-y-0 left-0 h-full w-80 max-w-[calc(100vw-2rem)] border-r data-[state=closed]:-translate-x-full data-[state=open]:translate-x-0",
          side === "top" && "inset-x-0 top-0 max-h-[calc(100dvh-2rem)] border-b data-[state=closed]:-translate-y-full data-[state=open]:translate-y-0",
          side === "bottom" && "inset-x-0 bottom-0 max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top)))] rounded-t-2xl border-t data-[state=closed]:translate-y-full data-[state=open]:translate-y-0",
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute right-2 top-[max(0.5rem,env(safe-area-inset-top))] inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </SheetPortal>
  );
}

// SheetContent carries the padding, so header and footer only add spacing.
export function SheetHeader({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pe-10 text-left", className)} {...props} />;
}

export function SheetFooter({ className, ...props }: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("mt-auto flex flex-col gap-2", className)} {...props} />;
}

export function SheetTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-tight text-foreground", className)} {...props} />;
}

export function SheetDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
