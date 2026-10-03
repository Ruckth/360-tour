"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { useState, type FormEvent } from "react";
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
import {
  BUSINESS_FACT_STATUSES,
  EMPTY_FACT_FORM,
  FACT_LIMITS,
  type AdminBusinessFact,
  type AdminFactProperty,
  type BusinessFactStatus,
  type FactFormValues,
  factFormValues,
  factSavePayload,
  validateFactForm,
} from "@/components/admin/business-facts-form";
import { STATUS_LABELS } from "@/components/admin/labels";
import type { Id } from "convex/_generated/dataModel";

/**
 * What the fact dialog edits: an existing fact, a new fact prefilled from a missing-information
 * report (resolves that report when approved), or (empty) a blank new fact.
 */
export type FactFormTarget = {
  fact?: AdminBusinessFact;
  /** Prefill from a guest question and resolve its report once the fact is approved. */
  fromUnknown?: {
    unknownQuestionId: Id<"chatUnknownQuestions">;
    question: string;
    propertyId?: Id<"properties">;
  };
  /** Prefill a blank draft fact from arbitrary text (e.g. a chat message), resolving nothing. */
  fromMessage?: { question: string; propertyId?: Id<"properties"> };
};

const STATUS_LABEL: Record<BusinessFactStatus, string> = STATUS_LABELS.businessFact;

function initialValues(target: FactFormTarget): FactFormValues {
  if (target.fact) return factFormValues(target.fact);
  if (target.fromUnknown) {
    return {
      ...EMPTY_FACT_FORM,
      title: target.fromUnknown.question.slice(0, FACT_LIMITS.title),
      body: "",
      propertyId: target.fromUnknown.propertyId ?? "",
    };
  }
  if (target.fromMessage) {
    return {
      ...EMPTY_FACT_FORM,
      title: target.fromMessage.question.slice(0, FACT_LIMITS.title),
      propertyId: target.fromMessage.propertyId ?? "",
    };
  }
  return EMPTY_FACT_FORM;
}

export function BusinessFactFormDialog({
  target,
  properties,
  onClose,
  onSaved,
}: {
  target: FactFormTarget | null;
  properties: readonly AdminFactProperty[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  return (
    <Dialog open={target !== null} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        {/* Mounted per open, so the form state starts fresh each time. */}
        {target ? (
          <FactForm target={target} properties={properties} onClose={onClose} onSaved={onSaved} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FactForm({
  target,
  properties,
  onClose,
  onSaved,
}: {
  target: FactFormTarget;
  properties: readonly AdminFactProperty[];
  onClose: () => void;
  onSaved?: () => void;
}) {
  const [form, setForm] = useState<FactFormValues>(() => initialValues(target));
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);
  const save = useMutation(api.businessFacts.adminSave);

  const editing = target.fact ?? null;
  const fromUnknown = target.fromUnknown ?? null;
  const activeProperties = properties.filter((property) => property.status === "active");
  // Keep an archived/inactive scope visible when editing a fact that already uses it.
  const scopeOptions =
    editing?.propertyId && !activeProperties.some((property) => property._id === editing.propertyId)
      ? [...activeProperties, ...properties.filter((property) => property._id === editing.propertyId)]
      : activeProperties;

  function update<K extends keyof FactFormValues>(key: K, value: FactFormValues[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError("");
    const invalid = validateFactForm(form);
    if (invalid) {
      setFormError(invalid.message);
      return;
    }
    if (fromUnknown && form.status !== "approved") {
      setFormError("Approve the fact to resolve the missing-information report.");
      return;
    }
    setSaving(true);
    try {
      const payload = factSavePayload(form);
      await save({
        ...(editing ? { factId: editing._id, expectedRevision: editing.revision } : {}),
        ...(fromUnknown ? { unknownQuestionId: fromUnknown.unknownQuestionId } : {}),
        title: payload.title,
        body: payload.body,
        searchText: payload.searchText,
        source: payload.source,
        propertyId: payload.propertyId,
        status: payload.status,
      });
      onSaved?.();
      onClose();
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Unable to save the fact.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>
          {editing ? "Edit business fact" : fromUnknown ? "Create a fact from this question" : "Add a business fact"}
        </DialogTitle>
        <DialogDescription>
          Approved facts are what the concierge can quote. Store the fact once, with the source you verified it
          against and the properties it applies to.
        </DialogDescription>
      </DialogHeader>
      <form className="grid gap-4" onSubmit={submit}>
        <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div className="grid gap-2">
            <Label htmlFor="fact-title">Title</Label>
            <Input
              id="fact-title"
              value={form.title}
              maxLength={FACT_LIMITS.title}
              onChange={(event) => update("title", event.target.value)}
              placeholder="Breakfast policy"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fact-status">Status</Label>
            <Select value={form.status} onValueChange={(value) => update("status", value as BusinessFactStatus)}>
              <SelectTrigger id="fact-status" className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BUSINESS_FACT_STATUSES.map((status) => (
                  <SelectItem key={status} value={status}>
                    {STATUS_LABEL[status]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="fact-body">Fact</Label>
          <Textarea
            id="fact-body"
            value={form.body}
            maxLength={FACT_LIMITS.body}
            onChange={(event) => update("body", event.target.value)}
            className="min-h-32"
            placeholder="Breakfast is included for all villa stays, served 7–10am at the main house."
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="fact-search-text">English search terms</Label>
          <Textarea
            id="fact-search-text"
            value={form.searchText}
            maxLength={FACT_LIMITS.searchText}
            onChange={(event) => update("searchText", event.target.value)}
            className="min-h-20"
            placeholder="breakfast included morning meal buffet dining"
            aria-describedby="fact-search-text-hint"
          />
          <p id="fact-search-text-hint" className="text-xs text-muted-foreground">
            Thai and Korean questions are searched by these English terms, so include the words guests use in any
            language, translated to English.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="fact-scope">Scope</Label>
            <Select value={form.propertyId || "all"} onValueChange={(value) => update("propertyId", value === "all" ? "" : value)}>
              <SelectTrigger id="fact-scope" className="h-10 rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All properties</SelectItem>
                {scopeOptions.map((property) => (
                  <SelectItem key={property._id} value={property._id}>
                    {property.name}
                    {property.status !== "active" ? " (inactive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="fact-source">Source</Label>
            <Input
              id="fact-source"
              value={form.source}
              maxLength={FACT_LIMITS.source}
              onChange={(event) => update("source", event.target.value)}
              placeholder="Where you verified this (e.g. owner email, booking terms)"
            />
          </div>
        </div>

        {fromUnknown ? (
          <p className="text-xs text-muted-foreground">
            Approving this fact resolves the missing-information report for &quot;{fromUnknown.question}&quot;.
          </p>
        ) : null}

        {formError ? (
          <p role="alert" className="text-sm font-medium text-destructive">
            {formError}
          </p>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner label="Saving" className="text-current" /> : null}
            Save fact
          </Button>
        </DialogFooter>
      </form>
    </>
  );
}
