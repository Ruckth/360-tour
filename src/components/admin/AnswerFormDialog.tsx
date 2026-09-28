"use client";

import { api } from "convex/_generated/api";
import { useAction, useMutation, useQuery } from "convex/react";
import { Loader2, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge, RemovableBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { KnowledgePropertyScopeSelector } from "@/components/admin/KnowledgePropertyScopeSelector";
import type {
  AdminKnowledgeAnswer,
  AdminKnowledgePropertyScope,
  AdminUnknownQuestion,
  KnowledgeAnswerStatus,
} from "@/components/admin/admin-knowledge-types";

/**
 * What the dialog edits: an existing answer, a new answer from an unknown question,
 * a new answer prefilled with a guest's question (from a chat), or (empty) a new answer.
 */
export type AnswerFormTarget = {
  answer?: AdminKnowledgeAnswer;
  unknown?: AdminUnknownQuestion;
  question?: string;
};

type AnswerKnowledgeForm = {
  title: string;
  answer: string;
  status: KnowledgeAnswerStatus;
  primaryQuestion: string;
  questions: string[];
  additionalQuestionInput: string;
  topicNames: string[];
  propertySlugs: string[];
};

function emptyKnowledgeForm(): AnswerKnowledgeForm {
  return {
    title: "",
    answer: "",
    status: "approved",
    primaryQuestion: "",
    questions: [],
    additionalQuestionInput: "",
    topicNames: [],
    propertySlugs: [],
  };
}

function formForKnowledgeAnswer(answer: AdminKnowledgeAnswer): AnswerKnowledgeForm {
  const approvedQuestions = answer.questions.filter((question) => question.status === "approved");
  const primaryQuestion =
    approvedQuestions.find((question) => question.isPrimary) ??
    approvedQuestions[0] ??
    null;
  return {
    title: answer.title,
    answer: answer.answer,
    status: answer.status,
    primaryQuestion: primaryQuestion?.questionText ?? "",
    questions: approvedQuestions
      .filter((question) => question._id !== primaryQuestion?._id)
      .map((question) => question.questionText),
    additionalQuestionInput: "",
    topicNames: answer.topics.map((topic) => topic.name),
    propertySlugs:
      answer.propertySlugs ??
      answer.propertyScopes?.map((scope) => scope.propertySlug) ??
      (answer.propertySlug ? [answer.propertySlug] : []),
  };
}

function formForUnknownQuestion(question: AdminUnknownQuestion): AnswerKnowledgeForm {
  return {
    ...emptyKnowledgeForm(),
    title: question.detectedTopic ? `${question.detectedTopic}: ${question.userQuestion}` : question.userQuestion,
    primaryQuestion: question.userQuestion,
    topicNames: question.detectedTopic ? [question.detectedTopic] : [],
    propertySlugs: question.propertySlug ? [question.propertySlug] : [],
  };
}

function topicKey(value: string) {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

/** Pick existing topics or type a new one and press Enter. */
function TopicPicker({ value, onChange }: { value: string[]; onChange: (topics: string[]) => void }) {
  const [query, setQuery] = useState("");
  const topics = useQuery(api.chatKnowledge.adminListTopics, {}) ?? [];
  const selected = new Set(value.map(topicKey));
  const search = topicKey(query);
  const options = topics
    .filter((topic) => !selected.has(topicKey(topic)) && topicKey(topic).includes(search))
    .slice(0, 12);
  const canCreate = Boolean(search) && !selected.has(search) && !topics.some((topic) => topicKey(topic) === search);

  function add(topic: string) {
    const name = topic.trim();
    if (name && !selected.has(topicKey(name))) onChange([...value, name]);
    setQuery("");
  }

  return (
    <div className="grid gap-2">
      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((topic) => (
            <RemovableBadge
              key={topic}
              removeLabel={`Remove ${topic}`}
              onRemove={() => onChange(value.filter((item) => item !== topic))}
            >
              {topic}
            </RemovableBadge>
          ))}
        </div>
      ) : null}
      <Input
        id="knowledge-topics"
        value={query}
        maxLength={80}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const exact = topics.find((topic) => topicKey(topic) === search);
          add(exact ?? options[0] ?? query);
        }}
        placeholder="Search or add a topic"
      />
      {options.length > 0 || canCreate ? (
        <div className="flex flex-wrap gap-1">
          {options.map((topic) => (
            <button key={topic} type="button" onClick={() => add(topic)}>
              <Badge variant="outline" className="cursor-pointer rounded-full hover:bg-muted">
                {topic}
              </Badge>
            </button>
          ))}
          {canCreate ? (
            <button type="button" onClick={() => add(query)}>
              <Badge variant="secondary" className="cursor-pointer rounded-full">
                <Plus className="h-3 w-3" />
                Add &quot;{query.trim()}&quot;
              </Badge>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function AnswerFormDialog({
  target,
  propertyScopes,
  onClose,
}: {
  target: AnswerFormTarget | null;
  propertyScopes: AdminKnowledgePropertyScope[];
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(isOpen) => {
        if (!isOpen) onClose();
      }}
    >
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        {/* Mounted per open, so the form state starts fresh each time. */}
        {target ? <AnswerForm target={target} propertyScopes={propertyScopes} onClose={onClose} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function AnswerForm({
  target,
  propertyScopes,
  onClose,
}: {
  target: AnswerFormTarget;
  propertyScopes: AdminKnowledgePropertyScope[];
  onClose: () => void;
}) {
  const editingAnswer = target.answer ?? null;
  const sourceUnknown = target.unknown ?? null;
  const [form, setForm] = useState<AnswerKnowledgeForm>(() =>
    sourceUnknown
      ? formForUnknownQuestion(sourceUnknown)
      : editingAnswer
        ? formForKnowledgeAnswer(editingAnswer)
        : {
            ...emptyKnowledgeForm(),
            title: target.question?.slice(0, 120) ?? "",
            primaryQuestion: target.question?.slice(0, 240) ?? "",
          },
  );
  const [formError, setFormError] = useState("");
  const [pendingAction, setPendingAction] = useState("");
  const createAnswer = useMutation(api.chatKnowledge.adminCreateAnswer);
  const updateAnswer = useMutation(api.chatKnowledge.adminUpdateAnswer);
  const createPropertyScope = useMutation(api.chatKnowledge.adminCreatePropertyScope);
  const deletePropertyScope = useMutation(api.chatKnowledge.adminDeletePropertyScope);
  const createAnswerFromUnknown = useAction(api.chatKnowledge.adminCreateAnswerFromUnknown);

  function addAdditionalQuestion() {
    const question = form.additionalQuestionInput.trim();
    if (!question) return;
    const normalizedQuestion = question.toLowerCase().replace(/\s+/g, " ");
    const existingQuestions = [form.primaryQuestion, ...form.questions].map((item) =>
      item.trim().toLowerCase().replace(/\s+/g, " "),
    );
    if (existingQuestions.includes(normalizedQuestion)) {
      setForm((current) => ({ ...current, additionalQuestionInput: "" }));
      return;
    }
    setForm((current) => ({
      ...current,
      questions: [...current.questions, question],
      additionalQuestionInput: "",
    }));
  }

  function removeAdditionalQuestion(question: string) {
    setForm((current) => ({
      ...current,
      questions: current.questions.filter((item) => item !== question),
    }));
  }

  async function createKnowledgePropertyScope(slug: string) {
    setPendingAction("create-property-scope");
    setFormError("");
    try {
      const scope = (await createPropertyScope({ slug })) as AdminKnowledgePropertyScope;
      setForm((current) => ({
        ...current,
        propertySlugs: current.propertySlugs.includes(scope.slug)
          ? current.propertySlugs
          : [...current.propertySlugs, scope.slug],
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to add property.");
    } finally {
      setPendingAction("");
    }
  }

  async function deleteKnowledgePropertyScope(slug: string) {
    setPendingAction(`delete-property-scope:${slug}`);
    setFormError("");
    try {
      await deletePropertyScope({ slug });
      setForm((current) => ({
        ...current,
        propertySlugs: current.propertySlugs.filter((item) => item !== slug),
      }));
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to delete property.");
    } finally {
      setPendingAction("");
    }
  }

  async function submitKnowledgeAnswer(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const title = form.title.trim();
    const answer = form.answer.trim();
    if (!title || !answer) {
      setFormError("Title and answer are required.");
      return;
    }
    if (!sourceUnknown && !form.primaryQuestion.trim()) {
      setFormError("Add the primary question guests will ask.");
      return;
    }

    setPendingAction("save-answer");
    try {
      const topicNames = form.topicNames;
      if (sourceUnknown) {
        await createAnswerFromUnknown({
          unknownQuestionId: sourceUnknown._id,
          title,
          answer,
          status: form.status,
          topicNames,
          generateSimilar: true,
        });
      } else if (editingAnswer) {
        await updateAnswer({
          answerId: editingAnswer._id,
          title,
          answer,
          status: form.status,
          topicNames,
          propertySlugs: form.propertySlugs,
          primaryQuestion: form.primaryQuestion.trim(),
          questions: form.questions,
        });
      } else {
        await createAnswer({
          title,
          answer,
          status: form.status,
          primaryQuestion: form.primaryQuestion.trim(),
          questions: form.questions,
          topicNames,
          propertySlugs: form.propertySlugs,
        });
      }
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save answer.");
    } finally {
      setPendingAction("");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {sourceUnknown ? "Create Answer From Unknown" : editingAnswer ? "Edit Answer" : "Add Answer"}
        </DialogTitle>
        <DialogDescription>
          Approved answers are the source of truth. Suggested questions still need approval.
        </DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" onSubmit={submitKnowledgeAnswer}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="grid gap-2">
            <Label htmlFor="knowledge-title">Title</Label>
            <Input
              id="knowledge-title"
              value={form.title}
              onChange={(event) => setForm((current) => ({ ...current, title: event.target.value }))}
              placeholder="Smoking policy"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="knowledge-status">Status</Label>
            <Select
              value={form.status}
              onValueChange={(value) =>
                setForm((current) => ({ ...current, status: value as KnowledgeAnswerStatus }))
              }
            >
              <SelectTrigger id="knowledge-status" className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(["approved", "draft", "archived"] satisfies KnowledgeAnswerStatus[]).map((status) => (
                  <SelectItem key={status} value={status}>
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="knowledge-answer">Answer</Label>
          <textarea
            id="knowledge-answer"
            value={form.answer}
            maxLength={2000}
            onChange={(event) => setForm((current) => ({ ...current, answer: event.target.value }))}
            className="min-h-32 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm transition placeholder:text-muted-foreground/70 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
          />
        </div>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>Properties</Label>
            <KnowledgePropertyScopeSelector
              scopes={propertyScopes}
              selectedSlugs={form.propertySlugs}
              disabled={Boolean(sourceUnknown)}
              pendingAction={pendingAction}
              onChange={(propertySlugs) => setForm((current) => ({ ...current, propertySlugs }))}
              onCreate={(slug) => void createKnowledgePropertyScope(slug)}
              onDelete={(slug) => void deleteKnowledgePropertyScope(slug)}
            />
          </div>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="knowledge-primary-question">Primary question</Label>
          <Input
            id="knowledge-primary-question"
            value={form.primaryQuestion}
            maxLength={240}
            disabled={Boolean(sourceUnknown)}
            onChange={(event) => setForm((current) => ({ ...current, primaryQuestion: event.target.value }))}
            placeholder="Who is the creator of this website?"
          />
        </div>
        {!sourceUnknown ? (
          <div className="grid gap-2">
            <Label htmlFor="knowledge-more-questions">Additional approved questions</Label>
            <div className="flex gap-2">
              <Input
                id="knowledge-more-questions"
                value={form.additionalQuestionInput}
                maxLength={240}
                onChange={(event) =>
                  setForm((current) => ({ ...current, additionalQuestionInput: event.target.value }))
                }
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addAdditionalQuestion();
                  }
                }}
                placeholder="Add another way guests ask this"
              />
              <Button type="button" variant="secondary" size="icon" onClick={addAdditionalQuestion}>
                <Plus className="h-4 w-4" />
                <span className="sr-only">Add question</span>
              </Button>
            </div>
            {form.questions.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {form.questions.map((question) => (
                  <RemovableBadge
                    key={question}
                    removeLabel={`Remove ${question}`}
                    onRemove={() => removeAdditionalQuestion(question)}
                  >
                    {question}
                  </RemovableBadge>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="grid gap-2">
          <Label htmlFor="knowledge-topics">Topics</Label>
          <TopicPicker
            value={form.topicNames}
            onChange={(topicNames) => setForm((current) => ({ ...current, topicNames }))}
          />
        </div>
        {formError ? <p className="text-sm font-medium text-destructive">{formError}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pendingAction === "save-answer"}>
            {pendingAction === "save-answer" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save answer
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
