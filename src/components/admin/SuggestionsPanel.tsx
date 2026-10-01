"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { supportedSuggestionLocales } from "convex/lib/chatSuggestions";
import { useAction, useMutation, useQuery } from "convex/react";
import { Archive, Edit3, Languages, Plus, RotateCcw, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Badge } from "@/components/ui/badge";
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
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConfirm } from "@/components/admin/ConfirmDialog";
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
  useSelection,
  useUndoNotice,
} from "@/components/admin/admin-bulk";
import {
  CURATED_DYNAMIC_INTENTS,
  CURATED_TOPICS,
  type AdminCuratedSuggestion,
  type AdminKnowledgePropertyScope,
  type CuratedAnswerMode,
  type CuratedDynamicIntent,
  type CuratedSuggestionStatus,
} from "@/components/admin/admin-knowledge-types";
import { cn } from "@/lib/utils";

type StatusFilter = CuratedSuggestionStatus | "all";

const ALL_PROPERTIES = "__all__";
const TRANSLATION_LOCALES = supportedSuggestionLocales.filter((locale) => locale !== "en");
const LOCALE_LABELS: Record<string, string> = {
  th: "Thai",
  "zh-CN": "Chinese",
  ja: "Japanese",
  ko: "Korean",
  fr: "French",
  de: "German",
  es: "Spanish",
  ru: "Russian",
  it: "Italian",
  hi: "Hindi",
};

function label(value: string) {
  return value.replace(/_/g, " ");
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/** Languages still missing for the question or, for fixed replies, the answer (mirrors the server check). */
function missingLocaleCount(row: AdminCuratedSuggestion) {
  const needsAnswer = (row.answerMode ?? (row.answer ? "static" : "dynamic")) === "static" && Boolean(row.answer);
  return TRANSLATION_LOCALES.filter(
    (locale) => !row.translations?.[locale]?.trim() || (needsAnswer && !row.answerTranslations?.[locale]?.trim()),
  ).length;
}

/** Curated chat chips: the question bank guests can tap, with fixed or live answers. */
export function SuggestionsPanel() {
  const confirm = useConfirm();
  const [status, setStatus] = useState<StatusFilter>("active");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<AdminCuratedSuggestion | "new" | null>(null);
  const [pendingAction, setPendingAction] = useState("");
  const [actionError, setActionError] = useState("");
  const suggestions = useQuery(api.chatSuggestions.adminListCurated, { status, limit: 100 }) as
    | AdminCuratedSuggestion[]
    | undefined;
  const propertyScopes = useQuery(api.chatKnowledge.adminListPropertyScopes, {}) as
    | AdminKnowledgePropertyScope[]
    | undefined;
  const archiveCurated = useMutation(api.chatSuggestions.adminArchiveCurated);
  const restoreCurated = useMutation(api.chatSuggestions.adminRestoreCurated);
  const deleteCurated = useMutation(api.chatSuggestions.adminDeleteArchivedCurated);
  const setCuratedStatus = useMutation(api.chatSuggestions.adminSetCuratedStatus);
  const translateMissing = useAction(api.chatSuggestions.adminTranslateMissingCurated);
  const [translateProgress, setTranslateProgress] = useState<{ done: number; failed: number; left: number } | null>(
    null,
  );
  const undo = useUndoNotice();
  const properties = (propertyScopes ?? []).filter((scope) => scope.source === "property");
  const propertyNames = new Map(properties.map((property) => [property.slug, property.label]));
  const query = search.trim().toLowerCase();
  const rows = (suggestions ?? []).filter(
    (row) =>
      !query ||
      [row.question, row.answer ?? "", row.topic, ...Object.values(row.translations ?? {})]
        .join(" ")
        .toLowerCase()
        .includes(query),
  );
  const selection = useSelection(rows.map((row) => row._id));
  const selectedRows = rows.filter((row) => selection.isSelected(row._id));
  const missingCount = (suggestions ?? []).filter(
    (row) => row.status === "active" && missingLocaleCount(row) > 0,
  ).length;

  async function setSelectedStatus(next: CuratedSuggestionStatus) {
    const questionIds = selectedRows.filter((row) => row.status !== next).map((row) => row._id);
    if (questionIds.length === 0) return;
    await runAction(`bulk:${next}`, async () => {
      const { changedIds } = await setCuratedStatus({ questionIds, status: next });
      selection.clear();
      undo.show(
        `${next === "archived" ? "Archived" : "Restored"} ${pluralize(changedIds.length, "suggestion")}.`,
        () => setCuratedStatus({ questionIds: changedIds, status: next === "archived" ? "active" : "archived" }),
      );
    });
  }

  /** Translates every active suggestion missing a language, a few per server call, with live progress. */
  async function translateAllMissing() {
    setActionError("");
    const skipIds: Id<"curatedChatQuestions">[] = [];
    const progress = { done: 0, failed: 0, left: missingCount };
    setTranslateProgress({ ...progress });
    try {
      for (;;) {
        const batch = await translateMissing({ skipIds });
        skipIds.push(...batch.processedIds);
        progress.done += batch.translated;
        progress.failed += batch.failed;
        progress.left = batch.remaining;
        setTranslateProgress({ ...progress });
        if (batch.processedIds.length === 0 || batch.remaining === 0) break;
      }
      undo.show(
        `Translated ${pluralize(progress.done, "suggestion")}${progress.failed ? `, ${progress.failed} failed` : ""}.`,
      );
    } catch (error) {
      setActionError(errorMessage(error, "Unable to translate suggestions."));
    } finally {
      setTranslateProgress(null);
    }
  }

  async function runAction(key: string, action: () => Promise<unknown>) {
    setPendingAction(key);
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(errorMessage(error, "Something went wrong."));
    } finally {
      setPendingAction("");
    }
  }

  async function deleteSuggestion(row: AdminCuratedSuggestion) {
    const confirmed = await confirm({
      title: "Delete this suggestion?",
      description: `"${row.question}" and its click history will be removed permanently.`,
      confirmLabel: "Delete",
      destructive: true,
    });
    if (confirmed) await runAction(`delete:${row._id}`, () => deleteCurated({ questionId: row._id }));
  }

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <SearchBox value={search} onChange={setSearch} label="Search suggestions" />
        <Select value={status} onValueChange={(value) => setStatus(value as StatusFilter)}>
          <SelectTrigger className="h-9 w-[10rem] rounded-lg" aria-label="Suggestion status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="archived">Archived</SelectItem>
            <SelectItem value="all">All</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <DisabledReason
            reason={
              translateProgress === null &&
              status !== "archived" &&
              missingCount === 0 &&
              "Every active suggestion is already translated"
            }
          >
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={translateProgress !== null || (status !== "archived" && missingCount === 0)}
              onClick={() => void translateAllMissing()}
              title="Translate every active suggestion that is missing a language"
            >
              {translateProgress ? (
                <Spinner label="Translating" className="text-current" />
              ) : (
                <Languages aria-hidden="true" className="h-4 w-4" />
              )}
              {translateProgress
                ? `Translating… ${translateProgress.done} done, ${translateProgress.left} left`
                : `Translate all missing${missingCount ? ` (${missingCount})` : ""}`}
            </Button>
          </DisabledReason>
          <Button type="button" size="sm" onClick={() => setEditing("new")}>
            <Plus aria-hidden="true" className="h-4 w-4" />
            Add suggestion
          </Button>
        </div>
      </div>

      {actionError ? (
        <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
          {actionError}
        </p>
      ) : null}
      {undo.element}
      <BulkActionBar
        count={selectedRows.length}
        noun={selectedRows.length === 1 ? "suggestion" : "suggestions"}
        onClear={selection.clear}
      >
        {selectedRows.some((row) => row.status === "active") ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAction.startsWith("bulk:")}
            onClick={() => void setSelectedStatus("archived")}
          >
            <Archive aria-hidden="true" className="h-4 w-4" />
            Archive
          </Button>
        ) : null}
        {selectedRows.some((row) => row.status === "archived") ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pendingAction.startsWith("bulk:")}
            onClick={() => void setSelectedStatus("active")}
          >
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Restore
          </Button>
        ) : null}
      </BulkActionBar>

      {!suggestions ? (
        <SkeletonRows label="Loading suggestions" />
      ) : rows.length === 0 ? (
        query ? (
          <EmptyState
            action={
              <Button type="button" size="sm" onClick={() => setSearch("")}>
                Clear search
              </Button>
            }
          >
            No suggestions match &quot;{search.trim()}&quot;.
          </EmptyState>
        ) : status === "archived" ? (
          <EmptyState
            action={
              <Button type="button" size="sm" variant="outline" onClick={() => setStatus("active")}>
                Show active suggestions
              </Button>
            }
          >
            No archived suggestions.
          </EmptyState>
        ) : (
          <EmptyState
            action={
              <Button type="button" size="sm" onClick={() => setEditing("new")}>
                <Plus aria-hidden="true" className="h-4 w-4" />
                Add suggestion
              </Button>
            }
          >
            {status === "active"
              ? "No active suggestions yet. Add the questions guests can tap in chat."
              : "No suggestions yet. Add the questions guests can tap in chat."}
          </EmptyState>
        )
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
                    label="Select all suggestions"
                  />
                </th>
                <th className={STACKED_TABLE.th}>Suggestion</th>
                <th className={STACKED_TABLE.th}>Reply</th>
                <th className={STACKED_TABLE.th}>Topic</th>
                <th className={STACKED_TABLE.th}>Score</th>
                <th className={STACKED_TABLE.th}>Scope</th>
                <th className={STACKED_TABLE.th}>Actions</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {rows.map((row) => {
                const mode = row.answerMode ?? (row.answer ? "static" : "dynamic");
                const translationCount = Object.keys(row.translations ?? {}).filter((locale) => locale !== "en").length;
                return (
                  <tr key={row._id} className={cn(STACKED_TABLE.row, STACKED_TABLE.selectableRow)}>
                    <td className={STACKED_TABLE.cell}>
                      <SelectCheckbox
                        checked={selection.isSelected(row._id)}
                        onChange={() => selection.toggle(row._id)}
                        label={`Select "${row.question}"`}
                      />
                    </td>
                    <td className={cn(STACKED_TABLE.cell, "lg:max-w-[340px]")}>
                      <p className="font-medium text-foreground">{row.question}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {translationCount}/{TRANSLATION_LOCALES.length} translations
                        {row.status === "archived" ? <StatusBadge tone="muted" label="Archived" /> : null}
                      </p>
                    </td>
                    <td
                      data-label="Reply"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[320px]")}
                    >
                      {mode === "static" ? (
                        <p className="line-clamp-2 text-xs leading-5">{row.answer}</p>
                      ) : (
                        <Badge variant="outline" className="rounded-full">
                          Live: {label(row.dynamicIntent ?? "property_details")}
                        </Badge>
                      )}
                    </td>
                    <td
                      data-label="Topic"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "capitalize text-muted-foreground")}
                    >
                      {label(row.topic)}
                    </td>
                    <td
                      data-label="Score"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground")}
                    >
                      {row.score}
                    </td>
                    <td
                      data-label="Scope"
                      className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground")}
                    >
                      {row.propertySlug ? (propertyNames.get(row.propertySlug) ?? row.propertySlug) : "All properties"}
                    </td>
                    <td className={STACKED_TABLE.cell}>
                      <div className="flex flex-wrap gap-2">
                        <Button type="button" variant="outline" size="sm" onClick={() => setEditing(row)}>
                          <Edit3 aria-hidden="true" className="h-4 w-4" />
                          Edit
                        </Button>
                        {row.status === "active" ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={pendingAction === `archive:${row._id}`}
                            onClick={() =>
                              void runAction(`archive:${row._id}`, () => archiveCurated({ questionId: row._id }))
                            }
                          >
                            <Archive aria-hidden="true" className="h-4 w-4" />
                            Archive
                          </Button>
                        ) : (
                          <>
                            <Button
                              type="button"
                              variant="secondary"
                              size="sm"
                              disabled={pendingAction === `restore:${row._id}`}
                              onClick={() =>
                                void runAction(`restore:${row._id}`, () => restoreCurated({ questionId: row._id }))
                              }
                            >
                              <RotateCcw aria-hidden="true" className="h-4 w-4" />
                              Restore
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              disabled={pendingAction === `delete:${row._id}`}
                              onClick={() => void deleteSuggestion(row)}
                              className="text-destructive"
                            >
                              <Trash2 aria-hidden="true" className="h-4 w-4" />
                              Delete
                            </Button>
                          </>
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

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
          {editing ? (
            <SuggestionForm
              suggestion={editing === "new" ? null : editing}
              properties={properties}
              onClose={() => setEditing(null)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

type SuggestionFormState = {
  question: string;
  answer: string;
  answerMode: CuratedAnswerMode;
  dynamicIntent: CuratedDynamicIntent;
  topic: string;
  score: string;
  propertySlug: string;
  translations: Record<string, string>;
  answerTranslations: Record<string, string>;
};

function formFor(suggestion: AdminCuratedSuggestion | null): SuggestionFormState {
  return {
    question: suggestion?.question ?? "",
    answer: suggestion?.answer ?? "",
    answerMode: suggestion?.answerMode ?? (suggestion && !suggestion.answer ? "dynamic" : "static"),
    dynamicIntent: suggestion?.dynamicIntent ?? "property_details",
    topic: suggestion?.topic ?? "villa_fit",
    score: String(suggestion?.score ?? 50),
    propertySlug: suggestion?.propertySlug ?? ALL_PROPERTIES,
    translations: { ...suggestion?.translations },
    answerTranslations: { ...suggestion?.answerTranslations },
  };
}

function SuggestionForm({
  suggestion,
  properties,
  onClose,
}: {
  suggestion: AdminCuratedSuggestion | null;
  properties: AdminKnowledgePropertyScope[];
  onClose: () => void;
}) {
  const [form, setForm] = useState(() => formFor(suggestion));
  const [pending, setPending] = useState<"" | "save" | "translate">("");
  const [formError, setFormError] = useState("");
  const createCurated = useMutation(api.chatSuggestions.adminCreateCurated);
  const updateCurated = useMutation(api.chatSuggestions.adminUpdateCurated);
  const translateDraft = useAction(api.chatSuggestions.adminTranslateCuratedDraft);
  const isStatic = form.answerMode === "static";
  const translatedCount = TRANSLATION_LOCALES.filter((locale) => form.translations[locale]?.trim()).length;

  function update<K extends keyof SuggestionFormState>(key: K, value: SuggestionFormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateTranslation(field: "translations" | "answerTranslations", locale: string, value: string) {
    setForm((current) => ({ ...current, [field]: { ...current[field], [locale]: value } }));
  }

  async function translate() {
    if (!form.question.trim()) {
      setFormError("Write the English question first.");
      return;
    }
    setPending("translate");
    setFormError("");
    try {
      const result = await translateDraft({
        question: form.question,
        answer: isStatic ? form.answer : undefined,
      });
      setForm((current) => ({
        ...current,
        translations: { ...current.translations, ...result.questionTranslations },
        answerTranslations: { ...current.answerTranslations, ...result.answerTranslations },
      }));
    } catch (error) {
      setFormError(errorMessage(error, "Unable to translate."));
    } finally {
      setPending("");
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    if (!form.question.trim()) {
      setFormError("Question is required.");
      return;
    }
    if (isStatic && !form.answer.trim()) {
      setFormError("Write the answer, or switch to a live answer.");
      return;
    }
    const args = {
      question: form.question,
      translations: form.translations,
      answerMode: form.answerMode,
      answer: isStatic ? form.answer : undefined,
      answerTranslations: isStatic ? form.answerTranslations : undefined,
      dynamicIntent: isStatic ? undefined : form.dynamicIntent,
      topic: form.topic,
      score: Number(form.score) || 0,
      propertySlug: form.propertySlug === ALL_PROPERTIES ? undefined : form.propertySlug,
    };
    setPending("save");
    try {
      if (suggestion) await updateCurated({ questionId: suggestion._id, ...args });
      else await createCurated(args);
      onClose();
    } catch (error) {
      setFormError(errorMessage(error, "Unable to save suggestion."));
    } finally {
      setPending("");
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>{suggestion ? "Edit suggestion" : "Add suggestion"}</DialogTitle>
        <DialogDescription>
          Suggestions are the question chips guests can tap in chat. Higher scores show first.
        </DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-2">
          <Label htmlFor="suggestion-question">Question (English)</Label>
          <Input
            id="suggestion-question"
            value={form.question}
            maxLength={160}
            onChange={(event) => update("question", event.target.value)}
            placeholder="Is breakfast included?"
          />
        </div>
        <div className="grid gap-2">
          <Label id="suggestion-reply-type">Reply</Label>
          <ToggleGroup
            value={form.answerMode}
            onValueChange={(value) => update("answerMode", value as CuratedAnswerMode)}
            aria-labelledby="suggestion-reply-type"
            className="w-fit"
          >
            <ToggleGroupItem value="static" className="px-4">Fixed answer</ToggleGroupItem>
            <ToggleGroupItem value="dynamic" className="px-4">Live answer</ToggleGroupItem>
          </ToggleGroup>
          {isStatic ? (
            <Textarea
              aria-label="Answer"
              value={form.answer}
              maxLength={1200}
              onChange={(event) => update("answer", event.target.value)}
              placeholder="Breakfast is included with every stay."
            />
          ) : (
            <div className="grid gap-1">
              <Select
                value={form.dynamicIntent}
                onValueChange={(value) => update("dynamicIntent", value as CuratedDynamicIntent)}
              >
                <SelectTrigger className="h-10 w-[16rem] rounded-lg capitalize" aria-label="Live answer type">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CURATED_DYNAMIC_INTENTS.map((intent) => (
                    <SelectItem key={intent} value={intent} className="capitalize">
                      {label(intent)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                The assistant answers with current data (prices, availability, villa details).
              </p>
            </div>
          )}
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="grid gap-2">
            <Label htmlFor="suggestion-topic">Topic</Label>
            <Select value={form.topic} onValueChange={(value) => update("topic", value)}>
              <SelectTrigger id="suggestion-topic" className="h-10 rounded-lg capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURATED_TOPICS.map((topic) => (
                  <SelectItem key={topic} value={topic} className="capitalize">
                    {label(topic)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="suggestion-score">Score (0–100)</Label>
            <Input
              id="suggestion-score"
              type="number"
              min={0}
              max={100}
              value={form.score}
              onChange={(event) => update("score", event.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="suggestion-property">Property</Label>
            <Select value={form.propertySlug} onValueChange={(value) => update("propertySlug", value)}>
              <SelectTrigger id="suggestion-property" className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_PROPERTIES}>All properties</SelectItem>
                {properties.map((property) => (
                  <SelectItem key={property.slug} value={property.slug}>
                    {property.label}
                  </SelectItem>
                ))}
                {form.propertySlug !== ALL_PROPERTIES &&
                !properties.some((property) => property.slug === form.propertySlug) ? (
                  <SelectItem value={form.propertySlug}>{form.propertySlug}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
        </div>
        <details className="rounded-lg border border-border">
          <summary className="cursor-pointer rounded-lg px-3 py-2 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            Translations ({translatedCount}/{TRANSLATION_LOCALES.length})
          </summary>
          <div className="grid gap-3 border-t border-border p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Empty languages fall back to English.</p>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={pending === "translate"}
                onClick={() => void translate()}
              >
                {pending === "translate" ? (
                  <Spinner label="Translating" className="text-current" />
                ) : (
                  <Languages aria-hidden="true" className="h-4 w-4" />
                )}
                Translate with AI
              </Button>
            </div>
            {TRANSLATION_LOCALES.map((locale) => (
              <div key={locale} className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-start">
                <Label htmlFor={`suggestion-${locale}`} className="pt-2 text-xs">
                  {LOCALE_LABELS[locale] ?? locale}
                </Label>
                <div className="grid gap-1">
                  <Input
                    id={`suggestion-${locale}`}
                    value={form.translations[locale] ?? ""}
                    maxLength={160}
                    onChange={(event) => updateTranslation("translations", locale, event.target.value)}
                  />
                  {isStatic ? (
                    <Textarea
                      aria-label={`${LOCALE_LABELS[locale] ?? locale} answer`}
                      value={form.answerTranslations[locale] ?? ""}
                      maxLength={1200}
                      onChange={(event) => updateTranslation("answerTranslations", locale, event.target.value)}
                      className="min-h-14"
                    />
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </details>
        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={pending === "save"}>
            {pending === "save" ? <Spinner label="Saving" className="text-current" /> : null}
            Save suggestion
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
