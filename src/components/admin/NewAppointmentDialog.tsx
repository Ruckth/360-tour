"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useRef, useState, type FormEvent } from "react";
import { appointmentEntrySlot, appointmentEntryStatus } from "@/components/admin/appointment-entry";
import { ServicePicker } from "@/components/admin/ServicePicker";
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
  resortIsoDate,
  resortMidnight,
  resortTime24,
  resortDateTime,
  useNow,
} from "@/lib/staff-bookings";

type Staff = Doc<"staff">;
type Service = Doc<"services">;

/**
 * Where the new appointment dialog starts; `rebook` copies a cancelled or no-show appointment's
 * guest and service, and `stay` books for a villa guest (their details and the stay's bookingId).
 */
export type AppointmentDraft = {
  date: string;
  staffId?: Id<"staff">;
  start?: number;
  rebook?: Doc<"serviceAppointments">;
  stay?: { bookingId: Id<"bookings">; guestName: string; guestPhone: string; guestEmail?: string; villaName: string };
};

const LAST_SERVICE_KEY = "admin.staff.lastServiceId";
/** Up to this many services show as one-tap chips; more get the searchable picker. */
const SERVICE_CHIPS = 6;
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
  services: initialServices,
  staff: initialStaff,
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
  const { rebook, stay } = draft;
  const allServices = useQuery(api.adminServices.listServices, { includeArchived: true });
  const allStaff = useQuery(api.adminServices.listStaff, { includeArchived: true });
  const services = allServices ?? initialServices;
  const staff = allStaff ?? initialStaff;
  const [wanted] = useState(() => rebook?.serviceId ?? readLastService());
  const [pickedServiceId, setServiceId] = useState<Id<"services"> | undefined>();
  // The picked service, else the rebooked or last used one (once services load), as long as the
  // staff member picked on the calendar performs it.
  const fits = (s: Service) => !draft.staffId || s.staffIds.includes(draft.staffId);
  const serviceId = pickedServiceId ?? (services.find((s) => s._id === wanted && fits(s)) ?? services.find(fits) ?? services[0])?._id;
  const service = services.find((s) => s._id === serviceId);
  const [staffChoice, setStaffChoice] = useState<string>(draft.staffId ?? "auto");
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState<number | null>(draft.start ?? null);
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  const now = useNow();
  const today = resortIsoDate(now);
  const historicalDate = date <= today;
  const qualified = staff.filter(person => historicalDate || (person.status === "active" && service?.staffIds.includes(person._id)));
  const staffId = qualified.some(person => person._id === staffChoice) ? staffChoice as Id<"staff"> : undefined;
  const [historicalReason, setHistoricalReason] = useState("");
  const pickable = services.filter(s => historicalDate || s.status === "active").map(s => s.status === "archived" ? { ...s, name: `${s.name} (archived)` } : s);

  const slots = useQuery(
    api.adminServices.findOpenSlots,
    serviceId ? { serviceId, date, staffId } : "skip",
  );
  // Fall back to the next open time (or the first), so the form is always one click from booking.
  const selectedSlot = appointmentEntrySlot(slots, start, staffId, now);
  const assignedId = staffId ?? selectedSlot?.autoStaffId;
  const review = useQuery(api.adminServices.previewAppointmentTime, serviceId && assignedId && selectedSlot ? { serviceId, staffId: assignedId, start: selectedSlot.start } : "skip");
  const assigned = staff.find((person) => person._id === assignedId);
  // Presentation follows the selected service time; eligibility above deliberately
  // keeps its existing date-based rule.
  const entryStart = selectedSlot?.start ?? start;
  const completed = entryStart !== null && service !== undefined && appointmentEntryStatus(entryStart, service.durationMin, now) === "completed";
  const inProgress = entryStart !== null && !completed && entryStart <= now;
  // An automatic fallback may be this morning's first slot. Keep later choices
  // available until staff explicitly select or enter a time that has started.
  const showSuggestedTimes = date >= today && !(start !== null && start <= now);
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
        historicalReason: historicalReason.trim() || undefined,
        // Book exactly who the preview showed.
        staffId: assignedId,
        ...(stay
          ? { guestName: stay.guestName, guestPhone: stay.guestPhone, guestEmail: stay.guestEmail, bookingId: stay.bookingId }
          : { guestName: text("guestName"), guestPhone: text("guestPhone"), guestEmail: text("guestEmail") || undefined }),
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
            {stay ? "Book spa" : rebook
              ? rebook.guestName
                ? `Book ${rebook.guestName} again`
                : "Book again"
              : "New appointment"}
          </DialogTitle>
          <DialogDescription>
            {stay ? `For ${stay.guestName} · ${stay.villaName}` : rebook
              ? `A new appointment linked to ${rebook.confirmationCode}, which stays as it was. Only open times are shown.`
              : "Record a service at its actual date and time. Current and future availability is checked before saving."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 overflow-y-auto">
            <fieldset disabled={saving} className="grid min-w-0 gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2 sm:col-span-2">
                  {pickable.length <= SERVICE_CHIPS ? (
                    <fieldset className="grid gap-2">
                      <legend className="text-sm font-medium">Service</legend>
                      <div className="flex flex-wrap gap-2">
                        {pickable.map((s) => (
                          <Button
                            key={s._id}
                            type="button"
                            variant={s._id === serviceId ? "default" : "outline"}
                            aria-pressed={s._id === serviceId}
                            onClick={() => {
                              setServiceId(s._id);
                              setStart(null);
                            }}
                          >
                            {s.name} · {formatMoney(s.price, s.currency)}
                          </Button>
                        ))}
                      </div>
                    </fieldset>
                  ) : (
                    <>
                  <Label id="na-service-label" htmlFor="na-service">Service</Label>
                  <ServicePicker
                    id="na-service"
                    labelId="na-service-label"
                    services={pickable}
                    value={serviceId}
                    disabled={saving}
                    onChange={(value) => {
                      setServiceId(value);
                      setStart(null);
                    }}
                  />
                    </>
                  )}
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="na-date">Date</Label>
                  <DatePicker
                    disabled={saving}
                    id="na-date"
                    value={date}
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
              {selectedSlot && service ? <p className="text-sm">{completed ? "Completed · Unpaid. Checkout can collect payment for this service." : inProgress ? "In progress · Unpaid." : "Booked · Unpaid."}</p> : null}
              <div className="grid gap-2">
                {historicalDate ? (
                  <div className="grid gap-2">
                    <Label htmlFor="na-actual-time">Time (Bangkok)</Label>
                    <Input id="na-actual-time" type="time" step={60} value={entryStart === null ? "" : resortTime24(entryStart)} onChange={event => setStart(event.target.value ? resortDateTime(date, event.target.value) : null)} />
                  </div>
                ) : null}
                {showSuggestedTimes ? <Label>{historicalDate ? "Suggested open times" : "Time (Bangkok)"}</Label> : null}
                {showSuggestedTimes && slots === undefined ? (
                  <div
                    role="status"
                    aria-label="Finding open times"
                    className="grid grid-cols-4 gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-6"
                  >
                    {Array.from({ length: 12 }, (_, i) => (
                      <Skeleton key={i} className="h-9" />
                    ))}
                  </div>
                ) : showSuggestedTimes && slots?.length === 0 ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    No available times.
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
                ) : showSuggestedTimes ? (
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
                ) : null}
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
                <Select
                  value={staffId ?? (historicalDate ? "" : "auto")}
                  disabled={saving}
                  onValueChange={setStaffChoice}
                >
                  <SelectTrigger id="na-staff" className="rounded-lg">
                    <SelectValue placeholder="Choose who did the work" />
                  </SelectTrigger>
                  <SelectContent>
                    {!historicalDate ? (
                      <SelectItem value="auto">
                        Auto (least busy){staffId ? "" : ` · ${assigned?.name ?? "picked once a time is chosen"}`}
                      </SelectItem>
                    ) : null}
                    {qualified.map((person) => (
                      <SelectItem key={person._id} value={person._id}>
                        {person.name}{person.status === "archived" ? " (archived)" : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {completed ? <p className="text-xs text-muted-foreground">Past work · Verify service and staff. No guest notification.</p> : null}
              {review?.problem ? <p role="alert" className="text-sm text-destructive">{review.problem}</p> : null}
              {review?.warnings.map(warning => <p key={warning} className="text-sm text-muted-foreground">{warning}</p>)}
              {review?.needsReason ? <div className="grid gap-2"><Label htmlFor="na-reason">Reason for the historical overlap</Label><Input id="na-reason" required maxLength={500} value={historicalReason} onChange={event => setHistoricalReason(event.target.value)} /></div> : null}
{stay ? null : (<>
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
</>)}
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
            <Button type="submit" disabled={saving || !selectedSlot || review === undefined || Boolean(review.problem) || Boolean(review.needsReason && !historicalReason.trim())}>
              {saving ? <Spinner className="text-current" /> : null}
              {rebook ? "Book again" : stay && service && selectedSlot ? `Book ${service.name} · ${formatResortTime(selectedSlot.start)}` : "Book appointment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
