/**
 * Pure display rules for Stock › Purchasing: resort-time relative dates and urgency, request item summaries and
 * human-readable history entries. No React, no Convex; tested directly.
 */
import { addDays } from "convex/shared/dates";
import { resortTodayIso } from "convex/shared/time";

export type Urgency = "overdue" | "soon" | "later" | "none";

/** Whole days from `from` to `to` (ISO dates). */
export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** A date relative to resort today: "Today", "Tomorrow", "in 7 days", "2 d overdue". */
export function relativeDate(iso: string | undefined | null, today = resortTodayIso()) {
  if (!iso) return { label: "—", urgency: "none" as Urgency, days: null };
  const days = daysBetween(today, iso);
  const urgency: Urgency = days < 0 ? "overdue" : days < 3 ? "soon" : "later";
  const label = days < 0 ? `${-days} d overdue` : days === 0 ? "Today" : days === 1 ? "Tomorrow" : `in ${days} days`;
  return { label, urgency, days };
}

export const URGENCY_CLASS: Record<Urgency, string> = {
  overdue: "text-destructive font-medium",
  soon: "text-amber-700 dark:text-amber-400 font-medium",
  later: "text-muted-foreground",
  none: "text-muted-foreground",
};

/** "submitted 2 d ago" from an instant. */
export function ageLabel(ms: number | undefined, now = Date.now()) {
  if (!ms) return "";
  const days = daysBetween(resortTodayIso(ms), resortTodayIso(now));
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} d ago`;
}

/** First item names with a "+N more" tail. Older requests without a summary fall back to the line count. */
export function itemSummaryLabel(summary: readonly string[] | undefined, lineCount: number) {
  if (!summary?.length) return `${lineCount} ${lineCount === 1 ? "line" : "lines"}`;
  const names = [...new Set(summary)].slice(0, 2);
  const more = lineCount - names.length;
  return `${names.join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}

/** Lateness of a receipt against the expected date in force: "on time", "2 d late", "1 d early". */
export function latenessLabel(lateDays: number | null) {
  if (lateDays === null) return "No expected date";
  if (lateDays === 0) return "On time";
  return lateDays > 0 ? `${lateDays} d late` : `${-lateDays} d early`;
}

/** Default expected date from a lead time (days), in resort time. */
export function expectedFromLeadTime(leadTimeDays: number | undefined, today = resortTodayIso()) {
  return leadTimeDays && leadTimeDays > 0 ? addDays(today, leadTimeDays) : "";
}

// ---------- History ----------

const FIELD_LABELS: Record<string, string> = {
  issuedRevision: "Revision", needBy: "Need-by date", note: "Note", supplier: "Supplier", requestId: "Source request",
  expectedDate: "Expected date", supplierReference: "Supplier reference", replacesReturnId: "Replaces return", forHoldId: "For held goods",
  status: "Status", remainderCancelled: "Cancelled remainder", acceptedQuantity: "Accepted quantity", acceptedOn: "Accepted on order",
  acceptedReceipt: "Accepted on receipt", missingUnits: "Missing units received", "followUp.quantity": "Follow-up units",
  blockedBy: "Blocked by", deliveryReference: "Delivery reference", duplicateOf: "Duplicate of", duplicateReason: "Duplicate reason",
  copiedFrom: "Copied from", copiedTo: "Copied to", skippedArchived: "Archived items left out", orderValue: "Order value",
  directOrderLimit: "Direct order limit", name: "Name", contactName: "Contact", phone: "Phone", email: "Email",
};

const LINE_PROPERTY: Record<string, string> = {
  quantity: "Quantity", unitCost: "Unit cost", item: "Item", due: "Still due", approved: "Approved",
};

export type HistoryChange = { field: string; before: string | number | boolean | null; after: string | number | boolean | null };

/** A history field as a label: no dotted keys or bracket syntax reach the screen. */
export function historyFieldLabel(field: string) {
  const line = /^lines\[(.+)\](?:\.(\w+))?$/.exec(field);
  if (line) {
    const [, item, property] = line;
    return property ? `${LINE_PROPERTY[property] ?? "Change"} — ${item}` : item;
  }
  return FIELD_LABELS[field] ?? field.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[._]/g, " ").replace(/^\w/, c => c.toUpperCase());
}

const value = (v: HistoryChange["before"]) => (v === null ? "Not set" : typeof v === "boolean" ? (v ? "Yes" : "No") : String(v));

/** One readable change line. `changes.omitted` becomes "+N more changes"; added/removed lines say so. */
export function historyChangeText(change: HistoryChange) {
  if (change.field === "changes.omitted") return `+${value(change.after)} more changes`;
  const label = historyFieldLabel(change.field);
  if (/^lines\[.+\]$/.test(change.field)) {
    if (change.before === null) return `Added ${label}: ${value(change.after)}`;
    if (change.after === null) return `Removed ${label} (was ${value(change.before)})`;
  }
  if (/\]\.approved$/.test(change.field)) {
    const item = /^lines\[(.+)\]/.exec(change.field)?.[1] ?? "";
    return `${item}: ${value(change.before)} → ${value(change.after)} approved`;
  }
  return `${label}: ${value(change.before)} → ${value(change.after)}`;
}

/** Revision bookkeeping is shown as the event's revision badge, not as a separate change line. */
export function visibleHistoryChanges(changes: readonly HistoryChange[] | undefined) {
  return (changes ?? []).filter(change => change.field !== "issuedRevision");
}

export function historyRevision(changes: readonly HistoryChange[] | undefined) {
  const revision = changes?.find(change => change.field === "issuedRevision")?.after;
  return typeof revision === "number" ? revision : null;
}
