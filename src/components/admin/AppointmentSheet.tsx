"use client";

import { useMutation } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import {
  appointmentRevision,
  canBookAgain,
  canEditTurnaround,
  canReschedule,
  turnaroundMinutes,
} from "convex/lib/appointmentWindow";
import { CalendarClock, Hourglass, Pencil, Repeat } from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import { AppointmentHistory } from "@/components/admin/AppointmentHistory";
import { CancelAppointmentDialog } from "@/components/admin/CancelAppointmentDialog";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { RescheduleDialog } from "@/components/admin/RescheduleDialog";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TurnaroundDialog } from "@/components/admin/TurnaroundDialog";
import { formatMoney, sourceLabel } from "@/components/admin/labels";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { endTime, timeRange } from "@/lib/schedule-changes";
import {
  PAYMENT_LABELS,
  appointmentStatus,
  displayStatus,
  errorText,
  formatResortDate,
  formatResortDateTime,
  useNow,
  type AppointmentStatus,
} from "@/lib/staff-bookings";

type Staff = Doc<"staff">;
type Service = Doc<"services">;
type Appointment = Doc<"serviceAppointments">;

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

type StatusAction = "arrived" | "in_service" | "completed" | "no_show" | "paid" | "refund";

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
  paid: "Mark paid",
  refund: "Record refund",
};

const CANCELLABLE: AppointmentStatus[] = ["booked", "arrived"];

type Dialog = "reschedule" | "turnaround" | "cancel" | null;

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
  const markPaid = useMutation(api.adminServices.markAppointmentPaid);
  const refund = useMutation(api.adminServices.refundAppointment);
  const [pending, setPending] = useState<StatusAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [error, setError] = useState("");
  const now = useNow();
  const confirm = useConfirm();

  const service = appointment ? serviceById.get(appointment.serviceId) : undefined;
  const staff = appointment ? staffById.get(appointment.staffId) : undefined;
  const serviceName = service?.name ?? "Service";
  const staffName = (id: string) => staffById.get(id)?.name ?? "Former staff member";

  async function run(action: StatusAction) {
    if (!appointment) return;
    if (
      action === "refund" &&
      !(await confirm({
        title: `Record a ${formatMoney(appointment.price, appointment.currency)} refund?`,
        description: "Marks the payment as refunded. Give the money back at the desk; nothing is charged or sent from here.",
        confirmLabel: "Record refund",
        destructive: true,
      }))
    ) {
      return;
    }
    setPending(action);
    setError("");
    try {
      if (action === "paid") await markPaid({ appointmentId: appointment._id });
      else if (action === "refund") await refund({ appointmentId: appointment._id });
      else await updateStatus({ appointmentId: appointment._id, status: action });
    } catch (err) {
      setError(errorText(err, "Could not update the appointment."));
    } finally {
      setPending(null);
    }
  }

  const actions = appointment
    ? [
        ...NEXT_ACTIONS[appointment.status].filter((action) => action !== "no_show" || appointment.start <= now),
        ...(appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" ? (["paid"] as const) : []),
        ...(appointment.paymentStatus === "paid" ? (["refund"] as const) : []),
      ]
    : [];
  const status = appointment ? appointmentStatus(displayStatus(appointment)) : null;
  const turnaround = appointment ? turnaroundMinutes(appointment) : 0;

  return (
    <Sheet
      open={Boolean(appointment)}
      onOpenChange={(open) => {
        if (!open) {
          setError("");
          setEditing(false);
          setDialog(null);
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {appointment && status ? (
          <div className="grid gap-5">
            <div>
              <SheetTitle className="pe-8">Appointment · {appointment.guestName}</SheetTitle>
              <SheetDescription className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge {...status} />
                <span className="font-mono text-xs">{appointment.confirmationCode}</span>
              </SheetDescription>
            </div>
            {editing ? (
              <AppointmentEditForm
                key={appointment._id}
                appointment={appointment}
                service={service}
                services={services}
                onDone={() => setEditing(false)}
              />
            ) : (
              <>
                <dl className="divide-y divide-border border-y border-border">
                  <Detail label="Service">{service?.name ?? "—"}</Detail>
                  <Detail label="Staff">
                    {staff ? (
                      <span className="flex items-center gap-2">
                        <StaffAvatar staff={staff} className="size-6" />
                        {staff.name} <span className="text-muted-foreground">· {staff.role}</span>
                      </span>
                    ) : (
                      "—"
                    )}
                  </Detail>
                  <Detail label="When">
                    {formatResortDate(appointment.start)}, {timeRange(appointment.start, appointment.end)}
                  </Detail>
                  <Detail label="Occupied">
                    Service {timeRange(appointment.start, appointment.end)}
                    {turnaround ? ` · Turnaround ${timeRange(appointment.end, appointment.blockedUntil)}` : " · No turnaround"}
                    {" · "}Available again {endTime(appointment.start, appointment.blockedUntil)}
                  </Detail>
                  <Detail label="Price">{formatMoney(appointment.price, appointment.currency)}</Detail>
                  <Detail label="Payment">
                    {PAYMENT_LABELS[appointment.paymentStatus]}
                    {appointment.refundedAt ? ` · ${formatResortDate(appointment.refundedAt)}` : ""}
                  </Detail>
                  {appointment.cancelledAt ? (
                    <Detail label="Cancelled">
                      {formatResortDateTime(appointment.cancelledAt)}
                      {appointment.cancelledBy ? ` · ${appointment.cancelledBy === "guest" ? "Guest, in chat" : appointment.cancelledBy}` : ""}
                      {appointment.cancellationReason ? (
                        <span className="block text-muted-foreground">{appointment.cancellationReason}</span>
                      ) : null}
                    </Detail>
                  ) : null}
                  <Detail label="Phone">{appointment.guestPhone}</Detail>
                  <Detail label="Email">{appointment.guestEmail ?? "—"}</Detail>
                  <Detail label="Notes">
                    <span className="whitespace-pre-wrap">{appointment.notes ?? "—"}</span>
                  </Detail>
                  <Detail label="Villa stay">{appointment.bookingId ? "Linked to a villa booking" : "—"}</Detail>
                  {appointment.rebookedFromId ? <Detail label="Booked again">From a cancelled or no-show appointment</Detail> : null}
                  <Detail label="Source">
                    <Badge variant="outline">{sourceLabel(appointment.source)}</Badge>
                  </Detail>
                </dl>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      variant={action === "no_show" || action === "refund" ? "outline" : action === "paid" ? "secondary" : "default"}
                      onClick={() => run(action)}
                      disabled={pending !== null}
                    >
                      {pending === action ? <Spinner className="text-current" /> : null}
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                  {canReschedule(appointment, now) ? (
                    <Button variant="outline" onClick={() => setDialog("reschedule")} disabled={pending !== null}>
                      <CalendarClock aria-hidden className="size-4" />
                      Reschedule
                    </Button>
                  ) : null}
                  {canEditTurnaround(appointment) ? (
                    <Button variant="outline" onClick={() => setDialog("turnaround")} disabled={pending !== null}>
                      <Hourglass aria-hidden className="size-4" />
                      Turnaround
                    </Button>
                  ) : null}
                  {canBookAgain(appointment) ? (
                    <Button variant="outline" onClick={() => onBookAgain(appointment)} disabled={pending !== null || services.length === 0}>
                      <Repeat aria-hidden className="size-4" />
                      Book again
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setEditing(true)} disabled={pending !== null}>
                    <Pencil aria-hidden className="size-4" />
                    Edit details
                  </Button>
                  {CANCELLABLE.includes(appointment.status) ? (
                    <Button variant="outline" className="text-destructive" onClick={() => setDialog("cancel")} disabled={pending !== null}>
                      Cancel appointment
                    </Button>
                  ) : null}
                </div>
                {canBookAgain(appointment) && services.length === 0 ? <p className="text-sm text-muted-foreground">Add an active service before booking again.</p> : null}
                <AppointmentHistory
                  appointmentId={appointment._id}
                  staffName={staffName}
                  serviceName={(id) => serviceById.get(id)?.name ?? "Former service"}
                />
              </>
            )}
          </div>
        ) : null}
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
      </SheetContent>
    </Sheet>
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
}: {
  appointment: Appointment;
  service?: Service;
  services: Service[];
  onDone: () => void;
}) {
  const updateDetails = useMutation(api.adminServices.updateAppointmentDetails);
  const [original] = useState(appointment);
  const revision = appointmentRevision(original);
  const confirm = useConfirm();
  const [serviceId, setServiceId] = useState<Id<"services">>(appointment.serviceId);
  const [saving, setSaving] = useState(false);
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
    <form onSubmit={submit} className="grid gap-4">
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
          <Label htmlFor="ap-name">Guest name</Label>
          <Input id="ap-name" name="guestName" defaultValue={appointment.guestName} required />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-2">
            <Label htmlFor="ap-phone">Phone</Label>
            <Input id="ap-phone" name="guestPhone" type="tel" defaultValue={appointment.guestPhone} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="ap-email">Email (optional)</Label>
            <Input id="ap-email" name="guestEmail" type="email" defaultValue={appointment.guestEmail} />
          </div>
        </div>
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
          <Button type="button" variant="outline" onClick={onDone}>
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
