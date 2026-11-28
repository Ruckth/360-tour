"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { TimePicker } from "@/components/ui/time-picker";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export type Plan = { shifts: Array<{ start: string; end: string }>; breaks: Array<{ start: string; end: string; label: string }> };

export function CustomShiftDialog({ selectionLabel, onClose, onApply }: { selectionLabel: string; onClose: () => void; onApply: (plan: Plan) => void }) {
  const [error, setError] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const [start, end, breakStart, breakEnd] = ["start", "end", "breakStart", "breakEnd"].map(text);
    if (!start || !end || start >= end) return setError("Start must be before end.");
    if (Boolean(breakStart) !== Boolean(breakEnd)) return setError("Give the break a start and an end, or leave both empty.");
    if (breakStart && (breakStart >= breakEnd || breakStart < start || breakEnd > end)) {
      return setError("The break must fit inside the shift.");
    }
    onApply({
      shifts: [{ start, end }],
      breaks: breakStart ? [{ start: breakStart, end: breakEnd, label: text("breakLabel") || "Break" }] : [],
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <form onSubmit={submit} className="space-y-4">
          <DialogHeader>
            <DialogTitle>Custom hours</DialogTitle>
            <DialogDescription>Applies to {selectionLabel}. Times are resort time.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <TimeField name="start" label="Start" defaultValue="10:00" required />
            <TimeField name="end" label="End" defaultValue="18:00" required />
          </div>
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Break (optional)</legend>
            <div className="grid grid-cols-3 gap-3">
              <TimeField name="breakStart" label="From" />
              <TimeField name="breakEnd" label="To" />
              <div className="space-y-1.5">
                <Label htmlFor="roster-break-label">Label</Label>
                <Input id="roster-break-label" name="breakLabel" placeholder="Lunch" />
              </div>
            </div>
          </fieldset>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit">Apply</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeField({ name, label, defaultValue, required }: { name: string; label: string; defaultValue?: string; required?: boolean }) {
  const id = `roster-${name}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <TimePicker id={id} label={label} name={name} minuteStep={15} allowEmpty={!required} defaultValue={defaultValue} required={required} />
    </div>
  );
}
