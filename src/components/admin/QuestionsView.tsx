"use client";

import { api } from "convex/_generated/api";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Archive, Edit3, HelpCircle, ListChecks, Loader2, Plus, RotateCcw, Search, Star, Trash2, X } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AnswerFormDialog, type AnswerFormTarget } from "@/components/admin/AnswerFormDialog";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { PendingVariantsPanel } from "@/components/admin/PendingVariantsPanel";
import { SuggestionsPanel } from "@/components/admin/SuggestionsPanel";
import { UnknownQuestionsPanel } from "@/components/admin/UnknownQuestionsPanel";
import {
  BulkActionBar,
  SelectCheckbox,
  pluralize,
  useDebounced,
  useSelection,
  useUndoNotice,
} from "@/components/admin/admin-bulk";
import {
  KNOWLEDGE_VIEW_MODES,
  type AdminKnowledgeAnswer,
  type AdminKnowledgePropertyScope,
  type AdminKnowledgeQuestion,
  type AdminPendingVariant,
  type KnowledgeAnswerFilter,
  type KnowledgeAnswerStatus,
  type KnowledgeViewMode,
} from "@/components/admin/admin-knowledge-types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function answersEmptyText(status: KnowledgeAnswerFilter, search: string) {
  if (search) return `No answers match "${search}".`;
  if (status === "all") return "No answers yet. Add one so the chatbot can reply on its own.";
  if (status === "approved") return "No approved answers yet. Add one so the chatbot can reply on its own.";
  return `No ${status} answers.`;
}

function SearchBox({ value, onChange, label }: { value: string; onChange: (value: string) => void; label: string }) {
  return (
    <div className="relative min-w-[14rem] flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={label} aria-label={label} className="pl-9" />
    </div>
  );
}

function LoadMore({ status, onLoadMore }: { status: string; onLoadMore: () => void }) {
  if (status !== "CanLoadMore" && status !== "LoadingMore") return null;
  return (
    <div className="border-t border-border p-3 text-center">
      <Button size="sm" variant="outline" disabled={status === "LoadingMore"} onClick={onLoadMore}>
        {status === "LoadingMore" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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

  function answerStatusTone(status: KnowledgeAnswerStatus) {
    if (status === "approved") return "bg-emerald-600 text-white";
    if (status === "archived") return "bg-muted text-foreground";
    return "bg-amber-600 text-white";
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
        className="h-6 w-6 shrink-0"
        aria-label={`${labelText}: ${question.questionText}`}
        title={labelText}
        disabled={pendingAction === `${action}:${question._id}`}
        onClick={() => void runQuestionAction(action, question)}
      >
        <Icon className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="border-b border-border p-4">
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
            <HelpCircle className="h-4 w-4" />
            Approved knowledge
          </div>
          <h2 className="mt-2 font-serif text-3xl font-semibold text-foreground">Chatbot Knowledge</h2>
          <ToggleGroup value={mode} onValueChange={setMode} aria-label="Knowledge view" className="mt-4 w-fit">
            {KNOWLEDGE_VIEW_MODES.map((option) => (
              <ToggleGroupItem key={option} value={option} className="px-4 capitalize">
                {option === "variants" && variantCount ? `Variants (${variantCount})` : option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

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
                <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Answer status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["approved", "draft", "archived", "all"] satisfies KnowledgeAnswerFilter[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {capitalize(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {pendingVariants && pendingVariants.variants.length > 0 ? (
                <Button type="button" size="sm" variant="outline" onClick={() => setMode("variants")}>
                  <ListChecks className="h-4 w-4" />
                  Review variants ({variantCount})
                </Button>
              ) : null}
              <Button type="button" onClick={() => setAnswerTarget({})} size="sm">
                <Plus className="h-4 w-4" />
                Add answer
              </Button>
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
                  <Archive className="h-4 w-4" />
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
                  <RotateCcw className="h-4 w-4" />
                  Restore
                </Button>
              ) : null}
            </BulkActionBar>
            {answers.status === "LoadingFirstPage" ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading answers
              </div>
            ) : answerRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                {answersEmptyText(answerStatus, answerSearch)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1100px] text-left text-sm">
                  <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="w-10 px-4 py-3">
                        <SelectCheckbox
                          checked={answerSelection.allSelected}
                          indeterminate={answerSelection.someSelected}
                          onChange={answerSelection.toggleAll}
                          label="Select all answers"
                        />
                      </th>
                      <th className="px-4 py-3 font-semibold">Answer</th>
                      <th className="px-4 py-3 font-semibold">Questions</th>
                      <th className="px-4 py-3 font-semibold">Suggested</th>
                      <th className="px-4 py-3 font-semibold">Scope</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {answerRows.map((answer) => {
                      const approvedQuestions = answer.questions
                        .filter((question) => question.status === "approved")
                        .sort((left, right) => Number(right.isPrimary) - Number(left.isPrimary));
                      const suggestedQuestions = answer.questions.filter((question) => question.status === "suggested");
                      const rejectedQuestions = answer.questions.filter((question) => question.status === "rejected");
                      const archived = answer.status === "archived";
                      return (
                        <tr key={answer._id} className="border-b border-border align-top last:border-b-0">
                          <td className="px-4 py-3">
                            <SelectCheckbox
                              checked={answerSelection.isSelected(answer._id)}
                              onChange={() => answerSelection.toggle(answer._id)}
                              label={`Select "${answer.title}"`}
                            />
                          </td>
                          <td className="max-w-[360px] px-4 py-3">
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
                          <td className="max-w-[320px] px-4 py-3 text-muted-foreground">
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
                                <summary className="cursor-pointer">{rejectedQuestions.length} rejected</summary>
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
                          <td className="max-w-[300px] px-4 py-3">
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
                                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
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
                          <td className="px-4 py-3 text-muted-foreground">
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
                              "Global"
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <Badge className={cn("rounded-full", answerStatusTone(answer.status))}>{answer.status}</Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => setAnswerTarget({ answer })}>
                                <Edit3 className="h-4 w-4" />
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
                                  <Trash2 className="h-4 w-4" />
                                  Delete
                                </Button>
                              ) : (
                                <Button
                                  type="button"
                                  variant="secondary"
                                  size="sm"
                                  disabled={pendingAction === `generate:${answer._id}`}
                                  onClick={() => void generateForAnswer(answer)}
                                >
                                  {pendingAction === `generate:${answer._id}` ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Plus className="h-4 w-4" />
                                  )}
                                  Generate
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
            <LoadMore status={answers.status} onLoadMore={() => answers.loadMore(PAGE_SIZE)} />
          </div>
        ) : null}

        {mode === "unknown" ? <UnknownQuestionsPanel onCreateAnswer={(unknown) => setAnswerTarget({ unknown })} /> : null}

        {mode === "variants" ? <PendingVariantsPanel variants={pendingVariants?.variants} /> : null}

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
