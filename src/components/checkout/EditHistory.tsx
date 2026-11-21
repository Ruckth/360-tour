"use client";

import { Pencil } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { maskVoucherCodes } from "@/components/display/voucher-mask";
import { lastUsableAt } from "convex/shared/commerce/validity";
import { guestFactText, useCommerce, type AdjustTarget, type ChangeValue, type CommerceCopy, type CustomerPage, type FieldChange, type HistoryAudience, type HistoryBalance, type HistoryEntry, type PartValue, type StockReason } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { formatResort } from "./checkout-ui";
import { useCommerceCopy } from "./commerce-copy";
import { fieldChanges } from "./history-changes";

/**
 * Edit · History for one sold or catalogue item (D19): its history, newest first, 20 at a time, with
 * Show guest for the plain-words view the guest may see (journey 12). Read-only until edits ship;
 * Edit is there, switched off, so the sheet keeps its shape when it opens. The guest view is shaped
 * on the server; this screen also never draws staff, notes or a full code in it.
 */

/** An opaque scrim over the whole staff screen while the guest looks at their history. */
const GUEST_SCRIM = "bg-background md:bg-background backdrop-blur-none md:backdrop-blur-none";

const STOCK_REASONS = new Set<string>(["received", "recount", "damaged", "theft", "lost", "returnedToStock"] satisfies StockReason[]);

/** "4 → 3 sessions", "3 paid + 1 goodwill", "฿2,000 → ฿1,400", "Stock 3 → 2". */
export function balanceText(balance: HistoryBalance, copy: CommerceCopy) {
  if (balance.unit === "stock") return copy.t("history.stockBeforeAfter", { before: balance.before, after: balance.after });
  const before = balance.before.paid + balance.before.goodwill;
  const after = balance.after.paid + balance.after.goodwill;
  if (balance.unit === "money") return copy.t("history.balanceBeforeAfter", { before: copy.money(before), after: copy.money(after) });
  const sessions = copy.t("history.sessionsBeforeAfter", { before, after });
  return balance.after.goodwill ? `${sessions} · ${copy.t("packages.paidPlusGoodwill", { paid: balance.after.paid, goodwill: balance.after.goodwill })}` : sessions;
}

// Satang fields; other numbers are counts or days. Fields ending in "At" are dates.
const MONEY_FIELDS = new Set(["price", "unitPrice", "minPrice", "maxPrice", "faceValue", "paidBalance", "goodwillBalance", "amount"]);
const leaf = (field: string) => field.slice(field.lastIndexOf(".") + 1);

/** "refundDueDays.card" → "Refund due days · Card", in the page's words where the catalog has the field. */
export function fieldLabel(field: string, copy: CommerceCopy) {
  return field.split(".").map((part) => {
    const key = `history.fields.${part}`;
    if (copy.has?.(key)) return copy.t(key);
    const words = part.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
    return words.charAt(0).toUpperCase() + words.slice(1);
  }).join(" · ");
}

/** One side of a change: money as money, dates as dates, on/off, a list, or a size. Never a full code. */
export function changeValueText(field: string, value: ChangeValue, copy: CommerceCopy): string {
  const one = (item: string | number | boolean | null): string => {
    if (item === null) return "—";
    if (typeof item === "boolean") return copy.t(item ? "history.on" : "history.off");
    if (typeof item === "string") return maskVoucherCodes(item) || "—";
    if (MONEY_FIELDS.has(leaf(field))) return copy.money(item);
    // A benefit's end is stored exclusive: show its last usable day, as the receipt and slips do.
    if (/ExpiresAt$|^expiresAt$/.test(leaf(field))) return copy.date(lastUsableAt(item));
    return /At$/.test(leaf(field)) ? copy.date(item) : String(item);
  };
  if (value === undefined) return "—";
  if (Array.isArray(value)) return value.length ? value.map(one).join(", ") : "—";
  if (isPart(value)) return partText(value, true, copy);
  if (value !== null && typeof value === "object") return copy.t("history.items", { count: value.items });
  return one(value);
}

const isPart = (value: ChangeValue): value is PartValue => value !== null && typeof value === "object" && "part" in value;

/** "5 × Massage", "Spa robe ×2", "Gift voucher · ฿500", or just the name when the count didn't change. */
function partText(value: PartValue | undefined, withCount: boolean, copy: CommerceCopy) {
  if (!value) return "—";
  const named = !withCount || value.count === null ? value.part
    : value.sessions ? copy.t("packages.contentsSessions", { count: value.count, service: value.part }) : `${value.part} ×${value.count}`;
  return value.amount === null ? named : `${named} · ${copy.money(value.amount)}`;
}

/** A package part that changed: "Massage: 5 → 6 sessions", "Contents: Thai massage → Hot stone", "Robe changed". */
function partChangeText(field: string, before: PartValue | undefined, after: PartValue | undefined, copy: CommerceCopy) {
  if (before && after && before.part === after.part) {
    const { part } = after;
    if (before.count !== after.count) {
      const change = after.sessions && before.count !== null && after.count !== null
        ? copy.t("history.sessionsBeforeAfter", { before: before.count, after: after.count })
        : `${before.count ?? "—"} → ${after.count ?? "—"}`;
      return copy.t("history.partChange", { part, change });
    }
    if (before.amount !== after.amount) return copy.t("history.change", { label: part, before: before.amount === null ? "—" : copy.money(before.amount), after: after.amount === null ? "—" : copy.money(after.amount) });
    return copy.t("history.partChanged", { part });
  }
  const counts = before?.count !== after?.count;
  return copy.t("history.change", { label: fieldLabel(field, copy), before: partText(before, counts, copy), after: partText(after, counts, copy) });
}

/** "Price: ฿1,000 → ฿1,200": what an edit changed, for staff only. */
export function changeText(change: FieldChange, copy: CommerceCopy) {
  const { before, after } = change;
  if (isPart(before) || isPart(after)) return partChangeText(change.field, isPart(before) ? before : undefined, isPart(after) ? after : undefined, copy);
  return copy.t("history.change", { label: fieldLabel(change.field, copy), before: changeValueText(change.field, before, copy), after: changeValueText(change.field, after, copy) });
}

/** Each field an edit changed, before → after; nothing when it changed none. */
function EntryChanges({ fields, copy }: { fields: NonNullable<HistoryEntry["fields"]>; copy: CommerceCopy }) {
  const changes = fieldChanges(fields.before, fields.after);
  if (!changes.length) return null;
  return (
    <ul className="grid gap-0.5 text-sm text-muted-foreground tabular-nums [overflow-wrap:anywhere]" data-testid="history-changes">
      {changes.map((change, index) => <li key={`${change.field}:${index}`}>{changeText(change, copy)}</li>)}
    </ul>
  );
}

/** Who did it and why, for staff only: "By Ploy · Health pause or extension". */
function staffText(staff: NonNullable<HistoryEntry["staff"]>, copy: CommerceCopy) {
  const reason = staff.reason ? copy.t(`edits.${STOCK_REASONS.has(staff.reason) ? "stockReasons" : "reasons"}.${staff.reason}`) : null;
  return [copy.t("history.by", { staff: staff.actorName }), reason, staff.reasonText].filter(Boolean).join(" · ");
}

/** The entries, as staff or as the guest sees them. */
export function HistoryList({ target, audience }: { target: AdjustTarget; audience: HistoryAudience }) {
  const copy = useCommerceCopy();
  const page = useCommerce().useHistory(target, audience);
  return <HistoryEntries page={page} copy={copy} audience={audience} />;
}

/**
 * One page of history rows, for any reader of commerce/history: the sheet above, or Settings ›
 * Checkout rules with its own copy. `describe` adds staff lines under a row (a changed rule).
 */
export function HistoryEntries({ page, copy, audience, describe }: {
  page: CustomerPage<HistoryEntry>; copy: CommerceCopy; audience: HistoryAudience; describe?: (entry: HistoryEntry) => string[];
}) {
  // A first page Convex splits arrives as "LoadingMore" with nothing yet: still loading, not empty.
  if (page.status === "LoadingFirstPage" || (!page.results.length && page.status === "LoadingMore")) return <Spinner label={copy.t("history.title")} />;
  if (!page.results.length && page.status === "Exhausted") return <p className="text-sm text-muted-foreground">{copy.t("history.empty")}</p>;
  const guest = audience === "guest";
  return (
    <div className="grid gap-3">
      <ol className="grid divide-y divide-border rounded-xl border border-border" aria-label={copy.t(guest ? "history.guestTitle" : "history.title")} data-audience={audience}>
        {page.results.map((entry) => (
          <li key={entry.entryId} className="grid gap-0.5 px-4 py-3" data-testid="history-entry">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
              <p className="min-w-0 text-[15px] font-medium [overflow-wrap:anywhere]">{maskVoucherCodes(guestFactText(entry.fact, copy))}</p>
              <time className="shrink-0 text-xs text-muted-foreground tabular-nums" dateTime={new Date(entry.at).toISOString()}>{formatResort(entry.at, guest ? "d MMM yyyy" : "d MMM yyyy, HH:mm")}</time>
            </div>
            {entry.balance ? <p className="text-sm text-muted-foreground tabular-nums">{balanceText(entry.balance, copy)}</p> : null}
            {!guest && describe ? describe(entry).map((line) => <p key={line} className="text-sm text-muted-foreground [overflow-wrap:anywhere]">{line}</p>) : null}
            {!guest && !describe && entry.fields ? <EntryChanges fields={entry.fields} copy={copy} /> : null}
            {!guest && entry.staff ? <p className="text-xs text-muted-foreground [overflow-wrap:anywhere]" data-testid="history-staff">{staffText(entry.staff, copy)}</p> : null}
          </li>
        ))}
      </ol>
      {page.status === "CanLoadMore" || page.status === "LoadingMore" ? (
        <Button type="button" variant="outline" className="h-11 justify-self-start" disabled={page.status === "LoadingMore"} onClick={() => page.loadMore(20)}>
          {copy.t("history.loadMore")}
        </Button>
      ) : null}
    </div>
  );
}

/** The sheet, opened from a receipt row, package card or voucher card. */
export default function EditHistory({ target, title, onClose, audience: initial = "staff" }: { target: AdjustTarget; title: string; onClose: () => void; audience?: HistoryAudience }) {
  const copy = useCommerceCopy();
  const [audience, setAudience] = useState<HistoryAudience>(initial);
  const noteId = useId();
  const guest = audience === "guest";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      {/* Shown to the guest, the whole screen behind the sheet is covered: no staff names, notes or codes show through (D19). */}
      <CheckoutDialogContent panel className="gap-4 max-md:h-[85dvh] max-md:content-start" data-testid="edit-history" overlayClassName={guest ? GUEST_SCRIM : undefined} data-guest-screen={guest ? "" : undefined}>
        <DialogHeader>
          <DialogTitle className="[overflow-wrap:anywhere]">{guest ? copy.t("history.guestTitle") : title}</DialogTitle>
          <DialogDescription>{guest ? title : copy.t("buttons.editHistory")}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          {guest ? null : (
            <Button type="button" variant="outline" className="h-11" disabled aria-describedby={noteId}>
              <Pencil aria-hidden className="size-4" />{copy.t("buttons.edit")}
            </Button>
          )}
          <Button type="button" variant={guest ? "default" : "outline"} className="h-11" aria-pressed={guest} onClick={() => setAudience(guest ? "staff" : "guest")}>
            {guest ? copy.t("history.showStaff") : copy.t("buttons.showGuest")}
          </Button>
        </div>
        {guest ? null : <p id={noteId} className="text-xs text-muted-foreground">{copy.t("edits.notYet")}</p>}
        <HistoryList key={audience} target={target} audience={audience} />
      </CheckoutDialogContent>
    </Dialog>
  );
}
