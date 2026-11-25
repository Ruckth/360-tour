"use client";

import { useMutation, useQuery } from "convex/react";
import { ConvexError } from "convex/values";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { PhotoPickerButton } from "@/components/admin/PhotoPickerButton";
import { HistoryDisclosure, RecordHistoryPanel } from "@/components/admin/RecordHistoryPanel";
import { ServiceOptionsEditor, useServiceOptions } from "@/components/admin/ServiceOptionsEditor";
import { ServiceThumb } from "@/components/admin/ServicePhoto";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { usePhotoDraft } from "@/components/admin/usePhotoDraft";
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
import { Spinner } from "@/components/ui/spinner";
import { errorText } from "@/lib/staff-bookings";

type Service = Doc<"services">;
type Staff = Doc<"staff">;

const refusalCode = (err: unknown) =>
  err instanceof ConvexError && err.data && typeof err.data === "object" && "code" in err.data ? err.data.code : null;

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Names with no Latin letters or digits (e.g. Thai-only) would give an empty slug.
  return slug || `service-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
}

export function ServiceDialog({ service, latest, staff, onClose }: { service?: Service; latest?: Service; staff: Staff[]; onClose: () => void }) {
  const createService = useMutation(api.services.commands.createService.createService);
  const updateService = useMutation(api.services.commands.updateService.updateService);
  const upcoming = useQuery(api.services.admin.countUpcomingAppointments, service ? { serviceId: service._id } : "skip");
  const usage = useQuery(api.services.admin.upcomingOptionUsage, service ? { serviceId: service._id } : "skip");
  const confirm = useConfirm();
  // Only active staff can be assigned; archived ones already left the service.
  const activeStaffIds = new Set(staff.map((person) => person._id));
  const activeAssignments = (ids: Iterable<Id<"staff">>) => [...ids].filter((id) => activeStaffIds.has(id));
  const [staffIds, setStaffIds] = useState(() => new Set(activeAssignments(service?.staffIds ?? [])));
  const selectedStaffIds = activeAssignments(staffIds);
  const options = useServiceOptions(service);
  const [name, setName] = useState(service?.name ?? "");
  const [category, setCategory] = useState(service?.category ?? "");
  const [description, setDescription] = useState(service?.description ?? "");
  const [bufferMin, setBufferMin] = useState(String(service?.bufferMin ?? 15));
  // The version these edits are based on. Save sends only what differs from it; "Reload" moves
  // it to the latest, which fills in every field the admin hasn't changed.
  const [base, setBase] = useState(service);
  const [conflict, setConflict] = useState<false | "stale" | "unavailable">(false);
  const [notice, setNotice] = useState("");
  const saveButton = useRef<HTMLButtonElement>(null);
  const reloadButton = useRef<HTMLButtonElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const photo = usePhotoDraft(service?.imageUrl);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const busy = saving || photoBusy;
  const currency = service?.currency ?? "THB";

  const baseStaffIds = new Set(activeAssignments(base?.staffIds ?? []));
  const staffChanged = selectedStaffIds.length !== baseStaffIds.size || selectedStaffIds.some((id) => !baseStaffIds.has(id));
  const needsStaff = selectedStaffIds.length === 0 && (!base || staffChanged);

  /** Which fields differ from the base; lengths, prices and the default count as one. */
  function changedFrom(version: Service) {
    return {
      name: name.trim() !== version.name,
      category: category.trim() !== version.category,
      description: description.trim() !== (version.description ?? ""),
      terms: !options.matches(version),
      bufferMin: Number(bufferMin) !== version.bufferMin,
      staffIds: staffChanged,
    };
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (needsStaff) return;
    const terms = options.payload(Number(bufferMin));
    if (!terms) {
      event.currentTarget.querySelector<HTMLInputElement>("[aria-invalid=true]")?.focus();
      return;
    }
    const values = {
      name: name.trim(),
      category: category.trim(),
      description: description.trim(),
      bufferMin: Number(bufferMin),
      staffIds: selectedStaffIds,
    };
    // An edit sends only what this admin changed, so a save never undoes someone else's change.
    const changed = base && changedFrom(base);
    const fields: Partial<typeof values> = changed
      ? Object.fromEntries(Object.entries(values).filter(([key]) => changed[key as keyof typeof values]))
      : values;
    // A new default turnaround is for new bookings; booked appointments keep their own.
    if (
      base &&
      fields.bufferMin !== undefined &&
      !(await confirm({
        title: `Change the default turnaround from ${base.bufferMin} to ${fields.bufferMin} min?`,
        description: `Applies to new bookings only. ${
          upcoming === undefined
            ? "Upcoming appointments"
            : upcoming === 1
              ? "The 1 upcoming appointment"
              : `The ${upcoming} upcoming appointments`
        } keep their current turnaround; change one from its details on the calendar.`,
        confirmLabel: "Change default",
        cancelLabel: "Keep current default",
      }))
    ) {
      return;
    }
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const save = (imageStorageId?: Id<"_storage"> | null) =>
        base
          ? updateService({ serviceId: base._id, ...fields, ...(changed?.terms ? terms : {}), imageStorageId, expectedRevision: base.revision ?? 0 })
          : createService({ ...values, ...terms, slug: slugify(values.name), currency, imageStorageId: imageStorageId ?? undefined });
      await photo.save(save);
      onClose();
    } catch (err) {
      if (refusalCode(err) === "STALE_ADJUSTMENT_REVISION") {
        flushSync(() => setConflict("stale"));
        reloadButton.current?.focus();
      }
      else setError(errorText(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  // Fields this admin changed keep their values; every other field takes the latest one.
  function reload() {
    if (!base || !latest || (latest.revision ?? 0) === (base.revision ?? 0)) {
      setConflict("unavailable");
      return;
    }
    const changed = changedFrom(base);
    if (!changed.name) setName(latest.name);
    if (!changed.category) setCategory(latest.category);
    if (!changed.description) setDescription(latest.description ?? "");
    if (!changed.terms) options.load(latest);
    if (!changed.bufferMin) setBufferMin(String(latest.bufferMin));
    // Apply this admin's assignment changes to the live set, which may have lost archived staff.
    const refreshedStaffIds = new Set(activeAssignments(latest.staffIds));
    for (const id of baseStaffIds) {
      if (!staffIds.has(id)) refreshedStaffIds.delete(id);
    }
    for (const id of selectedStaffIds) {
      if (!baseStaffIds.has(id)) refreshedStaffIds.add(id);
    }
    setStaffIds(refreshedStaffIds);
    setBase(latest);
    setConflict(false);
    setNotice("Loaded the latest version. Your changes are kept.");
    saveButton.current?.focus();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      {/* Header and actions stay put; the fields scroll between them, so Save is always in reach. */}
      <DialogContent className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : "Add service"}</DialogTitle>
          <DialogDescription>Turnaround is cleanup or travel time after the service. The staff member stays blocked for it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-col gap-3">
          <div className="-mx-1 grid min-h-0 gap-4 overflow-y-auto px-1 pb-1">
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px]">
              <div className="grid gap-2">
                <Label htmlFor="sv-name">Name</Label>
                <Input id="sv-name" name="name" value={name} onChange={(event) => setName(event.target.value)} required />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="sv-category">Category</Label>
                <Input id="sv-category" name="category" value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Wellness" required />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="sv-description">Description</Label>
              <Input id="sv-description" name="description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
            <div className="grid justify-items-start gap-2">
              <p className="text-sm font-medium">Photo (optional)</p>
              <PhotoPickerButton
                label
                shape="rounded-lg"
                photoUrl={photo.url}
                name={service?.name ?? ""}
                unnamed="new service"
                thumb={<ServiceThumb service={{ name: service?.name ?? "", category: service?.category ?? "", imageUrl: photo.url }} className="size-14" />}
                title={service ? `${service.name} photo` : "Service photo"}
                description="Shown in the service picker when booking. Tap it there to see it large."
                disabled={saving}
                onPhoto={photo.choose}
                onRemove={photo.remove}
                onError={setPhotoError}
                onBusyChange={setPhotoBusy}
              />
              {photoError ? (
                <p role="alert" className="text-sm text-destructive">{photoError}</p>
              ) : photo.changed ? (
                <p className="text-xs text-muted-foreground">
                  {photo.removing ? "The photo is removed when you save." : "The new photo is saved when you save."}
                </p>
              ) : null}
            </div>
            <ServiceOptionsEditor state={options} bufferMin={Number(bufferMin)} currency={currency} serviceName={name} usage={usage} />
            <div className="grid gap-2 max-w-40">
              <Label htmlFor="sv-buffer">Turnaround (min)</Label>
              <Input id="sv-buffer" name="bufferMin" type="number" min={0} step={5} value={bufferMin} onChange={(event) => setBufferMin(event.target.value)} required />
            </div>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">Who can perform it</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {staff.map((person) => (
                  <label key={person._id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <input
                      type="checkbox"
                      className="size-4 accent-foreground"
                      checked={staffIds.has(person._id)}
                      onChange={(event) =>
                        setStaffIds((current) => {
                          const next = new Set(current);
                          if (event.target.checked) next.add(person._id);
                          else next.delete(person._id);
                          return next;
                        })
                      }
                    />
                    <StaffAvatar staff={person} className="size-6" />
                    <span className="truncate">{person.name}</span>
                    <span className="truncate text-xs text-muted-foreground">{person.role}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            {service ? <HistoryDisclosure>
              <RecordHistoryPanel entityType="service" entityId={service._id} title={`${service.name} history`} />
            </HistoryDisclosure> : null}
            {selectedStaffIds.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {needsStaff ? "Pick at least one person to save." : "Assign a staff member to make this service bookable."}
              </p>
            ) : null}
          </div>
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          {conflict ? (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-foreground">
              {conflict === "stale"
                ? "Someone else changed this service."
                : "Someone else changed this service, and the latest version hasn't loaded yet. Try again in a moment, or close without saving."}
              <Button ref={reloadButton} type="button" size="sm" variant="outline" onClick={reload}>
                Reload &amp; keep my edits
              </Button>
            </div>
          ) : notice ? (
            <p role="status" className="text-sm text-muted-foreground">{notice}</p>
          ) : null}
          <DialogFooter className="shrink-0 flex-row justify-end border-t border-border pt-3">
            <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
              Cancel
            </Button>
            <Button ref={saveButton} type="submit" disabled={busy || needsStaff}>
              {saving ? <Spinner className="text-current" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
