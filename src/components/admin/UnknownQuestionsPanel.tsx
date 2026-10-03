"use client";

import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useMutation, usePaginatedQuery, useQuery } from "convex/react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { EmptyState, SkeletonRows } from "@/components/admin/admin-bulk";

export function UnknownQuestionsPanel({
  onCreateFact,
}: {
  onCreateFact: (unknown: Doc<"chatUnknownQuestions">) => void;
}) {
  const [filter, setFilter] =
    useState<Doc<"chatUnknownQuestions">["status"]>("new");
  const [error, setError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const { results, status, loadMore } = usePaginatedQuery(
    api.businessFacts.adminMissing,
    { status: filter },
    { initialNumItems: 25 },
  );
  const options = useQuery(api.businessFacts.adminApprovedOptions, {});
  const setStatus = useMutation(api.businessFacts.adminSetMissingStatus);
  const resolve = useMutation(api.businessFacts.adminResolveMissing);
  async function run(id: string, operation: () => Promise<unknown>) {
    setPending(id);
    setError("");
    try {
      await operation();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to update this report.",
      );
    } finally {
      setPending(null);
    }
  }
  return (
    <section className="rounded-lg border border-border bg-card">
      <div className="border-b border-border p-4">
        <Select
          value={filter}
          onValueChange={(value) =>
            setFilter(value as Doc<"chatUnknownQuestions">["status"])
          }
        >
          <SelectTrigger
            className="w-40"
            aria-label="Missing information status"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(["new", "resolved", "ignored"] as const).map((value) => (
              <SelectItem key={value} value={value}>
                {value}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {error ? (
        <p role="alert" className="p-4 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {status === "LoadingFirstPage" ? (
        <SkeletonRows label="Loading missing information" rows={4} />
      ) : results.length === 0 ? (
        <EmptyState>No {filter} missing-information reports.</EmptyState>
      ) : (
        results.map((unknown) => {
          const applicable =
            options?.filter(
              (fact) =>
                !fact.propertyId || fact.propertyId === unknown.propertyId,
            ) ?? [];
          return (
            <article
              key={unknown._id}
              className="grid gap-3 border-b border-border p-4 last:border-b-0"
            >
              <p className="font-medium">{unknown.userQuestion}</p>
              <p className="text-xs text-muted-foreground">
                {unknown.propertySlug ?? "General site"} ·{" "}
                {new Date(unknown.createdAt).toLocaleDateString()}
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {unknown.status === "new" ? (
                  <>
                    <Button size="sm" onClick={() => onCreateFact(unknown)}>
                      Add verified fact
                    </Button>
                    {applicable.length ? (
                      <>
                        <Select
                          value={selected[unknown._id] ?? ""}
                          onValueChange={(value) =>
                            setSelected((items) => ({
                              ...items,
                              [unknown._id]: value,
                            }))
                          }
                        >
                          <SelectTrigger
                            className="w-60"
                            aria-label={`Fact for ${unknown.userQuestion}`}
                          >
                            <SelectValue placeholder="Choose an approved fact" />
                          </SelectTrigger>
                          <SelectContent>
                            {applicable.map((fact) => (
                              <SelectItem key={fact.factId} value={fact.factId}>
                                {fact.title}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pending !== null || !selected[unknown._id]}
                          onClick={() =>
                            void run(unknown._id, () =>
                              resolve({
                                unknownId: unknown._id,
                                factId: selected[
                                  unknown._id
                                ] as Id<"businessFacts">,
                              }),
                            )
                          }
                        >
                          Link fact
                        </Button>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No approved facts apply yet.
                      </p>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={pending !== null}
                      onClick={() =>
                        void run(unknown._id, () =>
                          setStatus({
                            unknownId: unknown._id,
                            status: "ignored",
                          }),
                        )
                      }
                    >
                      Ignore
                    </Button>
                  </>
                ) : (
                  <>
                    <p className="text-sm text-muted-foreground">
                      {unknown.resolvedFactId
                        ? "Linked to a verified fact."
                        : unknown.status === "resolved"
                          ? "Handled in the previous workflow."
                          : "Ignored."}
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={pending !== null}
                      onClick={() =>
                        void run(unknown._id, () =>
                          setStatus({ unknownId: unknown._id, status: "new" }),
                        )
                      }
                    >
                      Reopen
                    </Button>
                  </>
                )}
              </div>
            </article>
          );
        })
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <Button
          className="m-4"
          variant="outline"
          disabled={status === "LoadingMore"}
          onClick={() => loadMore(25)}
        >
          Load more
        </Button>
      ) : null}
    </section>
  );
}
