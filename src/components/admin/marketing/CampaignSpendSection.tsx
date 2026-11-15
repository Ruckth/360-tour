"use client";

import type { Id } from "convex/_generated/dataModel";
import type { ReportSpend } from "convex/shared/marketingReport";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConfirm } from "../ConfirmDialog";
import { useMarketingAccess } from "./MarketingAccess";
import { RowMenu, UsageBar } from "./MarketingBits";
import { SpendDialog, type SpendDialogProps } from "./SpendDialog";
import { formatRange, marketingErrorText, thb } from "./marketing-format";

type CampaignSpendSectionProps = {
  campaign: { _id: Id<"marketingCampaigns">; name: string; budget?: number };
  /** The campaign's entries; `undefined` while loading. */
  spend?: ReportSpend[];
  onSave: SpendDialogProps["onSave"];
  onDelete: (id: Id<"marketingSpend">) => Promise<void>;
  /** Fixed clock for tests and fixtures. */
  now?: number;
};

/** Newest dates first. */
const byDates = (a: ReportSpend, b: ReportSpend) => b.to.localeCompare(a.to) || b.from.localeCompare(a.from);

/** The Spend section of a saved campaign's editor sheet: entries, total against the budget, add, edit and delete. */
export function CampaignSpendSection({ campaign, spend, onSave, onDelete, now }: CampaignSpendSectionProps) {
  const { capabilities } = useMarketingAccess();
  const id = useId();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<{ entry?: ReportSpend } | null>(null);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const entries = spend ? [...spend].sort(byDates) : [];
  const total = entries.reduce((sum, entry) => sum + entry.amount, 0);
  const budget = campaign.budget || undefined;

  async function remove(entry: ReportSpend) {
    if (!capabilities.spend) return;
    const confirmed = await confirm({
      title: `Delete ${thb(entry.amount)} of spend?`,
      description: `${formatRange(entry.from, entry.to)}. It leaves every report; the change history keeps it.`,
      confirmLabel: "Delete spend",
      destructive: true,
    });
    if (!confirmed) return;
    try {
      await onDelete(entry.id);
      setMessage({ text: "Spend deleted" });
    } catch (error) {
      setMessage({ text: marketingErrorText(error, "Couldn’t delete the spend."), error: true });
    }
  }

  return (
    <section aria-labelledby={`${id}-title`} className="grid gap-2">
      <div className="flex items-center gap-2">
        <h3 id={`${id}-title`} className="flex-1 text-base font-semibold text-foreground">
          Spend {spend ? <span className="text-sm font-normal tabular-nums text-muted-foreground">{entries.length}</span> : null}
        </h3>
        {capabilities.spend ? <Button type="button" size="sm" variant="outline" disabled={!spend} onClick={() => setDialog({})}>
          <Plus aria-hidden className="size-4" />
          Add spend
        </Button> : null}
      </div>
      <p className="text-xs text-muted-foreground">ROAS uses spend for the same dates. Without spend, ROAS is unavailable, never 0×.</p>

      {spend === undefined ? (
        <div role="status" className="grid gap-2">
          <span className="sr-only">Loading spend</span>
          <Skeleton className="h-14 w-full" />
        </div>
      ) : entries.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">No spend yet.{capabilities.spend ? " Add it when the invoice arrives." : ""}</p>
      ) : (
        <div className="rounded-lg border border-border">
          <ul className="divide-y divide-border" aria-label={`Spend for ${campaign.name}`}>
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start gap-1 pe-1">
                <button
                  type="button"
                  disabled={!capabilities.spend}
                  onClick={() => setDialog({ entry })}
                  className="grid min-w-0 flex-1 grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2.5 text-left text-sm hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring sm:grid-cols-[9.5rem_minmax(0,1fr)_auto]"
                >
                  <span className="text-muted-foreground">{formatRange(entry.from, entry.to)}</span>
                  <span className="col-start-1 row-start-2 min-w-0 truncate text-foreground sm:col-start-2 sm:row-start-1">
                    {entry.note || <span className="text-muted-foreground">No note</span>}
                  </span>
                  <span className="col-start-2 row-start-1 text-right font-semibold tabular-nums text-foreground sm:col-start-3">{thb(entry.amount)}</span>
                </button>
                {capabilities.spend ? <RowMenu
                  label={`Actions for spend ${formatRange(entry.from, entry.to)}`}
                  className="mt-1"
                  actions={[
                    { label: "Edit", icon: Pencil, onSelect: () => setDialog({ entry }) },
                    { label: "Delete", icon: Trash2, destructive: true, onSelect: () => void remove(entry) },
                  ]}
                /> : null}
              </li>
            ))}
          </ul>
          <div className="grid gap-2 border-t border-border px-3 py-2.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-muted-foreground">{budget ? `Total of ${thb(budget)} budget` : "Total"}</span>
              <span className="font-semibold tabular-nums text-foreground">
                {thb(total)}
                {budget ? <span className="font-normal text-muted-foreground"> ({Math.round((total / budget) * 100)}%)</span> : null}
              </span>
            </div>
            {budget ? <UsageBar used={total} limit={budget} label="Spend against budget" /> : null}
            {budget && total > budget ? <p className="text-xs text-destructive">{thb(total - budget)} over budget</p> : null}
          </div>
        </div>
      )}

      <div aria-live="polite" className={message ? undefined : "sr-only"}>
        {message ? (
          <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm font-medium text-destructive" : "text-xs text-muted-foreground"}>
            {message.text}
          </p>
        ) : null}
      </div>

      <SpendDialog
        open={capabilities.spend && dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
        campaigns={[{ id: campaign._id, name: campaign.name }]}
        entry={dialog?.entry}
        defaults={{ campaignId: campaign._id }}
        onSave={async (draft) => {
          await onSave(draft);
          setMessage({ text: draft.id ? "Spend saved" : `Added ${thb(draft.amount)} of spend` });
        }}
        onDelete={async (spendId) => {
          await onDelete(spendId);
          setMessage({ text: "Spend deleted" });
        }}
        now={now}
      />
    </section>
  );
}
