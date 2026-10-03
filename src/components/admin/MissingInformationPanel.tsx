"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { MessageSquare, Plus, RotateCcw } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BusinessFactFormDialog, type FactFormTarget } from "@/components/admin/BusinessFactFormDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { StatusBadge } from "@/components/admin/StatusBadge";
import {
  BulkActionBar,
  EmptyState,
  STACKED_TABLE,
  SearchBox,
  SelectCheckbox,
  SkeletonRows,
  pluralize,
  useDebounced,
  useSelection,
  useUndoNotice,
} from "@/components/admin/admin-bulk";
import { ChannelIcon, formatDateTime, truncate } from "@/components/admin/admin-chat-format";
import {
  STRUCTURED_SOURCES,
  compatibleFacts,
  structuredSourceLabel,
  type AdminBusinessFact,
  type AdminFactProperty,
  type StructuredSource,
} from "@/components/admin/business-facts-form";
import type { AdminUnknownGroup } from "@/components/admin/admin-knowledge-types";
import { STATUS_LABELS, sourceLabel } from "@/components/admin/labels";
import type { Tone } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";

const UNKNOWN_STATUSES = ["new", "resolved", "ignored"] as const;
type MissingInfoFilter = (typeof UNKNOWN_STATUSES)[number] | "all";
/** How a report can be resolved from a dropdown: a structured source or an approved fact. */
const STRUCTURED_PREFIX = "source:";
const FACT_PREFIX = "fact:";

function statusSummary(group: AdminUnknownGroup): { label: string; tone: Tone } {
  const label = UNKNOWN_STATUSES.filter((status) => group.counts[status] > 0)
    .map((status) =>
      group.counts[status] === group.count
        ? STATUS_LABELS.unknownQuestion[status]
        : `${group.counts[status]} ${STATUS_LABELS.unknownQuestion[status]}`,
    )
    .join(" · ");
  const tone = group.counts.new > 0 ? "warning" : group.counts.resolved > 0 ? "success" : "muted";
  return { label, tone };
}

/**
 * Reports of information the concierge could not answer, grouped by identical question. Staff
 * resolve a group by linking an approved business fact, pointing to a structured source, or
 * creating a fact prefilled from the question. Groups can also be ignored and reopened.
 */
export function MissingInformationPanel({ properties }: { properties: readonly AdminFactProperty[] }) {
  const [status, setStatus] = useState<MissingInfoFilter>("new");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [rowResolution, setRowResolution] = useState<Record<string, string>>({});
  const [factTarget, setFactTarget] = useState<FactFormTarget | null>(null);

  const result = useQuery(api.chatKnowledge.adminListUnknownGroups, { status, search: search || undefined }) as
    | { groups: AdminUnknownGroup[]; truncated: boolean }
    | undefined;
  // Approved facts are the pool for the "link a fact" picker; paginated so the picker stays bounded.
  const approvedFacts = usePaginatedQuery(
    api.businessFacts.adminList,
    { status: "approved" },
    { initialNumItems: 100 },
  );
  const facts = approvedFacts.results as AdminBusinessFact[];
  const resolveGroups = useMutation(api.businessFacts.adminResolveUnknownGroups);
  const ignoreGroups = useMutation(api.chatKnowledge.adminIgnoreUnknownGroups);
  const reopenGroups = useMutation(api.chatKnowledge.adminReopenUnknownGroups);
  const undo = useUndoNotice();
  const [leftover, setLeftover] = useState<{ remaining: number; rerun: () => void } | null>(null);

  const groups = result?.groups ?? [];
  const selection = useSelection(groups.map((group) => group.normalizedQuestion));
  const selectedGroups = groups.filter((group) => selection.isSelected(group.normalizedQuestion));
  const selectedNew = selectedGroups.filter((group) => group.counts.new > 0);
  const selectedClosed = selectedGroups.filter((group) => group.counts.new < group.count);
  const reopenIds = (ids: Id<"chatUnknownQuestions">[]) => () => reopenGroups({ unknownQuestionIds: ids });

  async function run(key: string, fallback: string, action: () => Promise<void>) {
    setPendingAction(key);
    setActionError("");
    setLeftover(null);
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : fallback);
    } finally {
      setPendingAction("");
    }
  }

  function offerRerun(remaining: number | undefined, rerun: () => void) {
    if (remaining && remaining > 0) setLeftover({ remaining, rerun });
  }

  async function ignore(keys: string[]) {
    await run(`ignore:${keys.join("|")}`, "Unable to ignore the reports.", async () => {
      const done = await ignoreGroups({ normalizedQuestions: keys });
      selection.clear();
      undo.show(`Ignored ${pluralize(done.ignored, "report")}.`, reopenIds(done.unknownQuestionIds));
      offerRerun(done.remaining, () => void ignore(keys));
    });
  }

  async function reopen(keys: string[]) {
    await run(`reopen:${keys.join("|")}`, "Unable to reopen the reports.", async () => {
      const done = await reopenGroups({ normalizedQuestions: keys });
      selection.clear();
      undo.show(`Reopened ${pluralize(done.reopened, "report")}.`);
      offerRerun(done.remaining, () => void reopen(keys));
    });
  }

  /** Resolve one group by the value chosen in its dropdown (an approved fact or a structured source). */
  async function resolve(group: AdminUnknownGroup, value: string) {
    if (!value) return;
    const key = group.normalizedQuestion;
    await run(`resolve:${key}`, "Unable to resolve the report.", async () => {
      const args: {
        normalizedQuestions: string[];
        factId?: Id<"businessFacts">;
        structuredSource?: StructuredSource;
      } = { normalizedQuestions: [key] };
      if (value.startsWith(FACT_PREFIX)) args.factId = value.slice(FACT_PREFIX.length) as Id<"businessFacts">;
      else if (value.startsWith(STRUCTURED_PREFIX))
        args.structuredSource = value.slice(STRUCTURED_PREFIX.length) as StructuredSource;
      const done = await resolveGroups(args);
      selection.clear();
      undo.show(`Resolved ${pluralize(done.resolved, "report")}.`, reopenIds(done.unknownQuestionIds));
      offerRerun(done.remaining, () => void resolve(group, value));
    });
  }

  function emptyState() {
    if (search) {
      return (
        <EmptyState
          action={
            <Button type="button" size="sm" onClick={() => setSearchInput("")}>
              Clear search
            </Button>
          }
        >
          No missing-information reports match &quot;{search}&quot;.
        </EmptyState>
      );
    }
    if (status === "new") {
      return (
        <EmptyState
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setStatus("all")}>
              Show handled reports
            </Button>
          }
        >
          No new missing-information reports. The concierge answered everything it was asked.
        </EmptyState>
      );
    }
    if (status === "all") return <EmptyState>No missing-information reports yet.</EmptyState>;
    return (
      <EmptyState
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setStatus("new")}>
            Show new reports
          </Button>
        }
      >
        No {STATUS_LABELS.unknownQuestion[status].toLowerCase()} reports.
      </EmptyState>
    );
  }

  /** Options for a group's resolve dropdown: compatible approved facts, then structured sources. */
  function resolveOptions(reportPropertyId: Id<"properties"> | undefined) {
    const usable = compatibleFacts(facts, reportPropertyId);
    return (
      <SelectContent>
        {usable.length > 0 ? (
          <>
            {usable.map((fact) => (
              <SelectItem key={fact._id} value={`${FACT_PREFIX}${fact._id}`}>
                {fact.title}
              </SelectItem>
            ))}
          </>
        ) : null}
        {STRUCTURED_SOURCES.map((source) => (
          <SelectItem key={source.value} value={`${STRUCTURED_PREFIX}${source.value}`}>
            From {source.label}
          </SelectItem>
        ))}
      </SelectContent>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <SearchBox value={searchInput} onChange={setSearchInput} label="Search missing-information reports" />
        <Select value={status} onValueChange={(value) => setStatus(value as MissingInfoFilter)}>
          <SelectTrigger className="h-9 w-[10rem] rounded-lg" aria-label="Report status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {UNKNOWN_STATUSES.map((option) => (
              <SelectItem key={option} value={option}>
                {STATUS_LABELS.unknownQuestion[option]}
              </SelectItem>
            ))}
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {actionError ? (
        <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
          {actionError}
        </p>
      ) : null}
      {undo.element}
      {leftover ? (
        <div role="status" className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm">
          <span className="text-foreground">
            {pluralize(leftover.remaining, "more matching report")}{" "}
            {leftover.remaining === 1 ? "wasn't" : "weren't"} updated.
          </span>
          <Button type="button" size="sm" variant="outline" disabled={pendingAction !== ""} onClick={leftover.rerun}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Run again
          </Button>
        </div>
      ) : null}

      <BulkActionBar
        count={selectedGroups.length}
        noun={selectedGroups.length === 1 ? "report" : "reports"}
        onClear={selection.clear}
      >
        {selectedNew.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAction.startsWith("ignore:")}
            onClick={() => void ignore(selectedNew.map((group) => group.normalizedQuestion))}
          >
            Ignore
          </Button>
        ) : null}
        {selectedClosed.length > 0 ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAction.startsWith("reopen:")}
            onClick={() => void reopen(selectedClosed.map((group) => group.normalizedQuestion))}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Reopen
          </Button>
        ) : null}
      </BulkActionBar>

      {result === undefined ? (
        <SkeletonRows label="Loading missing-information reports" />
      ) : groups.length === 0 ? (
        emptyState()
      ) : (
        <div className="lg:overflow-x-auto">
          <table className={STACKED_TABLE.table}>
            <thead className={STACKED_TABLE.head}>
              <tr>
                <th className={cn(STACKED_TABLE.th, "w-10")}>
                  <SelectCheckbox
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onChange={selection.toggleAll}
                    label="Select all reports"
                  />
                </th>
                <th className={STACKED_TABLE.th}>Question</th>
                <th className={STACKED_TABLE.th}>Context</th>
                <th className={STACKED_TABLE.th}>Resolve</th>
                <th className={STACKED_TABLE.th}>Status</th>
                <th className={STACKED_TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {groups.map((group) => {
                const key = group.normalizedQuestion;
                const question = group.latest;
                const hasNew = group.counts.new > 0;
                const reportPropertyId = question.propertyId;
                const value = rowResolution[key] ?? "";
                return (
                  <tr key={key} className={cn(STACKED_TABLE.row, STACKED_TABLE.selectableRow)}>
                    <td className={STACKED_TABLE.cell}>
                      <SelectCheckbox
                        checked={selection.isSelected(key)}
                        onChange={() => selection.toggle(key)}
                        label={`Select "${question.userQuestion}"`}
                      />
                    </td>
                    <td className={cn(STACKED_TABLE.cell, "lg:max-w-[360px]")}>
                      <p className="font-medium text-foreground">
                        {question.userQuestion}
                        {group.count > 1 ? (
                          <Badge variant="secondary" className="ml-2 rounded-full align-middle">
                            Asked {group.count}×
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(group.latestAt)}
                        {group.channels.map((channel) => (
                          <span key={channel} title={sourceLabel(channel)} className="inline-flex">
                            <ChannelIcon channel={channel} className="h-3.5 w-3.5" />
                            <span className="sr-only">{sourceLabel(channel)}</span>
                          </span>
                        ))}
                        {question.sessionId ? (
                          <Link
                            href={`/admin/chats?session=${question.sessionId}`}
                            className="inline-flex items-center gap-1 rounded font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <MessageSquare aria-hidden="true" className="h-3.5 w-3.5" />
                            Open chat
                          </Link>
                        ) : null}
                      </p>
                    </td>
                    <td
                      data-label="Context"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[220px]")}
                    >
                      <p>{question.propertyName ?? question.propertySlug ?? "General"}</p>
                      <p className="mt-1 line-clamp-1 text-xs">
                        {question.detectedTopic ?? "No topic"} · {truncate(question.pageUrl, 60) || "No page"}
                      </p>
                    </td>
                    <td
                      data-label="Resolve"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "lg:min-w-[280px]")}
                    >
                      {hasNew ? (
                        <div className="flex flex-wrap gap-2">
                          <Select
                            value={value}
                            onValueChange={(next) => setRowResolution((current) => ({ ...current, [key]: next }))}
                          >
                            <SelectTrigger
                              className="h-9 min-w-0 flex-1 rounded-lg lg:min-w-[180px]"
                              aria-label={`Resolve "${question.userQuestion}" with a fact or source`}
                            >
                              <SelectValue placeholder="Link a fact or source…" />
                            </SelectTrigger>
                            {resolveOptions(reportPropertyId)}
                          </Select>
                          <DisabledReason reason={value ? undefined : "Choose a fact or source to resolve with"}>
                            <Button
                              type="button"
                              size="sm"
                              variant="secondary"
                              disabled={!value || pendingAction === `resolve:${key}`}
                              onClick={() => void resolve(group, value)}
                            >
                              Resolve
                            </Button>
                          </DisabledReason>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          {question.resolvedFactTitle ??
                            (question.resolvedSource
                              ? `From ${structuredSourceLabel(question.resolvedSource as StructuredSource)}`
                              : "Resolved")}
                        </span>
                      )}
                    </td>
                    <td className={STACKED_TABLE.cell}>
                      <StatusBadge {...statusSummary(group)} className="whitespace-normal" />
                    </td>
                    <td className={STACKED_TABLE.cell}>
                      <div className="flex flex-wrap items-center gap-2">
                        {hasNew ? (
                          <>
                            <Button
                              type="button"
                              size="sm"
                              onClick={() =>
                                setFactTarget({
                                  fromUnknown: {
                                    unknownQuestionId: question._id,
                                    question: question.userQuestion,
                                    propertyId: reportPropertyId,
                                  },
                                })
                              }
                            >
                              <Plus aria-hidden="true" className="h-4 w-4" />
                              Create fact
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={pendingAction === `ignore:${key}`}
                              onClick={() => void ignore([key])}
                            >
                              Ignore
                            </Button>
                          </>
                        ) : null}
                        {group.counts.new < group.count ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={pendingAction === `reopen:${key}`}
                            onClick={() => void reopen([key])}
                          >
                            <RotateCcw aria-hidden="true" className="h-4 w-4" />
                            Reopen
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result.truncated ? (
            <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
              Showing the newest 500 reports. Handle these to see older ones, or search.
            </p>
          ) : null}
        </div>
      )}

      <BusinessFactFormDialog target={factTarget} properties={properties} onClose={() => setFactTarget(null)} />
    </div>
  );
}
