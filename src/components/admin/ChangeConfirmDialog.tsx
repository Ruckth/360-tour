"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import type { ChangeRow } from "@/lib/schedule-changes";
import { RESORT_ZONE_LABEL, errorText } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

/**
 * The one before → after confirmation for schedule changes. Nothing is saved until Confirm;
 * closing, Escape or the keep button discards the proposal. `onConfirm` returns false to stay
 * open (for example to show conflicts); a thrown error is shown and the dialog stays open.
 */
export function ChangeConfirmDialog({
  title,
  description,
  rows,
  children,
  footnote,
  confirmLabel,
  keepLabel = "Keep original",
  destructive = false,
  confirmDisabled = false,
  onConfirm,
  onClose,
}: {
  title: string;
  description?: ReactNode;
  rows: ChangeRow[];
  /** Form fields that shape the proposal, shown above the comparison. */
  children?: ReactNode;
  footnote?: ReactNode;
  confirmLabel: string;
  keepLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => Promise<boolean | void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      if ((await onConfirm()) !== false) onClose();
    } catch (err) {
      setError(errorText(err, "Could not save the change."));
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !pending && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className={description ? undefined : "sr-only"}>
            {description ?? "Review the change before saving it."}
          </DialogDescription>
        </DialogHeader>
        {children ? <div className="grid gap-4">{children}</div> : null}
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Before and after</caption>
          <thead>
            <tr className="border-b border-border text-start text-xs text-muted-foreground">
              <td className="py-1.5" />
              <th scope="col" className="py-1.5 text-start font-medium">From</th>
              <th scope="col" className="py-1.5 text-start font-medium">To</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const changed = row.before !== row.after;
              return (
                <tr key={row.label} className="border-b border-border align-top last:border-b-0">
                  <th scope="row" className="py-2 pe-3 text-start font-normal text-muted-foreground">{row.label}</th>
                  <td className={cn("py-2 pe-3", changed && "text-muted-foreground line-through decoration-muted-foreground/50")}>
                    {row.before}
                  </td>
                  <td className={cn("py-2", changed ? "font-semibold" : "text-muted-foreground")}>
                    {changed ? row.after : "No change"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="grid gap-1 text-xs text-muted-foreground">
          <p className="font-medium">{RESORT_ZONE_LABEL}.</p>
          {footnote}
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={pending}>
            {keepLabel}
          </Button>
          <Button
            type="button"
            variant={destructive ? "destructive" : "default"}
            onClick={confirm}
            disabled={pending || confirmDisabled}
          >
            {pending ? <Spinner className="text-current" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
