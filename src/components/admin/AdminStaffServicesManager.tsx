"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Archive, Loader2, Pencil, PlusIcon } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { Badge } from "@/components/ui/badge";
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
import { DAY_MS, WEEKDAYS, errorText, money, resortIsoDate, resortMidnight, useNow } from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

type Staff = Doc<"staff">;
type Service = Doc<"services">;

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Hours as one line, e.g. "Mon–Fri 09:00–18:00". Mixed schedules list each shift. */
function hoursSummary(staff: Staff) {
  if (!staff.workingHours.length) return "No working hours";
  const shifts = new Map<string, number[]>();
  for (const row of staff.workingHours) {
    const key = `${row.start}–${row.end}`;
    shifts.set(key, [...(shifts.get(key) ?? []), row.weekday]);
  }
  return [...shifts]
    .map(([time, days]) => (days.length === 7 ? `Daily ${time}` : `${days.sort().map((d) => WEEKDAYS[d]).join(", ")} ${time}`))
    .join(" · ");
}

export function AdminStaffServicesManager({ section }: { section: "staff" | "services" }) {
  const staff = useQuery(api.adminServices.listStaff, { includeArchived: true });
  const services = useQuery(api.adminServices.listServices, { includeArchived: true });
  const [editing, setEditing] = useState<{ kind: "staff"; staff?: Staff } | { kind: "service"; service?: Service } | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archiveStaff = useMutation(api.adminServices.archiveStaff);
  const archiveService = useMutation(api.adminServices.archiveService);
  const [error, setError] = useState("");

  if (!staff || !services) {
    return <Loader2 className="mx-auto my-16 size-5 animate-spin text-gold" />;
  }

  const staffNames = new Map(staff.map((s) => [s._id as string, s.name]));
  const rows = section === "staff" ? staff : services;
  const archivedCount = rows.filter((row) => row.status === "archived").length;

  async function archive(action: () => Promise<unknown>, what: string) {
    if (!window.confirm(`Archive ${what}? It will no longer be bookable.`)) return;
    setError("");
    try {
      await action();
    } catch (err) {
      setError(errorText(err, "Could not archive."));
    }
  }

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <p className="flex-1 text-sm text-muted-foreground">
          {section === "staff"
            ? "Who performs services, and when they work. Breaks show as blocked time on the calendar."
            : "What guests can book, how long it takes, and who can do it."}
        </p>
        {archivedCount ? (
          <Button size="sm" variant={showArchived ? "secondary" : "outline"} onClick={() => setShowArchived((v) => !v)}>
            Show archived ({archivedCount})
          </Button>
        ) : null}
        <Button
          size="sm"
          disabled={section === "services" && !staff.some((s) => s.status === "active")}
          onClick={() => setEditing(section === "staff" ? { kind: "staff" } : { kind: "service" })}
        >
          <PlusIcon aria-hidden className="size-4" />
          {section === "staff" ? "Add staff" : "Add service"}
        </Button>
      </div>
      {error ? <p className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">{error}</p> : null}

      <ul className="divide-y divide-border">
        {section === "staff"
          ? staff
              .filter((s) => showArchived || s.status === "active")
              .map((s) => (
                <Row
                  key={s._id}
                  archived={s.status === "archived"}
                  leading={<StaffAvatar staff={s} className="size-10" />}
                  title={s.name}
                  subtitle={`${s.role} · ${hoursSummary(s)}`}
                  onEdit={() => setEditing({ kind: "staff", staff: s })}
                  onArchive={() => archive(() => archiveStaff({ staffId: s._id }), s.name)}
                />
              ))
          : services
              .filter((s) => showArchived || s.status === "active")
              .map((s) => (
                <Row
                  key={s._id}
                  archived={s.status === "archived"}
                  leading={
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold text-muted-foreground">
                      {s.durationMin}′
                    </span>
                  }
                  title={s.name}
                  subtitle={`${s.category} · ${s.durationMin} min${s.bufferMin ? ` + ${s.bufferMin} min turnaround` : ""} · ${money(s.price, s.currency)} · ${s.staffIds.map((id) => staffNames.get(id) ?? "?").join(", ")}`}
                  onEdit={() => setEditing({ kind: "service", service: s })}
                  onArchive={() => archive(() => archiveService({ serviceId: s._id }), s.name)}
                />
              ))}
        {rows.length === 0 ? (
          <li className="px-4 py-10 text-center text-sm text-muted-foreground">
            {section === "staff" ? "No staff yet." : "No services yet."}
          </li>
        ) : null}
      </ul>

      {editing?.kind === "staff" ? (
        <StaffDialog key={editing.staff?._id ?? "new"} staff={editing.staff} onClose={() => setEditing(null)} />
      ) : null}
      {editing?.kind === "service" ? (
        <ServiceDialog
          key={editing.service?._id ?? "new"}
          service={editing.service}
          staff={staff.filter((s) => s.status === "active" || editing.service?.staffIds.includes(s._id))}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </section>
  );
}

function Row({
  leading,
  title,
  subtitle,
  archived,
  onEdit,
  onArchive,
}: {
  leading: ReactNode;
  title: string;
  subtitle: string;
  archived: boolean;
  onEdit: () => void;
  onArchive: () => void;
}) {
  return (
    <li className={cn("flex items-center gap-3 px-4 py-3", archived && "opacity-60")}>
      {leading}
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
          {title}
          {archived ? <Badge variant="outline">Archived</Badge> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit} aria-label={`Edit ${title}`}>
        <Pencil aria-hidden className="size-4" />
      </Button>
      {!archived ? (
        <Button size="sm" variant="ghost" onClick={onArchive} aria-label={`Archive ${title}`}>
          <Archive aria-hidden className="size-4" />
        </Button>
      ) : null}
    </li>
  );
}

function Field({ label, htmlFor, children, className }: { label: string; htmlFor?: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

/** The form edits one shift and one break for the chosen days; anything richer is kept as-is. */
function isSimpleSchedule(staff?: Staff) {
  if (!staff) return true;
  const distinct = (values: string[]) => new Set(values).size;
  const workDays = staff.workingHours.map((row) => row.weekday);
  const breakDays = staff.breaks.map((row) => row.weekday);
  return (
    distinct(staff.workingHours.map((row) => `${row.start}-${row.end}`)) <= 1 &&
    distinct(workDays.map(String)) === workDays.length &&
    distinct(staff.breaks.map((row) => `${row.start}-${row.end}-${row.label}`)) <= 1 &&
    (breakDays.length === 0 || [...breakDays].sort().join() === [...workDays].sort().join())
  );
}

function StaffDialog({ staff, onClose }: { staff?: Staff; onClose: () => void }) {
  const createStaff = useMutation(api.adminServices.createStaff);
  const updateStaff = useMutation(api.adminServices.updateStaff);
  const addTimeOff = useMutation(api.adminServices.addTimeOff);
  // The form edits one shift and one daily break applied to the chosen days.
  const firstShift = staff?.workingHours[0];
  const firstBreak = staff?.breaks[0];
  const [days, setDays] = useState<Set<number>>(
    () => new Set(staff ? staff.workingHours.map((row) => row.weekday) : [0, 1, 2, 3, 4, 5, 6]),
  );
  const [hasBreak, setHasBreak] = useState(staff ? Boolean(firstBreak) : true);
  const simpleSchedule = isSimpleSchedule(staff);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = resortIsoDate(useNow());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const weekdays = [...days].sort();
    const profile = {
      name: text("name"),
      role: text("role"),
      avatarUrl: text("avatarUrl") || undefined,
      color: text("color"),
    };
    const schedule = {
      workingHours: weekdays.map((weekday) => ({ weekday, start: text("start"), end: text("end") })),
      breaks: hasBreak
        ? weekdays.map((weekday) => ({ weekday, start: text("breakStart"), end: text("breakEnd"), label: text("breakLabel") }))
        : [],
    };
    const offFrom = text("offFrom");
    const timeOff = (staffId: Id<"staff">) =>
      addTimeOff({
        staffId,
        start: resortMidnight(offFrom),
        end: resortMidnight(text("offTo") || offFrom) + DAY_MS,
        label: text("offLabel") || "Time off",
      });
    setSaving(true);
    setError("");
    try {
      if (staff) {
        // Time off first: if it clashes with a booking, nothing else is saved either.
        if (offFrom) await timeOff(staff._id);
        await updateStaff({ staffId: staff._id, ...profile, ...(simpleSchedule ? schedule : {}) });
      } else {
        const staffId = await createStaff({ ...profile, ...schedule });
        if (offFrom) await timeOff(staffId);
      }
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{staff ? `Edit ${staff.name}` : "Add staff"}</DialogTitle>
          <DialogDescription>Resort time (Bangkok). Breaks and time off block bookings automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_56px] gap-3">
            <Field label="Name" htmlFor="st-name">
              <Input id="st-name" name="name" defaultValue={staff?.name} required />
            </Field>
            <Field label="Role" htmlFor="st-role">
              <Input id="st-role" name="role" defaultValue={staff?.role} placeholder="Massage therapist" required />
            </Field>
            <Field label="Color" htmlFor="st-color">
              <Input id="st-color" name="color" type="color" defaultValue={staff?.color ?? "#8EAB8B"} className="p-1" />
            </Field>
          </div>
          <Field label="Photo URL (optional)" htmlFor="st-avatar">
            <Input id="st-avatar" name="avatarUrl" type="url" defaultValue={staff?.avatarUrl} />
          </Field>
          {simpleSchedule ? (
            <>
              <fieldset className="grid gap-2">
                <legend className="mb-2 text-sm font-medium">Working days</legend>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map((label, weekday) => (
                    <Button
                      key={label}
                      type="button"
                      size="sm"
                      variant={days.has(weekday) ? "default" : "outline"}
                      aria-pressed={days.has(weekday)}
                      onClick={() =>
                        setDays((current) => {
                          const next = new Set(current);
                          if (next.has(weekday)) next.delete(weekday);
                          else next.add(weekday);
                          return next;
                        })
                      }
                    >
                      {label}
                    </Button>
                  ))}
                </div>
              </fieldset>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Starts" htmlFor="st-start">
                  <Input id="st-start" name="start" type="time" step={900} defaultValue={firstShift?.start ?? "09:00"} required />
                </Field>
                <Field label="Ends" htmlFor="st-end">
                  <Input id="st-end" name="end" type="time" step={900} defaultValue={firstShift?.end ?? "18:00"} required />
                </Field>
              </div>
              <label className="flex items-center gap-2 text-sm font-medium">
                <input type="checkbox" className="size-4 accent-foreground" checked={hasBreak} onChange={(e) => setHasBreak(e.target.checked)} />
                Daily break
              </label>
              {hasBreak ? (
                <div className="grid grid-cols-3 gap-3">
                  <Field label="Label" htmlFor="st-break-label">
                    <Input id="st-break-label" name="breakLabel" defaultValue={firstBreak?.label ?? "Lunch"} required />
                  </Field>
                  <Field label="From" htmlFor="st-break-start">
                    <Input id="st-break-start" name="breakStart" type="time" step={900} defaultValue={firstBreak?.start ?? "12:00"} required />
                  </Field>
                  <Field label="To" htmlFor="st-break-end">
                    <Input id="st-break-end" name="breakEnd" type="time" step={900} defaultValue={firstBreak?.end ?? "13:00"} required />
                  </Field>
                </div>
              ) : null}
            </>
          ) : (
            <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
              {hoursSummary(staff!)}. This custom schedule is kept as-is; it can&apos;t be edited in this form.
            </p>
          )}
          <fieldset className="grid gap-3 border-t border-border pt-4">
            <legend className="text-sm font-medium">Add time off (optional)</legend>
            <div className="grid grid-cols-3 gap-3">
              <Field label="From" htmlFor="st-off-from">
                <Input id="st-off-from" name="offFrom" type="date" min={today} />
              </Field>
              <Field label="To" htmlFor="st-off-to">
                <Input id="st-off-to" name="offTo" type="date" min={today} />
              </Field>
              <Field label="Label" htmlFor="st-off-label">
                <Input id="st-off-label" name="offLabel" placeholder="Day off" />
              </Field>
            </div>
            <p className="text-xs text-muted-foreground">Whole days. Remove time off by clicking it on the calendar.</p>
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (simpleSchedule && days.size === 0)}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ServiceDialog({ service, staff, onClose }: { service?: Service; staff: Staff[]; onClose: () => void }) {
  const createService = useMutation(api.adminServices.createService);
  const updateService = useMutation(api.adminServices.updateService);
  const [staffIds, setStaffIds] = useState<Set<Id<"staff">>>(() => new Set(service?.staffIds ?? []));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const name = text("name");
    const fields = {
      name,
      slug: service?.slug ?? slugify(name),
      description: text("description"),
      category: text("category"),
      durationMin: Number(text("durationMin")),
      bufferMin: Number(text("bufferMin")),
      price: Number(text("price")),
      currency: service?.currency ?? "THB",
      staffIds: [...staffIds],
    };
    setSaving(true);
    setError("");
    try {
      if (service) await updateService({ serviceId: service._id, ...fields });
      else await createService(fields);
      onClose();
    } catch (err) {
      setError(errorText(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{service ? `Edit ${service.name}` : "Add service"}</DialogTitle>
          <DialogDescription>Turnaround is cleanup or travel time after the service. The staff member stays blocked for it.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-[minmax(0,1fr)_160px] gap-3">
            <Field label="Name" htmlFor="sv-name">
              <Input id="sv-name" name="name" defaultValue={service?.name} required />
            </Field>
            <Field label="Category" htmlFor="sv-category">
              <Input id="sv-category" name="category" defaultValue={service?.category} placeholder="Wellness" required />
            </Field>
          </div>
          <Field label="Description" htmlFor="sv-description">
            <Input id="sv-description" name="description" defaultValue={service?.description} />
          </Field>
          <div className="grid grid-cols-3 gap-3">
            <Field label="Duration (min)" htmlFor="sv-duration">
              <Input id="sv-duration" name="durationMin" type="number" min={15} step={15} defaultValue={service?.durationMin ?? 60} required />
            </Field>
            <Field label="Turnaround (min)" htmlFor="sv-buffer">
              <Input id="sv-buffer" name="bufferMin" type="number" min={0} step={5} defaultValue={service?.bufferMin ?? 15} required />
            </Field>
            <Field label={`Price (${service?.currency ?? "THB"})`} htmlFor="sv-price">
              <Input id="sv-price" name="price" type="number" min={0} defaultValue={service?.price} required />
            </Field>
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
                  <StaffAvatar staff={person} className="size-6 text-[10px]" />
                  <span className="truncate">{person.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{person.role}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || staffIds.size === 0}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
