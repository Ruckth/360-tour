"use client";

import { api } from "convex/_generated/api";
import type { Doc } from "convex/_generated/dataModel";
import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";
import {
  FactFormDialog,
  type FactFormTarget,
} from "@/components/admin/FactFormDialog";
import { UnknownQuestionsPanel } from "@/components/admin/UnknownQuestionsPanel";

export function QuestionsView() {
  const [mode, setMode] = useState<"facts" | "missing">("facts");
  const [filter, setFilter] =
    useState<Doc<"businessFacts">["status"]>("approved");
  const [target, setTarget] = useState<FactFormTarget | null>(null);
  const { results, status, loadMore } = usePaginatedQuery(
    api.businessFacts.adminList,
    mode === "facts" ? { status: filter } : "skip",
    { initialNumItems: 25 },
  );
  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6">
      <div>
        <h1 className="text-xl font-semibold">Business facts</h1>
        <p className="text-sm text-muted-foreground">
          The concierge looks up relevant facts and current records for each
          question. Saved answers and Q&A are retired.
        </p>
      </div>
      <SegmentedTabs
        id="business-knowledge"
        tabs={[
          { value: "facts", label: "Business facts" },
          { value: "missing", label: "Missing information" },
        ]}
        value={mode}
        onValueChange={setMode}
        label="Business knowledge"
      />
      {mode === "facts" ? (
        <section
          {...tabPanelProps("business-knowledge", "facts")}
          className="rounded-lg border border-border bg-card"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border p-4">
            <Select
              value={filter}
              onValueChange={(value) =>
                setFilter(value as Doc<"businessFacts">["status"])
              }
            >
              <SelectTrigger className="w-40" aria-label="Fact status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["approved", "draft", "archived"] as const).map((value) => (
                  <SelectItem key={value} value={value}>
                    {value}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button onClick={() => setTarget({})}>Add fact</Button>
          </div>
          {status === "LoadingFirstPage" ? (
            <SkeletonRows label="Loading facts" rows={4} />
          ) : results.length === 0 ? (
            <EmptyState>
              No {filter} business facts. Add verified information with its
              source.
            </EmptyState>
          ) : (
            results.map((fact) => (
              <article
                key={fact._id}
                className="flex items-start justify-between gap-4 border-b border-border p-4 last:border-b-0"
              >
                <div className="min-w-0">
                  <h2 className="font-medium">{fact.title}</h2>
                  <p className="mt-1 whitespace-pre-wrap text-sm">
                    {fact.body}
                  </p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Source: {fact.source} · Revision {fact.revision} ·{" "}
                    {fact.propertyId ? "One property" : "All properties"}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setTarget({ fact })}
                >
                  Edit
                </Button>
              </article>
            ))
          )}
          {status === "CanLoadMore" || status === "LoadingMore" ? (
            <Button
              className="m-4"
              variant="outline"
              disabled={status === "LoadingMore"}
              onClick={() => loadMore(25)}
            >
              Load more
            </Button>
          ) : null}
        </section>
      ) : (
        <section {...tabPanelProps("business-knowledge", "missing")}>
          <UnknownQuestionsPanel
            onCreateFact={(unknown) => setTarget({ unknown })}
          />
        </section>
      )}
      <FactFormDialog target={target} onClose={() => setTarget(null)} />
    </div>
  );
}
