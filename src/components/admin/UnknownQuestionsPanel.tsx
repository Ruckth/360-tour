"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { Link2, Loader2, MessageSquare, Plus, RotateCcw, Search, Sparkles } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BulkActionBar,
  SelectCheckbox,
  pluralize,
  useDebounced,
  useSelection,
  useUndoNotice,
} from "@/components/admin/admin-bulk";
import { ChannelIcon, channelLabel, formatDateTime, truncate } from "@/components/admin/admin-chat-format";
import type {
  AdminUnknownGroup,
  AdminUnknownQuestion,
  UnknownQuestionFilter,
} from "@/components/admin/admin-knowledge-types";

function emptyText(status: UnknownQuestionFilter, search: string) {
  if (search) return `No unknown questions match "${search}".`;
  if (status === "new") return "No new unknown questions. The chatbot answered everything it was asked.";
  if (status === "all") return "No unknown questions yet.";
  return `No ${status} unknown questions.`;
}

function statusSummary(group: AdminUnknownGroup) {
  return (["new", "resolved", "ignored"] as const)
    .filter((status) => group.counts[status] > 0)
    .map((status) => (group.counts[status] === group.count ? status : `${group.counts[status]} ${status}`))
    .join(" · ");
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
  const undo = useUndoNotice();
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
    try {
      await action();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : fallback);
    } finally {
      setPendingAction("");
    }
  }

  const reopenIds = (ids: Id<"chatUnknownQuestions">[]) => () => reopenGroups({ unknownQuestionIds: ids });

  async function ignore(keys: string[]) {
    await run(`ignore:${keys.join("|")}`, "Unable to ignore the questions.", async () => {
      const done = await ignoreGroups({ normalizedQuestions: keys });
      selection.clear();
      undo.show(`Ignored ${pluralize(done.ignored, "question")}.`, reopenIds(done.unknownQuestionIds));
    });
  }

  async function reopen(keys: string[]) {
    await run(`reopen:${keys.join("|")}`, "Unable to reopen the questions.", async () => {
      const done = await reopenGroups({ normalizedQuestions: keys });
      selection.clear();
      undo.show(`Reopened ${pluralize(done.reopened, "question")}.`);
    });
  }

  async function link(keys: string[], answerId: string) {
    if (!answerId) return;
    await run(`link:${keys.join("|")}`, "Unable to link the answer.", async () => {
      const done = await linkGroups({
        normalizedQuestions: keys,
        answerId: answerId as Id<"chatAnswers">,
        generateSimilar: true,
      });
      selection.clear();
      undo.show(
        `Linked ${pluralize(done.linked, "question")} to "${answerTitle(answerId)}".`,
        reopenIds(done.unknownQuestionIds),
      );
    });
  }

  const answerSelectItems = answers.map((answer) => (
    <SelectItem key={answer._id} value={answer._id}>
      {answer.title}
    </SelectItem>
  ));

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <div className="relative min-w-[14rem] flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search unknown questions"
            aria-label="Search unknown questions"
            className="pl-9"
          />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value as UnknownQuestionFilter)}>
          <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Unknown status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["new", "resolved", "ignored", "all"] satisfies UnknownQuestionFilter[]).map((option) => (
              <SelectItem key={option} value={option} className="capitalize">
                {option.charAt(0).toUpperCase() + option.slice(1)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {actionError ? (
        <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
          {actionError}
        </p>
      ) : null}
      {undo.element}

      <BulkActionBar count={selectedGroups.length} noun={selectedGroups.length === 1 ? "group" : "groups"} onClear={selection.clear}>
        {selectedNew.length > 0 ? (
          <>
            <Select value={bulkAnswerId} onValueChange={setBulkAnswerId} disabled={answersLoading || !hasAnswers}>
              <SelectTrigger className="h-9 w-[14rem] rounded-lg bg-background" aria-label="Link selected to answer">
                <SelectValue placeholder="Link to answer…" />
              </SelectTrigger>
              {hasAnswers ? <SelectContent>{answerSelectItems}</SelectContent> : null}
            </Select>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              disabled={!bulkAnswerId || pendingAction.startsWith("link:")}
              onClick={() => void link(selectedNew.map((group) => group.normalizedQuestion), bulkAnswerId)}
            >
              <Link2 className="h-4 w-4" />
              Link
            </Button>
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
            <RotateCcw className="h-4 w-4" />
            Reopen
          </Button>
        ) : null}
      </BulkActionBar>

      {result === undefined ? (
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading unknown questions
        </div>
      ) : groups.length === 0 ? (
        <div className="p-5 text-sm leading-6 text-muted-foreground">{emptyText(status, search)}</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-3">
                  <SelectCheckbox
                    checked={selection.allSelected}
                    indeterminate={selection.someSelected}
                    onChange={selection.toggleAll}
                    label="Select all questions"
                  />
                </th>
                <th className="px-4 py-3 font-semibold">Question</th>
                <th className="px-4 py-3 font-semibold">Context</th>
                <th className="px-4 py-3 font-semibold">Answer</th>
                <th className="px-4 py-3 font-semibold">Status</th>
                <th className="px-4 py-3 font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group) => {
                const key = group.normalizedQuestion;
                const question = group.latest;
                const hasNew = group.counts.new > 0;
                const rowAnswerId = rowAnswerIds[key] ?? group.suggestion?.answerId ?? "";
                const suggested = group.suggestion && rowAnswerId === group.suggestion.answerId;
                return (
                  <tr key={key} className="border-b border-border align-top last:border-b-0">
                    <td className="px-4 py-3">
                      <SelectCheckbox
                        checked={selection.isSelected(key)}
                        onChange={() => selection.toggle(key)}
                        label={`Select "${question.userQuestion}"`}
                      />
                    </td>
                    <td className="max-w-[360px] px-4 py-3">
                      <p className="font-medium text-foreground">
                        {question.userQuestion}
                        {group.count > 1 ? (
                          <Badge variant="secondary" className="ml-2 rounded-full align-middle" title="Times asked">
                            ×{group.count}
                          </Badge>
                        ) : null}
                      </p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {formatDateTime(group.latestAt)}
                        {group.channels.map((channel) => (
                          <span key={channel} title={channelLabel(channel)} className="inline-flex">
                            <ChannelIcon channel={channel} className="h-3.5 w-3.5" />
                            <span className="sr-only">{channelLabel(channel)}</span>
                          </span>
                        ))}
                        {question.sessionId ? (
                          <Link
                            href={`/admin/chats?session=${question.sessionId}`}
                            className="inline-flex items-center gap-1 font-medium text-foreground hover:underline"
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            Open chat
                          </Link>
                        ) : null}
                      </p>
                    </td>
                    <td className="max-w-[260px] px-4 py-3 text-muted-foreground">
                      <p>{question.propertyName ?? question.propertySlug ?? "General"}</p>
                      <p className="mt-1 line-clamp-1 text-xs">
                        {question.detectedTopic ?? "No topic"} · {truncate(question.pageUrl, 60) || "No page"}
                      </p>
                    </td>
                    <td className="min-w-[280px] px-4 py-3">
                      {hasNew ? (
                        <div className="grid gap-1">
                          <div className="flex gap-2">
                            <Select
                              value={rowAnswerId}
                              disabled={answersLoading || !hasAnswers}
                              onValueChange={(value) => setRowAnswerIds((current) => ({ ...current, [key]: value }))}
                            >
                              <SelectTrigger className="h-9 min-w-[180px] rounded-lg" aria-label="Answer to link">
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
                            <Button
                              type="button"
                              size="sm"
                              variant={suggested ? "default" : "secondary"}
                              disabled={!rowAnswerId || pendingAction === `link:${key}`}
                              onClick={() => void link([key], rowAnswerId)}
                            >
                              Link
                            </Button>
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
                    <td className="px-4 py-3">
                      <Badge variant={hasNew ? "default" : "secondary"} className="rounded-full">
                        {statusSummary(group)}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {hasNew ? (
                          <>
                            <Button type="button" size="sm" onClick={() => onCreateAnswer(question)}>
                              <Plus className="h-4 w-4" />
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
                            <RotateCcw className="h-4 w-4" />
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
