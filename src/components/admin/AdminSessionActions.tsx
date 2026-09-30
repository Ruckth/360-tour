"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { Archive, Bot, CheckCircle2, Hand, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { StatusBadge } from "@/components/admin/StatusBadge";
import type { AdminSession } from "@/components/admin/admin-chat-types";
import { TONES, statusMeta } from "@/components/admin/status-tones";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
        <StatusBadge {...statusMeta("chatSession", status)} />
        {status === "open" ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => run(() => setSessionStatus({ sessionId, status: "resolved" }))}
          >
            <CheckCircle2 aria-hidden="true" className="h-4 w-4" />
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
            <RotateCcw aria-hidden="true" className="h-4 w-4" />
            Reopen
          </Button>
        )}
        {status === "archived" ? (
          <Button type="button" size="sm" variant="destructive" disabled={pending} onClick={() => void deleteChat()}>
            <Trash2 aria-hidden="true" className="h-4 w-4" />
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
            <Archive aria-hidden="true" className="h-4 w-4" />
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
            <Hand aria-hidden="true" className="h-4 w-4" />
            Take over
          </Button>
        ) : null}
      </div>
      {session.aiPaused ? (
        <div
          role="status"
          className={cn(
            "mt-3 flex flex-wrap items-center gap-2 rounded-lg border px-3 py-2 text-sm text-foreground",
            TONES.accent.bg,
            TONES.accent.border,
          )}
        >
          <Hand className={cn("h-4 w-4 shrink-0", TONES.accent.text)} aria-hidden="true" />
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
            <Bot aria-hidden="true" className="h-4 w-4" />
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
