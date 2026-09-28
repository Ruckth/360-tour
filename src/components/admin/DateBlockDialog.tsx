"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { Loader2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDaysIso, isDateInIsoList, rangeIntersectsDates, todayIsoLocal } from "@/lib/booking/dates";
import { errorText } from "@/lib/staff-bookings";
import { SOURCE_LABELS, displayDate, isoNights, type AdminProperty, type DateBlock } from "./admin-bookings-shared";

export type BlockTarget =
  | { kind: "new"; propertyId?: string; start?: string; end?: string }
  | { kind: "host"; block: DateBlock }
  | { kind: "ota"; propertyId: string; start: string; end: string; source: string };

/** Add / edit / remove a host date block. OTA-imported nights open read-only. */
export function DateBlockDialog({
  target,
  properties,
  onClose,
}: {
  target: BlockTarget;
  properties: AdminProperty[];
  onClose: () => void;
}) {
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Villa";

  if (target.kind === "ota") {
    const source = SOURCE_LABELS[target.source] ?? target.source;
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Imported from {source}</DialogTitle>
            <DialogDescription>
              {villaName(target.propertyId)} · {displayDate(target.start)} → {displayDate(target.end)}
            </DialogDescription>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            {target.source === "manual" || target.source === "direct"
              ? "This older block has no editable record."
              : `These nights come from the ${source} calendar feed and are read-only here. Change them on ${source}, or remove the feed under OTA calendars.`}
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  if (target.kind === "host") {
    return <HostBlockForm key={target.block._id} block={target.block} properties={properties} onClose={onClose} />;
  }
  return <HostBlockForm block={null} prefill={target} properties={properties} onClose={onClose} />;
}

type BlockResult = { propertyId: string; error: string | null };

function HostBlockForm({
  block,
  prefill,
  properties,
  onClose,
}: {
  block: DateBlock | null;
  prefill?: { propertyId?: string; start?: string; end?: string };
  properties: AdminProperty[];
  onClose: () => void;
}) {
  const addDateBlocks = useMutation(api.adminBookings.addDateBlocks);
  const updateDateBlock = useMutation(api.adminBookings.updateDateBlock);
  const removeDateBlock = useMutation(api.adminBookings.removeDateBlock);
  const confirm = useConfirm();
  // A new block can cover several villas at once (one block per villa); an existing one stays on its villa.
  const [propertyIds, setPropertyIds] = useState<string[]>(() => [
    block?.propertyId ?? prefill?.propertyId ?? properties[0]?._id ?? "",
  ]);
  const [dates, setDates] = useState({
    checkIn: block?.start ?? prefill?.start ?? "",
    checkOut: block?.end ?? prefill?.end ?? "",
  });
  const [reason, setReason] = useState(block?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<BlockResult[] | null>(null);
  const propertyId = propertyIds.length === 1 ? propertyIds[0] : "";
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Villa";

  const today = todayIsoLocal();
  // Date hints only make sense for a single villa; with several, conflicts are reported per villa on save.
  const blockedDates =
    useQuery(
      api.availability.getBlockedDates,
      propertyId ? { propertyId: propertyId as Id<"properties">, startDate: today, endDate: addDaysIso(today, 365) } : "skip",
    ) ?? [];
  const ownNights = new Set(block && block.propertyId === propertyId ? isoNights(block.start, block.end) : []);
  const otherBlocked = blockedDates.filter((date) => !ownNights.has(date));
  const otherBlockedSet = new Set(otherBlocked);
  const conflicts = rangeIntersectsDates(otherBlocked, dates.checkIn, dates.checkOut);

  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save the block."));
      setBusy(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    const range = { start: dates.checkIn, end: dates.checkOut, reason };
    if (block) {
      void run(() => updateDateBlock({ blockId: block._id, propertyId: propertyId as Id<"properties">, ...range }));
      return;
    }
    setBusy(true);
    setError("");
    try {
      const saved = await addDateBlocks({ propertyIds: propertyIds as Id<"properties">[], ...range });
      if (saved.every((result) => result.error === null)) {
        onClose();
        return;
      }
      setResults(saved);
    } catch (err) {
      setError(errorText(err, "Could not save the block."));
    }
    setBusy(false);
  }

  async function remove() {
    if (!block) return;
    const ok = await confirm({
      title: "Remove this block?",
      description: "The nights become bookable again.",
      confirmLabel: "Remove block",
      destructive: true,
    });
    if (ok) await run(() => removeDateBlock({ blockId: block._id }));
  }

  function toggleVilla(id: string, checked: boolean) {
    setPropertyIds((current) => (checked ? [...current, id] : current.filter((other) => other !== id)));
  }

  if (results) {
    const blocked = results.filter((result) => result.error === null);
    return (
      <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Blocked {blocked.length} of {results.length} villas
            </DialogTitle>
            <DialogDescription>
              {displayDate(dates.checkIn)} → {displayDate(dates.checkOut)}. Villas with a conflict were left open.
            </DialogDescription>
          </DialogHeader>
          <ul className="grid gap-2 text-sm">
            {results.map((result) => (
              <li key={result.propertyId} className="rounded-lg border border-border px-3 py-2">
                <span className="font-medium">{villaName(result.propertyId)}</span>
                <span className={result.error ? "block text-destructive" : "block text-muted-foreground"}>
                  {result.error ?? "Blocked"}
                </span>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button onClick={onClose}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  const allSelected = propertyIds.length === properties.length;

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{block ? "Edit date block" : "Block dates"}</DialogTitle>
          <DialogDescription>
            Close a villa for an owner stay, maintenance or similar. Blocked nights cannot be booked and are shared with OTA calendars.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          {block ? (
            <div className="grid gap-2">
              <Label>Villa</Label>
              <Select value={propertyId} onValueChange={(id) => setPropertyIds([id])}>
                <SelectTrigger className="rounded-lg" aria-label="Villa">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {properties.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : (
            <fieldset className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <legend className="text-sm font-medium">Villas</legend>
                {properties.length > 1 ? (
                  <button
                    type="button"
                    className="text-xs font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                    onClick={() => setPropertyIds(allSelected ? [] : properties.map((p) => p._id))}
                  >
                    {allSelected ? "Clear" : "Select all"}
                  </button>
                ) : null}
              </div>
              <div className="grid max-h-40 gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {properties.map((p) => (
                  <label key={p._id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="size-4 accent-foreground"
                      checked={propertyIds.includes(p._id)}
                      onChange={(event) => toggleVilla(p._id, event.target.checked)}
                    />
                    {p.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <BookingRangePicker
            checkIn={dates.checkIn}
            checkOut={dates.checkOut}
            onChange={setDates}
            isDateDisabled={(date) => isDateInIsoList(date, otherBlockedSet)}
            unavailableDates={otherBlocked}
            helperText={
              propertyIds.length > 1
                ? "Pick the first blocked night, then the day the villas are free again. Conflicts are checked per villa."
                : "Pick the first blocked night, then the day the villa is free again."
            }
          />
          {conflicts ? (
            <p className="text-sm text-destructive">These dates overlap a booking or another block.</p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="block-reason">Reason</Label>
            <Input
              id="block-reason"
              value={reason}
              maxLength={200}
              placeholder="Owner stay, maintenance…"
              onChange={(event) => setReason(event.target.value)}
              required
            />
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="gap-2">
            {block ? (
              <Button type="button" variant="ghost" className="text-destructive sm:me-auto" onClick={remove} disabled={busy}>
                Remove block
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button
              type="submit"
              disabled={busy || propertyIds.length === 0 || !dates.checkIn || !dates.checkOut || !reason.trim() || conflicts}
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {block ? "Save block" : propertyIds.length > 1 ? `Block ${propertyIds.length} villas` : "Block dates"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
