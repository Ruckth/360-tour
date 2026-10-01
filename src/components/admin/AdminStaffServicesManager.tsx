"use client";

import { useConvex, useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { Archive, ArchiveRestore, CalendarOff, Pencil, PlusIcon, Trash2 } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { ServiceStaffMatrix } from "@/components/admin/AdminServiceStaffMatrix";
import { BulkTimeOffDialog, TimeOffFields, conflictText, readTimeOff } from "@/components/admin/AdminStaffTimeOff";
import { adminStaffTabPath } from "@/components/admin/admin-routes";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatMoney } from "@/components/admin/labels";
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
import {
  WEEKDAYS,
  errorText,
  formatTimeOff,
  resortIsoDate,
  timeOffInput,
  timeOffRange,
  timeOffRangeProblem,
  useNow,
} from "@/lib/staff-bookings";
import { UNSAVED_CHANGES_MESSAGE, useUnsavedChangesGuard } from "@/lib/react/use-unsaved-changes";
import { cn } from "@/lib/utils";

type Staff = Doc<"staff">;
type Service = Doc<"services">;
type TimeOff = Doc<"staffTimeOff">;

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  // Names with no Latin letters or digits (e.g. Thai-only) would give an empty slug.
  return slug || `service-${Math.random().toString(36).slice(2, 8).padEnd(6, "0")}`;
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
  const [view, setView] = useState<"list" | "matrix">("list");
  const [matrixDirty, setMatrixDirty] = useState(false);
  const [bulkTimeOff, setBulkTimeOff] = useState(false);
  const archiveStaff = useMutation(api.adminServices.archiveStaff);
  const archiveService = useMutation(api.adminServices.archiveService);
  const updateStaff = useMutation(api.adminServices.updateStaff);
  const updateService = useMutation(api.adminServices.updateService);
  const convex = useConvex();
  const router = useRouter();
  const [error, setError] = useState("");
  const confirm = useConfirm();
  // Staff tabs ask via hasUnsavedChanges(); reloads and sidebar links are guarded here.
  useUnsavedChangesGuard(matrixDirty && section === "services" && view === "matrix");

  async function switchView(next: "list" | "matrix") {
    if (next === view) return;
    if (
      matrixDirty &&
      !(await confirm({ title: UNSAVED_CHANGES_MESSAGE, confirmLabel: "Discard", cancelLabel: "Keep editing", destructive: true }))
    ) {
      return;
    }
    setMatrixDirty(false);
    setView(next);
  }

  if (!staff || !services) {
    return (
      <section role="status" aria-label={`Loading ${section}`} className="border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3">
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <ul className="divide-y divide-border">
          {Array.from({ length: 4 }, (_, i) => (
            <li key={i} className="flex items-center gap-3 px-4 py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="grid flex-1 gap-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    );
  }

  const staffNames = new Map(staff.map((s) => [s._id as string, s.name]));
  const rows = section === "staff" ? staff : services;
  const archivedCount = rows.filter((row) => row.status === "archived").length;
  const visibleCount = showArchived ? rows.length : rows.length - archivedCount;
  const hasActiveStaff = staff.some((s) => s.status === "active");

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError("");
    try {
      await action();
    } catch (err) {
      setError(errorText(err, fallback));
    }
  }

  async function archivePerson(person: Staff) {
    const upcoming = await convex.query(api.adminServices.countUpcomingAppointments, { staffId: person._id });
    if (upcoming) {
      if (
        await confirm({
          title: `${person.name} has ${plural(upcoming, "upcoming appointment")}`,
          description: "Reassign or cancel them on the calendar before archiving.",
          confirmLabel: "Open calendar",
        })
      ) {
        router.push(adminStaffTabPath("calendar"));
      }
      return;
    }
    const theirServices = services!.filter((s) => s.status === "active" && s.staffIds.includes(person._id));
    const orphaned = theirServices.filter((s) => s.staffIds.length === 1);
    const confirmed = await confirm({
      title: `Archive ${person.name}?`,
      description: [
        "They can no longer be booked. Past appointments stay on the calendar.",
        theirServices.length ? `They'll be removed from ${plural(theirServices.length, "service")}.` : "",
        orphaned.length ? `${orphaned.map((s) => s.name).join(", ")} will have no staff until you assign someone.` : "",
      ].join(" "),
      confirmLabel: "Archive",
      destructive: true,
    });
    if (confirmed) await run(() => archiveStaff({ staffId: person._id }), "Could not archive.");
  }

  async function archiveOffering(service: Service) {
    const upcoming = await convex.query(api.adminServices.countUpcomingAppointments, { serviceId: service._id });
    const confirmed = await confirm({
      title: `Archive ${service.name}?`,
      description: `It will no longer be bookable.${upcoming ? ` ${plural(upcoming, "upcoming appointment")} stay booked.` : ""}`,
      confirmLabel: "Archive",
      destructive: true,
    });
    if (confirmed) await run(() => archiveService({ serviceId: service._id }), "Could not archive.");
  }

  return (
    <section className="border border-border bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
        <p className="min-w-60 flex-1 text-sm text-muted-foreground">
          {section === "staff"
            ? "Who performs services, and when they work. Breaks show as blocked time on the calendar."
            : "What guests can book, how long it takes, and who can do it."}
        </p>
        {section === "services" ? (
          <div className="flex h-9 rounded-lg border border-border bg-muted/40 p-0.5" role="group" aria-label="Services view">
            {([["list", "List"], ["matrix", "Who does what"]] as const).map(([key, label]) => (
              <Button
                key={key}
                size="sm"
                variant="ghost"
                aria-pressed={view === key}
                className={cn(
                  "h-full rounded-md",
                  view === key ? "bg-background text-foreground shadow-sm hover:bg-background" : "text-muted-foreground",
                )}
                onClick={() => switchView(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        ) : null}
        {archivedCount && !(section === "services" && view === "matrix") ? (
          <Button
            size="sm"
            variant={showArchived ? "secondary" : "outline"}
            aria-pressed={showArchived}
            onClick={() => setShowArchived((v) => !v)}
          >
            Show archived ({archivedCount})
          </Button>
        ) : null}
        {section === "staff" ? (
          <DisabledReason reason={!hasActiveStaff && "Add staff first."}>
            <Button size="sm" variant="outline" disabled={!hasActiveStaff} onClick={() => setBulkTimeOff(true)}>
              <CalendarOff aria-hidden className="size-4" />
              Add time off
            </Button>
          </DisabledReason>
        ) : null}
        <DisabledReason reason={section === "services" && !hasActiveStaff && "Add staff first: every service needs someone to perform it."}>
          <Button
            size="sm"
            disabled={section === "services" && !hasActiveStaff}
            onClick={() => setEditing(section === "staff" ? { kind: "staff" } : { kind: "service" })}
          >
            <PlusIcon aria-hidden className="size-4" />
            {section === "staff" ? "Add staff" : "Add service"}
          </Button>
        </DisabledReason>
      </div>
      {error ? (
        <p role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      {section === "services" && view === "matrix" ? (
        <ServiceStaffMatrix
          services={services.filter((s) => s.status === "active")}
          staff={staff.filter((s) => s.status === "active")}
          onDirtyChange={setMatrixDirty}
        />
      ) : (
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
                    onArchive={() => archivePerson(s)}
                    onRestore={() => run(() => updateStaff({ staffId: s._id, status: "active" }), "Could not restore.")}
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
                    subtitle={`${s.category} · ${s.durationMin} min${s.bufferMin ? ` + ${s.bufferMin} min turnaround` : ""} · ${formatMoney(s.price, s.currency)} · ${s.staffIds.map((id) => staffNames.get(id) ?? "?").join(", ") || "No staff"}`}
                    onEdit={() => setEditing({ kind: "service", service: s })}
                    onArchive={() => archiveOffering(s)}
                    onRestore={() => run(() => updateService({ serviceId: s._id, status: "active" }), "Could not restore.")}
                  />
                ))}
          {visibleCount === 0 ? (
            <li className="grid justify-items-center gap-3 px-4 py-10 text-center text-sm text-muted-foreground">
              {rows.length
                ? `Every ${section === "staff" ? "staff member" : "service"} is archived.`
                : section === "staff"
                  ? "No staff yet. Add the people who perform services."
                  : hasActiveStaff
                    ? "No services yet. Add what guests can book."
                    : "No services yet. Add staff first, then the services they perform."}
            </li>
          ) : null}
        </ul>
      )}

      {bulkTimeOff ? (
        <BulkTimeOffDialog staff={staff.filter((s) => s.status === "active")} onClose={() => setBulkTimeOff(false)} />
      ) : null}
      {editing?.kind === "staff" ? (
        <StaffDialog key={editing.staff?._id ?? "new"} staff={editing.staff} onClose={() => setEditing(null)} />
      ) : null}
      {editing?.kind === "service" ? (
        <ServiceDialog
          key={editing.service?._id ?? "new"}
          service={editing.service}
          staff={staff.filter((s) => s.status === "active")}
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
  onRestore,
}: {
  leading: ReactNode;
  title: string;
  subtitle: string;
  archived: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      {/* Only the picture fades: faded text would fail contrast. The badge says it's archived. */}
      <span className={cn("shrink-0", archived && "opacity-50 grayscale")}>{leading}</span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 truncate text-sm font-semibold text-foreground">
          {title}
          {archived ? <StatusBadge tone="muted" label="Archived" /> : null}
        </p>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <Button size="icon" variant="ghost" className="size-9" onClick={onEdit} aria-label={`Edit ${title}`}>
        <Pencil aria-hidden className="size-4" />
      </Button>
      {archived ? (
        <Button size="sm" variant="outline" onClick={onRestore}>
          <ArchiveRestore aria-hidden className="size-4" />
          Restore
        </Button>
      ) : (
        <Button size="icon" variant="ghost" className="size-9" onClick={onArchive} aria-label={`Archive ${title}`}>
          <Archive aria-hidden className="size-4" />
        </Button>
      )}
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
  // Set once a new person is saved, so retrying a failed time off updates them instead of adding them again.
  const [createdId, setCreatedId] = useState<Id<"staff"> | null>(null);
  const today = resortIsoDate(useNow());

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    const weekdays = [...days].sort();
    const profile = {
      name: text("name"),
      role: text("role"),
      avatarUrl: text("avatarUrl"),
      color: text("color"),
    };
    const schedule = {
      workingHours: weekdays.map((weekday) => ({ weekday, start: text("start"), end: text("end") })),
      breaks: hasBreak
        ? weekdays.map((weekday) => ({ weekday, start: text("breakStart"), end: text("breakEnd"), label: text("breakLabel") }))
        : [],
    };
    const off = readTimeOff(form);
    const offFrom = off.from;
    const offRange = timeOffRange(off);
    // Check before saving anything, so a bad range can't leave a half-saved new person behind.
    const offProblem = offFrom ? timeOffRangeProblem(offRange) : null;
    if (offProblem) {
      setError(offProblem);
      return;
    }
    const timeOff = async (staffId: Id<"staff">) => {
      const [result] = await addTimeOff({ staffIds: [staffId], ...offRange, label: off.label || "Time off" });
      if (result && !result.timeOffId) throw new Error(conflictText(result.conflicts));
    };
    setSaving(true);
    setError("");
    try {
      const existingId = staff?._id ?? createdId;
      if (existingId) {
        // Profile and hours first: saving them again is harmless, so a retry after a
        // failed time-off insert (e.g. a clash with a booking) can't duplicate the time off.
        await updateStaff({ staffId: existingId, ...profile, ...(simpleSchedule ? schedule : {}) });
        if (offFrom) await timeOff(existingId);
      } else {
        const staffId = await createStaff({ ...profile, avatarUrl: profile.avatarUrl || undefined, ...schedule });
        setCreatedId(staffId);
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
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
          {staff ? <TimeOffList staff={staff} /> : null}
          <fieldset className="grid gap-3 border-t border-border pt-4">
            <legend className="text-sm font-medium">Add time off (optional)</legend>
            <TimeOffFields idPrefix="st-off" min={today} />
          </fieldset>
          {simpleSchedule && days.size === 0 ? <p className="text-sm text-muted-foreground">Pick at least one working day to save.</p> : null}
          {createdId ? (
            <p className="text-sm text-muted-foreground">Staff member added. Fix the time off and save again, or cancel to skip it.</p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || (simpleSchedule && days.size === 0)}>
              {saving ? <Spinner className="text-current" /> : null}
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
  const upcoming = useQuery(api.adminServices.countUpcomingAppointments, service ? { serviceId: service._id } : "skip");
  const confirm = useConfirm();
  // Only active staff can be assigned; archived ones already left the service.
  const [staffIds, setStaffIds] = useState<Set<Id<"staff">>>(
    () => new Set(service?.staffIds.filter((id) => staff.some((person) => person._id === id)) ?? []),
  );
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
    // A new default turnaround is for new bookings; booked appointments keep their own.
    if (
      service &&
      fields.bufferMin !== service.bufferMin &&
      !(await confirm({
        title: `Change the default turnaround from ${service.bufferMin} to ${fields.bufferMin} min?`,
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
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
                  <StaffAvatar staff={person} className="size-6" />
                  <span className="truncate">{person.name}</span>
                  <span className="truncate text-xs text-muted-foreground">{person.role}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {staffIds.size === 0 ? <p className="text-sm text-muted-foreground">Pick at least one person to save.</p> : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || staffIds.size === 0}>
              {saving ? <Spinner className="text-current" /> : null}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function TimeOffList({ staff }: { staff: Staff }) {
  const rows = useQuery(api.adminServices.listTimeOff, { staffId: staff._id });
  const removeTimeOff = useMutation(api.adminServices.removeTimeOff);
  const [editing, setEditing] = useState<TimeOff | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();

  async function remove(row: TimeOff) {
    if (!(await confirm({ title: `Remove "${row.label}" time off?`, confirmLabel: "Remove", destructive: true }))) return;
    setError("");
    try {
      await removeTimeOff({ timeOffId: row._id });
    } catch (err) {
      setError(errorText(err, "Could not remove time off."));
    }
  }

  return (
    <section className="grid gap-2 border-t border-border pt-4">
      <h3 className="text-sm font-semibold">Upcoming time off</h3>
      {rows === undefined ? (
        <div role="status" aria-label="Loading time off">
          <Skeleton className="h-12 w-full" />
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">None scheduled.</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {rows.map((row) => (
            <li key={row._id} className="flex items-center gap-2 px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{row.label}</p>
                <p className="truncate text-xs text-muted-foreground">{formatTimeOff(row)}</p>
              </div>
              <Button type="button" size="icon" variant="ghost" className="size-9" onClick={() => setEditing(row)} aria-label={`Edit ${row.label}`}>
                <Pencil aria-hidden className="size-4" />
              </Button>
              <Button type="button" size="icon" variant="ghost" className="size-9" onClick={() => remove(row)} aria-label={`Remove ${row.label}`}>
                <Trash2 aria-hidden className="size-4" />
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
      {editing ? <TimeOffDialog key={editing._id} timeOff={editing} staffName={staff.name} onClose={() => setEditing(null)} /> : null}
    </section>
  );
}

export function TimeOffDialog({ timeOff, staffName, onClose }: { timeOff: TimeOff; staffName?: string; onClose: () => void }) {
  const updateTimeOff = useMutation(api.adminServices.updateTimeOff);
  const removeTimeOff = useMutation(api.adminServices.removeTimeOff);
  const [pending, setPending] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState("");
  const confirm = useConfirm();

  async function act(kind: "save" | "remove", action: () => Promise<unknown>) {
    setPending(kind);
    setError("");
    try {
      await action();
      onClose();
    } catch (err) {
      setError(errorText(err, kind === "save" ? "Could not save." : "Could not remove time off."));
    } finally {
      setPending(null);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // This dialog can open from inside the staff form; React events bubble through portals.
    event.stopPropagation();
    const input = readTimeOff(new FormData(event.currentTarget));
    void act("save", () => updateTimeOff({ timeOffId: timeOff._id, ...timeOffRange(input), label: input.label || "Time off" }));
  }

  async function remove() {
    if (!(await confirm({ title: `Remove "${timeOff.label}" time off?`, confirmLabel: "Remove", destructive: true }))) return;
    await act("remove", () => removeTimeOff({ timeOffId: timeOff._id }));
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit time off{staffName ? ` · ${staffName}` : ""}</DialogTitle>
          <DialogDescription>{formatTimeOff(timeOff)}</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <TimeOffFields idPrefix="to-edit" defaults={{ ...timeOffInput(timeOff), label: timeOff.label }} required />
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter className="sm:justify-between">
            <Button type="button" variant="outline" onClick={remove} disabled={pending !== null}>
              {pending === "remove" ? <Spinner className="text-current" /> : <Trash2 aria-hidden className="size-4" />}
              Remove
            </Button>
            <div className="flex gap-2">
              <Button type="button" variant="outline" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" disabled={pending !== null}>
                {pending === "save" ? <Spinner className="text-current" /> : null}
                Save
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
