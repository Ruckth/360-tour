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
  | { kind: "new" }
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

  return <HostBlockForm block={target.kind === "host" ? target.block : null} properties={properties} onClose={onClose} />;
}

function HostBlockForm({
  block,
  properties,
  onClose,
}: {
  block: DateBlock | null;
  properties: AdminProperty[];
  onClose: () => void;
}) {
  const addDateBlock = useMutation(api.adminBookings.addDateBlock);
  const updateDateBlock = useMutation(api.adminBookings.updateDateBlock);
  const removeDateBlock = useMutation(api.adminBookings.removeDateBlock);
  const confirm = useConfirm();
  const [propertyId, setPropertyId] = useState<string>(block?.propertyId ?? properties[0]?._id ?? "");
  const [dates, setDates] = useState({ checkIn: block?.start ?? "", checkOut: block?.end ?? "" });
  const [reason, setReason] = useState(block?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const today = todayIsoLocal();
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

  function submit(event: FormEvent) {
    event.preventDefault();
    const args = {
      propertyId: propertyId as Id<"properties">,
      start: dates.checkIn,
      end: dates.checkOut,
      reason,
    };
    void run(() => (block ? updateDateBlock({ blockId: block._id, ...args }) : addDateBlock(args)));
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

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{block ? "Edit date block" : "Block dates"}</DialogTitle>
          <DialogDescription>
            Close a villa for an owner stay, maintenance or similar. Blocked nights cannot be booked and are shared with OTA calendars.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label>Villa</Label>
            <Select value={propertyId} onValueChange={setPropertyId}>
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
          <BookingRangePicker
            checkIn={dates.checkIn}
            checkOut={dates.checkOut}
            onChange={setDates}
            isDateDisabled={(date) => isDateInIsoList(date, otherBlockedSet)}
            unavailableDates={otherBlocked}
            helperText="Pick the first blocked night, then the day the villa is free again."
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
            <Button type="submit" disabled={busy || !propertyId || !dates.checkIn || !dates.checkOut || !reason.trim() || conflicts}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : null}
              {block ? "Save block" : "Block dates"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
