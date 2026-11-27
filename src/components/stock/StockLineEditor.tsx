"use client";

import { Plus, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { FieldError, NumberField } from "@/components/admin/marketing/MarketingBits";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { formatSatang, STOCK_MAX_LINES } from "./stock-format";
import type { StockLineDraft } from "./stock-types";

export type StockLineFieldErrors = Record<
  string,
  { quantity?: string; unitCost?: string; lotCode?: string; lotExpiry?: string; general?: string }
>;

/**
 * Shared multi-line item + quantity (+ optional unit cost) table/card editor
 * reused across Purchase Requests, Purchase Orders, and Direct Receiving.
 * Preserves typed values on errors and caps lines at 50 per document.
 */
export function StockLineEditor({
  lines,
  onChange,
  showUnitCost = false,
  quantityLabel = "Quantity",
  unitCostLabel = "Unit cost (THB)",
  lineErrors = {},
  disabled = false,
  onAddClick,
  addLabel = "Add item",
  headerSlot,
  allowRemove = true,
  idPrefix = "stock-line",
  renderLineBadge,
  renderLineExtra,
}: {
  lines: readonly StockLineDraft[];
  onChange: (next: StockLineDraft[]) => void;
  showUnitCost?: boolean;
  quantityLabel?: string;
  unitCostLabel?: string;
  lineErrors?: StockLineFieldErrors;
  disabled?: boolean;
  onAddClick?: () => void;
  addLabel?: string;
  headerSlot?: ReactNode;
  allowRemove?: boolean;
  idPrefix?: string;
  renderLineBadge?: (line: StockLineDraft, index: number) => ReactNode;
  renderLineExtra?: (line: StockLineDraft, index: number) => ReactNode;
}) {
  const atCap = lines.length >= STOCK_MAX_LINES;

  function updateLine(index: number, patch: Partial<StockLineDraft>) {
    onChange(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    onChange(lines.filter((_, i) => i !== index));
  }

  return (
    <section aria-label="Line items" className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">
            Items ({lines.length}/{STOCK_MAX_LINES})
          </h3>
          <p className="text-xs text-muted-foreground">
            One line per variant, up to {STOCK_MAX_LINES} lines per document.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {headerSlot}
          {onAddClick ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={disabled || atCap}
              onClick={onAddClick}
            >
              <Plus aria-hidden className="size-4" />
              {addLabel}
            </Button>
          ) : null}
        </div>
      </div>

      {lines.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center text-sm text-muted-foreground">
          No items added yet. Use <strong>{addLabel}</strong> to select variants.
        </div>
      ) : (
        <ul className="grid gap-2.5">
          {lines.map((line, index) => {
            const err = lineErrors[line.variantId];
            const qtyId = `${idPrefix}-qty-${line.variantId}`;
            const costId = `${idPrefix}-cost-${line.variantId}`;
            const qtyErrorId = `${qtyId}-error`;
            const costErrorId = `${costId}-error`;
            return (
              <li
                key={line.variantId}
                className={cn(
                  "grid gap-3 rounded-lg border border-border bg-card p-3",
                  (err?.quantity || err?.unitCost || err?.lotCode || err?.lotExpiry || err?.general) &&
                    "border-destructive/60",
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {line.productName}
                      </p>
                      {renderLineBadge?.(line, index)}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {line.variantLabel}
                      {line.sku ? ` · SKU ${line.sku}` : ""}
                      {line.onHand !== undefined ? ` · On hand ${line.onHand}` : ""}
                      {line.onOrder !== undefined && line.onOrder > 0 ? ` · On order ${line.onOrder}` : ""}
                    </p>
                    {line.availableQuantity !== undefined ? (
                      <p className="mt-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
                        Available to allocate: {line.availableQuantity.toLocaleString("en-US")}
                      </p>
                    ) : null}
                  </div>
                  {allowRemove ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      disabled={disabled}
                      aria-label={`Remove ${line.productName} ${line.variantLabel}`}
                      onClick={() => removeLine(index)}
                      className="size-9 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 aria-hidden className="size-4" />
                    </Button>
                  ) : null}
                </div>

                <div className={cn("grid gap-3", showUnitCost ? "sm:grid-cols-2" : "sm:max-w-xs")}>
                  <div className="grid gap-1.5">
                    <Label htmlFor={qtyId}>
                      {quantityLabel}
                      {line.maxQuantity !== undefined ? ` (max ${line.maxQuantity})` : ""}
                    </Label>
                    <NumberField
                      id={qtyId}
                      value={line.quantityText}
                      disabled={disabled}
                      placeholder="0"
                      aria-invalid={err?.quantity ? true : undefined}
                      aria-describedby={err?.quantity ? qtyErrorId : undefined}
                      onChange={(event) => updateLine(index, { quantityText: event.target.value })}
                    />
                    <FieldError id={qtyErrorId}>{err?.quantity}</FieldError>
                  </div>

                  {showUnitCost ? (
                    <div className="grid gap-1.5">
                      <Label htmlFor={costId}>{unitCostLabel}</Label>
                      <NumberField
                        id={costId}
                        prefix="฿"
                        inputMode="decimal"
                        value={line.unitCostText ?? ""}
                        disabled={disabled}
                        placeholder="Optional"
                        aria-invalid={err?.unitCost ? true : undefined}
                        aria-describedby={err?.unitCost ? costErrorId : undefined}
                        onChange={(event) => updateLine(index, { unitCostText: event.target.value })}
                      />
                      <FieldError id={costErrorId}>{err?.unitCost}</FieldError>
                    </div>
                  ) : null}
                </div>

                {renderLineExtra?.(line, index)}

                {err?.general ? (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {err.general}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      {showUnitCost && lines.length > 0 ? (
        <LineCostSummary lines={lines} />
      ) : null}
    </section>
  );
}

function LineCostSummary({ lines }: { lines: readonly StockLineDraft[] }) {
  let totalSatang = 0;
  let totalUnits = 0;
  let hasAnyCost = false;
  for (const line of lines) {
    const qty = Number(line.quantityText.trim());
    if (Number.isSafeInteger(qty) && qty > 0) {
      totalUnits += qty;
      const costText = (line.unitCostText ?? "").trim().replaceAll(",", "");
      if (costText && /^\d+(?:\.\d{1,2})?$/.test(costText)) {
        hasAnyCost = true;
        totalSatang += Math.round(Number(costText) * 100) * qty;
      }
    }
  }
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
      <span className="text-muted-foreground">
        Total units: <strong className="tabular-nums text-foreground">{totalUnits.toLocaleString("en-US")}</strong>
      </span>
      <span className="text-muted-foreground">
        Estimated total:{" "}
        <strong className="tabular-nums text-foreground">
          {hasAnyCost ? formatSatang(totalSatang) : "—"}
        </strong>
      </span>
    </div>
  );
}
