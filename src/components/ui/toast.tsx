"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** One short message at a time, cleared after `ms`. Showing a new one replaces the last. */
export function useToast(ms = 8000) {
  const [message, setMessage] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const show = useCallback((text: string) => {
    clearTimeout(timer.current);
    setMessage(text);
    timer.current = setTimeout(() => setMessage(""), ms);
  }, [ms]);
  useEffect(() => () => clearTimeout(timer.current), []);
  return { message, show };
}

/**
 * A result line under the admin header, top right. The live region is always mounted so screen
 * readers announce each message.
 */
export function Toast({ message, className }: { message: string; className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      className={cn(
        "pointer-events-none fixed inset-x-4 top-[calc(var(--admin-header,4rem)+0.5rem)] z-[60] flex justify-end sm:left-auto sm:right-6",
        className,
      )}
    >
      {message ? (
        <p className="pointer-events-auto max-w-sm rounded-xl border border-border bg-card px-4 py-3 text-sm font-medium text-card-foreground shadow-xl [overflow-wrap:anywhere]">{message}</p>
      ) : null}
    </div>
  );
}
