"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import { format } from "date-fns";
import { Loader2 } from "lucide-react";
import { useState } from "react";
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
import { errorText } from "@/lib/staff-bookings";
import { SOURCE_LABELS, STATUS, displayDate, statusKey, type AdminProperty } from "./admin-bookings-shared";

const BATCH = 100;

/** Lists deletable test / stale bookings (unpaid pending or cancelled) and deletes the selected ones in batches. */
export function BookingCleanupDialog({ properties, onClose }: { properties: AdminProperty[]; onClose: () => void }) {
  const [days, setDays] = useState("7");
  const olderThanDays = Math.max(0, Number(days) || 0);
  const candidates = useQuery(api.adminBookings.listCleanupCandidates, { olderThanDays });
  const deleteBookings = useMutation(api.adminBookings.deleteBookings);
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Villa";

  const rows = candidates ?? [];
  const chosen = rows.filter((b) => selected.has(b._id));
  const allSelected = rows.length > 0 && chosen.length === rows.length;

  function toggle(id: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function remove() {
    const ok = await confirm({
      title: `Delete ${chosen.length} ${chosen.length === 1 ? "booking" : "bookings"}?`,
      description: "They are removed permanently and any dates they held are released. Paid bookings are never deleted.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    let deleted = 0;
    const skipped: string[] = [];
    try {
      const ids = chosen.map((b) => b._id as Id<"bookings">);
      for (let i = 0; i < ids.length; i += BATCH) {
        const result = await deleteBookings({ bookingIds: ids.slice(i, i + BATCH) });
        deleted += result.deleted;
        skipped.push(...result.skipped.map((s) => s.reason));
      }
      setSelected(new Set());
      setMessage({
        text: `Deleted ${deleted} ${deleted === 1 ? "booking" : "bookings"}.${skipped.length ? ` Skipped ${skipped.length}: ${[...new Set(skipped)].join(" ")}` : ""}`,
      });
    } catch (err) {
      setMessage({ text: errorText(err, "Could not delete the bookings."), error: true });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clean up test bookings</DialogTitle>
          <DialogDescription>
            Unpaid pending or cancelled bookings that were entered by hand in admin, or created more than the chosen number of
            days ago. Anything that was paid stays.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="cleanup-days">Older than (days)</Label>
            <Input
              id="cleanup-days"
              type="number"
              min={0}
              value={days}
              onChange={(event) => setDays(event.target.value)}
              className="h-9 w-28"
            />
          </div>
          {rows.length ? (
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                checked={allSelected}
                onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((b) => b._id)) : new Set())}
              />
              Select all ({rows.length})
            </label>
          ) : null}
        </div>
        {candidates === undefined ? (
          <Loader2 role="status" aria-label="Loading" className="mx-auto my-6 size-5 animate-spin text-gold" />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Nothing to clean up.</p>
        ) : (
          <ul className="grid max-h-[45dvh] gap-1 overflow-y-auto rounded-lg border border-border p-1">
            {rows.map((b) => (
              <li key={b._id}>
                <label className="flex items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-foreground"
                    checked={selected.has(b._id)}
                    onChange={(event) => toggle(b._id, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 font-medium">
                      {b.guestName}
                      <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">
                        <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: STATUS[statusKey(b)].color }} />
                        {STATUS[statusKey(b)].label} · {SOURCE_LABELS[b.source] ?? b.source}
                      </span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {villaName(b.propertyId)} · {displayDate(b.checkIn)} → {displayDate(b.checkOut)} · created{" "}
                      {format(new Date(b.createdAt), "d MMM yyyy")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {message ? (
          <p role={message.error ? "alert" : "status"} className={message.error ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>
            {message.text}
          </p>
        ) : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy || chosen.length === 0}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            Delete {chosen.length || ""} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
