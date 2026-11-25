"use client";

import type { Id } from "convex/_generated/dataModel";
import type { BranchState } from "convex/shared/branchTypes";
import { Check, MapPin } from "lucide-react";
import { useId } from "react";
import { cn } from "@/lib/utils";
import { BranchStatePill } from "./branch-status";

export type SelectableBranch = {
  id: Id<"branches">;
  name: string;
  state: BranchState;
};

export function BranchMultiSelect({
  branches,
  selectedIds,
  disabled = false,
  label = "Branches",
  hint = "A desk role needs at least one branch.",
  error,
  onToggle,
}: {
  branches: readonly SelectableBranch[];
  selectedIds: readonly Id<"branches">[];
  disabled?: boolean;
  label?: string;
  hint?: string;
  error?: string;
  onToggle: (branchId: Id<"branches">) => void;
}) {
  const labelId = useId();
  const errorId = useId();
  return (
    <div className="grid gap-1.5">
      <span id={labelId} className="text-xs font-normal text-muted-foreground">
        {label}
      </span>
      {branches.length === 0 ? (
        <p className="text-xs text-muted-foreground">No non-archived branches available.</p>
      ) : (
        <div
          role="group"
          aria-labelledby={labelId}
          aria-describedby={error ? errorId : undefined}
          className="flex flex-wrap gap-2"
        >
          {branches.map((branch) => {
            const checked = selectedIds.includes(branch.id);
            return (
              <button
                key={branch.id}
                type="button"
                role="checkbox"
                aria-checked={checked}
                disabled={disabled}
                onClick={() => onToggle(branch.id)}
                className={cn(
                  "inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
                  checked
                    ? "border-foreground/60 bg-background font-medium text-foreground"
                    : "border-border bg-background text-muted-foreground hover:bg-muted",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "grid size-4 shrink-0 place-items-center rounded-[4px] border",
                    checked ? "border-foreground bg-foreground text-background" : "border-foreground/50",
                  )}
                >
                  {checked ? <Check className="size-3" /> : null}
                </span>
                <MapPin aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
                <span>{branch.name}</span>
                <BranchStatePill state={branch.state} />
              </button>
            );
          })}
        </div>
      )}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p className="text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </div>
  );
}
