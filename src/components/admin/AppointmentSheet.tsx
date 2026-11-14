"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
  appointmentRevision,
  canBookAgain,
  canEditTurnaround,
  canCorrectAppointmentTime,
  turnaroundMinutes,
} from "convex/lib/appointmentWindow";
import { Pencil, Repeat, X } from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { AppointmentCorrectionDialog } from "@/components/admin/AppointmentCorrectionDialog";
import { AppointmentFeeAction } from "@/components/admin/AppointmentFeeAction";
import { AppointmentFinancials, AppointmentMoneyBlock } from "@/components/admin/AppointmentFinancials";
import { AppointmentHistory } from "@/components/admin/AppointmentHistory";
import { BookingOrders } from "@/components/admin/BookingOrders";
import { CancelAppointmentDialog } from "@/components/admin/CancelAppointmentDialog";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { RescheduleDialog } from "@/components/admin/RescheduleDialog";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TurnaroundDialog } from "@/components/admin/TurnaroundDialog";
import { formatMoney, sourceLabel } from "@/components/admin/labels";
import { staffLabel } from "@/components/admin/admin-bookings-shared";
import { Button } from "@/components/ui/button";
import { MoreMenu } from "@/components/ui/more-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog as Modal, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetClose, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { DeskSheetContent as SheetContent } from "./DeskSheetContent";
import { BookingSheet } from "./BookingSheet";
import { useUnsavedGuard } from "@/hooks/use-unsaved-guard";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { endTime, timeRange } from "@/lib/schedule-changes";
import {
  appointmentStatus,
  displayStatus,
  errorText,
  useNow,
  type AppointmentStatus,
} from "@/lib/staff-bookings";
import { staffDate, staffDateTime } from "@/lib/staff-time";

type Staff = Doc<"staff">;
type Service = Doc<"services">;
type Appointment = Doc<"serviceAppointments">;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 py-3 text-sm">
      <dt className="self-center text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

type StatusAction = "arrived" | "in_service" | "completed" | "no_show";

const NEXT_ACTIONS: Record<AppointmentStatus, StatusAction[]> = {
  booked: ["arrived", "in_service", "completed", "no_show"],
  arrived: ["in_service", "completed", "no_show"],
  in_service: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

const ACTION_LABELS: Record<StatusAction, string> = {
  arrived: "Mark arrived",
  in_service: "Start service",
  completed: "Complete",
  no_show: "No-show",
};

const CANCELLABLE: AppointmentStatus[] = ["booked", "arrived"];

type Dialog = "choose" | "reschedule" | "turnaround" | "cancel" | "correct" | null;

export function AppointmentSheet({
  appointment,
  services,
  staffById,
  serviceById,
  onBookAgain,
  onClose,
}: {
  appointment: Appointment | null;
  /** Active services, for changing the service. */
  services: Service[];
  staffById: ReadonlyMap<string, Staff>;
  serviceById: ReadonlyMap<string, Service>;
  onBookAgain: (appointment: Appointment) => void;
  onClose: () => void;
}) {
  const updateStatus = useMutation(api.adminServices.updateAppointmentStatus);
  const originalReference = useQuery(api.adminServices.getAppointmentReference, appointment?.rebookedFromId ? { appointmentId: appointment.rebookedFromId } : "skip");
  const [feePending, setFeePending] = useState(false);
  const [pending, setPending] = useState<StatusAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editorSaving, setEditorSaving] = useState(false);
  const [draftDirty, setDraftDirty] = useState(false);
  const { confirmDiscard } = useUnsavedGuard(draftDirty);
  const [stayOpen, setStayOpen] = useState(false);
  const stay = useQuery(api.adminBookings.getForAdmin, appointment?.bookingId ? { bookingId: appointment.bookingId } : "skip");
  const now = useNow();
  // Same read as the money block (one subscription): while a balance is due, Take payment is the
  // one filled button and the next step goes outline.
  const finance = useQuery(api.adminServices.getAppointmentFinancials, appointment ? { appointmentId: appointment._id } : "skip");
  const balanceDue = Boolean(
    appointment && finance && appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" && appointment.status !== "no_show" && finance.money.owed > 0,
  );
  const service = appointment ? serviceById.get(appointment.serviceId) : undefined;
  const staff = appointment ? staffById.get(appointment.staffId) : undefined;
  const serviceName = appointment?.serviceNameSnapshot ?? service?.name ?? "Service";
  const staffName = (id: string) => staffById.get(id)?.name ?? "Former staff member";

  async function copyReference() {
    if (!appointment) return;
    const code = appointment.confirmationCode;
    try {
      await navigator.clipboard.writeText(code);
      setNotice(`Copied ${code}.`);
    } catch {
      setError("Could not copy the reference.");
    }
  }

  async function run(action: StatusAction) {
    if (!appointment || pending !== null || feePending) return;
    setPending(action);
    setError("");
    try {
      await updateStatus({ appointmentId: appointment._id, status: action, expectedRevision: appointmentRevision(appointment) });
    } catch (err) {
      setError(errorText(err, "Could not update the appointment."));
    } finally {
      setPending(null);
    }
  }

  const actions = appointment
    ? NEXT_ACTIONS[appointment.status].filter((action) => action !== "no_show" || appointment.start <= now)
    : [];
  // One next step on screen; the other moves and corrections are in ⋯.
  const next: StatusAction | "book_again" | null = appointment
    ? actions.find((action) => action !== "no_show") ?? (canBookAgain(appointment) ? "book_again" : null)
    : null;
  const status = appointment ? appointmentStatus(displayStatus(appointment)) : null;
  const turnaround = appointment ? turnaroundMinutes(appointment) : 0;

  return (
    <Sheet
      open={Boolean(appointment)}
      onOpenChange={async (open) => {
        if (!open && !feePending && !editorSaving && await confirmDiscard()) {
          setError("");
          setEditing(false);
          setDialog(null);
          onClose();
        }
      }}
    >
      <SheetContent showCloseButton={false} onEscapeKeyDown={(e) => { if (feePending || editorSaving) e.preventDefault(); }} onPointerDownOutside={(e) => { if (feePending || editorSaving) e.preventDefault(); }} className="w-full max-w-full overflow-y-auto bg-background p-5 sm:max-w-[30rem]">
        {appointment && status ? (
          <div className="grid gap-5">
            <header className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="mb-1 text-xs text-muted-foreground">Appointment</p>
                <SheetTitle className="font-serif text-2xl font-semibold"><span className="sr-only">Appointment · </span>{appointment.guestName || "Unnamed guest"}</SheetTitle>
                <SheetDescription className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge {...status} />                <span className="inline-flex">
                  {!editing && next ? (
                    <Button size="sm" variant={balanceDue ? "outline" : "default"} onClick={() => (next === "book_again" ? onBookAgain(appointment) : run(next))} disabled={feePending || pending !== null || (next === "book_again" && services.length === 0)}>
                      {pending === next ? <Spinner className="text-current" /> : null}
                      {next === "book_again" ? <><Repeat aria-hidden className="size-4" />Book again</> : ACTION_LABELS[next]}
                    </Button>
                  ) : null}
                </span>
</SheetDescription>
              </div>
              <div className="flex shrink-0 items-center gap-0.5">
                <Button size="icon" variant="ghost" aria-label="Edit appointment" disabled={feePending || pending !== null || editing} onClick={() => setEditing(true)}><Pencil aria-hidden className="size-4" /></Button>
                {!editing ? (
                  <MoreMenu
                    label="More appointment actions"
                    disabled={feePending || pending !== null}
                    items={[
                      ...actions.filter((action) => action !== next).map((action) => ({ label: ACTION_LABELS[action], onSelect: () => void run(action) })),
                      // Date or time, turnaround, status and details: one item, then a choice.
                      { label: "Correct…", onSelect: () => setDialog("choose") },
                      { label: "Book again", onSelect: () => onBookAgain(appointment), hidden: !canBookAgain(appointment) || next === "book_again", disabled: services.length === 0 },
                      { label: "Copy reference", onSelect: () => void copyReference() },
                      { label: "Cancel appointment", onSelect: () => setDialog("cancel"), destructive: true, hidden: !CANCELLABLE.includes(appointment.status) },
                    ]}
                  />
                ) : null}
                <SheetClose asChild><Button size="icon" variant="ghost" aria-label="Close" disabled={feePending || editorSaving}><X aria-hidden className="size-4" /></Button></SheetClose>
              </div>
            </header>
            {editing ? (
              <AppointmentEditForm
                key={appointment._id}
                appointment={appointment}
                service={service}
                services={services}
                onDone={() => { setDraftDirty(false); setEditing(false); }}
                onCancel={async () => { if (await confirmDiscard()) { setDraftDirty(false); setEditing(false); } }}
                onDirtyChange={setDraftDirty}
                onBusyChange={setEditorSaving}
              />
            ) : (
              <>
                <AppointmentMoneyBlock appointment={appointment} disabled={feePending || pending !== null} />
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                {notice ? <p role="status" className="text-sm text-muted-foreground">{notice}</p> : null}
                {canBookAgain(appointment) && services.length === 0 ? <p className="text-sm text-muted-foreground">Add an active service before booking again.</p> : null}
                <dl className="divide-y divide-border rounded-xl border border-border bg-card px-4">
                  <Detail label="Service">{appointment.serviceNameSnapshot ?? service?.name ?? "—"}</Detail>
                  <Detail label="Staff">
                    {staff ? (
                      <span className="flex items-center gap-2">
                        <StaffAvatar staff={staff} className="size-6" />
                        {appointment.staffNameSnapshot ?? staff.name} <span className="text-muted-foreground">· {staff.role}</span>
                      </span>
                    ) : (
                      appointment.staffNameSnapshot ?? "—"
                    )}
                  </Detail>
                  <Detail label="When">
                    {staffDate(appointment.start, { weekday: true })}, {timeRange(appointment.start, appointment.end)}
                    <span className="block text-muted-foreground">
                      {turnaround ? `Room ready ${endTime(appointment.start, appointment.blockedUntil)}` : "No turnaround"}
                    </span>
                  </Detail>
                  {appointment.cancelledAt ? (
                    <Detail label="Cancelled">
                      {staffDateTime(appointment.cancelledAt)}
                      {appointment.cancelledBy ? ` · ${appointment.cancelledBy === "guest" ? "Guest, in chat" : staffLabel(appointment.cancelledBy)}` : ""}
                      {appointment.cancellationReason ? (
                        <span className="block text-muted-foreground">{appointment.cancellationReason}</span>
                      ) : null}
                    </Detail>
                  ) : null}
                  {appointment.guestPhone ? <Detail label="Phone"><a className="inline-flex min-h-11 items-center rounded hover:underline focus-visible:ring-2 focus-visible:ring-ring" href={`tel:${appointment.guestPhone}`}>{appointment.guestPhone}</a></Detail> : null}
                  {appointment.guestEmail ? <Detail label="Email"><a className="inline-flex min-h-11 items-center rounded hover:underline focus-visible:ring-2 focus-visible:ring-ring" href={`mailto:${appointment.guestEmail}`}>{appointment.guestEmail}</a></Detail> : null}
                  {appointment.notes ? <Detail label="Notes"><span className="whitespace-pre-wrap">{appointment.notes}</span></Detail> : null}
                  {appointment.bookingId ? <Detail label="Villa stay"><Button variant="ghost" className="h-auto min-h-11 whitespace-normal px-0 text-left" disabled={!stay} onClick={() => setStayOpen(true)}>Open stay · {stay ? `${stay.propertyName} · ${stay.guestName}` : "Loading stay…"}</Button></Detail> : null}
                  {appointment.rebookedFromId ? <Detail label="Booked again">{originalReference === undefined ? "Loading original reference…" : originalReference ? `From ${originalReference}` : "Original appointment unavailable"}</Detail> : null}
                  <Detail label="Source">
                    {sourceLabel(appointment.source)}
                  </Detail>
                </dl>
                <BookingOrders
                  source={{ appointmentId: appointment._id }}
                  currency={appointment.currency}
                  closed={appointment.status === "cancelled" || appointment.status === "no_show" || appointment.paymentStatus === "refunded"}
                  history
                />
                {appointment.status === "no_show" || appointment.status === "cancelled" ? (
                  <AppointmentFeeAction key={`fee:${appointment._id}`} appointment={appointment} onPendingChange={setFeePending} />
                ) : null}
                <AppointmentFinancials key={appointment._id} appointment={appointment} />
                <AppointmentHistory
                  appointmentId={appointment._id}
                  staffName={staffName}
                  serviceName={(id) => serviceById.get(id)?.name ?? "Former service"}
                />
              </>
            )}
          </div>
        ) : null}
        {appointment && dialog === "choose" ? (
          <CorrectChoiceDialog
            canCorrectTime={canCorrectAppointmentTime(appointment, now)}
            canEditTurnaround={canEditTurnaround(appointment)}
            onClose={() => setDialog(null)}
            onPick={(choice) => {
              if (choice === "details") {
                setDialog(null);
                setEditing(true);
              } else setDialog(choice);
            }}
          />
        ) : null}
        {appointment && dialog === "correct" ? <AppointmentCorrectionDialog appointment={appointment} onClose={() => setDialog(null)} /> : null}
        {appointment && dialog === "reschedule" ? (
          <RescheduleDialog appointment={appointment} serviceName={serviceName} staffById={staffById} onClose={() => setDialog(null)} />
        ) : null}
        {appointment && dialog === "turnaround" ? (
          <TurnaroundDialog appointment={appointment} serviceDefaultMin={service?.bufferMin} onClose={() => setDialog(null)} />
        ) : null}
        {appointment && dialog === "cancel" ? (
          <CancelAppointmentDialog
            appointment={appointment}
            serviceName={serviceName}
            staffName={staffName(appointment.staffId)}
            onClose={() => setDialog(null)}
          />
        ) : null}
        {stayOpen && appointment?.bookingId ? <BookingSheet bookingId={appointment.bookingId} properties={[]} onClose={() => setStayOpen(false)} /> : null}
      </SheetContent>
    </Sheet>
  );
}

type Correction = "reschedule" | "turnaround" | "correct" | "details";

/** "Correct…": which part of the record was wrong. Each choice opens its own form. */
function CorrectChoiceDialog({
  canCorrectTime,
  canEditTurnaround,
  onPick,
  onClose,
}: {
  canCorrectTime: boolean;
  canEditTurnaround: boolean;
  onPick: (choice: Correction) => void;
  onClose: () => void;
}) {
  const choices: { value: Correction; label: string; hidden?: boolean }[] = [
    { value: "reschedule", label: "Date or time", hidden: !canCorrectTime },
    { value: "turnaround", label: "Turnaround", hidden: !canEditTurnaround },
    { value: "correct", label: "Status" },
    { value: "details", label: "Guest, service or notes" },
  ];
  return (
    <Modal open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="pe-8">Correct</DialogTitle>
          <DialogDescription className="sr-only">Choose what to correct</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {choices.filter((choice) => !choice.hidden).map((choice) => (
            <Button key={choice.value} variant="outline" className="min-h-11 justify-start" onClick={() => onPick(choice.value)}>
              {choice.label}
            </Button>
          ))}
        </div>
      </DialogContent>
    </Modal>
  );
}

/**
 * Guest details and notes can always be edited; the service only while booked or arrived and unpaid.
 * Everything is checked and saved in one write, so a bad email can't leave a half-saved service change.
 */
function AppointmentEditForm({
  appointment,
  service,
  services,
  onDone,
  onCancel,
  onDirtyChange,
  onBusyChange,
}: {
  appointment: Appointment;
  service?: Service;
  services: Service[];
  onDone: () => void;
  onCancel: () => void;
  onDirtyChange: (dirty: boolean) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const updateDetails = useMutation(api.adminServices.updateAppointmentDetails);
  const [original] = useState(appointment);
  const contactRequired = original.source !== "admin" || Boolean(original.chatSessionId);
  const revision = appointmentRevision(original);
  const confirm = useConfirm();
  const [serviceId, setServiceId] = useState<Id<"services">>(appointment.serviceId);
  const [detailsDirty, setDetailsDirty] = useState(false);
  const dirty = detailsDirty || serviceId !== original.serviceId;
  useEffect(() => { onDirtyChange(dirty); return () => onDirtyChange(false); }, [dirty, onDirtyChange]);
  const [saving, setSaving] = useState(false);
  useEffect(() => { onBusyChange(saving); return () => onBusyChange(false); }, [saving, onBusyChange]);
  const [error, setError] = useState("");
  const canChangeService =
    (appointment.status === "booked" || appointment.status === "arrived") && appointment.paymentStatus === "unpaid";
  // Services this staff member performs, plus the current one so the select shows it.
  const options = services.filter((s) => s.staffIds.includes(appointment.staffId) && s._id !== appointment.serviceId);
  if (service) options.unshift(service);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    if (saving) return;
    const chosen = options.find((s) => s._id === serviceId);
    setSaving(true);
    setError("");
    try {
      if (serviceId !== original.serviceId) {
        if (!chosen) throw new Error("This service is no longer available. Choose another service.");
        const end = original.start + chosen.durationMin * 60_000;
        const blockedUntil = end + chosen.bufferMin * 60_000;
        if (!(await confirm({
          title: "Confirm service change?",
          description: <>From: {service?.name ?? "Service"} · {timeRange(original.start, original.end)} · {turnaroundMinutes(original)} min turnaround · available again {endTime(original.start, original.blockedUntil)} · {formatMoney(original.price, original.currency)}.<br />To: {chosen.name} · {timeRange(original.start, end)} · {chosen.bufferMin} min turnaround · available again {endTime(original.start, blockedUntil)} · {formatMoney(chosen.price, chosen.currency)}. Staff and start time stay the same. Guest is not notified automatically.</>,
          confirmLabel: "Change service",
          cancelLabel: "Keep editing",
        }))) return;
      }
      await updateDetails({
        appointmentId: appointment._id,
        expectedRevision: revision,
        guestName: text("guestName"),
        guestPhone: text("guestPhone"),
        guestEmail: text("guestEmail"),
        notes: text("notes"),
        ...(serviceId !== original.serviceId && chosen ? { serviceId, expectedService: { durationMin: chosen.durationMin, bufferMin: chosen.bufferMin, price: chosen.price, currency: chosen.currency } } : {}),
      });
      onDone();
    } catch (err) {
      setError(errorText(err, "Could not save."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} onChange={event => {
      const form = new FormData(event.currentTarget);
      setDetailsDirty((["guestName", "guestPhone", "guestEmail", "notes"] as const).some(key => String(form.get(key) ?? "") !== String(original[key] ?? "")));
    }} className="grid gap-4">
      <fieldset disabled={saving} className="grid gap-4">
        <div className="grid gap-2">
          <Label>Service</Label>
          <Select value={serviceId} onValueChange={(value) => setServiceId(value as Id<"services">)} disabled={!canChangeService}>
            <SelectTrigger className="rounded-lg" aria-label="Service">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map((s) => (
                <SelectItem key={s._id} value={s._id}>
                  {s.name} · {s.durationMin} min · {formatMoney(s.price, s.currency)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">
            {canChangeService
              ? "Same staff member and start time. The length, turnaround and price follow the new service."
              : "The service can only change while the appointment is booked or arrived and unpaid."}
          </p>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="ap-name">Guest name{contactRequired ? "" : " (optional)"}</Label>
          <Input id="ap-name" name="guestName" required={contactRequired} aria-describedby={contactRequired ? undefined : "ap-guest-hint"} defaultValue={appointment.guestName} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="grid gap-2">
            <Label htmlFor="ap-phone">Phone{contactRequired ? "" : " (optional)"}</Label>
            <Input id="ap-phone" name="guestPhone" type="tel" required={contactRequired} aria-describedby={contactRequired ? undefined : "ap-guest-hint"} defaultValue={appointment.guestPhone} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ap-email">Email (optional)</Label>
            <Input id="ap-email" name="guestEmail" type="email" aria-describedby={contactRequired ? undefined : "ap-guest-hint"} defaultValue={appointment.guestEmail} />
          </div>
        </div>
        {!contactRequired ? <p id="ap-guest-hint" className="text-sm text-muted-foreground">Guest details can be added later.</p> : null}
        <div className="grid gap-2">
          <Label htmlFor="ap-notes">Notes (optional)</Label>
          <Textarea
            id="ap-notes"
            name="notes"
            maxLength={2000}
            defaultValue={appointment.notes}
            placeholder="Allergies, pressure preference, room number…"
          />
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Discard changes
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner className="text-current" /> : null}
            Save
          </Button>
        </div>
      </fieldset>
    </form>
  );
}
