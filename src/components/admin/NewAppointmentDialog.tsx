"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useRef, useState, type FormEvent } from "react";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { formatMoney } from "@/components/admin/labels";
import { Button } from "@/components/ui/button";
import { DatePicker } from "@/components/ui/date-picker";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  DAY_MS,
  errorText,
  formatResortTime,
  pickSlot,
  resortIsoDate,
  resortMidnight,
  resortTime24,
  useNow,
} from "@/lib/staff-bookings";

type Staff = Doc<"staff">;
type Service = Doc<"services">;

/** Where the new appointment dialog starts; `rebook` copies a cancelled or no-show appointment's guest and service. */
export type AppointmentDraft = {
  date: string;
  staffId?: Id<"staff">;
  start?: number;
  rebook?: Doc<"serviceAppointments">;
};

const LAST_SERVICE_KEY = "admin.staff.lastServiceId";
const DAY_PARTS = [
  { label: "Morning", before: "12:00" },
  { label: "Afternoon", before: "17:00" },
  { label: "Evening", before: "24:00" },
] as const;

function readLastService() {
  try {
    return window.localStorage.getItem(LAST_SERVICE_KEY);
  } catch {
    return null;
  }
}

function rememberService(serviceId: string) {
  try {
    window.localStorage.setItem(LAST_SERVICE_KEY, serviceId);
  } catch {
    // Private mode or full storage: remembering is only a convenience.
  }
}

/**
 * Service → date → time; the least-busy qualified staff member is pre-assigned and can be changed.
 * Booking again creates a new appointment linked to the original, which stays as it was.
 */
export function NewAppointmentDialog({
  draft,
  services,
  staff,
  onClose,
  onCreated,
}: {
  draft: AppointmentDraft;
  services: Service[];
  staff: Staff[];
  onClose: () => void;
  onCreated: (id: Id<"serviceAppointments">, start: number) => void;
}) {
  const createAppointment = useMutation(api.adminServices.createAppointment);
  const { rebook } = draft;
  const [serviceId, setServiceId] = useState<Id<"services"> | undefined>(() => {
    // The rebooked or last used service, as long as the staff member picked on the calendar performs it.
    const fits = (s: Service) =>
      !draft.staffId || s.staffIds.includes(draft.staffId);
    const wanted = rebook?.serviceId ?? readLastService();
    return (
      services.find((s) => s._id === wanted && fits(s)) ??
      services.find(fits) ??
      services[0]
    )?._id;
  });
  const service = services.find((s) => s._id === serviceId);
  const qualified = staff.filter((person) =>
    service?.staffIds.includes(person._id),
  );
  const [staffChoice, setStaffChoice] = useState<string>(
    draft.staffId ?? "auto",
  );
  const staffId = qualified.some((person) => person._id === staffChoice)
    ? (staffChoice as Id<"staff">)
    : undefined;
  const [changingStaff, setChangingStaff] = useState(false);
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState<number | null>(draft.start ?? null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const today = resortIsoDate(useNow());

  const slots = useQuery(
    api.adminServices.findOpenSlots,
    serviceId && date >= today ? { serviceId, date, staffId } : "skip",
  );
  // Fall back to the next open time (or the first), so the form is always one click from booking.
  const selectedSlot = pickSlot(slots, start);
  const assignedId = staffId ?? selectedSlot?.autoStaffId;
  const assigned = staff.find((person) => person._id === assignedId);
  const parts = DAY_PARTS.map((part, i) => ({
    label: part.label,
    slots: (slots ?? []).filter((slot) => {
      const time = resortTime24(slot.start);
      return time < part.before && (i === 0 || time >= DAY_PARTS[i - 1].before);
    }),
  })).filter((part) => part.slots.length);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !serviceId || submitting.current) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    submitting.current = true;
    setSaving(true);
    setError("");
    try {
      const result = await createAppointment({
        serviceId,
        start: selectedSlot.start,
        // Book exactly who the preview showed.
        staffId: assignedId,
        guestName: text("guestName"),
        guestPhone: text("guestPhone"),
        guestEmail: text("guestEmail") || undefined,
        ...(rebook ? { rebookedFromId: rebook._id } : {}),
      });
      rememberService(serviceId);
      onCreated(result.appointmentId, selectedSlot.start);
    } catch (err) {
      setError(errorText(err, "Could not create the appointment."));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next && !submitting.current) onClose();
      }}
    >
      <DialogContent
        className="flex max-h-[90dvh] flex-col overflow-hidden sm:max-w-lg"
        showCloseButton={!saving}
      >
        <DialogHeader>
          <DialogTitle>
            {rebook
              ? rebook.guestName
                ? `Book ${rebook.guestName} again`
                : "Book again"
              : "New appointment"}
          </DialogTitle>
          <DialogDescription>
            {rebook
              ? `A new appointment linked to ${rebook.confirmationCode}, which stays as it was. Only open times are shown.`
              : "Only open times are shown. Booking blocks the staff member's time."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 overflow-y-auto">
            <fieldset disabled={saving} className="grid min-w-0 gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label>Service</Label>
                  <Select
                    value={serviceId}
                    disabled={saving}
                    onValueChange={(value) => {
                      setServiceId(value as Id<"services">);
                      setStart(null);
                    }}
                  >
                    <SelectTrigger className="rounded-lg" aria-label="Service">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {services.map((s) => (
                        <SelectItem key={s._id} value={s._id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="na-date">Date</Label>
                  <DatePicker
                    disabled={saving}
                    id="na-date"
                    value={date}
                    min={today}
                    required
                    onValueChange={(next) => {
                      setDate(next);
                      setStart(null);
                    }}
                  />
                </div>
              </div>
              {service ? (
                <p className="-mt-2 text-xs text-muted-foreground">
                  {service.durationMin} min ·{" "}
                  {formatMoney(service.price, service.currency)}
                  {service.bufferMin
                    ? ` · ${service.bufferMin} min turnaround`
                    : ""}
                </p>
              ) : null}
              <div className="grid gap-2">
                <Label>Time</Label>
                {date < today ? (
                  <p className="text-sm text-muted-foreground">
                    Pick today or a future date.
                  </p>
                ) : slots === undefined ? (
                  <div
                    role="status"
                    aria-label="Finding open times"
                    className="grid grid-cols-4 gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-6"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : slots.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    No open times on this date.
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        setDate(resortIsoDate(resortMidnight(date) + DAY_MS))
                      }
                    >
                      Next day
                    </Button>
                  </p>
                ) : (
                  <div className="grid max-h-64 gap-3 overflow-y-auto rounded-lg border border-border p-3">
                    {parts.map((part) => (
                      <fieldset key={part.label}>
                        <legend className="admin-eyebrow mb-1.5">
                          {part.label}
                        </legend>
                        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                          {part.slots.map((slot) => {
                            const active = slot.start === selectedSlot?.start;
                            return (
                              <Button
                                key={slot.start}
                                type="button"
                                size="sm"
                                variant={active ? "default" : "outline"}
                                aria-pressed={active}
                                aria-label={formatResortTime(slot.start)}
                                className="px-0 tabular-nums"
                                onClick={() => setStart(slot.start)}
                              >
                                {/* The section heading says morning/afternoon/evening. */}
                                {formatResortTime(slot.start).replace(
                                  /\s?[AP]M$/,
                                  "",
                                )}
                              </Button>
                            );
                          })}
                        </div>
                      </fieldset>
                    ))}
                  </div>
                )}
                {start !== null &&
                selectedSlot &&
                selectedSlot.start !== start ? (
                  <p className="text-sm text-destructive">
                    {selectedSlot.start > start
                      ? "That time isn't open. Showing the next open time."
                      : "No open times after that. Showing the first open time."}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="na-staff">Staff</Label>
                {changingStaff ? (
                  <Select
                    value={staffId ?? "auto"}
                    disabled={saving}
                    onValueChange={(value) => {
                      setStaffChoice(value);
                      setChangingStaff(false);
                    }}
                  >
                    <SelectTrigger id="na-staff" className="rounded-lg">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">
                        Auto (least busy that day)
                      </SelectItem>
                      {qualified.map((person) => (
                        <SelectItem key={person._id} value={person._id}>
                          {person.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <p className="flex min-h-9 flex-wrap items-center gap-x-2 text-sm">
                    {assigned ? (
                      <>
                        <StaffAvatar staff={assigned} className="size-6" />
                        <span>
                          Assigned to{" "}
                          <span className="font-semibold">{assigned.name}</span>
                          {staffId ? null : (
                            <span className="text-muted-foreground">
                              {" "}
                              · least busy
                            </span>
                          )}
                        </span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">
                        Picked automatically once there&apos;s an open time.
                      </span>
                    )}
                    <Button
                      id="na-staff"
                      type="button"
                      size="sm"
                      variant="link"
                      className="h-auto px-1"
                      onClick={() => setChangingStaff(true)}
                    >
                      Change
                    </Button>
                  </p>
                )}
              </div>
              <div className="grid gap-2">
                <Label htmlFor="na-name">Guest name (optional)</Label>
                <Input
                  id="na-name"
                  name="guestName"
                  aria-describedby="na-guest-hint"
                  defaultValue={rebook?.guestName}
                />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="na-phone">Phone (optional)</Label>
                  <Input
                    id="na-phone"
                    name="guestPhone"
                    aria-describedby="na-guest-hint"
                    type="tel"
                    defaultValue={rebook?.guestPhone}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="na-email">Email (optional)</Label>
                  <Input
                    id="na-email"
                    name="guestEmail"
                    aria-describedby="na-guest-hint"
                    type="email"
                    defaultValue={rebook?.guestEmail}
                  />
                </div>
              </div>
              <p id="na-guest-hint" className="text-sm text-muted-foreground">
                Leave guest details blank to reserve the time. You can add them
                later.
              </p>
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </fieldset>
          </div>
          <DialogFooter className="shrink-0 border-t border-border bg-card pt-3">
            <Button
              type="button"
              variant="outline"
              disabled={saving}
              onClick={() => {
                if (!submitting.current) onClose();
              }}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !selectedSlot}>
              {saving ? <Spinner className="text-current" /> : null}
              {rebook ? "Book again" : "Book appointment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
