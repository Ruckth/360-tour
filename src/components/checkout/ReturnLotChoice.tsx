"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { useNow } from "@/lib/staff-bookings";
import type { ReturnLotOptions } from "./backend";
import { returnsCopy } from "./returns-desk-copy";
import { automaticReturnLots, selectedReturnLots, type Choice } from "./returns-desk";

const { t, date } = returnsCopy;

export function ReturnLotChoice({ options, choice, disabled, onChange }: {
  options: ReturnLotOptions["lots"]; choice: Choice; disabled: boolean; onChange: (choice: Choice) => void;
}) {
  const fieldId = useId();
  const now = useNow(10_000);
  const available = options.reduce((sum, lot) => sum + lot.quantity, 0);
  if (available < choice.units) return <p role="alert" className="text-sm text-destructive">{t("returns.notEnoughLotUnits")}</p>;
  const automatic = automaticReturnLots(options, choice.units);
  const selected = selectedReturnLots(options, choice);
  const total = selected.reduce((sum, lot) => sum + lot.quantity, 0);
  const includesExpired = options.some(lot => lot.expiresAt <= now && selected.some(item => item.lotId === lot.lotId));
  return (
    <fieldset className="grid gap-2 rounded-lg bg-muted/50 p-2" disabled={disabled}>
      <legend className="px-1 text-sm font-medium">{t("returns.returnLots")}</legend>
      {!automatic ? <p className="text-xs text-muted-foreground">{t("returns.confirmLotUnits", { count: total, units: choice.units })}</p> : null}
      {includesExpired ? <p className="text-xs text-muted-foreground">{t("returns.expiredLots")}</p> : null}
      {options.map(({ lotId, code, quantity, expiresAt }) => {
        const limit = Math.min(quantity, choice.units);
        const entered = choice.lotQuantities?.[lotId];
        const invalid = entered !== undefined && (!Number.isSafeInteger(entered) || entered < 0 || entered > limit);
        const errorId = `${fieldId}-${lotId}`;
        return <div key={lotId} className="flex items-center justify-between gap-2 text-sm">
            <span className="min-w-0 [overflow-wrap:anywhere]">
              {code}<span className="block text-xs text-muted-foreground">{t("returns.lotDetails", { date: date(expiresAt), units: quantity })}</span>
            </span>
            {automatic ? <span className="tabular-nums">{selected.find(lot => lot.lotId === lotId)?.quantity}</span> : (
              <div className="grid justify-items-end gap-1">
                <Input type="number" min={0} max={limit} step={1}
                  className="w-20 shrink-0 tabular-nums" value={choice.lotQuantities?.[lotId] ?? ""}
                  aria-label={t("returns.unitsForLot", { code })}
                  aria-invalid={invalid || undefined}
                  aria-describedby={invalid ? errorId : undefined}
                  onChange={event => {
                    const lotQuantities = { ...choice.lotQuantities };
                    if (event.target.value === "") delete lotQuantities[lotId];
                    else lotQuantities[lotId] = event.target.valueAsNumber;
                    onChange({ ...choice, lotQuantities });
                  }} />
                {invalid ? <p id={errorId} role="alert" className="text-xs text-destructive">{t("returns.invalidLotUnits", { max: limit })}</p> : null}
              </div>
            )}
        </div>;
      })}
    </fieldset>
  );
}
