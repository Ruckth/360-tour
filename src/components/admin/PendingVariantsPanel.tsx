"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { Check, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { EmptyState, STACKED_TABLE, SkeletonRows, pluralize, useUndoNotice } from "@/components/admin/admin-bulk";
import { formatDateTime } from "@/components/admin/admin-chat-format";
import type { AdminPendingVariant } from "@/components/admin/admin-knowledge-types";
import { cn } from "@/lib/utils";

/** One queue of every AI-suggested way to ask, across all answers: approve or reject each, or all. */
export function PendingVariantsPanel({
  variants,
  onOpenAnswers,
}: {
  variants: AdminPendingVariant[] | undefined;
  onOpenAnswers: () => void;
}) {
  const approveQuestions = useMutation(api.chatKnowledge.adminApproveQuestions);
  const rejectQuestions = useMutation(api.chatKnowledge.adminRejectQuestions);
  const unreviewQuestions = useMutation(api.chatKnowledge.adminUnreviewQuestions);
  const [pending, setPending] = useState("");
  const [error, setError] = useState("");
  const notice = useUndoNotice();
  const rows = variants ?? [];

  async function review(key: string, action: "approve" | "reject", questionIds: Id<"chatQuestions">[]) {
    if (questionIds.length === 0) return;
    setPending(key);
    setError("");
    try {
      const count =
        action === "approve"
          ? (await approveQuestions({ questionIds })).approved
          : (await rejectQuestions({ questionIds })).rejected;
      notice.show(`${action === "approve" ? "Approved" : "Rejected"} ${pluralize(count, "variant")}.`, () =>
        unreviewQuestions({ questionIds }),
      );
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Unable to update the variants.");
    } finally {
      setPending("");
    }
  }

  const allIds = rows.map((row) => row._id);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <p className="min-w-60 flex-1 text-sm text-muted-foreground">
          AI-suggested ways guests might ask. Approved variants make the chatbot reply with that answer.
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={rows.length === 0 || pending !== ""}
          onClick={() => void review("approve-all", "approve", allIds)}
        >
          {pending === "approve-all" ? (
            <Spinner label="Approving" className="text-current" />
          ) : (
            <Check aria-hidden="true" className="h-4 w-4" />
          )}
          Approve all ({rows.length})
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rows.length === 0 || pending !== ""}
          onClick={() => void review("reject-all", "reject", allIds)}
        >
          {pending === "reject-all" ? (
            <Spinner label="Rejecting" className="text-current" />
          ) : (
            <X aria-hidden="true" className="h-4 w-4" />
          )}
          Reject all
        </Button>
      </div>
      {error ? (
        <p role="alert" className="border-b border-border px-4 py-3 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
      {notice.element}
      {variants === undefined ? (
        <SkeletonRows label="Loading variants" />
      ) : rows.length === 0 ? (
        <EmptyState
          action={
            <Button type="button" size="sm" variant="outline" onClick={onOpenAnswers}>
              Go to answers
            </Button>
          }
        >
          No variants waiting for review. New ones appear after you link or create answers.
        </EmptyState>
      ) : (
        <div className="lg:overflow-x-auto">
          <table className={STACKED_TABLE.table}>
            <thead className={STACKED_TABLE.head}>
              <tr>
                <th className={STACKED_TABLE.th}>Suggested question</th>
                <th className={STACKED_TABLE.th}>Answer</th>
                <th className={STACKED_TABLE.th}>Suggested</th>
                <th className={STACKED_TABLE.th}>Review</th>
              </tr>
            </thead>
            <tbody className={STACKED_TABLE.body}>
              {rows.map((row) => (
                <tr key={row._id} className={STACKED_TABLE.row}>
                  <td className={cn(STACKED_TABLE.cell, "font-medium text-foreground lg:max-w-[360px]")}>
                    {row.questionText}
                  </td>
                  <td
                    data-label="Answer"
                    className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-muted-foreground lg:max-w-[260px]")}
                  >
                    {row.answerTitle}
                  </td>
                  <td
                    data-label="Suggested"
                    className={cn(STACKED_TABLE.cell, STACKED_TABLE.labelled, "text-xs text-muted-foreground")}
                  >
                    {formatDateTime(row.createdAt)}
                  </td>
                  <td className={STACKED_TABLE.cell}>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={pending !== ""}
                        aria-label={`Approve "${row.questionText}"`}
                        onClick={() => void review(`approve:${row._id}`, "approve", [row._id])}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending !== ""}
                        aria-label={`Reject "${row.questionText}"`}
                        onClick={() => void review(`reject:${row._id}`, "reject", [row._id])}
                      >
                        Reject
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
