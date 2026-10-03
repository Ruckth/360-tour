"use client";

import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type FactFormTarget = {
  fact?: Doc<"businessFacts">;
  question?: string;
  unknown?: Doc<"chatUnknownQuestions">;
};

export function FactFormDialog({
  target,
  onClose,
}: {
  target: FactFormTarget | null;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-2xl overflow-y-auto">
        <DialogTitle>
          {target?.fact ? "Edit business fact" : "Add business fact"}
        </DialogTitle>
        <DialogDescription>
          Maintain verified information once. Only approved facts are available
          to the concierge.
        </DialogDescription>
        {target ? (
          <FactForm
            key={
              target.fact?._id ??
              target.unknown?._id ??
              target.question ??
              "new"
            }
            target={target}
            onClose={onClose}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function FactForm({
  target,
  onClose,
}: {
  target: FactFormTarget;
  onClose: () => void;
}) {
  const existing = target.fact;
  const [title, setTitle] = useState(
    existing?.title ??
      target.unknown?.userQuestion.slice(0, 160) ??
      target.question?.slice(0, 160) ??
      "",
  );
  const [body, setBody] = useState(existing?.body ?? "");
  const [searchText, setSearchText] = useState(existing?.searchText ?? "");
  const [source, setSource] = useState(existing?.source ?? "");
  const [status, setStatus] = useState<Doc<"businessFacts">["status"]>(
    existing?.status ?? "draft",
  );
  const [propertyId, setPropertyId] = useState<string>(
    existing?.propertyId ?? target.unknown?.propertyId ?? "global",
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const properties = useQuery(api.properties.list, {});
  const save = useMutation(api.businessFacts.adminSave);
  return (
    <form
      className="grid gap-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setPending(true);
        setError("");
        try {
          await save({
            title,
            body,
            searchText,
            source,
            status,
            ...(existing
              ? { factId: existing._id, expectedRevision: existing.revision }
              : {}),
            ...(propertyId !== "global"
              ? { propertyId: propertyId as Id<"properties"> }
              : {}),
            ...(target.unknown && status === "approved"
              ? { unknownQuestionId: target.unknown._id }
              : {}),
          });
          onClose();
        } catch (cause) {
          setError(
            cause instanceof Error ? cause.message : "Unable to save the fact.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      {target.unknown || target.question ? (
        <p className="rounded-lg bg-muted p-3 text-sm">
          Guest question: {target.unknown?.userQuestion ?? target.question}
        </p>
      ) : null}
      <div className="grid gap-1.5">
        <Label htmlFor="fact-title">Title / subject</Label>
        <Input
          id="fact-title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={160}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fact-body">Verified information</Label>
        <Textarea
          id="fact-body"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={2400}
          rows={5}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fact-source">Source</Label>
        <Input
          id="fact-source"
          placeholder="Owner confirmation, policy document or source URL"
          value={source}
          onChange={(e) => setSource(e.target.value)}
          maxLength={500}
          required
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fact-search">English search terms</Label>
        <Input
          id="fact-search"
          placeholder="e.g. breakfast included meal morning"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          maxLength={1200}
          required
        />
        <p className="text-xs text-muted-foreground">
          Include the subject and common words guests use. The AI searches these
          terms for all guest languages.
        </p>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fact-property">Applies to</Label>
        <Select value={propertyId} onValueChange={setPropertyId}>
          <SelectTrigger id="fact-property">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="global">All properties</SelectItem>
            {properties?.map((p) => (
              <SelectItem key={p._id} value={p._id}>
                {p.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="fact-status">Status</Label>
        <Select
          value={status}
          onValueChange={(value) =>
            setStatus(value as Doc<"businessFacts">["status"])
          }
        >
          <SelectTrigger id="fact-status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["draft", "approved", "archived"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {target.unknown ? (
        <p className="text-sm text-muted-foreground">
          Approving this fact also resolves the missing-information report.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save fact"}
        </Button>
      </div>
    </form>
  );
}
