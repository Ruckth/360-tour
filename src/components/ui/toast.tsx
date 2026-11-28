"use client";

import { Undo2, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

/** A button on the toast, e.g. Undo. The toast closes once it resolves, or shows its error. */
export type ToastAction = { label: string; retryOnError?: boolean; run: () => unknown | Promise<unknown> };

export type ToastState = { id: number; message: string; action?: ToastAction };

/** An open modal sheet or dialog hides the rest of the page, toasts included, from screen readers. */
const toastHidden = () =>
  typeof document !== "undefined" && document.querySelector('[aria-hidden="true"] [data-slot="toast"], [inert] [data-slot="toast"]') !== null;

/**
 * One success message at a time, cleared after `ms`; showing a new one replaces the last. The
 * message waits (up to a second) for a closing sheet or dialog to go, so it is announced once,
 * on the page the person is back on.
 */
export function useToast(ms = 8000) {
  const [current, setCurrent] = useState<ToastState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const frame = useRef<number | undefined>(undefined);
  const seq = useRef(0);

  const dismiss = useCallback(() => {
    ++seq.current;
    clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    setCurrent(null);
    setError("");
    setBusy(false);
  }, []);

  const show = useCallback((message: string, action?: ToastAction) => {
    clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
    const id = ++seq.current;
    const started = Date.now();
    const reveal = () => {
      if (toastHidden() && Date.now() - started < 1000) {
        frame.current = requestAnimationFrame(reveal);
        return;
      }
      frame.current = undefined;
      setError("");
      setBusy(false);
      setCurrent({ id, message, action });
      timer.current = setTimeout(() => setCurrent((now) => (now?.id === id ? null : now)), ms);
    };
    reveal();
  }, [ms]);

  const run = useCallback(async () => {
    const action = current?.action;
    if (!action || current.id !== seq.current) return;
    const id = current.id;
    // Hold the toast while the action runs, and on an error until it is dismissed.
    clearTimeout(timer.current);
    setBusy(true);
    setError("");
    try {
      await action.run();
      if (seq.current === id) setCurrent(null);
    } catch (failure) {
      if (seq.current !== id) return;
      setError(failure instanceof Error && failure.message ? failure.message : `Couldn't ${action.label.toLowerCase()}. Try again.`);
    } finally {
      if (seq.current === id) setBusy(false);
    }
  }, [current]);

  useEffect(() => () => {
    ++seq.current;
    clearTimeout(timer.current);
    if (frame.current !== undefined) cancelAnimationFrame(frame.current);
  }, []);

  return { current, busy, error, show, dismiss, run, message: current?.message ?? "" };
}

/**
 * The admin's success message: a card at the bottom, above the phone tab bar (and above a
 * page's own bottom bar, marked `data-admin-bottom-bar`), bottom right on wider screens. An
 * optional action (Undo) sits after the text; ✕ appears with it. The live region is always
 * mounted so screen readers announce each message. Errors stay inline where they happen.
 */
export function Toast({
  current,
  busy = false,
  error = "",
  run,
  dismiss,
  className,
}: {
  current: ToastState | null;
  busy?: boolean;
  error?: string;
  run?: () => void | Promise<void>;
  dismiss?: () => void;
  className?: string;
}) {
  const action = current?.action;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="toast"
      data-slot="toast"
      className={cn(
        "pointer-events-none fixed inset-x-4 bottom-[calc(var(--admin-tab-bar,0px)+1rem)] z-[60] flex justify-center sm:left-auto sm:right-6 sm:justify-end",
        // While a modal dialog or sheet is open, a page's notice steps aside too: it never covers
        // (or takes the tap meant for) that dialog's buttons, and shows again once it closes. A
        // notice inside the open sheet itself stays. Radix keeps live regions like this one out of
        // its aria-hidden, so the open modal (`data-modal-content`) is what's matched.
        "[[aria-hidden=true]_&]:invisible [[inert]_&]:invisible [body:has([data-modal-content][data-state=open])_&:not([data-modal-content]_*)]:invisible",
        // Clear a page's own bottom bar: the till's order bar below lg, the coupon save bar below sm.
        "max-lg:[body:has([data-admin-bottom-bar=lg])_&]:bottom-[calc(var(--admin-tab-bar,0px)+5.5rem)]",
        "max-sm:[body:has([data-admin-bottom-bar=sm])_&]:bottom-[calc(var(--admin-tab-bar,0px)+5rem)]",
        className,
      )}
    >
      {current ? (
        <div
          key={current.id}
          className="pointer-events-auto flex w-full max-w-md items-center gap-2 rounded-xl border border-border bg-card py-2 pl-4 pr-2 text-sm text-card-foreground shadow-xl sm:w-auto"
        >
          <p className={cn("min-w-0 flex-1 py-1 font-medium [overflow-wrap:anywhere]", error && "text-destructive")}>{error || current.message}</p>
          {action && (!error || action.retryOnError) ? (
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => void run?.()}>
              {busy ? <Spinner label={`${action.label}…`} className="text-current" /> : <Undo2 aria-hidden className="size-4" />}
              {action.label}
            </Button>
          ) : null}
          {action || error ? (
            <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0" aria-label="Close notice" onClick={dismiss}>
              <X aria-hidden className="size-4" />
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
