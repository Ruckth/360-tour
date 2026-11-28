"use client";

import { useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { RefreshCw } from "lucide-react";
import { useCallback, useMemo } from "react";
import { Callout } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";

export type ResolvedBalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];

const NO_BALANCES: readonly ResolvedBalanceRow[] = [];

/**
 * Wires the existing admin dirty guard (`useUnsavedGuard`) into a Stock sheet so Escape,
 * overlay clicks, Cancel, in-app links, beforeunload, and branch switching all confirm
 * before abandoning unsaved inputs.
 */
export function useStockDirtyGuard(dirty: boolean, onClose: () => void, saving = false) {
  const { confirmDiscard } = useUnsavedGuard(dirty);

  const requestClose = useCallback(() => {
    if (saving) return;
    if (!dirty) {
      onClose();
      return;
    }
    void confirmDiscard().then((discard) => {
      if (discard) onClose();
    });
  }, [confirmDiscard, dirty, onClose, saving]);

  return { requestClose, confirmDiscard };
}

/**
 * Shown when a pinned stock balance or purchasing document revision changed live while
 * the user had a form open. Preserves all typed inputs and requires an explicit review action.
 */
export function StockStaleBanner({
  title,
  description,
  actionLabel = "Review updated values",
  onReview,
  secondaryActionLabel,
  onSecondaryAction,
}: {
  title: string;
  description: string;
  actionLabel?: string;
  onReview: () => void;
  secondaryActionLabel?: string;
  onSecondaryAction?: () => void;
}) {
  return (
    <Callout
      tone="warning"
      role="alert"
      title={title}
      action={
        <div className="flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" onClick={onReview}>
            <RefreshCw aria-hidden className="size-3.5" />
            {actionLabel}
          </Button>
          {secondaryActionLabel && onSecondaryAction ? (
            <Button type="button" size="sm" variant="ghost" onClick={onSecondaryAction}>
              {secondaryActionLabel}
            </Button>
          ) : null}
        </div>
      }
    >
      {description}
    </Callout>
  );
}

/** Resolve an authorized URL prefill directly by item ID. */
export function useResolvedStockVariants(
  branchId: Id<"branches"> | null,
  variantIds: readonly Id<"productVariants">[],
  options: {
    enabled?: boolean;
    knownRows?: readonly ResolvedBalanceRow[];
    includeRecountFallback?: boolean;
    includeReorderPoint?: boolean;
  } = {},
) {
  const { enabled = true, knownRows = NO_BALANCES, includeRecountFallback = false, includeReorderPoint = false } = options;
  const known = useMemo(() => new Map(knownRows.map(row => [row.variantId, row])), [knownRows]);
  const lookup = useMemo(() => variantIds.filter(id => !known.has(id)), [known, variantIds]);
  const active = enabled && branchId !== null && variantIds.length > 0;
  const fetched = useQuery(api.commerce.stock.selectedBalances, active && lookup.length && branchId
    ? { branchId, variantIds: lookup, includeRecount: includeRecountFallback, ...(includeReorderPoint ? { includeReorderPoint } : {}) }
    : "skip");
  return useMemo(() => {
    if (!active) return { items: [], missingIds: [], loading: false };
    const byId = new Map(known);
    for (const row of fetched ?? []) byId.set(row.variantId, row);
    const items: ResolvedBalanceRow[] = [];
    const missingIds: Id<"productVariants">[] = [];
    for (const id of variantIds) {
      const row = byId.get(id);
      if (row) items.push(row);
      else missingIds.push(id);
    }
    return { items, missingIds, loading: lookup.length > 0 && fetched === undefined };
  }, [active, fetched, lookup.length, known, variantIds]);
}
