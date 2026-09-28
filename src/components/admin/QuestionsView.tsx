"use client";

import { api } from "convex/_generated/api";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Archive, Edit3, ListChecks, Plus, RotateCcw, Sparkles, Star, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { AnswerFormDialog, type AnswerFormTarget } from "@/components/admin/AnswerFormDialog";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { PendingVariantsPanel } from "@/components/admin/PendingVariantsPanel";
import { SegmentedTabs, tabPanelProps } from "@/components/admin/SegmentedTabs";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { SuggestionsPanel } from "@/components/admin/SuggestionsPanel";
import { UnknownQuestionsPanel } from "@/components/admin/UnknownQuestionsPanel";
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
import {
  type AdminKnowledgeAnswer,
  type AdminKnowledgePropertyScope,
  type AdminKnowledgeQuestion,
  type AdminPendingVariant,
  type KnowledgeAnswerFilter,
  type KnowledgeViewMode,
  KNOWLEDGE_VIEW_MODES,
} from "@/components/admin/admin-knowledge-types";
import { STATUS_LABELS } from "@/components/admin/labels";
import { statusMeta } from "@/components/admin/status-tones";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
/** adminListAnswers returns at most this many search matches (SEARCH_RESULT_LIMIT in convex/chatKnowledge.ts). */
const ANSWER_SEARCH_LIMIT = 50;
const TAB_LABELS: Record<KnowledgeViewMode, string> = {
  answers: "Answers",
  unknown: "Unknown questions",
  variants: "Variants",
  suggestions: "Suggestions",
};

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function LoadMore({ status, onLoadMore }: { status: string; onLoadMore: () => void }) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") return null;
  return (
    <div className="border-t border-border p-3 text-center">
      <Button size="sm" variant="outline" disabled={status === "LoadingMore"} onClick={onLoadMore}>
        {status === "LoadingMore" ? <Spinner label="Loading more answers" className="text-current" /> : null}
        Load more
      </Button>
    </div>
  );
}

export function QuestionsView() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const confirm = useConfirm();
  const tab = searchParams.get("tab");
  const mode: KnowledgeViewMode = KNOWLEDGE_VIEW_MODES.includes(tab as KnowledgeViewMode)
    ? (tab as KnowledgeViewMode)
    : "answers";
  const [answerStatus, setAnswerStatus] = useState<KnowledgeAnswerFilter>("approved");
  const [answerSearchInput, setAnswerSearchInput] = useState("");
  const answerSearch = useDebounced(answerSearchInput.trim());
  const [answerTarget, setAnswerTarget] = useState<AnswerFormTarget | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const answers = usePaginatedQuery(
    api.chatKnowledge.adminListAnswers,
    mode === "answers"
      ? {
          status: answerStatus === "all" ? undefined : answerStatus,
          search: answerSearch || undefined,
        }
      : "skip",
    { initialNumItems: PAGE_SIZE },
  );
  const pendingVariants = useQuery(api.chatKnowledge.adminListPendingVariants, {}) as
    | { variants: AdminPendingVariant[]; truncated: boolean }
    | undefined;
  const propertyScopes = useQuery(
    api.chatKnowledge.adminListPropertyScopes,
    mode === "answers" || answerTarget !== null ? {} : "skip",
  ) as AdminKnowledgePropertyScope[] | undefined;
  const approveQuestion = useMutation(api.chatKnowledge.adminApproveQuestion);
  const rejectQuestion = useMutation(api.chatKnowledge.adminRejectQuestion);
  const deleteQuestion = useMutation(api.chatKnowledge.adminDeleteQuestion);
  const deleteAnswer = useMutation(api.chatKnowledge.adminDeleteAnswer);
  const setAnswersStatus = useMutation(api.chatKnowledge.adminSetAnswersStatus);
  const generateSimilarQuestions = useAction(api.chatKnowledge.adminGenerateSimilarQuestions);
  const answerRows = answers.results as AdminKnowledgeAnswer[];
  const answerSelection = useSelection(answerRows.map((answer) => answer._id));
  const selectedAnswers = answerRows.filter((answer) => answerSelection.isSelected(answer._id));
  const undo = useUndoNotice();
  const variantCount = pendingVariants
    ? `${pendingVariants.variants.length}${pendingVariants.truncated ? "+" : ""}`
    : "";
  const tabs = KNOWLEDGE_VIEW_MODES.map((value) => ({
    value,
    label:
      value === "variants" && pendingVariants?.variants.length ? (
        <>
          {TAB_LABELS[value]}
          <span className="rounded-full bg-muted px-1.5 text-xs font-semibold text-foreground">{variantCount}</span>
        </>
      ) : (
        TAB_LABELS[value]
      ),
  }));

  function setMode(next: KnowledgeViewMode) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", next);
    router.replace(`/admin/questions?${params}`, { scroll: false });
  }

  /** Runs one row action, tracking it as pending and showing any failure above the table. */
  async function runAction(key: string, fallbackError: string, action: () => Promise<unknown>) {
    setPendingAction(key);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error, fallbackError));
    } finally {
      setPendingAction("");
    }
  }

  async function generateForAnswer(answer: AdminKnowledgeAnswer) {
    await runAction(`generate:${answer._id}`, "Unable to generate similar questions.", () =>
      generateSimilarQuestions({ answerId: answer._id }),
    );
  }

  async function removeAnswer(answer: AdminKnowledgeAnswer) {
    const confirmed = await confirm({
      title: "Delete this answer?",
      description: `"${answer.title}" and all its questions will be removed permanently. Unknown questions linked to it go back to New.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!confirmed) return;
    await runAction(`delete-answer:${answer._id}`, "Unable to delete the answer.", () =>
      deleteAnswer({ answerId: answer._id }),
    );
  }

  async function runQuestionAction(
    action: "approve" | "reject" | "primary" | "delete",
    question: AdminKnowledgeQuestion,
  ) {
    if (action === "delete") {
      const confirmed = await confirm({
        title: "Delete this question?",
        description: `"${question.questionText}" will no longer match this answer.`,
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!confirmed) return;
    }
    await runAction(`${action}:${question._id}`, `Unable to update the question.`, async () => {
      if (action === "approve") await approveQuestion({ questionId: question._id });
      if (action === "reject") await rejectQuestion({ questionId: question._id });
      if (action === "primary") await approveQuestion({ questionId: question._id, isPrimary: true, isAiTrigger: true });
      if (action === "delete") await deleteQuestion({ questionId: question._id });
    });
  }

  /** Archive or restore the selected answers; Undo puts each back to its previous status. */
  async function setSelectedAnswersStatus(status: "archived" | "approved") {
    const answerIds = selectedAnswers
      .filter((answer) => (status === "archived" ? answer.status !== "archived" : answer.status === "archived"))
      .map((answer) => answer._id);
    if (answerIds.length === 0) return;
    await runAction(`bulk:${status}`, "Unable to update the answers.", async () => {
      const { changed } = await setAnswersStatus({ answerIds, status });
      answerSelection.clear();
      undo.show(`${status === "archived" ? "Archived" : "Restored"} ${pluralize(changed.length, "answer")}.`, async () => {
        for (const previous of ["draft", "approved", "archived"] as const) {
          const ids = changed.filter((row) => row.previousStatus === previous).map((row) => row.answerId);
          if (ids.length) await setAnswersStatus({ answerIds: ids, status: previous });
        }
      });
    });
  }

  function answersEmpty() {
    if (answerSearch) {
      return (
        <EmptyState
          action={
            <Button type="button" size="sm" onClick={() => setAnswerSearchInput("")}>
              Clear search
            </Button>
          }
        >
          No {answerStatus === "all" ? "" : `${STATUS_LABELS.answer[answerStatus].toLowerCase()} `}answers match &quot;
          {answerSearch}&quot;.
        </EmptyState>
      );
    }
    if (answerStatus === "draft" || answerStatus === "archived") {
      return (
        <EmptyState
          action={
            <Button type="button" size="sm" onClick={() => setAnswerStatus("all")}>
              Show all answers
            </Button>
          }
        >
          No {answerStatus} answers.
        </EmptyState>
      );
    }
    return (
      <EmptyState
        action={
          <Button type="button" size="sm" onClick={() => setAnswerTarget({})}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add answer
          </Button>
        }
      >
        No {answerStatus === "approved" ? "approved " : ""}answers yet. Add one so the chatbot can reply on its own.
      </EmptyState>
    );
  }

  function iconAction(
    action: "approve" | "primary" | "delete",
    question: AdminKnowledgeQuestion,
    labelText: string,
  ) {
    const Icon = action === "primary" ? Star : action === "delete" ? X : RotateCcw;
    return (
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-7 shrink-0"
        aria-label={`${labelText}: ${question.questionText}`}
        title={labelText}
        disabled={pendingAction === `${action}:${question._id}`}
        onClick={() => void runQuestionAction(action, question)}
      >
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="mx-auto grid w-full max-w-7xl gap-4 px-4 py-4 sm:px-6">
      <SegmentedTabs id="knowledge" tabs={tabs} value={mode} onValueChange={setMode} label="Knowledge sections" />

      <section {...tabPanelProps("knowledge", mode)} className="min-w-0 border border-border bg-card">
        {mode === "answers" && actionError ? (
          <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
            {actionError}
          </p>
        ) : null}
        {mode === "answers" ? undo.element : null}

        {mode === "answers" ? (
          <div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <SearchBox value={answerSearchInput} onChange={setAnswerSearchInput} label="Search answers" />
              <Select value={answerStatus} onValueChange={(value) => setAnswerStatus(value as KnowledgeAnswerFilter)}>
                <SelectTrigger className="h-9 w-[10rem] rounded-lg" aria-label="Answer status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["approved", "draft", "archived"] as const).map((status) => (
                    <SelectItem key={status} value={status}>
                      {STATUS_LABELS.answer[status]}
                    </SelectItem>
                  ))}
                  <SelectItem value="all">All</SelectItem>
                </SelectContent>
              </Select>
              <div className="flex flex-wrap gap-2 sm:ml-auto">
                {pendingVariants && pendingVariants.variants.length > 0 ? (
                  <Button type="button" size="sm" variant="outline" onClick={() => setMode("variants")}>
                    <ListChecks aria-hidden="true" className="h-4 w-4" />
                    Review variants ({variantCount})
                  </Button>
                ) : null}
                <Button type="button" onClick={() => setAnswerTarget({})} size="sm">
                  <Plus aria-hidden="true" className="h-4 w-4" />
                  Add answer
                </Button>
              </div>
            </div>
            <BulkActionBar
              count={selectedAnswers.length}
              noun={selectedAnswers.length === 1 ? "answer" : "answers"}
              onClear={answerSelection.clear}
            >
              {selectedAnswers.some((answer) => answer.status !== "archived") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingAction.startsWith("bulk:")}
                  onClick={() => void setSelectedAnswersStatus("archived")}
                >
                  <Archive aria-hidden="true" className="h-4 w-4" />
                  Archive
                </Button>
              ) : null}
              {selectedAnswers.some((answer) => answer.status === "archived") ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={pendingAction.startsWith("bulk:")}
                  onClick={() => void setSelectedAnswersStatus("approved")}
                >
                  <RotateCcw aria-hidden="true" className="h-4 w-4" />
                  Restore
                </Button>
              ) : null}
            </BulkActionBar>
            {answers.status === "LoadingFirstPage" ? (
              <SkeletonRows label="Loading answers" />
            ) : answerRows.length === 0 ? (
              answersEmpty()
            ) : (
              <div className="lg:overflow-x-auto">
                <table className={STACKED_TABLE.table}>
                  <thead className={STACKED_TABLE.head}>
                    <tr>
                      <th className={cn(STACKED_TABLE.th, "w-10")}>
                        <SelectCheckbox
                          checked={answerSelection.allSelected}
                          indeterminate={answerSelection.someSelected}
                          onChange={answerSelection.toggleAll}
                          label="Select all answers"
                        />
                      </th>
                      <th className={STACKED_TABLE.th}>Answer</th>
                      <th className={STACKED_TABLE.th}>Questions</th>
                      <th className={STACKED_TABLE.th}>Suggested</th>
                      <th className={STACKED_TABLE.th}>Scope</th>
                      <th className={STACKED_TABLE.th}>Status</th>
                      <th className={STACKED_TABLE.th}>Actions</th>
                    </tr>
                  </thead>
                  <tbody className={STACKED_TABLE.body}>
                    {answerRows.map((answer) => {
                      const approvedQuestions = answer.questions
                        .filter((question) => question.status === "approved")
                        .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
                      const suggestedQuestions = answer.questions.filter((question) => question.status === "suggested");
                      const rejectedQuestions = answer.questions.filter((question) => question.status === "rejected");
                      const archived = answer.status === "archived";
                      const generating = pendingAction === `generate:${answer._id}`;
                      return (
                        <tr key={answer._id} className={cn(STACKED_TABLE.row, STACKED_TABLE.selectableRow)}>
                          <td className={STACKED_TABLE.cell}>
                            <SelectCheckbox
                              checked={answerSelection.isSelected(answer._id)}
                              onChange={() => answerSelection.toggle(answer._id)}
                              label={`Select "${answer.title}"`}
                            />
                          </td>
                          <td className={cn(STACKED_TABLE.cell, "lg:max-w-[360px]")}>
                            <p className="font-medium text-foreground">{answer.title}</p>
                            <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">{answer.answer}</p>
                            {answer.topics.length > 0 ? (
                              <div className="mt-2 flex flex-wrap gap-1">
                                {answer.topics.map((topic) => (
                                  <Badge key={topic._id} variant="outline" className="rounded-full">
                                    {topic.name}
                                  </Badge>
                                ))}
                              </div>
                            ) : null}
                          </td>
                          <td
                            data-label="Questions"
                            className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[320px]")}
                          >
                            {approvedQuestions.length > 0 ? (
                              <div className="space-y-1">
                                {approvedQuestions.map((question) => (
                                  <div key={question._id} className="flex items-center gap-1">
                                    <p className="line-clamp-1 flex-1">
                                      {question.isPrimary ? (
                                        <span className="font-medium text-foreground">Primary: </span>
                                      ) : null}
                                      {question.questionText}
                                    </p>
                                    {question.isPrimary ? null : (
                                      <>
                                        {iconAction("primary", question, "Make primary")}
                                        {iconAction("delete", question, "Delete question")}
                                      </>
                                    )}
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <span>No approved questions</span>
                            )}
                            {rejectedQuestions.length > 0 ? (
                              <details className="mt-2 text-xs">
                                <summary className="cursor-pointer rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                                  {rejectedQuestions.length} rejected
                                </summary>
                                <div className="mt-1 space-y-1">
                                  {rejectedQuestions.map((question) => (
                                    <div key={question._id} className="flex items-center gap-1">
                                      <p className="line-clamp-1 flex-1 line-through">{question.questionText}</p>
                                      {iconAction("approve", question, "Restore and approve")}
                                      {iconAction("delete", question, "Delete question")}
                                    </div>
                                  ))}
                                </div>
                              </details>
                            ) : null}
                          </td>
                          <td
                            data-label="Suggested questions"
                            className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "lg:max-w-[300px]")}
                          >
                            {suggestedQuestions.length > 0 ? (
                              <div className="space-y-2">
                                {suggestedQuestions.slice(0, 3).map((question) => (
                                  <div key={question._id} className="rounded-lg border border-border bg-background/70 p-2">
                                    <p className="text-xs leading-5 text-foreground">{question.questionText}</p>
                                    <div className="mt-2 flex gap-2">
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="secondary"
                                        disabled={pendingAction === `approve:${question._id}`}
                                        onClick={() => void runQuestionAction("approve", question)}
                                      >
                                        Approve
                                      </Button>
                                      <Button
                                        type="button"
                                        size="sm"
                                        variant="outline"
                                        disabled={pendingAction === `reject:${question._id}`}
                                        onClick={() => void runQuestionAction("reject", question)}
                                      >
                                        Reject
                                      </Button>
                                    </div>
                                  </div>
                                ))}
                                {suggestedQuestions.length > 3 ? (
                                  <button
                                    type="button"
                                    className="rounded text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    onClick={() => setMode("variants")}
                                  >
                                    +{suggestedQuestions.length - 3} more in Variants
                                  </button>
                                ) : null}
                              </div>
                            ) : (
                              <span className="text-muted-foreground">No pending suggestions</span>
                            )}
                          </td>
                          <td
                            data-label="Scope"
                            className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground")}
                          >
                            {answer.propertyScopes && answer.propertyScopes.length > 0 ? (
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {answer.propertyScopes.slice(0, 3).map((scope) => (
                                  <Badge key={scope.propertySlug} variant="secondary" className="rounded-full">
                                    {scope.label}
                                  </Badge>
                                ))}
                                {answer.propertyScopes.length > 3 ? (
                                  <span className="text-xs">+{answer.propertyScopes.length - 3} more</span>
                                ) : null}
                              </div>
                            ) : (
                              "All properties"
                            )}
                          </td>
                          <td className={STACKED_TABLE.cell}>
                            <StatusBadge {...statusMeta("answer", answer.status)} />
                          </td>
                          <td className={STACKED_TABLE.cell}>
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setAnswerTarget({ answer })}>
                                <Edit3 aria-hidden="true" className="h-4 w-4" />
                                Edit
                              </Button>
                              {archived ? (
                                <Button
                                  type="button"
                                  variant="outline"
                                  size="sm"
                                  className="text-destructive"
                                  disabled={pendingAction === `delete-answer:${answer._id}`}
                                  onClick={() => void removeAnswer(answer)}
                                >
                                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                                  Delete
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={generating}
                                  title="Ask the AI for more ways guests might ask this"
                                  onClick={() => void generateForAnswer(answer)}
                                >
                                  {generating ? (
                                    <Spinner label="Generating questions" className="text-current" />
                                  ) : (
                                    <Sparkles aria-hidden="true" className="h-4 w-4" />
                                  )}
                                  Suggest questions
                                </Button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {answerSearch && answers.status !== "LoadingFirstPage" && answerRows.length >= ANSWER_SEARCH_LIMIT ? (
              <p role="status" className="border-t border-border p-3 text-center text-xs text-muted-foreground">
                Showing the top {ANSWER_SEARCH_LIMIT} matches. Refine your search to find others.
              </p>
            ) : null}
            <LoadMore status={answers.status} onLoadMore={() => answers.loadMore(PAGE_SIZE)} />
          </div>
        ) : null}

        {mode === "unknown" ? <UnknownQuestionsPanel onCreateAnswer={(unknown) => setAnswerTarget({ unknown })} /> : null}

        {mode === "variants" ? (
          <PendingVariantsPanel variants={pendingVariants?.variants} onOpenAnswers={() => setMode("answers")} />
        ) : null}

        {mode === "suggestions" ? <SuggestionsPanel /> : null}
      </section>

      <AnswerFormDialog
        target={answerTarget}
        propertyScopes={propertyScopes ?? []}
        onClose={() => setAnswerTarget(null)}
      />
    </div>
  );
}
