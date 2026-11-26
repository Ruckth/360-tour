import type { BranchState } from "convex/shared/branchTypes";
import { Building2, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";
import { StatusBadge } from "../StatusBadge";
import type { Tone } from "../status-tones";

/** The one branch state map: every state pill, dot and label reads from it. */
export const BRANCH_STATE_META: Record<BranchState, { tone: Tone; label: string }> = {
  active: { tone: "success", label: "Active" },
  setup: { tone: "warning", label: "Setup · hidden from guests" },
  suspended: { tone: "danger", label: "Suspended · no new sales" },
  archived: { tone: "muted", label: "Archived · read only" },
};

/** The state pill beside a branch name. Active shows none unless `showActive` (Settings › Branches). */
export function BranchStatePill({ state, showActive = false, className }: { state: BranchState; showActive?: boolean; className?: string }) {
  if (state === "active" && !showActive) return null;
  const meta = BRANCH_STATE_META[state];
  return <StatusBadge tone={meta.tone} label={meta.label} className={className} />;
}

/**
 * The one read-only branch pill: a map-pin (building for Company) and the name. `label` adds a
 * screen-reader prefix ("Branch: Koh Samui") where the pill stands alone, as in the header.
 */
export function BranchPill({ name, company = false, label, className }: { name: string; company?: boolean; label?: string; className?: string }) {
  const Icon = company ? Building2 : MapPin;
  return (
    <span
      data-branch-pill=""
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 font-sans text-xs font-medium text-foreground",
        className,
      )}
    >
      <Icon aria-hidden className="size-3 text-muted-foreground" />
      {label ? <span className="sr-only">{label}: </span> : null}
      {name}
    </span>
  );
}
