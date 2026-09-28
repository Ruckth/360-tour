"use client";

import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { useMutation } from "convex/react";
import { Check, Loader2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { pluralize, useUndoNotice } from "@/components/admin/admin-bulk";
import { formatDateTime } from "@/components/admin/admin-chat-format";
import type { AdminPendingVariant } from "@/components/admin/admin-knowledge-types";

/** One queue of every AI-suggested way to ask, across all answers: approve or reject each, or all. */
export function PendingVariantsPanel({ variants }: { variants: AdminPendingVariant[] | undefined }) {
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
        <p className="mr-auto text-sm text-muted-foreground">
          AI-suggested ways guests might ask. Approved variants make the chatbot reply with that answer.
        </p>
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={rows.length === 0 || pending !== ""}
          onClick={() => void review("approve-all", "approve", allIds)}
        >
          {pending === "approve-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
          Approve all ({rows.length})
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={rows.length === 0 || pending !== ""}
          onClick={() => void review("reject-all", "reject", allIds)}
        >
          {pending === "reject-all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
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
        <div className="flex items-center gap-2 p-5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading variants
        </div>
      ) : rows.length === 0 ? (
        <div className="p-5 text-sm leading-6 text-muted-foreground">
          No variants waiting for review. New ones appear after you link or create answers.
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="border-b border-border bg-background/70 text-xs uppercase tracking-[0.14em] text-muted-foreground">
              <tr>
                <th className="px-4 py-3 font-semibold">Suggested question</th>
                <th className="px-4 py-3 font-semibold">Answer</th>
                <th className="px-4 py-3 font-semibold">Suggested</th>
                <th className="px-4 py-3 font-semibold">Review</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id} className="border-b border-border last:border-b-0">
                  <td className="max-w-[360px] px-4 py-3 font-medium text-foreground">{row.questionText}</td>
                  <td className="max-w-[260px] px-4 py-3 text-muted-foreground">{row.answerTitle}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{formatDateTime(row.createdAt)}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        disabled={pending !== ""}
                        onClick={() => void review(`approve:${row._id}`, "approve", [row._id])}
                      >
                        Approve
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={pending !== ""}
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
