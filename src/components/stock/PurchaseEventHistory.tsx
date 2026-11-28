"use client";

import { Button } from "@/components/ui/button";
import { staffDateTime } from "@/lib/staff-time";
import { historyChangeText, historyRevision, visibleHistoryChanges } from "./purchasing-display";
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
  edited: "Edited",
  resubmitted: "Resubmitted for approval",
  send_back: "Sent back for changes",
  decline: "Declined",
  copied: "Created as a copy",
  copied_to: "Copied to a new request",
  approval_requested: "Sent for order approval (over the direct order limit)",
  issue_approved: "Order approved for issue",
  issue_declined: "Order sent back to draft",
  self_received: "Received by the person who issued it",
  posted: "Posted receipt",
  rejected: "Rejected delivery",
  returned_to_supplier: "Posted supplier return",
  receipt_corrected: "Receipt quantity corrected",
  correction_reported: "Correction sent for reconciliation",
  partially_accepted: "Partly accepted held goods",
  acceptance_corrected: "Held goods acceptance corrected",
  missing_units_received: "Missing units received",
  follow_up_received: "Follow-up receipt posted",
  reactivated: "Reactivated",
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
  onPrintRevision,
}: {
  events: readonly StockPurchaseEvent[];
  loading?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  emptyText?: string;
  /** Print an issued revision; issued and amended events show the revision and this action in their own row. */
  onPrintRevision?: (revision: number) => void;
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
        {events.map((event) => {
          // Older issue events carry no revision change; an order is always issued as Rev 1.
          const revision = historyRevision(event.changes) ?? (event.action === "issued" ? 1 : null);
          const changes = visibleHistoryChanges(event.changes);
          return (
          <li key={event._id} className="grid gap-1.5 py-3 first:pt-0">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-foreground">
                {ACTION_LABELS[event.action] ?? event.action.replaceAll("_", " ").replace(/^\w/, (c) => c.toUpperCase())}
                {revision !== null ? (
                  <span className="ml-2 font-mono text-xs text-muted-foreground">
                    Rev {revision}
                    {onPrintRevision ? (
                      <>
                        {" · "}
                        <button type="button" className="underline underline-offset-4" onClick={() => onPrintRevision(revision)}>
                          Print Rev {revision}
                        </button>
                      </>
                    ) : null}
                  </span>
                ) : null}
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
            {event.entity === "request" && event.action === "approved" &&
            !changes.some((change) => /^lines\[.+\]\.approved$/.test(change.field)) ? (
              <p className="text-xs text-muted-foreground">Approval quantities were unavailable for this event.</p>
            ) : null}
            {event.entity === "request" && event.relatedId && (event.action === "copied" || event.action === "copied_to") ? (
              <a className="w-fit text-xs underline underline-offset-4" href={`/admin/stock/purchasing/requests/${encodeURIComponent(event.relatedId)}`}>
                {event.action === "copied" ? "Open source request" : "Open copied request"}
              </a>
            ) : null}
            {changes.length > 0 ? (
              <ul className="grid gap-1 pl-3 text-xs text-muted-foreground">
                {changes.map((change, index) => (
                  <li key={`${change.field}-${index}`}>{historyChangeText(change)}</li>
                ))}
              </ul>
            ) : null}
          </li>
          );
        })}
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
