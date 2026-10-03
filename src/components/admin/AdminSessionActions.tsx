"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { Archive, Bot, CheckCircle2, Hand, MoreHorizontal, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import type { AdminSession, AdminSessionStatus } from "@/components/admin/admin-chat-types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/** One primary action; occasional actions stay in the conversation menu. */
export function AdminSessionActions({
  session,
  onDeleted,
  onStatusChanged,
}: {
  session: AdminSession;
  onDeleted: () => void;
  onStatusChanged?: (status: AdminSessionStatus) => void;
}) {
  const confirm = useConfirm();
  const setSessionStatus = useMutation(api.adminChat.setSessionStatus);
  const setAiPaused = useMutation(api.adminChat.setAiPaused);
  const deleteArchivedSession = useMutation(api.adminChat.deleteArchivedSession);
  const [pending, setPending] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = session.adminStatus ?? "open";
  const sessionId = session._id;

  async function run(action: () => Promise<unknown>) {
    setMenuOpen(false);
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

  async function changeStatus(nextStatus: AdminSessionStatus) {
    await setSessionStatus({ sessionId, status: nextStatus });
    onStatusChanged?.(nextStatus);
  }

  async function deleteChat() {
    setMenuOpen(false);
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
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      <Button
        type="button"
        size="sm"
        variant={status === "open" ? "default" : "outline"}
        disabled={pending}
        onClick={() => void run(() => changeStatus(status === "open" ? "resolved" : "open"))}
      >
        {status === "open" ? (
          <CheckCircle2 aria-hidden="true" className="size-4" />
        ) : (
          <RotateCcw aria-hidden="true" className="size-4" />
        )}
        {status === "open" ? "Resolve" : "Reopen"}
      </Button>
      <Popover open={menuOpen} onOpenChange={setMenuOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-9 text-muted-foreground"
            aria-label="More conversation actions"
            disabled={pending}
          >
            <MoreHorizontal aria-hidden="true" className="size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-64 space-y-1 p-1.5" aria-label="Conversation actions">
          <Button
            type="button"
            variant="ghost"
            className="w-full justify-start text-sm"
            disabled={pending}
            onClick={() => void run(() => setAiPaused({ sessionId, paused: !session.aiPaused }))}
          >
            {session.aiPaused ? (
              <Bot className="size-4" aria-hidden="true" />
            ) : (
              <Hand className="size-4" aria-hidden="true" />
            )}
            {session.aiPaused ? "Resume AI" : "Take over from AI"}
          </Button>
          {status === "archived" ? (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start text-destructive"
              disabled={pending}
              onClick={() => void deleteChat()}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              Delete conversation
            </Button>
          ) : (
            <Button
              type="button"
              variant="ghost"
              className="w-full justify-start"
              disabled={pending}
              onClick={() => void run(() => changeStatus("archived"))}
            >
              <Archive className="size-4" aria-hidden="true" />
              Archive conversation
            </Button>
          )}
        </PopoverContent>
      </Popover>
      {error ? (
        <p role="alert" className="basis-full text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
