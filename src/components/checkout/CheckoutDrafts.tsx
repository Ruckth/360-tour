"use client";

import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

type Drafts = {
  register: (id: string, dirty: boolean, discard?: () => void) => void;
  confirmDiscard: () => Promise<boolean>;
};
const DraftContext = createContext<Drafts | null>(null);

/** One guard for all mounted line editors, including the phone sheet's portaled content. */
export function CheckoutDraftProvider({ children }: { children: ReactNode }) {
  return <ConfirmProvider><DraftRegistry>{children}</DraftRegistry></ConfirmProvider>;
}

function DraftRegistry({ children }: { children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const resets = useRef(new Map<string, (() => void) | undefined>());
  const register = useCallback((id: string, dirty: boolean, discard?: () => void) => {
    if (dirty) resets.current.set(id, discard);
    else resets.current.delete(id);
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const { confirmDiscard: askDiscard } = useUnsavedGuard(dirtyIds.size > 0);
  const confirmDiscard = useCallback(async () => {
    // A blur-save may have cleared the registry since the action's render.
    if (!resets.current.size) return true;
    if (!await askDiscard()) return false;
    flushSync(() => {
      for (const reset of resets.current.values()) reset?.();
      resets.current.clear();
      setDirtyIds(new Set());
    });
    return true;
  }, [askDiscard]);
  const value = useMemo(() => ({ register, confirmDiscard }), [register, confirmDiscard]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useCheckoutDraft(dirty = false, onDiscard?: () => void) {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  const { register, confirmDiscard } = drafts;
  const id = useId();
  const discard = useRef(onDiscard);
  useLayoutEffect(() => { discard.current = onDiscard; });
  useLayoutEffect(() => {
    register(id, dirty, () => discard.current?.());
    return () => register(id, false);
  }, [register, id, dirty]);
  return { confirmDiscard };
}
