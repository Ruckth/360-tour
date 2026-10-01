"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { CircleAlert, CircleCheck } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { TONES } from "@/components/admin/status-tones";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { TimePicker } from "@/components/ui/time-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import {
  errorText,
  formatResortDate,
  formatResortTime,
  resortIsoDate,
  timeOffRange,
  useNow,
  type TimeOffInput,
} from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

const PRESETS = ["Leave", "Sick", "Training"] as const;
type TimeOffResults = FunctionReturnType<typeof api.adminServices.addTimeOff>;

function Field({ label, htmlFor, children }: { label: string; htmlFor?: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

export function readTimeOff(form: FormData): TimeOffInput & { label: string } {
  const text = (name: string) => String(form.get(name) ?? "").trim();
  return {
    from: text("offFrom"),
    to: text("offTo"),
    startTime: text("offStartTime"),
    endTime: text("offEndTime"),
    label: text("offLabel"),
  };
}

/** Dates plus optional times and a label preset; blank times mean whole days. Read back with `readTimeOff`. */
export function TimeOffFields({
  idPrefix,
  min,
  defaults,
  required,
}: {
  idPrefix: string;
  min?: string;
  defaults?: Partial<TimeOffInput> & { label?: string };
  required?: boolean;
}) {
  const initial = defaults?.label ?? PRESETS[0];
  const [preset, setPreset] = useState<string>(PRESETS.includes(initial as (typeof PRESETS)[number]) ? initial : "Custom");
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="From" htmlFor={`${idPrefix}-from`}>
          <DatePicker id={`${idPrefix}-from`} name="offFrom" clearable min={min} defaultValue={defaults?.from} required={required} />
        </Field>
        <Field label="Start time (optional)" htmlFor={`${idPrefix}-start`}>
          <TimePicker id={`${idPrefix}-start`} label="Start time" name="offStartTime" minuteStep={15} allowEmpty defaultValue={defaults?.startTime} />
        </Field>
        <Field label="To" htmlFor={`${idPrefix}-to`}>
          <DatePicker id={`${idPrefix}-to`} name="offTo" clearable min={min} defaultValue={defaults?.to} />
        </Field>
        <Field label="End time (optional)" htmlFor={`${idPrefix}-end`}>
          <TimePicker id={`${idPrefix}-end`} label="End time" name="offEndTime" minuteStep={15} allowEmpty defaultValue={defaults?.endTime} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Label</legend>
        <div className="flex flex-wrap gap-1.5">
          {[...PRESETS, "Custom"].map((option) => (
            <Button
              key={option}
              type="button"
              size="sm"
              variant={preset === option ? "default" : "outline"}
              aria-pressed={preset === option}
              onClick={() => setPreset(option)}
            >
              {option}
            </Button>
          ))}
        </div>
        {preset === "Custom" ? (
          <Input
            name="offLabel"
            aria-label="Custom label"
            placeholder="Doctor, family event…"
            defaultValue={PRESETS.includes(initial as (typeof PRESETS)[number]) ? "" : initial}
            required={required}
          />
        ) : (
          <input type="hidden" name="offLabel" value={preset} />
        )}
      </fieldset>
      <p className="text-xs text-muted-foreground">Leave the times blank for whole days. Resort time (Bangkok).</p>
    </>
  );
}

/** One line per blocked person, e.g. "2 booked appointments in the way: Mon, Sep 28 10:00 AM, …". */
export function conflictText(conflicts: TimeOffResults[number]["conflicts"]) {
  const times = conflicts.slice(0, 3).map((c) => `${formatResortDate(c.start)} ${formatResortTime(c.start)}`);
  const more = conflicts.length > 3 ? `, +${conflicts.length - 3} more` : "";
  const count = conflicts.length === 1 ? "1 booked appointment" : `${conflicts.length} booked appointments`;
  return `${count} in the way: ${times.join(", ")}${more}. Reassign or cancel them first.`;
}

/** Same time off for several people at once; anyone with bookings in the way is skipped and listed. */
export function BulkTimeOffDialog({ staff, onClose }: { staff: Doc<"staff">[]; onClose: () => void }) {
  const addTimeOff = useMutation(api.adminServices.addTimeOff);
  const [selected, setSelected] = useState<Set<Id<"staff">>>(() => new Set());
  const [results, setResults] = useState<TimeOffResults | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = resortIsoDate(useNow());
  const allSelected = staff.length > 0 && selected.size === staff.length;

  function toggle(id: Id<"staff">, on: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const input = readTimeOff(new FormData(event.currentTarget));
    setSaving(true);
    setError("");
    try {
      setResults(await addTimeOff({ staffIds: [...selected], ...timeOffRange(input), label: input.label || "Leave" }));
    } catch (err) {
      setError(errorText(err, "Could not add time off."));
    } finally {
      setSaving(false);
    }
  }

  const saved = results?.filter((r) => r.timeOffId).length ?? 0;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Add time off</DialogTitle>
          <DialogDescription>
            {results
              ? `Saved for ${saved} of ${results.length}. People with booked appointments in the way were skipped.`
              : "Pick everyone who's off. Anyone with booked appointments in the way is skipped and listed."}
          </DialogDescription>
        </DialogHeader>
        {results ? (
          <div className="grid gap-4">
            <ul className="divide-y divide-border rounded-lg border border-border">
              {results.map((result) => {
                const person = staff.find((s) => s._id === result.staffId);
                return (
                  <li key={result.staffId} className="flex items-start gap-3 px-3 py-2.5">
                    {person ? <StaffAvatar staff={person} className="size-7" /> : null}
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">{result.name}</p>
                      <p className={cn("text-xs", result.timeOffId ? "text-muted-foreground" : "text-destructive")}>
                        {result.timeOffId ? "Time off saved." : conflictText(result.conflicts)}
                      </p>
                    </div>
                    {result.timeOffId ? (
                      <CircleCheck aria-label="Saved" className={cn("size-4 shrink-0", TONES.success.text)} />
                    ) : (
                      <CircleAlert aria-label="Not saved" className="size-4 shrink-0 text-destructive" />
                    )}
                  </li>
                );
              })}
            </ul>
            <DialogFooter>
              <Button type="button" onClick={onClose}>
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <form onSubmit={submit} className="grid gap-4">
            <div role="group" aria-labelledby="bulk-off-staff" className="grid gap-1">
              <div className="mb-1 flex items-center justify-between">
                <span id="bulk-off-staff" className="text-sm font-medium">
                  Staff
                </span>
                <label className="flex cursor-pointer items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-foreground"
                    checked={allSelected}
                    ref={(el) => {
                      if (el) el.indeterminate = selected.size > 0 && !allSelected;
                    }}
                    onChange={(event) => setSelected(event.target.checked ? new Set(staff.map((s) => s._id)) : new Set())}
                  />
                  Select all
                </label>
              </div>
              <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">
                {staff.map((person) => (
                  <label key={person._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-foreground"
                      checked={selected.has(person._id)}
                      onChange={(event) => toggle(person._id, event.target.checked)}
                    />
                    <StaffAvatar staff={person} className="size-6" />
                    <span className="truncate">{person.name}</span>
                  </label>
                ))}
              </div>
            </div>
            <TimeOffFields idPrefix="bulk-off" min={today} defaults={{ from: today }} required />
            {selected.size === 0 ? <p className="text-sm text-muted-foreground">Pick at least one person.</p> : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={saving || selected.size === 0}>
                {saving ? <Spinner className="text-current" /> : null}
                {selected.size > 1 ? `Add for ${selected.size} people` : "Add time off"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
