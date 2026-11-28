"use client";

import { addDays } from "convex/shared/dates";
import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { api } from "convex/_generated/api";
import { Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { errorText } from "@/lib/staff-bookings";
import { cellKey, fullDay, plural, weekRange } from "./roster-format";

export type CopyResult = FunctionReturnType<typeof api.services.roster.copyWeek>;

const WEEK_CHOICES = ["4", "10", "20", "custom"] as const;

/** Repeats the shown roster week forward, with a dry-run preview of what it adds, replaces and skips. */
export function CopyWeekDialog({
  weekStart,
  onClose,
  onDone,
}: {
  weekStart: string;
  onClose: () => void;
  onDone: (result: CopyResult, weeks: number) => void;
}) {
  const copyWeek = useMutation(api.services.roster.copyWeek);
  const [choice, setChoice] = useState<(typeof WEEK_CHOICES)[number]>("10");
  const [custom, setCustom] = useState("12");
  const [conflict, setConflict] = useState<"skip" | "overwrite">("skip");
  const [preview, setPreview] = useState<{ key: string; result?: CopyResult; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const weeks = choice === "custom" ? Number(custom) : Number(choice);
  const valid = Number.isInteger(weeks) && weeks >= 1 && weeks <= 52;
  const key = `${weekStart}|${weeks}|${conflict}`;
  const current = preview?.key === key ? preview : null;

  useEffect(() => {
    if (!valid) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      copyWeek({ sourceWeekStart: weekStart, weeks, conflict, dryRun: true })
        .then((result) => !cancelled && setPreview({ key, result }))
        .catch((err: unknown) => !cancelled && setPreview({ key, error: errorText(err, "Could not preview the copy.") }));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [copyWeek, weekStart, weeks, conflict, valid, key]);

  async function submit() {
    setSaving(true);
    setError("");
    try {
      onDone(await copyWeek({ sourceWeekStart: weekStart, weeks, conflict }), weeks);
    } catch (err) {
      setError(errorText(err, "Could not copy the week."));
    } finally {
      setSaving(false);
    }
  }

  const result = current?.result;
  const firstTarget = addDays(weekStart, 7);
  const lastTarget = addDays(weekStart, 7 * (valid ? weeks : 1) + 6);

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Copy this week forward</DialogTitle>
          <DialogDescription>
            Repeats {weekRange(weekStart, addDays(weekStart, 6))} for the weeks after it
            {valid ? ` (${weekRange(firstTarget, lastTarget)})` : ""}.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <p className="text-sm font-medium">How many weeks</p>
            <div className="flex flex-wrap items-center gap-2">
              <ToggleGroup value={choice} onValueChange={setChoice} aria-label="Number of weeks">
                {WEEK_CHOICES.map((value) => (
                  <ToggleGroupItem key={value} value={value}>
                    {value === "custom" ? "Custom" : `${value} weeks`}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              {choice === "custom" ? (
                <Input
                  aria-label="Weeks (1–52)"
                  type="number"
                  min={1}
                  max={52}
                  value={custom}
                  onChange={(event) => setCustom(event.target.value)}
                  className="w-24"
                />
              ) : null}
            </div>
            {!valid ? <p className="text-xs text-destructive">Choose 1–52 weeks.</p> : null}
          </div>
          <div className="space-y-2">
            <p className="text-sm font-medium">Days already changed in those weeks</p>
            <ToggleGroup value={conflict} onValueChange={setConflict} aria-label="Days already changed">
              <ToggleGroupItem value="skip">Keep them</ToggleGroupItem>
              <ToggleGroupItem value="overwrite">Overwrite</ToggleGroupItem>
            </ToggleGroup>
          </div>
          <div aria-live="polite" className="rounded-lg border border-border bg-muted/30 px-3 py-2.5 text-sm">
            {!valid ? (
              <span className="text-muted-foreground">—</span>
            ) : current?.error ? (
              <span className="text-destructive">{current.error}</span>
            ) : !result ? (
              <span className="flex items-center gap-2 text-muted-foreground">
                <Spinner className="text-current" /> Checking…
              </span>
            ) : (
              <>
                <p className="font-medium">
                  Adds {result.created}, replaces {result.updated}, skips {result.skippedCount}
                </p>
                <p className="text-xs text-muted-foreground">
                  {result.unchanged} already match. Days that follow the weekly default stay on the default.
                </p>
                {result.skipped.length ? (
                  <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto text-xs">
                    {result.skipped.map((cell) => (
                      <li key={cellKey(cell.staffId, cell.date)} className="flex gap-2">
                        <span className="w-32 shrink-0 font-medium">{fullDay.format(cell.date)}</span>
                        <span className="min-w-0 truncate">
                          {cell.staffName} —{" "}
                          {cell.reason === "override"
                            ? "already changed"
                            : `${plural(cell.appointments, "appointment")} would fall outside`}
                        </span>
                      </li>
                    ))}
                    {result.skippedCount > result.skipped.length ? (
                      <li className="text-muted-foreground">and {result.skippedCount - result.skipped.length} more</li>
                    ) : null}
                  </ul>
                ) : null}
              </>
            )}
          </div>
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" disabled={!valid || saving || !result} onClick={submit}>
            {saving ? <Spinner className="text-current" /> : <Copy aria-hidden className="size-4" />}
            Copy to {valid ? plural(weeks, "week") : "weeks"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
