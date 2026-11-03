"use client";

import { usePaginatedQuery } from "convex/react";
import { makeFunctionReference, type PaginationOptions, type PaginationResult } from "convex/server";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

export type HistoryEntry = Doc<"recordChanges">;
// Explicit references until the parent runs local codegen; no untyped generated API cast.
const listHistory = makeFunctionReference<
  "query",
  {
    entityType: string;
    entityId?: string;
    paginationOpts: PaginationOptions;
  },
  PaginationResult<HistoryEntry>
>("recordHistory:list");
const listRecords = makeFunctionReference<
  "query",
  {
    propertyId?: Id<"properties">;
    paginationOpts: PaginationOptions;
  },
  PaginationResult<Doc<"configurationHistoryIndex">>
>("configurationHistory:records");

const LABELS: Record<string, string> = {
  businessName: "Business name",
  tagline: "Tagline",
  contactEmail: "Contact email",
  contactPhone: "Contact phone",
  whatsapp: "WhatsApp",
  lineId: "LINE ID",
  lineUrl: "LINE link",
  address: "Address",
  currency: "Currency",
  timezone: "Time zone",
  checkInTime: "Check-in time",
  checkOutTime: "Check-out time",
  cancellationPolicy: "Cancellation policy",
  bookingRules: "Booking rules",
  unpaidHoldMinutes: "Unpaid hold (minutes)",
  chatQuoteValidityMinutes: "Chat summary validity (minutes)",
  preArrivalDaysBefore: "Pre-arrival email days before check-in",
  reviewDaysAfter: "Review email days after check-out",
  minNights: "Minimum nights",
  maxAdvanceDays: "Maximum advance booking days",
  sameDayCutoff: "Same-day booking cutoff",
  ai: "AI preferences",
  tone: "Tone",
  maxWords: "Maximum words",
  email: "Email preferences",
  fromName: "Sender name",
  ownerNotificationEmail: "Notification email",
  footer: "Email footer",
  slug: "Slug",
  name: "Name",
  description: "Description",
  pricePerNight: "Price per night",
  maxGuests: "Maximum guests",
  bedrooms: "Bedrooms",
  bathrooms: "Bathrooms",
  area: "Area",
  images: "Photos",
  amenities: "Amenities",
  tourRoomIds: "Tour order",
  directDiscountPercent: "Direct discount (%)",
  status: "Status",
  translations: "Translations",
  locale: "Language",
  imagePath: "Panorama",
  hotspots: "Hotspots",
  label: "Label",
  targetRoomSlug: "Destination",
  position: "Position",
  platform: "Booking platform",
  nightlyRate: "Nightly rate",
  url: "Listing link",
  date: "Date",
  override: "Date override",
  shifts: "Shifts",
  breaks: "Breaks",
  note: "Note",
  workingHours: "Weekly shifts",
  effectiveFrom: "Applies from",
  weekday: "Weekday",
  start: "Start",
  end: "End",
  scope: "Scope",
  role: "Role",
  color: "Calendar color",
  staffId: "Staff reference",
  propertyId: "Villa reference",
  reason: "Reason",
  staffName: "Staff member",
  staffIds: "Assigned staff references",
  archivedServiceIds: "Service assignments retained at archive",
  hasPhoto: "Has photo",
  photoChanged: "Photo changed",
  category: "Category",
  durationMin: "Duration (minutes)",
  bufferMin: "Turnaround (minutes)",
  price: "Price",
};
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KINDS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  edited: "Edited",
  archived: "Archived",
  removed: "Removed",
  deleted: "Deleted",
  restored: "Configuration restored",
  day_updated: "Date plan changed",
  day_reset: "Date reset to weekly default",
  day_undone: "Date change undone",
  pattern_updated: "Weekly default changed",
  pattern_undone: "Weekly default change undone",
  ota_rate_updated: "OTA rate changed",
  ota_rate_removed: "OTA rate removed",
};
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
function display(value: unknown, field: string): string {
  if (value === null || value === undefined) return field === "override" ? "Weekly default" : "Not set";
  if (field === "weekday" && typeof value === "number") return DAYS[value] ?? "Unknown weekday";
  if ((field === "start" || field === "end") && typeof value === "number")
    return `${new Date(value).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} (Bangkok)`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (Array.isArray(value)) {
    if (!value.length) return "None";
    return value.map((item) => display(item, field)).join("; ");
  }
  if (typeof value === "object") {
    const row = object(value);
    if (typeof row.start === "string" && typeof row.end === "string") {
      return `${typeof row.weekday === "number" ? `${DAYS[row.weekday]} ` : ""}${row.start}–${row.end}${row.label ? ` (${row.label})` : ""}`;
    }
    if (typeof row.targetRoomSlug === "string")
      return `${row.label} → ${row.targetRoomSlug}${Array.isArray(row.position) ? ` (${row.position.join(", ")})` : ""}`;
    return (
      Object.entries(row)
        .filter(([key]) => LABELS[key])
        .map(([key, item]) => `${LABELS[key]}: ${display(item, key)}`)
        .join(" · ") || "Not set"
    );
  }
  if (field === "images" || field === "imagePath") {
    const path = String(value).split("?")[0];
    return path.split("/").pop() || "Image";
  }
  return value === "" ? "Blank" : String(value);
}
export function historyChanges(entry: Pick<HistoryEntry, "before" | "after">) {
  const before = object(entry.before),
    after = object(entry.after);
  return [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((field) => LABELS[field] && JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({ field, label: LABELS[field], before: display(before[field], field), after: display(after[field], field) }));
}

export function RecordHistoryPanel({
  entityType,
  entityId,
  title = "History",
  onRestore,
  disabled = false,
}: {
  entityType: string;
  entityId?: string;
  title?: string;
  onRestore?: (entry: HistoryEntry, side: "before" | "after") => Promise<void>;
  disabled?: boolean;
}) {
  const { results, status, loadMore } = usePaginatedQuery(listHistory, { entityType, entityId }, { initialNumItems: 10 });
  return (
    <section aria-label={title} className="min-w-0 space-y-3 border-t border-border pt-4">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <p className="text-xs text-muted-foreground">History begins with changes recorded now. Earlier edits were not recorded.</p>
      {entityType === "settings" ? (
        <p className="text-xs text-muted-foreground">
          Applying an earlier configuration creates a new change. AI instructions and provider secrets are retained.
        </p>
      ) : null}
      {status === "LoadingFirstPage" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading history…
        </p>
      ) : !results.length ? (
        <p className="text-sm text-muted-foreground">No recorded changes yet.</p>
      ) : null}
      <ol className="divide-y divide-border">
        {results.map((entry) => (
          <li key={entry._id} className="space-y-2 py-3 first:pt-0">
            <p className="text-sm font-medium text-foreground">{KINDS[entry.kind] ?? "Record changed"}</p>
            <p className="break-words text-xs text-muted-foreground">
              {entry.actor} · Recorded <time dateTime={new Date(entry.recordedAt).toISOString()}>{new Date(entry.recordedAt).toLocaleString()}</time>
            </p>
            <p className="text-xs text-muted-foreground">
              Effective {new Date(entry.effectiveAt).toLocaleString("en-GB", { timeZone: "Asia/Bangkok" })} (Bangkok)
            </p>
            {entry.reason ? <p className="break-words text-sm text-muted-foreground">{entry.reason}</p> : null}
            <dl className="grid gap-2 text-sm">
              {historyChanges(entry).map((change) => (
                <div key={change.field} className="min-w-0">
                  <dt className="font-medium text-foreground">{change.label}</dt>
                  <dd className="whitespace-pre-wrap break-words text-muted-foreground">
                    <span>{change.before}</span> <span aria-label="changed to">→</span> <span className="text-foreground">{change.after}</span>
                  </dd>
                </div>
              ))}
            </dl>
            {onRestore ? (
              <div className="flex flex-wrap gap-2">
                {(["before", "after"] as const).map((side) =>
                  entry[side] ? (
                    <Button key={side} type="button" size="sm" variant="outline" disabled={disabled} onClick={() => void onRestore(entry, side)}>
                      Apply {side} this change
                    </Button>
                  ) : null,
                )}
              </div>
            ) : null}
          </li>
        ))}
      </ol>
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button type="button" variant="outline" size="sm" disabled={status === "LoadingMore"} onClick={() => loadMore(10)}>
          {status === "LoadingMore" ? "Loading…" : "Load older changes"}
        </Button>
      ) : null}
    </section>
  );
}

/** Closed history sections do not subscribe to their nested pages. */
export function HistoryDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="border-t border-border py-2" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="cursor-pointer break-words rounded-sm text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {label}
      </summary>
      {open ? <div className="mt-3 space-y-3">{children}</div> : null}
    </details>
  );
}

/** Tombstone discovery remains usable after rows and their editor routes have disappeared. */
export function ConfigurationHistoryRecords({ propertyId }: { propertyId?: Id<"properties"> }) {
  const { results, status, loadMore } = usePaginatedQuery(listRecords, propertyId ? { propertyId } : {}, { initialNumItems: 10 });
  return (
    <section className="space-y-3" aria-label={propertyId ? "Room history" : "Deleted villa history"}>
      <h3 className="text-sm font-semibold">{propertyId ? "Room history, including removed rooms" : "Deleted villas"}</h3>
      {status === "LoadingFirstPage" ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading records…
        </p>
      ) : !results.length ? (
        <p className="text-sm text-muted-foreground">No retained records yet. History begins with changes recorded now.</p>
      ) : null}
      {results.map((row) => (
        <HistoryDisclosure key={row._id} label={`${row.name} · ${row.entityType === "room" ? "Room" : "Villa"}${row.deleted ? " · Deleted" : ""}`}>
          <RecordHistoryPanel entityType={row.entityType} entityId={row.entityId} title={`${row.name} history`} />
          {row.entityType === "property" ? <ConfigurationHistoryRecords propertyId={row.propertyId} /> : null}
        </HistoryDisclosure>
      ))}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button type="button" size="sm" variant="outline" disabled={status === "LoadingMore"} onClick={() => loadMore(10)}>
          Load more records
        </Button>
      ) : null}
    </section>
  );
}
