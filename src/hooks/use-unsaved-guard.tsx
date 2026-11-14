"use client";

import { useCallback, useEffect } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";

/** Closing a draft is a separate decision from saving it; revision checks stay with the save. */
export function useUnsavedGuard(dirty: boolean) {
  const confirm = useConfirm();
  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [dirty]);
  const confirmDiscard = useCallback(
    (): Promise<boolean> =>
      dirty
        ? confirm({
            title: "Discard unsaved changes?",
            confirmLabel: "Discard",
            cancelLabel: "Keep editing",
            destructive: true,
          })
        : Promise.resolve(true),
    [dirty, confirm],
  );
  return { confirmDiscard };
}
