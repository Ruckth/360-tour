"use client";

import { useEffect, useRef, type HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

/** Shared opaque action surface above the admin navigation and device safe area. */
export function StickyActionBar({
  position = "sticky",
  className,
  ...props
}: HTMLAttributes<HTMLDivElement> & { position?: "sticky" | "fixed" }) {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const active = document.activeElement;
    if (!bar || !(active instanceof HTMLElement) || bar.contains(active) || !active.matches("input, textarea, select, button, [role=combobox], [contenteditable=true]")) return;
    const field = active.getBoundingClientRect();
    const action = bar.getBoundingClientRect();
    // A newly dirty form must keep the field being edited above its new action bar.
    if (field.bottom > action.top && field.top < action.bottom)
      active.scrollIntoView({ block: "center", behavior: "instant" });
  }, []);

  return (
    <div
      ref={barRef}
      className={cn(
        "bottom-[var(--admin-tab-bar,0px)] z-20 flex flex-wrap items-center gap-3 border-t border-border bg-card px-4 pt-3 pb-[max(env(safe-area-inset-bottom),0.75rem)] sm:rounded-xl sm:border sm:shadow-sm",
        position === "fixed" ? "fixed inset-x-0" : "sticky -mx-4 sm:mx-0",
        className,
      )}
      {...props}
    />
  );
}
