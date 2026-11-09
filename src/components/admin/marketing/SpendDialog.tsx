"use client";

import type { Id } from "convex/_generated/dataModel";
import type { ReportSpend, SpendDraft } from "convex/lib/marketingReport";

/**
 * Release 3b contract: add or edit one spend entry. Used from the campaign sheet's Spend section and
 * from the dashboard's "Add spend". Validation is `validateSpend` from convex/lib/marketingReport.
 * Layout follows the "Add spend" dialog in docs/previews/marketing/src/dashboard.html and the
 * "Edit · spend" state in coupons-campaigns.html. The spend UI package replaces this stub.
 */
export type SpendDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Campaigns to choose from. With exactly one (opened from its campaign sheet) the picker is hidden. */
  campaigns: { id: Id<"marketingCampaigns">; name: string }[];
  /** The entry being edited; absent = add. */
  entry?: ReportSpend;
  /** Prefill when adding. Default: this month so far in Bangkok, the first campaign, no amount. */
  defaults?: Partial<SpendDraft>;
  /** Resolves when saved; rejects with the server's message, which the dialog shows. */
  onSave: (draft: SpendDraft & { id?: Id<"marketingSpend"> }) => Promise<void>;
  /** Shown only when editing. */
  onDelete?: (id: Id<"marketingSpend">) => Promise<void>;
  /** Fixed clock for tests and fixtures. */
  now?: number;
};

export function SpendDialog(_props: SpendDialogProps) {
  return null;
}
