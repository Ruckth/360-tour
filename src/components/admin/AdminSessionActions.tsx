"use client";

import { api } from "convex/_generated/api";
import { useMutation } from "convex/react";
import { CheckCheck, CheckCircle2, RotateCcw } from "lucide-react";
import { useRef, useState, type ReactNode } from "react";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import type { AdminSession, AdminSessionStatus } from "@/components/admin/admin-chat-types";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

type ActionSlots = { actions: ReactNode; followUp: ReactNode; actionError: ReactNode };

/**
 * One controller for the header actions and the existing follow-up's direct actions. The header
 * shows the one common action (No reply needed, or Reopen once done); the rest sit in ⋯.
 */
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
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  // MoreMenu owns its trigger; this wrapper finds it so focus can return after a follow-up edit.
  const menuWrapper = useRef<HTMLSpanElement>(null);
  const menuTrigger = () => menuWrapper.current?.querySelector("button") ?? null;
  const taskTrigger = useRef<HTMLButtonElement | null>(null);
  const status = session.adminStatus ?? "open";
  const sessionId = session._id;

  async function run(action: () => Promise<unknown>) {
    if (busy.current) return;
    busy.current = true;
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

  function openTask(trigger: HTMLButtonElement | null) {
    taskTrigger.current = trigger;
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
      requestAnimationFrame(() => menuTrigger()?.focus());
    });
  }

  async function changeStatus(nextStatus: AdminSessionStatus) {
    await setSessionStatus({ sessionId, status: nextStatus,
      ...(nextStatus === "resolved" ? { expectedGuestMessageId: session.latestGuestMessageId ?? null } : {}) });
    onStatusChanged?.(nextStatus);
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
    <div className="flex items-center justify-end gap-0 sm:gap-1.5">
      {status === "open" ? (
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={pending}
          title="No reply needed (e)"
          aria-label="No reply needed"
          className="size-9 p-0 sm:w-auto sm:px-3"
          onClick={() => void run(() => changeStatus("resolved"))}
        >
          <CheckCheck aria-hidden="true" className="size-4" />
          <span className="hidden sm:inline">No reply needed</span>
        </Button>
      ) : (
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => void run(() => changeStatus("open"))}>
          <RotateCcw aria-hidden="true" className="size-4" />
          {session.resolutionSource && session.resolutionSource !== "manual" ? "Undo" : "Reopen"}
        </Button>
      )}
      <span ref={menuWrapper} className="contents">
        <MoreMenu
          label="More chat actions"
          disabled={pending}
          className="size-9 text-muted-foreground"
          items={[
            { label: session.staffTask ? "Edit follow-up" : "Add follow-up", onSelect: () => openTask(null) },
            { label: "Complete follow-up", hidden: !session.staffTask, onSelect: completeTask },
            {
              label: session.aiPaused ? "Resume AI" : "Take over from AI",
              onSelect: () => void run(() => setAiPaused({ sessionId, paused: !session.aiPaused })),
            },
            {
              label: session.keepWithStaff ? "Let AI handle the next issue" : "Keep the next issue with staff",
              onSelect: () => void run(() => setKeepWithStaff({ sessionId, keep: !session.keepWithStaff })),
            },
            { label: "Archive chat", hidden: status === "archived", onSelect: () => void run(() => changeStatus("archived")) },
            { label: "Delete chat", hidden: status !== "archived", destructive: true, onSelect: () => void deleteChat() },
          ]}
        />
      </span>
    </div>
  );

  return <>
      {children ? children({ actions, followUp, actionError: error && !taskOpen ? <p role="alert" className="w-full border-t border-border px-4 py-3 text-sm text-destructive">{error}</p> : null }) : <>{actions}{error && !taskOpen ? <p role="alert" className="w-full text-sm text-destructive">{error}</p> : null}</>}
      <Dialog open={taskOpen} onOpenChange={open => !open && closeTask()}>
        <DialogContent className="sm:max-w-md" showCloseButton={!pending} onCloseAutoFocus={event => {
          const trigger = taskTrigger.current?.isConnected ? taskTrigger.current : menuTrigger();
          if (trigger?.isConnected) { event.preventDefault(); trigger.focus(); }
        }}>
          <DialogHeader><DialogTitle>Staff follow-up</DialogTitle><DialogDescription>The chat stays In progress until this is done and the guest has an answer.</DialogDescription></DialogHeader>
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
              <Button type="submit" disabled={pending || !task.trim()}>Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>;
}
