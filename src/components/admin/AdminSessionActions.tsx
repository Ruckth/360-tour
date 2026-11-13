"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { Archive, Bot, CheckCircle2, Hand, MoreHorizontal, RotateCcw, Trash2, ListTodo } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import type { AdminSession, AdminSessionStatus } from "@/components/admin/admin-chat-types";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ActionSlots = { actions: ReactNode; followUp: ReactNode };

/** One controller for the header menu and the existing follow-up's direct actions. */
export function AdminSessionActions({
  session,
  onDeleted,
  onStatusChanged,
  children,
}: {
  session: AdminSession;
  onDeleted: () => void;
  onStatusChanged?: (status: AdminSessionStatus) => void;
  children?: (slots: ActionSlots) => ReactNode;
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
  const busy = useRef(false);
  const menuTrigger = useRef<HTMLButtonElement>(null);
  const taskTrigger = useRef<HTMLButtonElement | null>(null);
  const status = session.adminStatus ?? "open";
  const sessionId = session._id;

  async function run(action: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
    setMenuOpen(false);
    setPending(true);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "Something went wrong. Try again.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  function openTask(trigger: HTMLButtonElement) {
    taskTrigger.current = trigger;
    setMenuOpen(false);
    setError(null);
    setTask(session.staffTask ?? "");
    setTaskOpen(true);
  }

  function closeTask() {
    if (busy.current) return;
    setTaskOpen(false);
    setTask("");
    setError(null);
  }

  function completeTask() {
    void run(async () => {
      await setStaffTask({ sessionId, task: null });
      setTask("");
      requestAnimationFrame(() => menuTrigger.current?.focus());
    });
  }

  async function changeStatus(nextStatus: AdminSessionStatus) {
    await setSessionStatus({ sessionId, status: nextStatus,
      ...(nextStatus === "resolved" ? { expectedGuestMessageId: session.latestGuestMessageId ?? null } : {}) });
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

  const followUp = session.staffTask ? (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/40 bg-muted/40 px-4 py-2 text-xs sm:px-6">
      <p className="min-w-0 flex-1 basis-48 break-words"><span className="font-medium">Follow-up:</span> {session.staffTask}</p>
      <div className="flex min-w-0 flex-wrap gap-1">
        <Button type="button" size="sm" variant="ghost" aria-label="Edit follow-up" disabled={pending} onClick={event => openTask(event.currentTarget)}>Edit</Button>
        <Button type="button" size="sm" variant="ghost" aria-label="Complete follow-up" disabled={pending} onClick={completeTask}>
          <CheckCircle2 className="size-4" aria-hidden="true" />Complete
        </Button>
      </div>
    </div>
  ) : null;

  const actions = (
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
            ref={menuTrigger}
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
        <PopoverContent align="end" className="max-h-[var(--radix-popover-content-available-height)] w-64 max-w-[calc(100vw-2rem)] space-y-1 overflow-y-auto p-1.5" aria-label="Conversation actions">
          <div role="group" aria-labelledby={`follow-up-actions-${sessionId}`}>
            <p id={`follow-up-actions-${sessionId}`} className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Follow-up</p>
            <Button type="button" variant="ghost" className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left" disabled={pending}
              onClick={event => openTask(event.currentTarget)}>
              <ListTodo className="size-4" aria-hidden="true" />{session.staffTask ? 'Edit follow-up' : 'Add follow-up'}
            </Button>
            {session.staffTask ? <Button type="button" variant="ghost" className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left" disabled={pending}
              onClick={completeTask}>
              <CheckCircle2 className="size-4" aria-hidden="true" />Complete follow-up
            </Button> : null}
          </div>
          <div role="group" aria-labelledby={`conversation-actions-${sessionId}`} className="border-t border-border pt-1">
            <p id={`conversation-actions-${sessionId}`} className="px-3 py-1.5 text-xs font-medium text-muted-foreground">This conversation</p>
          {status === 'open' ? <Button type="button" variant="ghost" className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left" disabled={pending}
            onClick={() => void run(() => changeStatus('resolved'))}>
            <CheckCircle2 className="size-4" aria-hidden="true" />No reply needed
          </Button> : null}
          <Button
            type="button"
            variant="ghost"
            className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left text-sm"
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
              className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left text-destructive"
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
              className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left"
              disabled={pending}
              onClick={() => void run(() => changeStatus("archived"))}
            >
              <Archive className="size-4" aria-hidden="true" />
              Archive conversation
            </Button>
          )}
          </div>
          <div role="group" aria-labelledby={`next-issue-actions-${sessionId}`} className="border-t border-border pt-1">
            <p id={`next-issue-actions-${sessionId}`} className="px-3 py-1.5 text-xs font-medium text-muted-foreground">Next issue</p>
            <Button type="button" variant="ghost" className="h-auto min-h-9 w-full justify-start whitespace-normal py-2 text-left" disabled={pending}
              onClick={() => void run(() => setKeepWithStaff({ sessionId, keep: !session.keepWithStaff }))}>
              <Hand className="size-4" aria-hidden="true" />{session.keepWithStaff ? 'Let AI handle the next issue' : 'Keep with staff'}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      {error && !taskOpen ? (
        <p role="alert" className="basis-full text-right text-xs text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );

  return <>
      {children ? children({ actions, followUp }) : actions}
      <Dialog open={taskOpen} onOpenChange={open => !open && closeTask()}>
        <DialogContent className="sm:max-w-md" showCloseButton={!pending} onCloseAutoFocus={event => {
          const trigger = taskTrigger.current?.isConnected ? taskTrigger.current : menuTrigger.current;
          if (trigger?.isConnected) { event.preventDefault(); trigger.focus(); }
        }}>
          <DialogHeader><DialogTitle>Staff follow-up</DialogTitle><DialogDescription>The chat stays In progress until this task is completed and the guest has an answer.</DialogDescription></DialogHeader>
          <form className="space-y-4" onSubmit={(event) => {
            event.preventDefault();
            const value = task.trim();
            if (!value) return;
            void run(async () => { await setStaffTask({ sessionId, task: value }); setTaskOpen(false); setTask(""); });
          }}>
            <label htmlFor={`follow-up-${sessionId}`} className="text-sm font-medium">What needs to be done?</label>
            <Input id={`follow-up-${sessionId}`} value={task} onChange={event => setTask(event.target.value)} disabled={pending} maxLength={300} placeholder="Check with housekeeping and update the guest" autoFocus required />
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" disabled={pending} onClick={closeTask}>Cancel</Button>
              <Button type="submit" disabled={pending || !task.trim()}>Save follow-up</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>;
}
