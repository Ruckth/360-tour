"use client";

import { staffDate } from "@/lib/staff-time";
import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import { useRef, useState } from "react";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";
import { StatusBadge } from "./StatusBadge";
import { displayDate, hotelStatus, statusKey, type AdminProperty } from "./admin-bookings-shared";
import { sourceLabel } from "./labels";

const BATCH = 100;

/** Lists deletable test / stale bookings (unpaid pending or cancelled) and deletes the selected ones in batches. */
export function BookingCleanupDialog({ properties, onClose }: { properties: AdminProperty[]; onClose: () => void }) {
  // The draft is what is typed; only a whole number of days is applied, so clearing the input never queries 0 days.
  const [days, setDays] = useState("7");
  const [olderThanDays, setOlderThanDays] = useState(7);
  const parsedDays = /^\d+$/.test(days.trim()) ? Number(days.trim()) : NaN;
  const draftDays = Number.isSafeInteger(parsedDays) ? parsedDays : null;
  const [refreshToken, setRefreshToken] = useState<string>();
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const active = useRef(false);
  const candidates = useQuery(api.bookings.admin.listCleanupCandidates, { olderThanDays, refreshToken });
  const applyDays = () => {
    if (active.current || needsRefresh || draftDays === null || draftDays === olderThanDays) return;
    setSelected(new Map());
    setOlderThanDays(draftDays);
  };
  const deleteBookings = useMutation(api.bookings.commands.deleteBookings.deleteBookings);
  const confirm = useConfirm();
  const [selected, setSelected] = useState<Map<string, number>>(() => new Map());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [skippedRows, setSkippedRows] = useState<Array<{ bookingId: string; reason: string; guestName?: string }>>([]);
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Villa";

  const rows = candidates ?? [];
  const chosen = rows.filter((b) => selected.get(b._id) === b.revision);
  const allSelected = rows.length > 0 && chosen.length === rows.length;

  function toggle(id: string, revision: number, checked: boolean) {
    setSelected((current) => {
      const next = new Map(current);
      if (checked) next.set(id, revision);
      else next.delete(id);
      return next;
    });
  }

  async function remove() {
    if (active.current || needsRefresh || !chosen.length) return;
    active.current = true;
    const ok = await confirm({
      title: `Delete ${chosen.length} ${chosen.length === 1 ? "booking" : "bookings"}?`,
      description: "They are removed permanently and any dates they held are released. Paid bookings are never deleted.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) {
      active.current = false;
      return;
    }
    setBusy(true);
    setMessage(null);
    setSkippedRows([]);
    let deleted = 0;
    let confirmedBatches = 0;
    const skipped: Array<{ bookingId: string; reason: string; guestName?: string }> = [];
    const names = new Map(chosen.map((b) => [b._id as string, b.guestName]));
    const ids = chosen.map((b) => b._id);
    const batches = Math.ceil(ids.length / BATCH);
    const plural = (n: number) => `${n} ${n === 1 ? "booking" : "bookings"}`;
    try {
      for (let i = 0; i < ids.length; i += BATCH) {
        const result = await deleteBookings({
          bookingIds: ids.slice(i, i + BATCH),
          review: {
            olderThanDays,
            revisions: chosen.slice(i, i + BATCH).map((b) => ({ bookingId: b._id, revision: b.revision })),
          },
        });
        deleted += result.deleted;
        confirmedBatches += 1;
        skipped.push(...result.skipped.map((row) => ({ ...row, guestName: names.get(row.bookingId) })));
      }
      setSelected(new Map());
      setMessage({ text: `Deleted ${plural(deleted)}.${skipped.length ? ` Skipped ${skipped.length}.` : ""}` });
    } catch (err) {
      setSelected(new Map());
      setNeedsRefresh(true);
      setMessage({
        text: `Batch ${confirmedBatches + 1} of ${batches} did not confirm: ${errorText(err, "Could not delete the bookings.")} ` +
          `Confirmed so far: deleted ${plural(deleted)}${skipped.length ? `, skipped ${skipped.length}` : ""}. ` +
          `Batches never attempted: ${batches - confirmedBatches - 1}. Reload candidates and review them before retrying.`,
        error: true,
      });
    } finally {
      setSkippedRows(skipped);
      active.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (!open && !active.current ? onClose() : undefined)}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Clean up test bookings</DialogTitle>
          <DialogDescription>
            Unpaid pending or cancelled bookings. &ldquo;Older than&rdquo; applies to online bookings; ones entered by hand in admin are
            listed at any age. Anything that was paid stays.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-end gap-3">
          <form
            className="flex items-end gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              applyDays();
            }}
          >
            <div className="grid gap-1.5">
              <Label htmlFor="cleanup-days">Older than (days)</Label>
              <Input
                id="cleanup-days"
                type="number"
                min={0}
                step={1}
                inputMode="numeric"
                value={days}
                onChange={(event) => setDays(event.target.value)}
                disabled={busy || needsRefresh}
                aria-describedby="cleanup-days-hint"
                className="h-9 w-28"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-9" disabled={busy || needsRefresh || draftDays === null || draftDays === olderThanDays}>
              Apply
            </Button>
          </form>
          {rows.length ? (
            <label className="flex h-9 items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-foreground"
                disabled={busy || needsRefresh}
                checked={allSelected}
                onChange={(event) => setSelected(event.target.checked ? new Map(rows.map((b) => [b._id, b.revision])) : new Map())}
              />
              Select all ({rows.length})
            </label>
          ) : null}
        </div>
        <p id="cleanup-days-hint" className="text-xs text-muted-foreground">
          Showing online bookings created more than {olderThanDays} {olderThanDays === 1 ? "day" : "days"} ago, plus hand-entered ones.
          {draftDays === null ? " Enter a whole number of days; the current filter stays until you do." : null}
        </p>
        {candidates === undefined ? (
          <ul role="status" aria-label="Loading bookings" className="grid gap-1 rounded-lg border border-border p-1">
            {Array.from({ length: 4 }, (_, i) => (
              <li key={i} className="grid gap-1.5 px-2 py-2">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3 w-2/3" />
              </li>
            ))}
          </ul>
        ) : rows.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
            Nothing to clean up{olderThanDays > 0 ? `. Lower "Older than" to include newer bookings.` : "."}
          </p>
        ) : (
          <ul className="grid max-h-[45dvh] gap-1 overflow-y-auto rounded-lg border border-border p-1">
            {rows.map((b) => (
              <li key={b._id}>
                <label className="flex items-start gap-3 rounded-md px-2 py-2 text-sm hover:bg-muted">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 accent-foreground"
                    disabled={busy || needsRefresh}
                    checked={selected.get(b._id) === b.revision}
                    onChange={(event) => toggle(b._id, b.revision, event.target.checked)}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 font-medium">
                      {b.guestName}
                      <StatusBadge {...hotelStatus(statusKey(b))} />
                      <span className="text-xs font-normal text-muted-foreground">{sourceLabel(b.source)}</span>
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {villaName(b.propertyId)} · {displayDate(b.checkIn)} → {displayDate(b.checkOut)} · created{" "}
                      {staffDate(b.createdAt)}
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
        {skippedRows.length ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Skipped bookings ({skippedRows.length})</summary>
            <ul className="mt-1 grid gap-1">
              {skippedRows.map((row) => (
                <li key={row.bookingId} className="text-xs">
                  {row.guestName ? `${row.guestName} · ` : null}<span className="font-mono">…{row.bookingId.slice(-6)}</span> · {row.reason}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
        <DialogFooter>
          {needsRefresh ? <Button variant="outline" onClick={() => {
            setRefreshToken(crypto.randomUUID());
            setNeedsRefresh(false);
          }}>Reload candidates</Button> : null}
          <Button variant="outline" disabled={busy} onClick={() => { if (!active.current) onClose(); }}>
            Close
          </Button>
          <Button variant="destructive" onClick={remove} disabled={busy || needsRefresh || chosen.length === 0}>
            {busy ? <Spinner className="text-current" /> : null}
            Delete {chosen.length || ""} selected
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
