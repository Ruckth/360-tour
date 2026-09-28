"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useAction, useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { Edit3, HelpCircle, Loader2, MessageSquare, Plus, RotateCcw, Search, Star, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AnswerFormDialog, type AnswerFormTarget } from "@/components/admin/AnswerFormDialog";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { SuggestionsPanel } from "@/components/admin/SuggestionsPanel";
import { formatDateTime, truncate } from "@/components/admin/admin-chat-format";
import {
  KNOWLEDGE_VIEW_MODES,
  type AdminKnowledgeAnswer,
  type AdminKnowledgePropertyScope,
  type AdminKnowledgeQuestion,
  type AdminUnknownQuestion,
  type KnowledgeAnswerFilter,
  type KnowledgeAnswerStatus,
  type KnowledgeViewMode,
  type UnknownQuestionFilter,
} from "@/components/admin/admin-knowledge-types";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function useDebounced<T>(value: T, delay = 250) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timeout = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timeout);
  }, [value, delay]);
  return debounced;
}

function answersEmptyText(status: KnowledgeAnswerFilter, search: string) {
  if (search) return `No answers match "${search}".`;
  if (status === "all") return "No answers yet. Add one so the chatbot can reply on its own.";
  if (status === "approved") return "No approved answers yet. Add one so the chatbot can reply on its own.";
  return `No ${status} answers.`;
}

function unknownEmptyText(status: UnknownQuestionFilter, search: string) {
  if (search) return `No unknown questions match "${search}".`;
  if (status === "new") return "No new unknown questions. The chatbot answered everything it was asked.";
  if (status === "all") return "No unknown questions yet.";
  return `No ${status} unknown questions.`;
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
  const [unknownStatus, setUnknownStatus] = useState<UnknownQuestionFilter>("new");
  const [answerSearchInput, setAnswerSearchInput] = useState("");
  const [unknownSearchInput, setUnknownSearchInput] = useState("");
  const answerSearch = useDebounced(answerSearchInput.trim());
  const unknownSearch = useDebounced(unknownSearchInput.trim());
  const [answerTarget, setAnswerTarget] = useState<AnswerFormTarget | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [linkAnswerIds, setLinkAnswerIds] = useState<Record<string, string>>({});
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
  const unknownQuestions = usePaginatedQuery(
    api.chatKnowledge.adminListUnknownQuestions,
    mode === "unknown" ? { status: unknownStatus, search: unknownSearch || undefined } : "skip",
    { initialNumItems: PAGE_SIZE },
  );
  const answerOptions = useQuery(api.chatKnowledge.adminListAnswerOptions, mode === "unknown" ? {} : "skip");
  const propertyScopes = useQuery(
    api.chatKnowledge.adminListPropertyScopes,
    mode === "answers" || answerTarget !== null ? {} : "skip",
  ) as AdminKnowledgePropertyScope[] | undefined;
  const approveQuestion = useMutation(api.chatKnowledge.adminApproveQuestion);
  const rejectQuestion = useMutation(api.chatKnowledge.adminRejectQuestion);
  const deleteQuestion = useMutation(api.chatKnowledge.adminDeleteQuestion);
  const deleteAnswer = useMutation(api.chatKnowledge.adminDeleteAnswer);
  const ignoreUnknown = useMutation(api.chatKnowledge.adminIgnoreUnknown);
  const reopenUnknown = useMutation(api.chatKnowledge.adminReopenUnknown);
  const resolveUnknownWithAnswer = useAction(api.chatKnowledge.adminResolveUnknownWithAnswer);
  const generateSimilarQuestions = useAction(api.chatKnowledge.adminGenerateSimilarQuestions);
  const answerRows = answers.results as AdminKnowledgeAnswer[];
  const unknownRows = unknownQuestions.results as AdminUnknownQuestion[];
  const linkableAnswers = answerOptions ?? [];
  const linkableAnswersLoading = mode === "unknown" && answerOptions === undefined;
  const hasLinkableAnswers = linkableAnswers.length > 0;

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

  async function linkUnknownQuestion(question: AdminUnknownQuestion) {
    const answerId = linkAnswerIds[question._id];
    if (!answerId) return;
    await runAction(`link:${question._id}`, "Unable to link the answer.", () =>
      resolveUnknownWithAnswer({
        unknownQuestionId: question._id,
        answerId: answerId as Id<"chatAnswers">,
        generateSimilar: true,
      }),
    );
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
                {option}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>

        {mode !== "suggestions" && actionError ? (
          <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
            {actionError}
          </p>
        ) : null}

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
              <Button type="button" onClick={() => setAnswerTarget({})} size="sm">
                <Plus className="h-4 w-4" />
                Add answer
              </Button>
            </div>
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
                                  <p className="text-xs text-muted-foreground">+{suggestedQuestions.length - 3} more</p>
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

        {mode === "unknown" ? (
          <div>
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
              <SearchBox value={unknownSearchInput} onChange={setUnknownSearchInput} label="Search unknown questions" />
              <Select value={unknownStatus} onValueChange={(value) => setUnknownStatus(value as UnknownQuestionFilter)}>
                <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Unknown status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["new", "resolved", "ignored", "all"] satisfies UnknownQuestionFilter[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {capitalize(status)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {unknownQuestions.status === "LoadingFirstPage" ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading unknown questions
              </div>
            ) : unknownRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                {unknownEmptyText(unknownStatus, unknownSearch)}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1080px] text-left text-sm">
                  <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
                    <tr>
                      <th className="px-4 py-3 font-semibold">Question</th>
                      <th className="px-4 py-3 font-semibold">Context</th>
                      <th className="px-4 py-3 font-semibold">Link Existing</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {unknownRows.map((question) => (
                      <tr key={question._id} className="border-b border-border last:border-b-0">
                        <td className="max-w-[360px] px-4 py-3">
                          <p className="font-medium text-foreground">{question.userQuestion}</p>
                          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                            {formatDateTime(question.createdAt)}
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
                        <td className="max-w-[280px] px-4 py-3 text-muted-foreground">
                          <p>{question.propertyName ?? question.propertySlug ?? "General"}</p>
                          <p className="mt-1 line-clamp-1 text-xs">
                            {question.detectedTopic ?? "No topic"} · {truncate(question.pageUrl, 72) || "No page"}
                          </p>
                        </td>
                        <td className="min-w-[260px] px-4 py-3">
                          {question.status === "new" ? (
                            <div className="flex gap-2">
                              <Select
                                value={linkAnswerIds[question._id] ?? ""}
                                disabled={linkableAnswersLoading || !hasLinkableAnswers}
                                onValueChange={(value) =>
                                  setLinkAnswerIds((current) => ({ ...current, [question._id]: value }))
                                }
                              >
                                <SelectTrigger className="h-9 min-w-[180px] rounded-lg" aria-label="Link answer">
                                  <SelectValue
                                    placeholder={
                                      linkableAnswersLoading
                                        ? "Loading answers"
                                        : hasLinkableAnswers
                                          ? "Select answer"
                                          : "No approved answers"
                                    }
                                  />
                                </SelectTrigger>
                                {hasLinkableAnswers ? (
                                  <SelectContent>
                                    {linkableAnswers.map((answer) => (
                                      <SelectItem key={answer._id} value={answer._id}>
                                        {answer.title}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                ) : null}
                              </Select>
                              <Button
                                type="button"
                                size="sm"
                                variant="secondary"
                                disabled={
                                  !hasLinkableAnswers ||
                                  !linkAnswerIds[question._id] ||
                                  pendingAction === `link:${question._id}`
                                }
                                onClick={() => void linkUnknownQuestion(question)}
                              >
                                Link
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">
                              {question.resolvedAnswerTitle ?? "No linked answer"}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={question.status === "new" ? "default" : "secondary"} className="rounded-full">
                            {question.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          {question.status === "new" ? (
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" size="sm" onClick={() => setAnswerTarget({ unknown: question })}>
                                <Plus className="h-4 w-4" />
                                Create answer
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingAction === `ignore:${question._id}`}
                                onClick={() =>
                                  void runAction(`ignore:${question._id}`, "Unable to ignore the question.", () =>
                                    ignoreUnknown({ unknownQuestionId: question._id }),
                                  )
                                }
                              >
                                Ignore
                              </Button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap items-center gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingAction === `reopen:${question._id}`}
                                onClick={() =>
                                  void runAction(`reopen:${question._id}`, "Unable to reopen the question.", () =>
                                    reopenUnknown({ unknownQuestionId: question._id }),
                                  )
                                }
                              >
                                <RotateCcw className="h-4 w-4" />
                                Reopen
                              </Button>
                              <span className="text-xs text-muted-foreground">{formatDateTime(question.updatedAt)}</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <LoadMore status={unknownQuestions.status} onLoadMore={() => unknownQuestions.loadMore(PAGE_SIZE)} />
          </div>
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
