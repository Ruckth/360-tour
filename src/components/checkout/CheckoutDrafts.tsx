"use client";

import { createContext, useCallback, useContext, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type Dispatch, type ReactNode, type SetStateAction } from "react";
import type { ApprovalRequest, OrderId, OrderLine, OrderView } from "./backend";
import { discountText } from "./discount-input";
import { flushSync } from "react-dom";
import { ConfirmProvider } from "@/components/admin/ConfirmDialog";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

type DiscountNotice = { orderId: OrderId; lineId: OrderLine["_id"]; message: string; discount: string; review?: boolean };

type Drafts = {
  values: Map<string, unknown>;
  validKey: (key: string) => boolean;
  reconcile: (orderId: OrderId, view: OrderView | null, approvals?: ApprovalRequest[]) => void;
  paymentSubmitting: boolean;
  setPaymentSubmitting: Dispatch<SetStateAction<boolean>>;
  listeners: Map<string, Set<() => void>>;
  discountNotice: DiscountNotice | null;
  setDiscountNotice: Dispatch<SetStateAction<DiscountNotice | null>>;
  register: (id: string, dirty: boolean, discard?: () => void) => void;
  confirmDiscard: () => Promise<boolean>;
};
const DraftContext = createContext<Drafts | null>(null);

/** One guard for line drafts, including editors moving between the side panel and phone sheet. */
export function CheckoutDraftProvider({ children }: { children: ReactNode }) {
  return <ConfirmProvider><DraftRegistry>{children}</DraftRegistry></ConfirmProvider>;
}

function DraftRegistry({ children }: { children: ReactNode }) {
  const [values] = useState(() => new Map<string, unknown>());
  const [listeners] = useState(() => new Map<string, Set<() => void>>());
  const [discountNotice, setDiscountNotice] = useState<DiscountNotice | null>(null);
  const [paymentSubmitting, setPaymentSubmitting] = useState(false);
  const lineIds = useRef(new Map<string, Set<string>>());
  const validKey = useCallback((key: string) => {
    const [order, line, field] = key.split(":");
    return !field || !lineIds.current.has(order) || lineIds.current.get(order)!.has(line);
  }, []);
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(() => new Set());
  const resets = useRef(new Map<string, (() => void) | undefined>());
  const register = useCallback((id: string, dirty: boolean, discard?: () => void) => {
    dirty = dirty && validKey(id);
    if (dirty) resets.current.set(id, discard);
    else resets.current.delete(id);
    setDirtyIds((current) => {
      if (current.has(id) === dirty) return current;
      const next = new Set(current);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, [validKey]);
  const reconcile = useCallback((orderId: OrderId, view: OrderView | null, approvals?: ApprovalRequest[]) => {
    const open = view && view.order.state === "unpaid";
    lineIds.current.set(orderId, new Set(open ? view.lines.map(line => line._id) : []));
    for (const key of new Set([...values.keys(), ...resets.current.keys()])) {
      if (!key.startsWith(`${orderId}:`) || (open && validKey(key))) continue;
      values.delete(key);
      register(key, false);
    }
    setDiscountNotice(current => {
      if (current?.orderId !== orderId) return current;
      const line = view?.lines.find(line => line._id === current.lineId);
      const requested = approvals?.some(request => request.kind === "discount" && request.lineId === current.lineId && request.status === "pending");
      return !open || !line || requested || discountText(line.discount) !== current.discount ? null : current;
    });
  }, [values, validKey, register]);
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
  const value = useMemo(() => ({ register, confirmDiscard, values, listeners, discountNotice, setDiscountNotice, validKey, reconcile, paymentSubmitting, setPaymentSubmitting }), [register, confirmDiscard, values, listeners, discountNotice, validKey, reconcile, paymentSubmitting]);
  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useCheckoutDraft(dirty = false, onDiscard?: () => void, draftKey?: string) {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  const { register, confirmDiscard } = drafts;
  const generatedId = useId();
  const id = draftKey ?? generatedId;
  const discard = useRef(onDiscard);
  useLayoutEffect(() => { discard.current = onDiscard; });
  useLayoutEffect(() => {
    register(id, dirty, () => discard.current?.());
    // Keyed line drafts outlive the side panel / sheet that currently edits them.
    return () => { if (!draftKey) register(id, false); };
  }, [register, id, dirty, draftKey]);
  return { confirmDiscard };
}

/** Checkout-local state that survives moving an editor between the side panel and sheet.
 * Keys include the order and line; setters also retain replies arriving after an editor unmounts.
 */
export function useCheckoutDraftState<T>(key: string, initial: T): [T, Dispatch<SetStateAction<T>>] {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  const { values, listeners, validKey } = drafts;
  // A live line update must not silently replace an untouched field's original baseline.
  const [fallback] = useState(() => initial);
  const snapshot = useCallback(() => values.has(key) ? values.get(key) as T : fallback, [values, key, fallback]);
  const subscribe = useCallback((changed: () => void) => {
    const subscribers = listeners.get(key) ?? new Set<() => void>();
    listeners.set(key, subscribers);
    subscribers.add(changed);
    return () => {
      subscribers.delete(changed);
      if (!subscribers.size) listeners.delete(key);
    };
  }, [listeners, key]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const set = useCallback<Dispatch<SetStateAction<T>>>((update) => {
    if (!validKey(key)) return;
    const previous = snapshot();
    const next = typeof update === "function" ? (update as (value: T) => T)(previous) : update;
    if (Object.is(previous, next)) return;
    values.set(key, next);
    listeners.get(key)?.forEach((changed) => changed());
  }, [values, listeners, key, snapshot, validKey]);
  return [value, set];
}

export function useCheckoutDiscountNotice() {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  return { discountNotice: drafts.discountNotice, setDiscountNotice: drafts.setDiscountNotice };
}

/** Reconcile against data, never editor unmounts: rotation must retain live drafts. */
export function useCheckoutDraftOrder(orderId: OrderId | null, view: OrderView | null | undefined, approvals?: ApprovalRequest[]) {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  const { reconcile, discountNotice } = drafts;
  useLayoutEffect(() => {
    if (orderId && view !== undefined) reconcile(orderId, view, approvals);
  }, [orderId, view, reconcile, discountNotice, approvals]);
}

export function useCheckoutPaymentSubmitting() {
  const drafts = useContext(DraftContext);
  if (!drafts) throw new Error("Checkout drafts need CheckoutDraftProvider.");
  return { paymentSubmitting: drafts.paymentSubmitting, setPaymentSubmitting: drafts.setPaymentSubmitting };
}
