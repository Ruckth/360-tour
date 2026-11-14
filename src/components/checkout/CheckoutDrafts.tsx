"use client";

import { createContext, useCallback, useContext, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

type Drafts = {
  register: (id: string, dirty: boolean) => void;
  confirmDiscard: () => Promise<boolean>;
};
const DraftContext = createContext<Drafts | null>(null);

/** One guard for all mounted line editors, including the phone sheet's portaled content. */
export function CheckoutDraftProvider({ children }: { children: ReactNode }) {
  return <ConfirmProvider><DraftRegistry>{children}</DraftRegistry></ConfirmProvider>;
}

function DraftRegistry({ children }: { children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const register = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);
  const { confirmDiscard } = useUnsavedGuard(dirtyIds.size > 0);
  const value = useMemo(() => ({ register, confirmDiscard }), [register, confirmDiscard]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useCheckoutDraft(dirty = false) {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  const { register, confirmDiscard } = drafts;
  const id = useId();
  useEffect(() => {
    register(id, dirty);
    return () => register(id, false);
  }, [register, id, dirty]);
  return { confirmDiscard };
}
