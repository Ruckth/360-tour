"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { Edit3, HelpCircle, Loader2, Plus } from "lucide-react";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AnswerFormDialog, type AnswerFormTarget } from "@/components/admin/AnswerFormDialog";
import { formatDateTime, truncate } from "@/components/admin/admin-chat-format";
import type {
  AdminKnowledgeAnswer,
  AdminKnowledgePropertyScope,
  AdminKnowledgeQuestion,
  AdminUnknownQuestion,
  KnowledgeAnswerFilter,
  KnowledgeAnswerStatus,
  KnowledgeViewMode,
  UnknownQuestionFilter,
} from "@/components/admin/admin-knowledge-types";
import { cn } from "@/lib/utils";

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export function QuestionsView() {
  const [mode, setMode] = useState<KnowledgeViewMode>("answers");
  const [answerStatus, setAnswerStatus] = useState<KnowledgeAnswerFilter>("approved");
  const [unknownStatus, setUnknownStatus] = useState<UnknownQuestionFilter>("new");
  const [answerTarget, setAnswerTarget] = useState<AnswerFormTarget | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const [linkAnswerIds, setLinkAnswerIds] = useState<Record<string, string>>({});
  const answers = useQuery(
    api.chatKnowledge.adminListAnswers,
    mode === "answers"
      ? {
          status: answerStatus === "all" ? undefined : answerStatus,
          limit: 100,
        }
      : mode === "unknown"
        ? { status: "approved", limit: 100 }
        : "skip",
  ) as AdminKnowledgeAnswer[] | undefined;
  const unknownQuestions = useQuery(
    api.chatKnowledge.adminListUnknownQuestions,
    mode === "unknown" ? { status: unknownStatus, limit: 100 } : "skip",
  ) as AdminUnknownQuestion[] | undefined;
  const propertyScopes = useQuery(
    api.chatKnowledge.adminListPropertyScopes,
    mode === "answers" || answerTarget !== null ? {} : "skip",
  ) as AdminKnowledgePropertyScope[] | undefined;
  const approveQuestion = useMutation(api.chatKnowledge.adminApproveQuestion);
  const rejectQuestion = useMutation(api.chatKnowledge.adminRejectQuestion);
  const ignoreUnknown = useMutation(api.chatKnowledge.adminIgnoreUnknown);
  const resolveUnknownWithAnswer = useAction(api.chatKnowledge.adminResolveUnknownWithAnswer);
  const generateSimilarQuestions = useAction(api.chatKnowledge.adminGenerateSimilarQuestions);
  const answerRows = answers ?? [];
  const unknownRows = unknownQuestions ?? [];
  const linkableAnswersLoading = mode === "unknown" && answers === undefined;
  const hasLinkableAnswers = answerRows.length > 0;

  function openCreateAnswer() {
    setAnswerTarget({});
  }

  function openEditAnswer(answer: AdminKnowledgeAnswer) {
    setAnswerTarget({ answer });
  }

  function openCreateFromUnknown(question: AdminUnknownQuestion) {
    setAnswerTarget({ unknown: question });
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

  async function runAnswerAction(action: string, answer: AdminKnowledgeAnswer) {
    await runAction(`${action}:${answer._id}`, "Unable to generate similar questions.", async () => {
      if (action === "generate") {
        await generateSimilarQuestions({ answerId: answer._id });
      }
    });
  }

  async function runQuestionAction(action: string, question: AdminKnowledgeQuestion) {
    await runAction(`${action}:${question._id}`, `Unable to ${action} the question.`, async () => {
      if (action === "approve") await approveQuestion({ questionId: question._id });
      if (action === "reject") await rejectQuestion({ questionId: question._id });
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

  async function ignoreUnknownQuestion(question: AdminUnknownQuestion) {
    await runAction(`ignore:${question._id}`, "Unable to ignore the question.", () =>
      ignoreUnknown({ unknownQuestionId: question._id }),
    );
  }

  function answerStatusTone(status: KnowledgeAnswerStatus) {
    if (status === "approved") return "bg-emerald-600 text-white";
    if (status === "archived") return "bg-muted text-foreground";
    return "bg-amber-600 text-white";
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <section className="border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border p-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gold">
              <HelpCircle className="h-4 w-4" />
              Approved knowledge
            </div>
            <h2 className="mt-2 font-serif text-3xl font-semibold text-foreground">
              Chatbot Knowledge
            </h2>
            <ToggleGroup value={mode} onValueChange={setMode} aria-label="Knowledge view" className="mt-4 w-fit">
              {(["answers", "unknown"] satisfies KnowledgeViewMode[]).map((option) => (
                <ToggleGroupItem key={option} value={option} className="px-4 capitalize">
                  {option}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {mode === "answers" ? (
              <>
                <Select
                  value={answerStatus}
                  onValueChange={(value) => setAnswerStatus(value as KnowledgeAnswerFilter)}
                >
                  <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Answer status">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(["approved", "draft", "archived", "all"] satisfies KnowledgeAnswerFilter[]).map((status) => (
                      <SelectItem key={status} value={status}>
                        {status}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button type="button" onClick={openCreateAnswer} size="sm">
                  <Plus className="h-4 w-4" />
                  Add answer
                </Button>
              </>
            ) : null}
            {mode === "unknown" ? (
              <Select
                value={unknownStatus}
                onValueChange={(value) => setUnknownStatus(value as UnknownQuestionFilter)}
              >
                <SelectTrigger className="h-10 w-[10rem] rounded-lg" aria-label="Unknown status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(["new", "resolved", "ignored", "all"] satisfies UnknownQuestionFilter[]).map((status) => (
                    <SelectItem key={status} value={status}>
                      {status}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
          </div>
        </div>

        {actionError ? (
          <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
            {actionError}
          </p>
        ) : null}

        {mode === "answers" ? (
          <div>
            {!answers ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading answers
              </div>
            ) : null}
            {answers && answerRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No approved answers match this filter yet.
              </div>
            ) : null}
            {answerRows.length > 0 ? (
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
                      const approvedQuestions = answer.questions.filter((question) => question.status === "approved");
                      const suggestedQuestions = answer.questions.filter((question) => question.status === "suggested");
                      return (
                        <tr key={answer._id} className="border-b border-border last:border-b-0">
                          <td className="max-w-[360px] px-4 py-3">
                            <p className="font-medium text-foreground">{answer.title}</p>
                            <p className="mt-1 line-clamp-3 text-xs leading-5 text-muted-foreground">
                              {answer.answer}
                            </p>
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
                          <td className="max-w-[300px] px-4 py-3 text-muted-foreground">
                            {approvedQuestions.length > 0 ? (
                              <div className="space-y-1">
                                {approvedQuestions.slice(0, 4).map((question) => (
                                  <p key={question._id} className="line-clamp-1">
                                    {question.isPrimary ? "Primary: " : ""}
                                    {question.questionText}
                                  </p>
                                ))}
                                {approvedQuestions.length > 4 ? (
                                  <p className="text-xs">+{approvedQuestions.length - 4} more</p>
                                ) : null}
                              </div>
                            ) : (
                              <span>No approved questions</span>
                            )}
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
                              </div>
                            ) : (
                              <span className="text-muted-foreground">No pending suggestions</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-muted-foreground">
                            {answer.propertyScopes && answer.propertyScopes.length > 0 ? (
                              <div className="flex max-w-[220px] flex-wrap gap-1">
                                {answer.propertyScopes.slice(0, 3).map((scope) => (
                                  <Badge key={scope.slug} variant="secondary" className="rounded-full">
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
                            <Badge className={cn("rounded-full", answerStatusTone(answer.status))}>
                              {answer.status}
                            </Badge>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-2">
                              <Button type="button" variant="outline" size="sm" onClick={() => openEditAnswer(answer)}>
                                <Edit3 className="h-4 w-4" />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                disabled={pendingAction === `generate:${answer._id}`}
                                onClick={() => void runAnswerAction("generate", answer)}
                              >
                                {pendingAction === `generate:${answer._id}` ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <Plus className="h-4 w-4" />
                                )}
                                Generate
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

        {mode === "unknown" ? (
          <div>
            {!unknownQuestions ? (
              <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading unknown questions
              </div>
            ) : null}
            {unknownQuestions && unknownRows.length === 0 ? (
              <div className="p-5 text-sm leading-6 text-muted-foreground">
                No unknown questions match this filter.
              </div>
            ) : null}
            {unknownRows.length > 0 ? (
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
                          <p className="mt-1 text-xs text-muted-foreground">
                            {formatDateTime(question.createdAt)}
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
                                  setLinkAnswerIds((current) => ({
                                    ...current,
                                    [question._id]: value,
                                  }))
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
                                    {answerRows.map((answer) => (
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
                              <Button type="button" size="sm" onClick={() => openCreateFromUnknown(question)}>
                                <Plus className="h-4 w-4" />
                                Create answer
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={pendingAction === `ignore:${question._id}`}
                                onClick={() => void ignoreUnknownQuestion(question)}
                              >
                                Ignore
                              </Button>
                            </div>
                          ) : (
                            <span className="text-muted-foreground">{formatDateTime(question.updatedAt)}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        ) : null}

      </section>

      <AnswerFormDialog
        target={answerTarget}
        propertyScopes={propertyScopes ?? []}
        onClose={() => setAnswerTarget(null)}
      />
    </div>
  );
}
