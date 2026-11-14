"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { MessageSquare, Plus, RotateCcw } from "lucide-react";
import { MoreMenu } from "@/components/ui/more-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BusinessFactFormDialog,
  type FactFormTarget,
} from "@/components/admin/BusinessFactFormDialog";
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
} from "@/components/admin/admin-bulk";
import { Toast, useToast } from "@/components/ui/toast";
import {
  ChannelIcon,
  formatDateTime,
} from "@/components/admin/admin-chat-format";
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
/** The resolve dropdown's last option: write a new fact from the question instead. */

function statusSummary(group: AdminUnknownGroup): {
  label: string;
  tone: Tone;
} {
  const label = UNKNOWN_STATUSES.filter((status) => group.counts[status] > 0)
    .map((status) =>
      group.counts[status] === group.count
        ? STATUS_LABELS.unknownQuestion[status]
        : `${group.counts[status]} ${STATUS_LABELS.unknownQuestion[status]}`,
    )
    .join(" · ");
  const tone =
    group.counts.new > 0
      ? "warning"
      : group.counts.resolved > 0
        ? "success"
        : "muted";
  return { label, tone };
}

/**
 * Reports of information the concierge could not answer, grouped by identical question. The one
 * dropdown resolves: picking an approved business fact or a structured source resolves the group at
 * once, with Undo, and its last option creates a fact prefilled from the question. Ignore and
 * Reopen sit in each row's ⋯ (Reopen is the button on handled rows).
 */
export function MissingInformationPanel({
  properties,
}: {
  properties: readonly AdminFactProperty[];
}) {
  const router = useRouter();
  const [status, setStatus] = useState<MissingInfoFilter>("new");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [factTarget, setFactTarget] = useState<FactFormTarget | null>(null);

  const result = useQuery(api.chatKnowledge.adminListUnknownGroups, {
    status,
    search: search || undefined,
  }) as { groups: AdminUnknownGroup[]; truncated: boolean } | undefined;
  // Approved facts are the pool for the "link a fact" picker; paginated so the picker stays bounded.
  const approvedFacts = usePaginatedQuery(
    api.businessFacts.adminList,
    { status: "approved" },
    { initialNumItems: 100 },
  );
  const facts = approvedFacts.results as AdminBusinessFact[];
  const resolveGroups = useMutation(
    api.businessFacts.adminResolveUnknownGroups,
  );
  const ignoreGroups = useMutation(api.chatKnowledge.adminIgnoreUnknownGroups);
  const reopenGroups = useMutation(api.chatKnowledge.adminReopenUnknownGroups);
  const undo = useToast();
  const [leftover, setLeftover] = useState<{
    remaining: number;
    remainingIsLowerBound: boolean;
    rerun: () => void;
  } | null>(null);

  const groups = result?.groups ?? [];
  // Filtered to New, a row that is only new needs no "New" badge; mixed rows still say what's what.
  const onlyNew = (group: AdminUnknownGroup) =>
    status === "new" && group.counts.new === group.count;
  const showStatus = !groups.every(onlyNew);
  const selection = useSelection(
    groups.map((group) => group.normalizedQuestion),
  );
  const selectedGroups = groups.filter((group) =>
    selection.isSelected(group.normalizedQuestion),
  );
  const selectedNew = selectedGroups.filter((group) => group.counts.new > 0);
  const selectedClosed = selectedGroups.filter(
    (group) => group.counts.new < group.count,
  );
  const undoAction = (ids: Id<"chatUnknownQuestions">[]) => ({
    label: "Undo",
    run: () => reopenGroups({ unknownQuestionIds: ids }),
  });

  async function run(
    key: string,
    fallback: string,
    action: () => Promise<void>,
  ) {
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

  function offerRerun(
    remaining: number | undefined,
    rerun: () => void,
    remainingIsLowerBound = false,
  ) {
    if (remaining && remaining > 0)
      setLeftover({ remaining, remainingIsLowerBound, rerun });
  }

  async function ignore(keys: string[]) {
    await run(
      `ignore:${keys.join("|")}`,
      "Unable to ignore the reports.",
      async () => {
        const done = await ignoreGroups({ normalizedQuestions: keys });
        selection.clear();
        undo.show(
          `Ignored ${pluralize(done.ignored, "report")}.`,
          undoAction(done.unknownQuestionIds),
        );
        offerRerun(
          done.remaining,
          () => void ignore(keys),
          done.remainingIsLowerBound,
        );
      },
    );
  }

  async function reopen(keys: string[]) {
    await run(
      `reopen:${keys.join("|")}`,
      "Unable to reopen the reports.",
      async () => {
        const done = await reopenGroups({ normalizedQuestions: keys });
        selection.clear();
        undo.show(`Reopened ${pluralize(done.reopened, "report")}.`);
        offerRerun(
          done.remaining,
          () => void reopen(keys),
          done.remainingIsLowerBound,
        );
      },
    );
  }

  /** Resolve one group with the fact or structured source just picked in its dropdown. */
  async function resolve(group: AdminUnknownGroup, value: string) {
    if (!value || pendingAction) return;
    const key = group.normalizedQuestion;
    await run(`resolve:${key}`, "Unable to resolve the report.", async () => {
      const args: {
        normalizedQuestions: string[];
        factId?: Id<"businessFacts">;
        structuredSource?: StructuredSource;
      } = { normalizedQuestions: [key] };
      if (value.startsWith(FACT_PREFIX))
        args.factId = value.slice(FACT_PREFIX.length) as Id<"businessFacts">;
      else if (value.startsWith(STRUCTURED_PREFIX))
        args.structuredSource = value.slice(
          STRUCTURED_PREFIX.length,
        ) as StructuredSource;
      const done = await resolveGroups(args);
      selection.clear();
      const factTitle = args.factId
        ? facts.find((fact) => fact._id === args.factId)?.title
        : undefined;
      const answer =
        factTitle ??
        (args.structuredSource
          ? structuredSourceLabel(args.structuredSource)
          : undefined);
      undo.show(
        `Resolved ${pluralize(done.resolved, "report")}${answer ? ` with “${answer}”` : ""}`,
        undoAction(done.unknownQuestionIds),
      );
      offerRerun(
        done.remaining,
        () => void resolve(group, value),
        done.remainingIsLowerBound,
      );
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
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setStatus("all")}
            >
              Show handled reports
            </Button>
          }
        >
          No new missing-information reports.
        </EmptyState>
      );
    }
    if (status === "all")
      return <EmptyState>No missing-information reports yet.</EmptyState>;
    return (
      <EmptyState
        action={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => setStatus("new")}
          >
            Show new reports
          </Button>
        }
      >
        No {STATUS_LABELS.unknownQuestion[status].toLowerCase()} reports.
      </EmptyState>
    );
  }

  function createFact(question: AdminUnknownGroup["latest"]) {
    setFactTarget({
      fromUnknown: {
        unknownQuestionId: question._id,
        question: question.userQuestion,
        propertyId: question.propertyId,
      },
    });
  }


  return (
    // The tab panel supplies the border; round it too so there is only one surface.
    <Card className="overflow-hidden border-0 shadow-none">
      <div className="grid grid-cols-[minmax(0,1fr)_8rem] items-center gap-2 border-b border-border px-4 py-2 sm:flex">
        <SearchBox
          value={searchInput}
          onChange={setSearchInput}
          label="Search missing-information reports"
          placeholder="Search reports"
          className="min-w-0! [&_input]:w-full sm:max-w-64"
        />
        <div className="flex items-center gap-2">
        <Label htmlFor="missing-status" className="sr-only text-xs text-muted-foreground sm:not-sr-only">Status</Label>
        <Select
          value={status}
          onValueChange={(value) => setStatus(value as MissingInfoFilter)}
        >
          <SelectTrigger
            id="missing-status"
            className="h-9 w-full rounded-lg pointer-coarse:min-h-11 sm:w-40"
            aria-label="Report status"
          >
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
      </div>

      {actionError ? (
        <p
          role="alert"
          className="border-b border-border px-4 py-3 text-sm font-medium text-destructive"
        >
          {actionError}
        </p>
      ) : null}
      <Toast {...undo} />
      {leftover ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-2 text-sm"
        >
          <span className="text-foreground">
            {leftover.remainingIsLowerBound ? "At least " : ""}
            {pluralize(leftover.remaining, "more matching report")}{" "}
            {leftover.remaining === 1 ? "wasn't" : "weren't"} updated.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAction !== ""}
            onClick={leftover.rerun}
          >
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
            onClick={() =>
              void ignore(selectedNew.map((group) => group.normalizedQuestion))
            }
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
            onClick={() =>
              void reopen(
                selectedClosed.map((group) => group.normalizedQuestion),
              )
            }
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
        <div className="lg:overflow-x-auto [&_tbody_td]:lg:align-middle [&_tbody_td]:lg:py-2">
          <table className={STACKED_TABLE.table}>
            <thead className="hidden border-b border-border bg-muted/40 text-xs font-normal text-muted-foreground lg:table-header-group [&_th]:py-0 [&_th]:font-normal [&_label]:pointer-fine:size-8">
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
                <th className={STACKED_TABLE.th}>Resolve</th>
                {showStatus ? (
                  <th className={STACKED_TABLE.th}>Status</th>
                ) : null}
                <th className={cn(STACKED_TABLE.th, "w-14")}>
                  <span className="sr-only">More</span>
                </th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {groups.map((group) => {
                const key = group.normalizedQuestion;
                const question = group.latest;
                const hasNew = group.counts.new > 0;
                const reportPropertyId = question.propertyId;
                return (
                  <tr
                    key={key}
                    className={cn(
                      STACKED_TABLE.row,
                      "max-lg:grid-cols-[2.75rem_minmax(0,1fr)] max-lg:[&>td:first-child]:col-start-1 max-lg:[&>td:nth-child(2)]:col-start-2 max-lg:[&>td:nth-child(3)]:col-span-full",
                      "relative min-h-16 gap-y-2",
                      hasNew && "max-lg:pr-4",
                    )}
                  >
                    <td className={STACKED_TABLE.cell}>
                      <SelectCheckbox
                        checked={selection.isSelected(key)}
                        onChange={() => selection.toggle(key)}
                        label={`Select "${question.userQuestion}"`}
                      />
                    </td>
                    <td className={cn(STACKED_TABLE.cell, "max-lg:pr-8 lg:w-full lg:max-w-[480px]")}>
                      <p className="text-[15px] font-medium leading-5 text-foreground">
                        {/* The guest's own words are content, not explanation (sentence budget). */}
                        <span data-sentence-budget="ignore">
                          {question.userQuestion}
                        </span>
                        {group.count > 1 ? (
                          <Badge
                            variant="secondary"
                            className="ml-2 rounded-full px-2 py-0 text-xs align-middle"
                          >
                            Asked {group.count}×
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(group.latestAt)}
                        {group.channels.map((channel) => (
                          <span
                            key={channel}
                            title={sourceLabel(channel)}
                            className="inline-flex"
                          >
                            <ChannelIcon
                              channel={channel}
                              className="h-3.5 w-3.5"
                            />
                            <span className="sr-only">
                              {sourceLabel(channel)}
                            </span>
                          </span>
                        ))}
                        {question.propertyName ? (
                          <span className="min-w-0 truncate">{question.propertyName}</span>
                        ) : null}
                        {question.detectedTopic ? (
                          <Badge variant="outline" className="text-xs font-normal">{question.detectedTopic}</Badge>
                        ) : null}

                      </p>

                    </td>
                    <td className={cn(STACKED_TABLE.cell, "max-lg:col-span-full")}>
                      {hasNew ? (
                        // Picking is the decision: it resolves at once, and the toast offers Undo. Most
                        // reports need a new fact, so Create fact stays one tap beside it.
                        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 lg:flex">
                          <ResolveFactPicker
                            label={`Resolve "${question.userQuestion}" with a fact or source`}
                            facts={compatibleFacts(facts, reportPropertyId)}
                            disabled={pendingAction !== ""}
                            resolving={pendingAction === `resolve:${key}`}
                            status={approvedFacts.status}
                            loadMore={() => approvedFacts.loadMore(100)}
                            onResolve={next => void resolve(group, next)}
                          />
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            className="h-9 shrink-0 px-2 text-sm font-medium"
                            disabled={pendingAction !== ""}
                            onClick={() => createFact(question)}
                          >
                            <Plus aria-hidden="true" className="h-4 w-4" />
                            Create fact
                          </Button>
                        {question.sessionId ? (
                          <Button asChild variant="ghost" size="sm" className="hidden w-fit px-2 text-sm font-medium lg:inline-flex"><Link
                            href={`/admin/chats?session=${question.sessionId}`}
                          >
                            <MessageSquare
                              aria-hidden="true"
                              className="h-3.5 w-3.5"
                            />
                            Open chat
                          </Link></Button>
                        ) : null}
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
                    {showStatus ? (
                      <td className={STACKED_TABLE.cell}>
                        {onlyNew(group) ? null : (
                          <StatusBadge
                            {...statusSummary(group)}
                            className="whitespace-normal"
                          />
                        )}
                      </td>
                    ) : null}
                    {/* On a phone the ⋯ sits in the card's top corner, beside the question. */}
                    <td
                      className={cn(
                        STACKED_TABLE.cell,
                        hasNew && "max-lg:absolute max-lg:top-2 max-lg:right-2",
                      )}
                    >
                      {/* Handled rows: Reopen is their one action. Rows with new reports: Ignore (and Reopen) in ⋯. */}
                      {!hasNew ? (
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
                      ) : (
                        <MoreMenu
                          label={`More for "${question.userQuestion}"`}
                          disabled={pendingAction !== ""}
                          items={[
                            {
                              label: "Open chat",
                              onSelect: () => router.push(`/admin/chats?session=${question.sessionId}`),
                              hidden: !question.sessionId,
                            },
                            {
                              label: "Ignore",
                              onSelect: () => void ignore([key]),
                            },
                            {
                              label: "Reopen",
                              hidden: group.counts.new === group.count,
                              onSelect: () => void reopen([key]),
                            },
                          ]}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {result.truncated ? (
            <p className="border-t border-border p-3 text-center text-xs text-muted-foreground">
              Showing the newest 500 reports; handle these or search to see
              older ones.
            </p>
          ) : null}
        </div>
      )}

      <BusinessFactFormDialog
        target={factTarget}
        properties={properties}
        onClose={() => setFactTarget(null)}
      />
    </Card>
  );
}

/** Search continues through every approved-fact page, rather than a fixed first 100. */
function ResolveFactPicker({ label, facts, disabled, resolving, status, loadMore, onResolve }: {
  label: string; facts: AdminBusinessFact[]; disabled: boolean; resolving: boolean;
  status: string; loadMore: () => void; onResolve: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    if (open && search.trim() && status === "CanLoadMore") loadMore();
  }, [open, search, status, loadMore]);
  const options = [
    ...facts.map(fact => ({ value: `${FACT_PREFIX}${fact._id}`, label: fact.title })),
    ...STRUCTURED_SOURCES.map(source => ({ value: `${STRUCTURED_PREFIX}${source.value}`, label: `From ${source.label}` })),
  ];
  const filtered = options.filter(option => option.label.toLowerCase().includes(search.toLowerCase()));
  return <div className="min-w-0 lg:w-64"><Combobox items={filtered.map(option => option.value)} filter={null} value={null} modal open={open} onOpenChange={next => { setOpen(next); if (!next) setSearch(""); }} onValueChange={value => { if (value) onResolve(value); }} disabled={disabled}>
    <ComboboxTrigger aria-label={label} render={<Button variant="outline" className="h-10 w-full justify-between font-normal text-muted-foreground pointer-coarse:min-h-11 lg:w-64" />}>
      {resolving ? <span role="status">Resolving…</span> : "Resolve…"}
    </ComboboxTrigger>
    <ComboboxContent className="w-[min(24rem,calc(100vw-2rem))]">
      <ComboboxInput showTrigger={false} aria-label="Search approved facts and sources" placeholder="Search facts and sources" value={search} onChange={event => setSearch(event.target.value)} className="pointer-coarse:min-h-11" />
      {status === "LoadingFirstPage" ? <p role="status" className="p-3 text-sm text-muted-foreground">Loading approved facts…</p> : <ComboboxEmpty className="p-3 text-sm text-muted-foreground">{status === "LoadingMore" ? "Searching more facts…" : "No matching facts or sources."}</ComboboxEmpty>}
      <ComboboxList>{filtered.map(option => <ComboboxItem key={option.value} value={option.value} className="pointer-coarse:min-h-11">{option.label}</ComboboxItem>)}</ComboboxList>
      {status === "CanLoadMore" || status === "LoadingMore" ? <Button variant="ghost" className="w-full" disabled={status === "LoadingMore"} onClick={loadMore}>{status === "LoadingMore" ? "Loading more facts…" : "Load more facts"}</Button> : null}
    </ComboboxContent>
  </Combobox></div>;
}
