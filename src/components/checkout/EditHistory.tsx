"use client";

import { Pencil } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { maskVoucherCodes } from "@/components/display/voucher-mask";
import { guestFactText, useCommerce, type AdjustTarget, type CommerceCopy, type HistoryAudience, type HistoryBalance, type HistoryEntry, type StockReason } from "./backend";
import { CheckoutDialogContent } from "./CheckoutLayers";
import { formatResort } from "./checkout-ui";
import { useCommerceCopy } from "./commerce-copy";

/**
 * Edit · History for one sold or catalogue item (D19): its history, newest first, 20 at a time, with
 * Show guest for the plain-words view the guest may see (journey 12). Read-only until edits ship;
 * Edit is there, switched off, so the sheet keeps its shape when it opens. The guest view is shaped
 * on the server; this screen also never draws staff, notes or a full code in it.
 */

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

/** Who did it and why, for staff only: "By Ploy · Health pause or extension". */
function staffText(staff: NonNullable<HistoryEntry["staff"]>, copy: CommerceCopy) {
  const reason = staff.reason ? copy.t(`edits.${STOCK_REASONS.has(staff.reason) ? "stockReasons" : "reasons"}.${staff.reason}`) : null;
  return [copy.t("history.by", { staff: staff.actorName }), reason, staff.reasonText].filter(Boolean).join(" · ");
}

/** The entries, as staff or as the guest sees them. */
export function HistoryList({ target, audience }: { target: AdjustTarget; audience: HistoryAudience }) {
  const copy = useCommerceCopy();
  const page = useCommerce().useHistory(target, audience);
  if (page.status === "LoadingFirstPage") return <Spinner label={copy.t("history.title")} />;
  if (!page.results.length) return <p className="text-sm text-muted-foreground">{copy.t("history.empty")}</p>;
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
      <CheckoutDialogContent panel className="gap-4" data-testid="edit-history">
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
