"use client";

import { useId } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";

export type ReasonFieldProps = {
  value: string;
  onChange: (value: string) => void;
  /** Quick reasons. Tapping one sets the text; staff can still edit it. */
  chips: readonly string[];
  label?: string;
  id?: string;
  disabled?: boolean;
  error?: string | null;
  placeholder?: string;
  /** Smaller chips and a screen-reader-only label, for a reason inside a tight panel. */
  compact?: boolean;
  /**
   * false: only the chips, labelled by `label`, for a panel that keeps its own-text field
   * elsewhere (e.g. under "More"). The caller then supplies that field.
   */
  showInput?: boolean;
  className?: string;
};

/** A required reason with editable quick chips. */
export function ReasonField({
  value,
  onChange,
  chips,
  label = "Reason",
  id,
  disabled = false,
  error,
  placeholder = "Pick one or type",
  compact = false,
  showInput = true,
  className,
}: ReasonFieldProps) {
  const autoId = useId();
  const inputId = id ?? `reason-${autoId}`;
  const errorId = `${inputId}-error`;
  const current = value.trim();

  return (
    <div className={cn("grid gap-2", className)}>
      {showInput ? (
        <Label htmlFor={inputId} className={cn(compact && "sr-only")}>{label}</Label>
      ) : (
        <p id={`${inputId}-label`} className={cn("text-sm leading-none font-medium", compact && "sr-only")}>{label}</p>
      )}
      {chips.length > 0 ? (
        <div role="group" {...(showInput ? { "aria-label": `Quick ${label.toLowerCase()}` } : { "aria-labelledby": `${inputId}-label` })} className={cn("flex flex-wrap", compact ? "gap-1.5" : "gap-2")}>
          {chips.map((chip) => {
            const pressed = current === chip;
            return (
              <button
                key={chip}
                type="button"
                aria-pressed={pressed}
                disabled={disabled}
                onClick={() => onChange(chip)}
                className={cn(
                  "inline-flex items-center rounded-full border font-semibold whitespace-nowrap transition-colors pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
                  compact ? "min-h-8 px-3 text-xs" : "min-h-10 px-3.5 text-sm",
                  pressed
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-muted text-foreground hover:border-input",
                )}
              >
                {chip}
              </button>
            );
          })}
        </div>
      ) : null}
      {showInput ? <Input
        id={inputId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        required
        aria-required="true"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        className={cn(error && "border-destructive focus-visible:ring-destructive")}
      /> : null}
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
