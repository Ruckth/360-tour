"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { Archive, Bot, CheckCircle2, Hand, MoreHorizontal, RotateCcw, Trash2, ListTodo } from "lucide-react";
import { useState } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import type { AdminSession, AdminSessionStatus } from "@/components/admin/admin-chat-types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

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
  const setStaffTask = useMutation(api.adminChat.setStaffTask);
  const setKeepWithStaff = useMutation(api.adminChat.setKeepWithStaff);
  const [taskOpen, setTaskOpen] = useState(false);
  const [task, setTask] = useState("");
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
      {status !== "open" ? <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => void run(() => changeStatus("open"))}
      >
        <RotateCcw aria-hidden="true" className="size-4" />
        {session.resolutionSource && session.resolutionSource !== 'manual' ? "Undo" : "Reopen"}
      </Button> : null}
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
          <Button type="button" variant="ghost" className="w-full justify-start" disabled={pending}
            onClick={() => { setMenuOpen(false); setTask(session.staffTask ?? ''); setTaskOpen(true); }}>
            <ListTodo className="size-4" aria-hidden="true" />{session.staffTask ? 'Edit follow-up' : 'Add follow-up / Keep open'}
          </Button>
          {session.staffTask ? <Button type="button" variant="ghost" className="w-full justify-start" disabled={pending}
            onClick={() => void run(() => setStaffTask({ sessionId, task: null }))}>
            <CheckCircle2 className="size-4" aria-hidden="true" />Complete follow-up
          </Button> : null}
          {status === 'open' ? <Button type="button" variant="ghost" className="w-full justify-start" disabled={pending}
            onClick={() => void run(() => changeStatus('resolved'))}>
            <CheckCircle2 className="size-4" aria-hidden="true" />No reply needed
          </Button> : null}
          <Button type="button" variant="ghost" className="w-full justify-start" disabled={pending}
            onClick={() => void run(() => setKeepWithStaff({ sessionId, keep: !session.keepWithStaff }))}>
            <Hand className="size-4" aria-hidden="true" />{session.keepWithStaff ? 'Let AI handle the next issue' : 'Keep with staff'}
          </Button>
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
      <Dialog open={taskOpen} onOpenChange={setTaskOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Staff follow-up</DialogTitle><DialogDescription>The chat stays In progress until this task is completed and the guest has an answer.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void run(async () => { await setStaffTask({ sessionId, task }); setTaskOpen(false); }); }}>
            <label htmlFor={`follow-up-${sessionId}`} className="text-sm font-medium">What needs to be done?</label>
            <Input id={`follow-up-${sessionId}`} value={task} onChange={event => setTask(event.target.value)} maxLength={300} placeholder="Check with housekeeping and update the guest" autoFocus required />
            <Button type="submit" disabled={pending || !task.trim()}>Save follow-up</Button>
          </form>
        </DialogContent>
      </Dialog>
      {error ? (
        <p role="alert" className="basis-full text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
