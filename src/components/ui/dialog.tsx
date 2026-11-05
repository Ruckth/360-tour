"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogPortal = DialogPrimitive.Portal;
export const DialogClose = DialogPrimitive.Close;

export function DialogOverlay({
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

export function DialogContent({
  className,
  children,
  showCloseButton = true,
  panel = false,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /**
   * For browsing or longer tasks: a full-height panel on the right from iPad up, over a light
   * scrim, so the page stays readable beside it (a bottom sheet on phones, like every dialog).
   * Short confirmations stay centred.
   */
  panel?: boolean;
}) {
  return (
    <DialogPortal>
      <DialogOverlay className={panel ? "md:bg-black/15 md:backdrop-blur-none" : undefined} />
      <DialogPrimitive.Content
        className={cn(
          // Centred from md up; a bottom sheet on phones. Either way capped to the window and scrolling,
          // so a long form or the on-screen keyboard can't push the actions out of reach.
          "fixed left-1/2 top-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto overscroll-contain rounded-xl border border-border bg-card p-6 text-card-foreground shadow-2xl outline-none transition data-[state=closed]:scale-95 data-[state=closed]:opacity-0 data-[state=open]:scale-100 data-[state=open]:opacity-100",
          "max-md:inset-x-0 max-md:top-auto max-md:bottom-0 max-md:max-h-[calc(100dvh-max(1rem,env(safe-area-inset-top)))] max-md:w-full max-md:max-w-none max-md:translate-x-0 max-md:translate-y-0 max-md:rounded-b-none max-md:rounded-t-2xl max-md:border-x-0 max-md:border-b-0 max-md:pb-[max(1.5rem,env(safe-area-inset-bottom))] max-md:data-[state=closed]:translate-y-8 max-md:data-[state=closed]:scale-100",
          panel && SIDE_PANEL,
          className,
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <DialogPrimitive.Close className="absolute right-2 top-2 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground transition hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring pointer-coarse:size-11">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

const SIDE_PANEL =
  "md:inset-y-0 md:right-0 md:left-auto md:top-0 md:h-dvh md:max-h-dvh md:w-[28rem] md:max-w-[calc(100vw-2rem)] md:translate-x-0 md:translate-y-0 md:content-start md:rounded-none md:rounded-l-2xl md:border-y-0 md:border-r-0 md:pt-[max(1.5rem,env(safe-area-inset-top))] md:pb-[max(1.5rem,env(safe-area-inset-bottom))] md:data-[state=closed]:translate-x-8 md:data-[state=closed]:scale-100";

export function DialogHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col gap-1.5 pe-8 text-left", className)} {...props} />;
}

export function DialogFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return <div className={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", className)} {...props} />;
}

export function DialogTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn("text-lg font-semibold leading-tight text-foreground", className)} {...props} />;
}

export function DialogDescription({
  className,
  ...props
}: ComponentPropsWithoutRef<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description className={cn("text-sm text-muted-foreground", className)} {...props} />;
}
