"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { BusinessFactsPanel } from "@/components/admin/BusinessFactsPanel";
import { MissingInformationPanel } from "@/components/admin/MissingInformationPanel";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import type { AdminFactProperty } from "@/components/admin/business-facts-form";

// Missing information is the work queue, so it comes first and is where the page opens.
const VIEW_MODES = ["missing", "facts"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const TAB_LABELS: Record<ViewMode, string> = {
  missing: "Missing information",
  facts: "Business facts",
};

/**
 * Staff knowledge workspace: resolve missing-information reports and author approved business
 * facts. Old `?tab=legacy` links fall back to Missing information; the retired Q&A data is kept.
 */
export function BusinessFactsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const mode: ViewMode = VIEW_MODES.includes(tab as ViewMode) ? (tab as ViewMode) : "missing";

  // Active properties scope a fact and gate which facts can resolve a report. properties.adminList
  // returns every property; the panels filter to active ones where it matters.
  const properties = (useQuery(api.properties.adminList, {}) ?? []) as AdminFactProperty[];

  function setMode(next: ViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/admin/questions?${params}`, { scroll: false });
  }

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 sm:px-6">
      {mode === "missing" ? <header><h2 className="font-serif text-2xl font-semibold">Missing information</h2><p className="mt-1 text-sm text-muted-foreground">Help the concierge answer guest questions.</p></header> : null}
      <SegmentedTabs
        id="knowledge"
        label="Knowledge sections"
        tabs={VIEW_MODES.map((value) => ({ value, label: TAB_LABELS[value] }))}
        value={mode}
        onValueChange={setMode}
      />
      <section {...tabPanelProps("knowledge", mode)} className="min-w-0 overflow-hidden rounded-xl border border-border bg-card">
        {mode === "missing" ? <MissingInformationPanel properties={properties} /> : null}
        {mode === "facts" ? <BusinessFactsPanel properties={properties} /> : null}
      </section>
    </div>
  );
}
