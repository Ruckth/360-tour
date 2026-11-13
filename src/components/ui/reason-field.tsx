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
  className,
}: ReasonFieldProps) {
  const autoId = useId();
  const inputId = id ?? `reason-${autoId}`;
  const errorId = `${inputId}-error`;
  const current = value.trim();

  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={inputId}>{label}</Label>
      {chips.length > 0 ? (
        <div role="group" aria-label={`Quick ${label.toLowerCase()}`} className="flex flex-wrap gap-2">
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
                  "inline-flex min-h-10 items-center rounded-full border px-3.5 text-sm font-semibold whitespace-nowrap transition-colors pointer-coarse:min-h-11 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-45",
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
      <Input
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
      />
      {error ? (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
