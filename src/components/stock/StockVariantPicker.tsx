"use client";

import { usePaginatedQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Check, Plus } from "lucide-react";
import { useState } from "react";
import { EmptyState, SearchBox, SkeletonRows, useDebounced } from "@/components/admin/admin-bulk";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { STOCK_MAX_LINES, STOCK_PAGE_SIZE } from "./stock-format";

export type BalancePickerRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];

/**
 * Searchable catalog variant picker backed by `commerce/stock:listBalances`.
 * Finds active variants that have no branch balance yet.
 */
export function StockVariantPickerDialog({
  open,
  onOpenChange,
  branchId,
  selectedIds = [],
  includeReorderPoint = false,
  maxLines = STOCK_MAX_LINES,
  title = "Select stock item",
  description = "Search the catalog by product name or SKU.",
  onSelect,
  onSelectMany,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branchId: Id<"branches">;
  maxLines?: number;
  selectedIds?: readonly string[];
  includeReorderPoint?: boolean;
  title?: string;
  description?: string;
} & (
  | { onSelect: (item: BalancePickerRow) => void; onSelectMany?: never }
  | { onSelect?: never; onSelectMany: (items: BalancePickerRow[]) => void }
)) {
  const [search, setSearch] = useState("");
  const [picks, setPicks] = useState<BalancePickerRow[]>([]);
  if (!open && picks.length) setPicks([]);

  function close() {
    setPicks([]);
    onOpenChange(false);
  }
  const debounced = useDebounced(search.trim(), 200);
  const selectedSet = new Set(selectedIds);
  const availableSlots = maxLines - selectedSet.size;
  const pending = picks.filter((item) => !selectedSet.has(item.variantId)).slice(0, Math.max(0, availableSlots));
  const pendingIds = new Set(pending.map((item) => item.variantId));
  const atCap = pending.length >= availableSlots;

  const { results, status, loadMore } = usePaginatedQuery(
    api.commerce.stock.listBalances,
    open ? { branchId, ...(debounced ? { search: debounced } : {}), ...(includeReorderPoint ? { includeReorderPoint } : {}) } : "skip",
    { initialNumItems: STOCK_PAGE_SIZE },
  );

  return (
    <Dialog open={open} onOpenChange={(next) => next ? onOpenChange(next) : close()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-3">
          <SearchBox
            value={search}
            onChange={setSearch}
            label="Search items by name or SKU"
            placeholder="Search product name or SKU…"
          />

          <div className="max-h-80 overflow-y-auto rounded-lg border border-border">
            {status === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading catalog items" rows={4} />
            ) : results.length === 0 ? (
              <EmptyState>
                {debounced ? `No active items match “${debounced}”.` : "No active stock items found."}
              </EmptyState>
            ) : (
              <ul className="divide-y divide-border">
                {results.map((item) => {
                  const alreadySelected = selectedSet.has(item.variantId);
                  const picked = pendingIds.has(item.variantId);
                  return (
                    <li key={item.variantId}>
                      <button
                        type="button"
                        disabled={alreadySelected || Boolean(onSelectMany && atCap && !picked)}
                        aria-pressed={onSelectMany ? alreadySelected || picked : undefined}
                        onClick={() => {
                          if (onSelect) {
                            onSelect(item);
                            close();
                          } else {
                            setPicks(picked ? pending.filter((row) => row.variantId !== item.variantId) : [...pending, item]);
                          }
                        }}
                        className="flex min-h-12 w-full items-center justify-between gap-3 px-3.5 py-2.5 text-left text-sm transition hover:bg-muted focus-visible:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring aria-pressed:bg-muted disabled:cursor-not-allowed disabled:opacity-55"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium text-foreground">
                            {item.productName}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {item.label}
                            {item.sku ? ` · SKU ${item.sku}` : ""}
                          </span>
                        </span>
                        <span className="shrink-0 text-right text-xs tabular-nums text-muted-foreground">
                          <span className="block font-medium text-foreground">
                            {item.onHand.toLocaleString("en-US")} on hand
                          </span>
                          {item.onOrder > 0 ? (
                            <span className="block">{item.onOrder.toLocaleString("en-US")} on order</span>
                          ) : null}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {alreadySelected || picked ? (
                            <Check aria-hidden className="size-4 text-emerald-600" />
                          ) : (
                            <Plus aria-hidden className="size-4" />
                          )}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          {status === "CanLoadMore" ? (
            <Button type="button" variant="outline" size="sm" onClick={() => loadMore(STOCK_PAGE_SIZE)}>
              Load more items
            </Button>
          ) : null}
          {onSelectMany ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">
                {pending.length} selected · {Math.max(0, availableSlots)} item slots
              </p>
              <Button
                type="button"
                disabled={!pending.length}
                onClick={() => {
                  onSelectMany(pending);
                  close();
                }}
              >
                {pending.length === 1 ? "Add 1 item" : `Add ${pending.length} items`}
              </Button>
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
