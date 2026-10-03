"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import { useRouter, useSearchParams } from "next/navigation";
import { BusinessFactsPanel } from "@/components/admin/BusinessFactsPanel";
import { LegacyArchivePanel } from "@/components/admin/LegacyArchivePanel";
import { MissingInformationPanel } from "@/components/admin/MissingInformationPanel";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import type { AdminFactProperty } from "@/components/admin/business-facts-form";

const VIEW_MODES = ["facts", "missing", "legacy"] as const;
type ViewMode = (typeof VIEW_MODES)[number];
const TAB_LABELS: Record<ViewMode, string> = {
  facts: "Business facts",
  missing: "Missing information",
  legacy: "Legacy archive",
};

/**
 * Staff knowledge workspace: author approved business facts, resolve missing-information reports,
 * and read the retired Q&A archive. Replaces the old Auto Answers / Q&A / variant authoring.
 */
export function BusinessFactsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tab = searchParams.get("tab");
  const mode: ViewMode = VIEW_MODES.includes(tab as ViewMode) ? (tab as ViewMode) : "facts";

  // Active properties scope a fact and gate which facts can resolve a report. properties.adminList
  // returns every property; the panels filter to active ones where it matters.
  const properties = (useQuery(api.properties.adminList, {}) ?? []) as AdminFactProperty[];

  function setMode(next: ViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/admin/questions?${params}`, { scroll: false });
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6">
      <SegmentedTabs
        id="knowledge"
        label="Knowledge sections"
        tabs={VIEW_MODES.map((value) => ({ value, label: TAB_LABELS[value] }))}
        value={mode}
        onValueChange={setMode}
      />
      <section {...tabPanelProps("knowledge", mode)} className="min-w-0 border border-border bg-card">
        {mode === "facts" ? <BusinessFactsPanel properties={properties} /> : null}
        {mode === "missing" ? <MissingInformationPanel properties={properties} /> : null}
        {mode === "legacy" ? <LegacyArchivePanel /> : null}
      </section>
    </div>
  );
}
