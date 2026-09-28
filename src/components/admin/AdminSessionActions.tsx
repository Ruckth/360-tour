"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { Archive, Bot, CheckCircle2, Hand, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import type { AdminSession, AdminSessionStatus } from "@/components/admin/admin-chat-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_LABELS: Record<AdminSessionStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  archived: "Archived",
};

/** Inbox status (open / resolved / archived / delete) and AI takeover controls for one chat. */
export function AdminSessionActions({
  session,
  onDeleted,
}: {
  session: AdminSession;
  onDeleted: () => void;
}) {
  const confirm = useConfirm();
  const setSessionStatus = useMutation(api.adminChat.setSessionStatus);
  const setAiPaused = useMutation(api.adminChat.setAiPaused);
  const deleteArchivedSession = useMutation(api.adminChat.deleteArchivedSession);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = session.adminStatus ?? "open";
  const sessionId = session._id;

  async function run(action: () => Promise<unknown>) {
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong. Try again.");
    } finally {
      setPending(false);
    }
  }

  async function deleteChat() {
    const confirmed = await confirm({
      title: "Delete this chat?",
      description: "The transcript and its suggestion history are deleted for good. Webhook delivery logs are kept.",
      confirmLabel: "Delete chat",
      destructive: true,
    });
    if (!confirmed) return;
    await run(async () => {
      await deleteArchivedSession({ sessionId });
      onDeleted();
    });
  }

  return (
    <>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge variant={status === "open" ? "secondary" : "outline"} className="rounded-full">
          {STATUS_LABELS[status]}
        </Badge>
        {status === "open" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setSessionStatus({ sessionId, status: "resolved" }))}
          >
            <CheckCircle2 className="h-4 w-4" />
            Resolve
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setSessionStatus({ sessionId, status: "open" }))}
          >
            <RotateCcw className="h-4 w-4" />
            Reopen
          </Button>
        )}
        {status === "archived" ? (
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => void deleteChat()}>
            <Trash2 className="h-4 w-4" />
            Delete
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setSessionStatus({ sessionId, status: "archived" }))}
          >
            <Archive className="h-4 w-4" />
            Archive
          </Button>
        )}
        {!session.aiPaused ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setAiPaused({ sessionId, paused: true }))}
            title="Stop automatic replies on every channel so you can reply yourself"
          >
            <Hand className="h-4 w-4" />
            Take over
          </Button>
        ) : null}
      </div>
      {session.aiPaused ? (
        <div
          role="status"
          className="mt-3 flex flex-wrap items-center gap-2 border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-foreground"
        >
          <Hand className="h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden="true" />
          <span className="min-w-0 flex-1">
            AI paused: {session.assignedAdminEmail ?? "staff"} is replying. The guest gets no automatic replies.
          </span>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setAiPaused({ sessionId, paused: false }))}
          >
            <Bot className="h-4 w-4" />
            Resume AI
          </Button>
        </div>
      ) : null}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-destructive">
          {error}
        </p>
      ) : null}
    </>
  );
}
