"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import { Check, Minus } from "lucide-react";
import { useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldLabel as Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";
import { TONES } from "../status-tones";
import { BranchStatePill, type BranchRow } from "./branch-status";

export type BranchLifecycleAction =
  | { kind: "activate"; branch: BranchRow }
  | { kind: "suspend"; branch: BranchRow }
  | { kind: "archive"; branch: BranchRow };

export function BranchLifecycleDialogs({
  action,
  onClose,
  onDone,
}: {
  action: BranchLifecycleAction | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  return (
    <Dialog open={action !== null} onOpenChange={(open) => !open && onClose()}>
      {action ? (
        <BranchLifecycleDialogBody
          key={`${action.kind}-${action.branch._id}`}
          action={action}
          onClose={onClose}
          onDone={onDone}
        />
      ) : null}
    </Dialog>
  );
}

function BranchLifecycleDialogBody({
  action,
  onClose,
  onDone,
}: {
  action: BranchLifecycleAction;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const id = useId();
  const setState = useMutation(api.branches.branches.setState);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const { branch } = action;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (action.kind === "suspend" && !reason.trim()) {
      setError("Enter a reason for suspending this branch.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      if (action.kind === "activate") {
        await setState({ branchId: branch._id, revision: branch.revision, state: "active" });
        onDone(`${branch.name} is now active.`);
      } else if (action.kind === "suspend") {
        await setState({ branchId: branch._id, revision: branch.revision, state: "suspended", reason: reason.trim() });
        onDone(`${branch.name} is now suspended.`);
      } else {
        await setState({ branchId: branch._id, revision: branch.revision, state: "archived" });
        onDone(`${branch.name} is now archived and read only.`);
      }
      onClose();
    } catch (err) {
      setError(errorText(err, "Couldn’t update branch state. Try again."));
    } finally {
      setSaving(false);
    }
  }

  if (action.kind === "activate") {
    const resuming = branch.state === "suspended";
    return (
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Activate {branch.name}?</DialogTitle>
          <DialogDescription>
            {resuming
              ? `${branch.name} resumes live bookings and sales for guests and staff now.`
              : `${branch.name} goes live for guests and staff now.`}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} className="grid gap-4">
          <ul className="grid gap-2 text-sm">
            <li className="flex gap-2">
              <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONES.success.text)} />
              <span>Guests can choose {branch.name} and book its published villas.</span>
            </li>
            <li className="flex gap-2">
              <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONES.success.text)} />
              <span>{branch.name} appears in the location chooser, sitemap and shared guest channels.</span>
            </li>
            <li className="flex gap-2">
              <Check aria-hidden className={cn("mt-0.5 size-4 shrink-0", TONES.success.text)} />
              <span>Assigned staff can take bookings and sell at {branch.name}.</span>
            </li>
            <li className="flex gap-2">
              <Minus aria-hidden className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
              <span>Other branches are unchanged.</span>
            </li>
          </ul>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? <Spinner label="Activating branch" className="text-current" /> : null}
              Activate {branch.name}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    );
  }

  if (action.kind === "suspend") {
    return (
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Suspend {branch.name}?</DialogTitle>
          <DialogDescription>New sales stop now. Everything already committed continues.</DialogDescription>
        </DialogHeader>
        <form onSubmit={(event) => void submit(event)} noValidate className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className={cn("grid content-start gap-2 rounded-lg border p-3 text-sm", TONES.danger.border, TONES.danger.bg)}>
              <p className={cn("font-semibold", TONES.danger.text)}>Stops now</p>
              <p>New bookings and holds from the website, chat and desk</p>
              <p>New checkout sales at {branch.name}</p>
              <p>{branch.name} in the location chooser and sitemap; villa pages say “Not taking new bookings”</p>
            </div>
            <div className="grid content-start gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
              <p className="font-semibold">Continues</p>
              <p>Existing stays, with their payments at the original amount</p>
              <p>Refunds and payment corrections</p>
              <p>OTA calendars and occupancy</p>
              <p>Guest chats, support and receipts</p>
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor={`${id}-reason`} className="text-xs font-normal text-muted-foreground">
              Reason (required, kept in history)
            </Label>
            <Textarea
              id={`${id}-reason`}
              required
              autoFocus
              disabled={saving}
              value={reason}
              onChange={(event) => {
                setReason(event.target.value);
                setError("");
              }}
              placeholder="e.g. Monsoon closure, reopen in March"
              aria-invalid={error ? true : undefined}
              className={cn("min-h-20", error && "border-destructive")}
            />
          </div>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={saving}>
              {saving ? <Spinner label="Suspending branch" className="text-current" /> : null}
              Suspend {branch.name}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    );
  }

  return (
    <DialogContent className="max-w-md">
      <DialogHeader>
        <DialogTitle>Archive {branch.name}?</DialogTitle>
        <DialogDescription>
          Archiving makes {branch.name} read only. History stays readable for authorized people, and it can’t be edited or reopened.
        </DialogDescription>
      </DialogHeader>
      <form onSubmit={(event) => void submit(event)} className="grid gap-4">
        <p className="rounded-lg border border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          Confirm there are no upcoming stays, open orders or pending refunds for {branch.name} before archiving.
        </p>
        <p className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
          After archiving: <BranchStatePill state="archived" />
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={saving} onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="destructive" disabled={saving}>
            {saving ? <Spinner label="Archiving branch" className="text-current" /> : null}
            Archive {branch.name}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}
