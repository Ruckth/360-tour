"use client";

import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { SelectCheckbox } from "@/components/admin/admin-bulk";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { Button, ButtonLink } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { balanceStatusBadges } from "./stock-format";

export type BalanceRow = FunctionReturnType<typeof api.commerce.stock.listBalances>["page"][number];

function lotViewHref(variantId: Id<"productVariants">) {
  return `/admin/stock/expansion?variantId=${encodeURIComponent(variantId)}`;
}

export function StockBalanceRow({
  row,
  checked,
  mobileSelectMode,
  encodedReturnTo,
  access,
  onToggleSelect,
  onOpenOpening,
  onOpenCount,
  onOpenAdjust,
  onOpenBin,
  onPurchasingAction,
  onNavigate,
}: {
  row: BalanceRow;
  checked: boolean;
  mobileSelectMode: boolean;
  encodedReturnTo: string;
  access: { receiver: boolean; lead: boolean; requester: boolean; directOrder: boolean };
  onToggleSelect: () => void;
  onOpenOpening: () => void;
  onOpenCount: () => void;
  onOpenAdjust: () => void;
  onOpenBin: () => void;
  onPurchasingAction: (action: "receive" | "request" | "order") => void;
  onNavigate: (href: string) => void;
}) {
  const statusBadges = balanceStatusBadges(row);
  const showCheckbox = mobileSelectMode || checked;
  const showOpenLotsPrimary = row.hasBalance && row.lotTracked && (access.receiver || access.lead);

  return (
    <tr
      className={cn(
        "group grid gap-x-3 gap-y-1.5 border-b border-border px-3.5 py-2.5 last:border-b-0 @2xl/balances:table-row @2xl/balances:p-0",
        showCheckbox ? "grid-cols-[auto_minmax(0,1fr)_auto]" : "grid-cols-[minmax(0,1fr)_auto]",
        checked && "bg-muted/40",
      )}
    >
      <td
        className={cn(
          "@2xl/balances:table-cell @2xl/balances:w-10 @2xl/balances:px-2 @2xl/balances:py-1.5 @2xl/balances:align-middle",
          showCheckbox ? "col-start-1 row-start-1 flex items-start" : "hidden @2xl/balances:table-cell",
        )}
      >
        <SelectCheckbox
          checked={checked}
          onChange={onToggleSelect}
          label={`Select ${row.productName} ${row.label}`}
          className="@2xl/balances:size-8 pointer-coarse:size-11"
        />
      </td>
      <td
        className={cn(
          "min-w-0 @2xl/balances:table-cell @2xl/balances:px-3 @2xl/balances:py-2 @2xl/balances:align-middle",
          showCheckbox ? "col-start-2 row-start-1" : "col-start-1 row-start-1",
        )}
      >
        <span className="block break-words font-medium leading-tight text-foreground">
          {row.productName}
        </span>
        <span className="mt-0.5 block wrap-anywhere text-xs leading-tight text-muted-foreground">
          {row.label}
          {row.sku ? <span className="font-mono"> · {row.sku}</span> : null}
        </span>
      </td>
      <td
        className={cn(
          "self-start text-right font-mono tabular-nums @2xl/balances:table-cell @2xl/balances:px-3 @2xl/balances:py-2 @2xl/balances:align-middle",
          showCheckbox ? "col-start-3 row-start-1" : "col-start-2 row-start-1",
          row.onHand < 0
            ? "text-destructive"
            : row.onHand === 0
              ? "text-muted-foreground"
              : "text-foreground",
        )}
      >
        <span className="text-lg font-bold leading-tight @2xl/balances:text-sm @2xl/balances:font-semibold">
          {row.onHand.toLocaleString("en-US")}
        </span>
        <span className="block font-sans text-[11px] font-normal leading-tight text-muted-foreground @2xl/balances:hidden">
          on hand
        </span>
      </td>
      <td
        className={cn(
          "font-mono text-xs tabular-nums @2xl/balances:table-cell @2xl/balances:px-3 @2xl/balances:py-2 @2xl/balances:text-right @2xl/balances:align-middle",
          row.onOrder > 0
            ? cn("row-start-2", showCheckbox ? "col-start-2" : "col-start-1")
            : "hidden @2xl/balances:table-cell",
        )}
      >
        {row.onOrder > 0 ? (
          <Link
            href={`/admin/stock/purchasing?tab=orders&variantId=${row.variantId}&returnTo=${encodedReturnTo}`}
            aria-label={`${row.onOrder.toLocaleString("en-US")} ${row.onOrder === 1 ? "unit" : "units"} on open orders`}
            className="inline-flex min-h-11 items-center text-xs font-medium text-foreground underline decoration-border underline-offset-4 hover:decoration-current"
          >
            +{row.onOrder.toLocaleString("en-US")} incoming
          </Link>
        ) : (
          <span className="text-muted-foreground" aria-label="No units on open orders">—</span>
        )}
      </td>
      <td
        className={cn(
          "@2xl/balances:table-cell @2xl/balances:px-3 @2xl/balances:py-2 @2xl/balances:align-middle",
          statusBadges.length > 0 || row.lotTracked
            ? row.onOrder > 0
              ? "col-span-full"
              : showCheckbox
                ? "col-start-2 col-span-2 row-start-2"
                : "col-span-full row-start-2"
            : "hidden @2xl/balances:table-cell",
        )}
      >
        {statusBadges.length > 0 || row.lotTracked ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {statusBadges.map((badge) => (
              <StatusBadge key={badge.label} tone={badge.tone} label={badge.label} />
            ))}
            {row.lotTracked ? <StatusBadge tone="info" label="Lot-tracked" /> : null}
          </div>
        ) : (
          <span className="sr-only">In stock</span>
        )}
      </td>
      <td className="col-span-full pt-1 @2xl/balances:table-cell @2xl/balances:px-3 @2xl/balances:py-1.5 @2xl/balances:text-right @2xl/balances:align-middle">
        <div className="flex flex-wrap items-center gap-1.5 @2xl/balances:flex-nowrap @2xl/balances:justify-end">
          {!row.hasBalance ? (
            access.receiver ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="min-h-11 @2xl/balances:min-h-0 @2xl/balances:h-8 @2xl/balances:px-2.5 @2xl/balances:text-xs pointer-coarse:min-h-11"
                onClick={onOpenOpening}
              >
                Record opening stock
              </Button>
            ) : null
          ) : showOpenLotsPrimary ? (
            <ButtonLink
              href={lotViewHref(row.variantId)}
              variant="outline"
              size="sm"
              className="min-h-11 @2xl/balances:min-h-0 @2xl/balances:h-8 @2xl/balances:px-2.5 @2xl/balances:text-xs pointer-coarse:min-h-11"
            >
              Open lots
            </ButtonLink>
          ) : (
            <>
              {access.receiver ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 border border-border @2xl/balances:min-h-0 @2xl/balances:h-8 @2xl/balances:border-transparent @2xl/balances:px-2.5 @2xl/balances:text-xs pointer-fine:@2xl/balances:opacity-0 @2xl/balances:transition-opacity @2xl/balances:group-hover:opacity-100 @2xl/balances:group-focus-within:opacity-100 @2xl/balances:focus-visible:opacity-100 pointer-coarse:min-h-11 pointer-coarse:opacity-100"
                  onClick={onOpenCount}
                >
                  Count
                </Button>
              ) : null}
              {access.lead ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="min-h-11 border border-border @2xl/balances:min-h-0 @2xl/balances:h-8 @2xl/balances:border-transparent @2xl/balances:px-2.5 @2xl/balances:text-xs pointer-fine:@2xl/balances:opacity-0 @2xl/balances:transition-opacity @2xl/balances:group-hover:opacity-100 @2xl/balances:group-focus-within:opacity-100 @2xl/balances:focus-visible:opacity-100 pointer-coarse:min-h-11 pointer-coarse:opacity-100"
                  onClick={onOpenAdjust}
                >
                  Adjust
                </Button>
              ) : null}
            </>
          )}
          <MoreMenu
            label={`More actions for ${row.productName} ${row.label}`}
            className="@2xl/balances:size-8 pointer-coarse:size-11"
            items={[
              {
                label: "View bin custody",
                onSelect: onOpenBin,
              },
              {
                label: "Count",
                hidden: row.hasBalance || !access.receiver || row.lotTracked,
                onSelect: onOpenCount,
              },
              {
                label: "Adjust",
                hidden: row.hasBalance || !access.lead || row.lotTracked,
                onSelect: onOpenAdjust,
              },
              {
                label: "Open lots",
                hidden: !row.lotTracked || showOpenLotsPrimary,
                onSelect: () => onNavigate(lotViewHref(row.variantId)),
              },
              {
                label: "Receive delivery",
                hidden: !access.receiver,
                onSelect: () => onPurchasingAction("receive"),
              },
              {
                label: "Request stock",
                hidden: !access.requester,
                onSelect: () => onPurchasingAction("request"),
              },
              {
                label: "Create order",
                hidden: !access.directOrder,
                onSelect: () => onPurchasingAction("order"),
              },
              {
                label: "View open orders",
                onSelect: () =>
                  onNavigate(`/admin/stock/purchasing?tab=orders&variantId=${row.variantId}&returnTo=${encodedReturnTo}`),
              },
              {
                label: "View Activity",
                onSelect: () =>
                  onNavigate(`/admin/stock/activity?variantId=${row.variantId}&returnTo=${encodedReturnTo}`),
              },
            ]}
          />
        </div>
      </td>
    </tr>
  );
}
