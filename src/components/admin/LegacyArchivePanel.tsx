"use client";

import { api } from "convex/_generated/api";
import { usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SegmentedTabs } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { EmptyState, STACKED_TABLE, SkeletonRows } from "@/components/admin/admin-bulk";
import type { AdminCuratedSuggestion, AdminKnowledgeAnswer } from "@/components/admin/admin-knowledge-types";
import { statusMeta } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
const LEGACY_SECTIONS = ["answers", "suggestions"] as const;
type LegacySection = (typeof LEGACY_SECTIONS)[number];
const SECTION_LABELS: Record<LegacySection, string> = {
  answers: "Saved answers",
  suggestions: "Curated suggestions",
};

/**
 * Read-only view of the retired Q&A system: saved answers and curated suggestions. These records
 * are kept for reference and audit only — there is nothing to create, edit, approve, restore,
 * generate, translate or delete here. Authoring moved to Business facts.
 */
export function LegacyArchivePanel() {
  const [section, setSection] = useState<LegacySection>("answers");
  return (
    <div>
      <div className="border-b border-border px-4 py-3">
        <p className="text-sm text-muted-foreground">
          The old saved answers and curated suggestions are kept here read-only for reference. The concierge no
          longer uses them — add verified information under <span className="font-medium text-foreground">Business facts</span>.
        </p>
      </div>
      <SegmentedTabs
        id="legacy-archive"
        className="px-4"
        label="Legacy archive sections"
        tabs={LEGACY_SECTIONS.map((value) => ({ value, label: SECTION_LABELS[value] }))}
        value={section}
        onValueChange={setSection}
      />
      {section === "answers" ? <LegacyAnswers /> : <LegacySuggestions />}
    </div>
  );
}

function LegacyAnswers() {
  const answers = usePaginatedQuery(api.chatKnowledge.adminListAnswers, {}, { initialNumItems: PAGE_SIZE });
  const rows = answers.results as AdminKnowledgeAnswer[];

  if (answers.status === "LoadingFirstPage") return <SkeletonRows label="Loading saved answers" />;
  if (rows.length === 0) return <EmptyState>No saved answers remain in the archive.</EmptyState>;

  return (
    <>
      <div className="lg:overflow-x-auto">
        <table className={STACKED_TABLE.table}>
          <thead className={STACKED_TABLE.head}>
            <tr>
              <th className={STACKED_TABLE.th}>Answer</th>
              <th className={STACKED_TABLE.th}>Questions</th>
              <th className={STACKED_TABLE.th}>Status</th>
            </tr>
          </thead>
          <tbody className={STACKED_TABLE.body}>
            {rows.map((answer) => {
              const approved = answer.questions.filter((question) => question.status === "approved");
              return (
                <tr key={answer._id} className={STACKED_TABLE.row}>
                  <td className={cn(STACKED_TABLE.cell, "lg:max-w-[420px]")}>
                    <p className="font-medium text-foreground">{answer.title}</p>
                    <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{answer.answer}</p>
                  </td>
                  <td
                    data-label="Questions"
                    className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[320px]")}
                  >
                    {approved.length > 0 ? (
                      <ul className="space-y-1">
                        {approved.slice(0, 4).map((question) => (
                          <li key={question._id} className="line-clamp-1">
                            {question.questionText}
                          </li>
                        ))}
                        {approved.length > 4 ? <li className="text-xs">+{approved.length - 4} more</li> : null}
                      </ul>
                    ) : (
                      <span>No approved questions</span>
                    )}
                  </td>
                  <td className={STACKED_TABLE.cell}>
                    <StatusBadge {...statusMeta("answer", answer.status)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {answers.status === "CanLoadMore" || answers.status === "LoadingMore" ? (
        <div className="border-t border-border p-3 text-center">
          <Button
            size="sm"
            variant="outline"
            disabled={answers.status === "LoadingMore"}
            onClick={() => answers.loadMore(PAGE_SIZE)}
          >
            {answers.status === "LoadingMore" ? <Spinner label="Loading more answers" className="text-current" /> : null}
            Load more
          </Button>
        </div>
      ) : null}
    </>
  );
}

function LegacySuggestions() {
  const suggestions = useQuery(api.chatSuggestions.adminListCurated, { status: "all", limit: 100 }) as
    | AdminCuratedSuggestion[]
    | undefined;

  if (suggestions === undefined) return <SkeletonRows label="Loading curated suggestions" />;
  if (suggestions.length === 0) return <EmptyState>No curated suggestions remain in the archive.</EmptyState>;

  return (
    <div className="lg:overflow-x-auto">
      <table className={STACKED_TABLE.table}>
        <thead className={STACKED_TABLE.head}>
          <tr>
            <th className={STACKED_TABLE.th}>Suggestion</th>
            <th className={STACKED_TABLE.th}>Topic</th>
            <th className={STACKED_TABLE.th}>Status</th>
          </tr>
        </thead>
        <tbody className={STACKED_TABLE.body}>
          {suggestions.map((suggestion) => (
            <tr key={suggestion._id} className={STACKED_TABLE.row}>
              <td className={cn(STACKED_TABLE.cell, "lg:max-w-[420px]")}>
                <p className="font-medium text-foreground">{suggestion.question}</p>
                {suggestion.answer ? (
                  <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{suggestion.answer}</p>
                ) : null}
              </td>
              <td data-label="Topic" className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground")}>
                <div className="flex flex-wrap items-center gap-1">
                  <Badge variant="outline" className="rounded-full">
                    {suggestion.topic}
                  </Badge>
                  {suggestion.answerMode ? (
                    <Badge variant="secondary" className="rounded-full">
                      {suggestion.answerMode}
                    </Badge>
                  ) : null}
                </div>
              </td>
              <td className={STACKED_TABLE.cell}>
                <StatusBadge
                  tone={suggestion.status === "active" ? "success" : "muted"}
                  label={suggestion.status === "active" ? "Active" : "Archived"}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
