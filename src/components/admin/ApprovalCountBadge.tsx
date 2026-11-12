"use client";

import { cn } from "@/lib/utils";
import { usePendingApprovalCount } from "./staff-access";

/** The number of approval requests waiting, on the Checkout navigation item. Nothing when none. */
export function ApprovalCountBadge({ className }: { className?: string }) {
  const count = usePendingApprovalCount();
  if (!count) return null;
  return (
    <span data-approval-count="" className={cn("inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-gold px-1.5 text-xs font-semibold text-navy tabular-nums", className)}>
      {count}
      <span className="sr-only"> {count === 1 ? "approval" : "approvals"} waiting</span>
    </span>
  );
}
