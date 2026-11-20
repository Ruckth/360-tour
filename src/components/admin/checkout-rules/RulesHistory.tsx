"use client";

import { usePaginatedQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMemo } from "react";
import { formatMoney } from "@/components/admin/labels";
import { staffDate } from "@/lib/staff-time";
import type { CommerceCopy, HistoryEntry } from "@/components/checkout/backend";
import { historyEntry } from "@/components/checkout/commerce-readers";
import { HistoryEntries } from "@/components/checkout/EditHistory";
import { t } from "./checkout-rules-copy";
import { ruleChangeText } from "./TermsForm";

const copy: CommerceCopy = { t, money: (satang) => formatMoney(satang), date: (at) => staffDate(at) };
const NOTHING = { results: [] as HistoryEntry[], status: "Exhausted" as const, loadMore: () => {} };

/** What changed, before → after, one line per rule or switch. */
const describe = (entry: HistoryEntry) => (entry.ruleChanges ?? []).flatMap((change) => ruleChangeText(change) ?? []);

/**
 * Settings › Checkout rules History (D19, D20): who changed which rule, when and why, newest first,
 * 20 at a time, from the same commerce/history stream every edited item uses. Nothing until the
 * first change creates the settings row.
 */
export function RulesHistory({ settingsId }: { settingsId: Id<"commerceSettings"> | null }) {
  const page = usePaginatedQuery(api.commerce.history.staffPage, settingsId ? { target: { targetType: "settings", targetId: settingsId } } : "skip", { initialNumItems: 20 });
  // Settings changes always carry the owner's own words, so the generic "Other" reason isn't shown.
  const results = useMemo(() => page.results.map((row) => {
    const entry = historyEntry(row);
    return entry.staff ? { ...entry, staff: { ...entry.staff, reason: null } } : entry;
  }), [page.results]);
  if (!settingsId) return <HistoryEntries page={NOTHING} copy={copy} audience="staff" />;
  return <HistoryEntries page={{ results, status: page.status, loadMore: page.loadMore }} copy={copy} audience="staff" describe={describe} />;
}
