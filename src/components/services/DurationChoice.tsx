import { useId } from "react";
import type { ServiceOption } from "@/lib/service-options";
import { cn } from "@/lib/utils";

/**
 * Lengths of one service as a radio group of chips (length and price). Native radios give arrow-key
 * movement and one tab stop; the chip is the radio's label.
 */
export function DurationChoice({
  legend,
  options,
  value,
  onChange,
  formatPrice,
  unit = "min",
  disabled,
  className,
}: {
  legend: string;
  options: readonly ServiceOption[];
  value: number | undefined;
  onChange: (durationMin: number) => void;
  formatPrice: (amount: number) => string;
  unit?: string;
  disabled?: boolean;
  className?: string;
}) {
  const name = useId();
  return (
    <fieldset disabled={disabled} className={cn("grid min-w-0 gap-2", className)}>
      <legend className="mb-2 text-sm font-medium">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => (
          <label key={option.durationMin} className="relative">
            <input
              type="radio"
              name={name}
              value={option.durationMin}
              checked={option.durationMin === value}
              onChange={() => onChange(option.durationMin)}
              className="peer sr-only"
            />
            <span className="flex min-h-11 min-w-20 cursor-pointer flex-col items-center justify-center rounded-lg border border-border bg-background px-3 py-1 text-sm leading-tight transition hover:bg-muted peer-checked:border-primary peer-checked:bg-primary peer-checked:text-primary-foreground peer-checked:hover:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 motion-reduce:transition-none">
              <span className="font-semibold tabular-nums">{option.durationMin} {unit}</span>
              <span className="text-xs tabular-nums opacity-80">{formatPrice(option.price)}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
