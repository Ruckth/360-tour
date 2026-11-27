"use client";

import { Button } from "@/components/ui/button";
import { staffDateTime } from "@/lib/staff-time";
import type { StockPurchaseEvent } from "./stock-types";

const ACTION_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  submitted: "Submitted for approval",
  withdrawn: "Withdrawn to draft",
  approved: "Approved",
  needs_changes: "Sent back for changes",
  declined: "Declined",
  discarded: "Discarded",
  closed: "Closed demand",
  deleted: "Deleted draft",
  issued: "Issued order",
  amended: "Amended order",
  closed_remainder: "Closed remainder",
  received: "Posted receipt",
  corrected: "Posted quantity correction",
  returned: "Posted supplier return",
  return_reversed: "Reversed supplier return",
  note_edited: "Updated reference / note",
  held: "Held goods recorded",
  hold_accepted: "Accepted held goods",
  hold_declined: "Declined held goods",
  activated: "Activated",
  deactivated: "Deactivated",
};

function formatChangeVal(val: string | number | boolean | null): string {
  if (val === null) return "Not set";
  if (typeof val === "boolean") return val ? "Yes" : "No";
  return String(val);
}

/**
 * Renders immutable purchasing audit history (`purchaseEvents`) with actor, timestamp,
 * action, reason, and before/after field changes.
 */
export function PurchaseEventHistory({
  events,
  loading = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
  emptyText = "No history recorded yet.",
}: {
  events: readonly StockPurchaseEvent[];
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  emptyText?: string;
}) {
  if (loading) {
    return (
      <p role="status" className="py-6 text-sm text-muted-foreground">
        Loading history…
      </p>
    );
  }

  if (events.length === 0) {
    return <p className="py-6 text-sm text-muted-foreground">{emptyText}</p>;
  }

  return (
    <div className="grid gap-3">
      <ol className="divide-y divide-border">
        {events.map((event) => (
          <li key={event._id} className="grid gap-1.5 py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {ACTION_LABELS[event.action] ?? event.action.replaceAll("_", " ")}
              </p>
              <time
                dateTime={new Date(event.createdAt).toISOString()}
                className="text-xs tabular-nums text-muted-foreground"
              >
                {staffDateTime(event.createdAt)}
              </time>
            </div>
            <p className="text-xs text-muted-foreground">{event.actorLabel}</p>
            {event.reason ? (
              <p className="rounded-md bg-muted/50 px-2.5 py-1.5 text-xs text-foreground">
                Reason: {event.reason}
              </p>
            ) : null}
            {event.changes && event.changes.length > 0 ? (
              <ul className="grid gap-1 pl-3 text-xs text-muted-foreground">
                {event.changes.map((change, index) => (
                  <li key={`${change.field}-${index}`}>
                    <span className="font-medium text-foreground">{change.field}:</span>{" "}
                    <span>{formatChangeVal(change.before)}</span> →{" "}
                    <span className="text-foreground">{formatChangeVal(change.after)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ))}
      </ol>
      {hasMore && onLoadMore ? (
        <div className="pt-1">
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={onLoadMore}>
            {loadingMore ? "Loading…" : "Load earlier history"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
