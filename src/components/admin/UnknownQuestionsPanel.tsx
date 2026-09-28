"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReference } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { Link2, MessageSquare, Plus, RotateCcw, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import type {
  AdminUnknownGroup,
  AdminUnknownQuestion,
  UnknownQuestionFilter,
} from "@/components/admin/admin-knowledge-types";
import { STATUS_LABELS, sourceLabel } from "@/components/admin/labels";
import type { Tone } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";

const UNKNOWN_STATUSES = ["new", "resolved", "ignored"] as const;

/** What adminUndoLinkUnknownGroups needs to restore the questions and the answer's question list. */
type LinkUndo = {
  unknownQuestionIds: Id<"chatUnknownQuestions">[];
  questionChanges: { questionId: Id<"chatQuestions">; previousStatus: "approved" | "suggested" | "rejected" | null }[];
};

// TODO(merge): the bulk mutations will return `remaining` (and link returns `undo`); drop the optional widening then.
type WithRemaining<T> = T & { remaining?: number };

/** "New", or "2 New · 1 Resolved" for groups whose questions are in different states. */
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
 * Unknown questions grouped by identical text. Each group is answered, ignored or reopened as a whole,
 * one at a time or many at once, with the best-matching existing answer pre-selected.
 */
export function UnknownQuestionsPanel({ onCreateAnswer }: { onCreateAnswer: (question: AdminUnknownQuestion) => void }) {
  const [status, setStatus] = useState<UnknownQuestionFilter>("new");
  const [searchInput, setSearchInput] = useState("");
  const search = useDebounced(searchInput.trim());
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [rowAnswerIds, setRowAnswerIds] = useState<Record<string, string>>({});
  const [bulkAnswerId, setBulkAnswerId] = useState("");
  const result = useQuery(api.chatKnowledge.adminListUnknownGroups, { status, search: search || undefined }) as
    | { groups: AdminUnknownGroup[]; truncated: boolean }
    | undefined;
  const answerOptions = useQuery(api.chatKnowledge.adminListAnswerOptions, {});
  const ignoreGroups = useMutation(api.chatKnowledge.adminIgnoreUnknownGroups);
  const reopenGroups = useMutation(api.chatKnowledge.adminReopenUnknownGroups);
  const linkGroups = useMutation(api.chatKnowledge.adminLinkUnknownGroups);
  // TODO(merge): typed after backend merge; use api.chatKnowledge.adminUndoLinkUnknownGroups directly.
  const undoLinkGroups = useMutation(
    (api.chatKnowledge as unknown as { adminUndoLinkUnknownGroups: FunctionReference<"mutation", "public", LinkUndo> })
      .adminUndoLinkUnknownGroups,
  );
  const undo = useUndoNotice();
  const [leftover, setLeftover] = useState<{ remaining: number; rerun: () => void } | null>(null);
  const groups = result?.groups ?? [];
  const selection = useSelection(groups.map((group) => group.normalizedQuestion));
  const selectedGroups = groups.filter((group) => selection.isSelected(group.normalizedQuestion));
  const selectedNew = selectedGroups.filter((group) => group.counts.new > 0);
  const selectedClosed = selectedGroups.filter((group) => group.counts.new < group.count);
  const answers = answerOptions ?? [];
  const answersLoading = answerOptions === undefined;
  const hasAnswers = answers.length > 0;
  const answerTitle = (answerId: string) => answers.find((answer) => answer._id === answerId)?.title ?? "the answer";

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

  /** Bulk actions stop at a per-call limit; offer to repeat the action for whatever is left. */
  function offerRerun(remaining: number | undefined, rerun: () => void) {
    if (remaining && remaining > 0) setLeftover({ remaining, rerun });
  }

  const reopenIds = (ids: Id<"chatUnknownQuestions">[]) => () => reopenGroups({ unknownQuestionIds: ids });

  async function ignore(keys: string[]) {
    await run(`ignore:${keys.join("|")}`, "Unable to ignore the questions.", async () => {
      const done: WithRemaining<{ ignored: number; unknownQuestionIds: Id<"chatUnknownQuestions">[] }> =
        await ignoreGroups({ normalizedQuestions: keys });
      selection.clear();
      undo.show(`Ignored ${pluralize(done.ignored, "question")}.`, reopenIds(done.unknownQuestionIds));
      offerRerun(done.remaining, () => void ignore(keys));
    });
  }

  async function reopen(keys: string[]) {
    await run(`reopen:${keys.join("|")}`, "Unable to reopen the questions.", async () => {
      const done: WithRemaining<{ reopened: number }> = await reopenGroups({ normalizedQuestions: keys });
      selection.clear();
      undo.show(`Reopened ${pluralize(done.reopened, "question")}.`);
      offerRerun(done.remaining, () => void reopen(keys));
    });
  }

  async function link(keys: string[], answerId: string) {
    if (!answerId) return;
    await run(`link:${keys.join("|")}`, "Unable to link the answer.", async () => {
      const done: WithRemaining<{
        linked: number;
        unknownQuestionIds: Id<"chatUnknownQuestions">[];
        undo?: LinkUndo;
      }> = await linkGroups({
        normalizedQuestions: keys,
        answerId: answerId as Id<"chatAnswers">,
        generateSimilar: true,
      });
      selection.clear();
      const undoPayload = done.undo;
      undo.show(
        `Linked ${pluralize(done.linked, "question")} to "${answerTitle(answerId)}".`,
        // Undo removes the questions the link added to the answer, not just the resolved status.
        undoPayload ? () => undoLinkGroups(undoPayload) : reopenIds(done.unknownQuestionIds),
      );
      offerRerun(done.remaining, () => void link(keys, answerId));
    });
  }

  const answerSelectItems = answers.map((answer) => (
    <SelectItem key={answer._id} value={answer._id}>
      {answer.title}
    </SelectItem>
  ));
  const noAnswersHint = answersLoading ? "Loading answers" : hasAnswers ? undefined : "Add an approved answer first";
  const linkHint = (answerId: string) => (answerId ? undefined : (noAnswersHint ?? "Choose an answer to link first"));

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
          No unknown questions match &quot;{search}&quot;.
        </EmptyState>
      );
    }
    if (status === "new") {
      return (
        <EmptyState
          action={
            <Button type="button" size="sm" variant="outline" onClick={() => setStatus("all")}>
              Show handled questions
            </Button>
          }
        >
          No new unknown questions. The chatbot answered everything it was asked.
        </EmptyState>
      );
    }
    if (status === "all") return <EmptyState>No unknown questions yet.</EmptyState>;
    return (
      <EmptyState
        action={
          <Button type="button" size="sm" variant="outline" onClick={() => setStatus("new")}>
            Show new questions
          </Button>
        }
      >
        No {STATUS_LABELS.unknownQuestion[status].toLowerCase()} unknown questions.
      </EmptyState>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <SearchBox value={searchInput} onChange={setSearchInput} label="Search unknown questions" />
        <Select value={status} onValueChange={(value) => setStatus(value as UnknownQuestionFilter)}>
          <SelectTrigger className="h-9 w-[10rem] rounded-lg" aria-label="Unknown status">
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
            {pluralize(leftover.remaining, "more matching question")}{" "}
            {leftover.remaining === 1 ? "wasn't" : "weren't"} updated.
          </span>
          <Button type="button" size="sm" variant="outline" disabled={pendingAction !== ""} onClick={leftover.rerun}>
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Run again
          </Button>
        </div>
      ) : null}

      <BulkActionBar count={selectedGroups.length} noun={selectedGroups.length === 1 ? "group" : "groups"} onClear={selection.clear}>
        {selectedNew.length > 0 ? (
          <>
            <Select value={bulkAnswerId} onValueChange={setBulkAnswerId} disabled={answersLoading || !hasAnswers}>
              <SelectTrigger
                className="h-9 w-[14rem] rounded-lg bg-background"
                aria-label="Link selected to answer"
                title={noAnswersHint}
              >
                <SelectValue placeholder={hasAnswers || answersLoading ? "Link to answer…" : "No approved answers"} />
              </SelectTrigger>
              {hasAnswers ? <SelectContent>{answerSelectItems}</SelectContent> : null}
            </Select>
            <DisabledReason reason={linkHint(bulkAnswerId)}>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={!bulkAnswerId || pendingAction.startsWith("link:")}
                onClick={() => void link(selectedNew.map((group) => group.normalizedQuestion), bulkAnswerId)}
              >
                <Link2 aria-hidden="true" className="h-4 w-4" />
                Link
              </Button>
            </DisabledReason>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={pendingAction.startsWith("ignore:")}
              onClick={() => void ignore(selectedNew.map((group) => group.normalizedQuestion))}
            >
              Ignore
            </Button>
          </>
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
        <SkeletonRows label="Loading unknown questions" />
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
                    label="Select all questions"
                  />
                </th>
                <th className={STACKED_TABLE.th}>Question</th>
                <th className={STACKED_TABLE.th}>Context</th>
                <th className={STACKED_TABLE.th}>Answer</th>
                <th className={STACKED_TABLE.th}>Status</th>
                <th className={STACKED_TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {groups.map((group) => {
                const key = group.normalizedQuestion;
                const question = group.latest;
                const hasNew = group.counts.new > 0;
                const rowAnswerId = rowAnswerIds[key] ?? group.suggestion?.answerId ?? "";
                const suggested = group.suggestion && rowAnswerId === group.suggestion.answerId;
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
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[260px]")}
                    >
                      <p>{question.propertyName ?? question.propertySlug ?? "General"}</p>
                      <p className="mt-1 line-clamp-1 text-xs">
                        {question.detectedTopic ?? "No topic"} · {truncate(question.pageUrl, 60) || "No page"}
                      </p>
                    </td>
                    <td
                      data-label="Answer"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "lg:min-w-[280px]")}
                    >
                      {hasNew ? (
                        <div className="grid gap-1">
                          <div className="flex gap-2">
                            <Select
                              value={rowAnswerId}
                              disabled={answersLoading || !hasAnswers}
                              onValueChange={(value) => setRowAnswerIds((current) => ({ ...current, [key]: value }))}
                            >
                              <SelectTrigger
                                className="h-9 min-w-0 flex-1 rounded-lg lg:min-w-[180px]"
                                aria-label="Answer to link"
                                title={noAnswersHint}
                              >
                                <SelectValue
                                  placeholder={
                                    answersLoading
                                      ? "Loading answers"
                                      : hasAnswers
                                        ? "Select answer"
                                        : "No approved answers"
                                  }
                                />
                              </SelectTrigger>
                              {hasAnswers ? <SelectContent>{answerSelectItems}</SelectContent> : null}
                            </Select>
                            <DisabledReason reason={linkHint(rowAnswerId)}>
                              <Button
                                type="button"
                                size="sm"
                                variant={suggested ? "default" : "secondary"}
                                disabled={!rowAnswerId || pendingAction === `link:${key}`}
                                onClick={() => void link([key], rowAnswerId)}
                              >
                                Link
                              </Button>
                            </DisabledReason>
                          </div>
                          {suggested && group.suggestion ? (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Sparkles className="h-3 w-3" aria-hidden="true" />
                              Best match ({group.suggestion.score}%)
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-muted-foreground">
                          {question.resolvedAnswerTitle ?? "No linked answer"}
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
                            <Button type="button" size="sm" onClick={() => onCreateAnswer(question)}>
                              <Plus aria-hidden="true" className="h-4 w-4" />
                              Create answer
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
              Showing the newest 500 questions. Handle these to see older ones, or search.
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}
