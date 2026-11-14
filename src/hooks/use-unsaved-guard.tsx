"use client";

import { useCallback, useEffect, useRef } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { isInAppNavigation } from "@/lib/react/use-unsaved-changes";

/** Guard explicit close/tab routes with confirmDiscard; same-tab links and page unloads are automatic. */
export function useUnsavedGuard(dirty: boolean) {
  const confirm = useConfirm();
  const pending = useRef<Promise<boolean> | null>(null);
  const confirmDiscard = useCallback((): Promise<boolean> => {
    if (!dirty) return Promise.resolve(true);
    if (!pending.current) {
      pending.current = confirm({
        title: "Discard unsaved changes?",
        description: "Your changes haven’t been saved.",
        cancelLabel: "Keep editing",
        confirmLabel: "Discard",
        destructive: true,
      }).finally(() => {
        pending.current = null;
      });
    }
    return pending.current;
  }, [confirm, dirty]);

  useEffect(() => {
    if (!dirty) return;
    let replaying = false;
    let live = true;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const click = (event: MouseEvent) => {
      if (replaying) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]");
      if (
        !(anchor instanceof HTMLAnchorElement) ||
        !isInAppNavigation(event, anchor, window.location)
      )
        return;
      event.preventDefault();
      event.stopPropagation();
      void confirmDiscard().then((discard) => {
        if (!discard || !live || !anchor.isConnected) return;
        replaying = true;
        try {
          anchor.click();
        } finally {
          replaying = false;
        }
      });
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => {
      live = false;
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", click, true);
    };
  }, [dirty, confirmDiscard]);

  return { confirmDiscard };
}
