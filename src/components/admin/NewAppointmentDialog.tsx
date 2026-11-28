"use client";

import { staffDateTime } from "@/lib/staff-time";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { FunctionArgs, FunctionReturnType } from "convex/server";
import { staffDate } from "@/lib/staff-time";
import { useRef, useState, type FormEvent } from "react";
import { appointmentEntrySlot, appointmentEntryStatus, isPastEntry } from "@/components/admin/appointment-entry";
import { ServicePicker } from "@/components/admin/ServicePicker";
import { formatMoney } from "@/components/admin/labels";
import { DurationChoice } from "@/components/services/DurationChoice";
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
import { hasDurations, priceFrom, serviceOption, serviceOptions } from "@/lib/service-options";
import {
  DAY_MS,
  errorText,
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
  rebook?: Doc<"appointments">;
  stay?: { bookingId: Id<"bookings">; guestName: string; guestPhone: string; guestEmail?: string; villaName: string };
};

const LAST_SERVICE_KEY = "admin.staff.lastServiceId";
/** The last booked length per service, as `{ [serviceId]: minutes }`. */
const LAST_DURATIONS_KEY = "admin.staff.lastDurations";
/** Up to this many services show as one-tap chips; more get the searchable picker. */
const SERVICE_CHIPS = 6;

function readLastService() {
  try {
    return window.localStorage.getItem(LAST_SERVICE_KEY);
  } catch {
    return null;
  }
}

function readLastDurations(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(LAST_DURATIONS_KEY) ?? "{}");
    return value && typeof value === "object" ? (value as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function rememberService(serviceId: string, durationMin: number) {
  try {
    window.localStorage.setItem(LAST_SERVICE_KEY, serviceId);
    window.localStorage.setItem(LAST_DURATIONS_KEY, JSON.stringify({ ...readLastDurations(), [serviceId]: durationMin }));
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
  onCreated: (id: Id<"appointments">, start: number) => void;
}) {
  const createAppointment = useMutation(api.services.commands.createAppointment.createAppointment);
  const { rebook, stay } = draft;
  const linked = useQuery(api.bookings.admin.stayAppointments, stay ? { bookingId: stay.bookingId } : "skip");
  const allServices = useQuery(api.services.admin.listServices, { includeArchived: true });
  const allStaff = useQuery(api.services.admin.listStaff, { includeArchived: true });
  const services = allServices ?? initialServices;
  const staff = allStaff ?? initialStaff;
  const [wanted] = useState(() => rebook?.serviceId ?? readLastService());
  const [pickedServiceId, setServiceId] = useState<Id<"services"> | undefined>();
  // The picked service, else the rebooked or last used one (once services load), as long as the
  // staff member picked on the calendar performs it.
  const fits = (s: Service) => !draft.staffId || s.staffIds.includes(draft.staffId);
  const serviceId = pickedServiceId ?? (services.find((s) => s._id === wanted && fits(s)) ?? services.find(fits) ?? services[0])?._id;
  const service = services.find((s) => s._id === serviceId);
  const [lastDurations] = useState(readLastDurations);
  const [pickedDuration, setDuration] = useState<number | undefined>();
  // The picked length, else the rebooked one, else the last booked for this service, else the default.
  const option = service
    ? serviceOption(service, pickedDuration ?? (rebook?.serviceId === service._id ? (rebook.end - rebook.start) / 60_000 : undefined) ?? lastDurations[service._id])
    : undefined;
  const multiple = service ? hasDurations(service) : false;
  // Only a service with several lengths names one, so a single-length service books as before.
  const durationArg = multiple && option ? { durationMin: option.durationMin } : {};
  const [staffChoice, setStaffChoice] = useState<string>(draft.staffId ?? "auto");
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState<number | null>(draft.start ?? null);
  const [startChange, setStartChange] = useState<"duration" | "staff" | null>(null);
  const clearStart = () => {
    setStart(null);
    setStartChange(null);
  };
  const [saving, setSaving] = useState(false);
  const submitting = useRef(false);
  const [error, setError] = useState("");
  /** "Other time…": the typed time replaces the chips (a past time today is past work). */
  const [otherTime, setOtherTime] = useState(false);
  const now = useNow();
  const today = resortIsoDate(now);
  const historicalDate = isPastEntry(date, start, now, service && option ? option.durationMin + (service.bufferMin ?? 0) : 0);
  const qualified = staff.filter(person => historicalDate || (person.status === "active" && service?.staffIds.includes(person._id)));
  const staffId = qualified.some(person => person._id === staffChoice) ? staffChoice as Id<"staff"> : undefined;
  const [historicalReason, setHistoricalReason] = useState("");
  // D19: an explicit stay attachment, separate from the guest contact fields and from any payment.
  const [attachedStay, setAttachedStay] = useState<AttachableStay | null>(null);
  const pickable = services.filter(s => historicalDate || s.status === "active").map(s => s.status === "archived" ? { ...s, name: `${s.name} (archived)` } : s);

  const slots = useQuery(
    api.services.admin.findOpenSlots,
    serviceId ? { serviceId, ...durationArg, date, staffId } : "skip",
  );
  // A time that has already started is past work, never a new booking's default.
  const openSlots = slots?.filter((slot) => slot.start >= now);
  // Keep the chosen time after a duration change, including subsequent staff changes.
  const exact = startChange !== null && start !== null && start >= now && !otherTime;
  const selectedSlot = exact ? openSlots?.find((slot) => slot.start === start) : appointmentEntrySlot(openSlots, start, staffId, now);
  const closedStart = exact && openSlots !== undefined && !selectedSlot ? start : null;
  const assignedId = staffId ?? selectedSlot?.autoStaffId;
  const review = useQuery(api.services.admin.previewAppointmentTime, serviceId && assignedId && selectedSlot ? { serviceId, ...durationArg, staffId: assignedId, start: selectedSlot.start } : "skip");
  const assigned = staff.find((person) => person._id === assignedId);
  let closedStartMessage = "";
  if (closedStart !== null && option) {
    const time = resortTime24(closedStart);
    closedStartMessage = startChange === "staff"
      ? assigned ? `${assigned.name} isn't available at ${time}. Pick another time.` : `No qualified staff are available at ${time}. Pick another time.`
      : `${time} isn't open for ${option.durationMin} min. Pick another time.`;
  }
  const entryStart = selectedSlot?.start ?? start;
  const completed = entryStart !== null && service !== undefined && appointmentEntryStatus(entryStart, option?.durationMin ?? service.durationMin, now) === "completed";
  const inProgress = entryStart !== null && !completed && entryStart <= now;
  // Chips or the typed time, never both: earlier days and "Other time…" type it.
  const typedTime = date < today || otherTime || (start !== null && start < now);

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
        ...durationArg,
        // The server refuses the booking if this price changed since staff saw it.
        expectedPrice: option?.price ?? service?.price,
        start: selectedSlot.start,
        historicalReason: historicalReason.trim() || undefined,
        // Book exactly who the preview showed.
        staffId: assignedId,
        ...(stay
          ? { guestName: stay.guestName, guestPhone: stay.guestPhone, guestEmail: stay.guestEmail, bookingId: stay.bookingId }
          : { guestName: text("guestName"), guestPhone: text("guestPhone"), guestEmail: text("guestEmail") || undefined, ...(attachedStay ? { bookingId: attachedStay._id } : {}) }),
        ...(rebook ? { rebookedFromId: rebook._id } : {}),
      });
      rememberService(serviceId, option?.durationMin ?? service?.durationMin ?? 0);
      onCreated(result.appointmentId, selectedSlot.start);
    } catch (err) {
      setError(errorText(err, "Could not create the appointment."));
    } finally {
      submitting.current = false;
      setSaving(false);
    }
  }

  const timeChip = (slot: { start: number }) => {
    const active = slot.start === selectedSlot?.start;
    const label = resortTime24(slot.start);
    return (
      <Button
        key={slot.start}
        type="button"
        size="sm"
        variant={active ? "default" : "outline"}
        aria-pressed={active}
        className="px-0 tabular-nums"
        onClick={() => setStart(slot.start)}
      >
        {label}
      </Button>
    );
  };
  const otherTimeChip = (
    <Button
      type="button"
      size="sm"
      variant="outline"
      className="col-span-2 px-2"
      onClick={() => {
        if (start === null && selectedSlot) setStart(selectedSlot.start);
        setOtherTime(true);
      }}
    >
      Other time…
    </Button>
  );

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
              ? `Linked to ${rebook.confirmationCode} · open times only`
              : historicalDate ? "Past work · pick who did it" : "Only open times are shown."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="flex min-h-0 flex-col gap-4">
          <div className="min-h-0 overflow-y-auto">
            <fieldset disabled={saving} className="grid min-w-0 gap-4">
              {stay ? (
                <section aria-label="Linked spa appointments" className="grid gap-1 text-sm">
                  <h3 className="font-medium">Linked spa appointments</h3>
                  {!linked ? <p role="status">Loading appointments…</p> : linked.appointments.length ? (
                    <ul>{linked.appointments.map((appointment) => (
                      <li key={appointment._id}>{appointment.serviceName} · {staffDateTime(appointment.start)} · {appointment.status.replaceAll("_", " ")}</li>
                    ))}</ul>
                  ) : <p>No linked appointments.</p>}
                  {linked?.complete === false ? <p>Some linked appointments could not be shown.</p> : null}
                </section>
              ) : null}
              <div className="grid gap-2">
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
                            setDuration(undefined);
                            clearStart();
                          }}
                        >
                          {s.name} · {priceFrom(s, (amount) => formatMoney(amount, s.currency))}
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
                        setDuration(undefined);
                        clearStart();
                      }}
                    />
                  </>
                )}
                {service && option && multiple ? (
                  <DurationChoice
                    legend="Duration"
                    options={serviceOptions(service)}
                    value={option.durationMin}
                    onChange={(minutes) => {
                      setDuration(minutes);
                      setStart(selectedSlot?.start ?? start);
                      setStartChange("duration");
                    }}
                    formatPrice={(amount) => formatMoney(amount, service.currency)}
                    className="mt-2"
                  />
                ) : null}
                {service && option ? (
                  <p className="text-xs text-muted-foreground">
                    {option.durationMin} min · {formatMoney(option.price, service.currency)}
                    {service.bufferMin ? ` · ${service.bufferMin} min turnaround` : ""}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="na-date">Date</Label>
                  <DatePicker
                    disabled={saving}
                    id="na-date"
                    value={date}
                    required
                    onValueChange={(next) => {
                      setDate(next);
                      clearStart();
                      setOtherTime(false);
                    }}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="na-staff">Staff</Label>
                  <Select
                    value={staffId ?? (historicalDate ? "" : "auto")}
                    disabled={saving}
                    onValueChange={(choice) => {
                      setStaffChoice(choice);
                      if (startChange !== null) setStartChange("staff");
                    }}
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
              </div>
              {typedTime ? (
                <div className="grid gap-2">
                  <Label htmlFor="na-actual-time">Time</Label>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      id="na-actual-time"
                      type="time"
                      step={60}
                      className="w-32 tabular-nums"
                      value={entryStart === null ? "" : resortTime24(entryStart)}
                      onChange={event => {
                        // Typing keeps the box, even once the time is later than now.
                        setOtherTime(true);
                        setStart(event.target.value ? resortDateTime(date, event.target.value) : null);
                      }}
                    />
                    {date >= today ? (
                      <Button
                        type="button"
                        variant="link"
                        className="min-h-10 px-1"
                        onClick={() => {
                          setOtherTime(false);
                          clearStart();
                        }}
                      >
                        Open times
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : (
                <fieldset className="grid gap-2">
                  <legend className="mb-2 text-sm font-medium">Time</legend>
                  {slots === undefined ? (
                    <div role="status" aria-label="Finding open times" className="grid grid-cols-4 gap-1.5 sm:grid-cols-8">
                      {Array.from({ length: 8 }, (_, i) => (
                        <Skeleton key={i} className="h-9" />
                      ))}
                    </div>
                  ) : openSlots?.length === 0 ? (
                    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                      No open times
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setDate(resortIsoDate(resortMidnight(date) + DAY_MS));
                          clearStart();
                        }}
                      >
                        Next day
                      </Button>
                      {otherTimeChip}
                      {serviceId && date >= today ? (
                        <NextOpenTime
                          args={{ serviceId, ...durationArg, afterDate: date, staffId }}
                          onChoose={(slot) => {
                            setDate(slot.date);
                            setStartChange(null);
                            setStart(slot.start);
                          }}
                        />
                      ) : null}
                    </div>
                  ) : (
                    <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-8">
                      {openSlots?.map(timeChip)}
                      {otherTimeChip}
                    </div>
                  )}
                </fieldset>
              )}
              <p role="status" className={closedStart === null ? "sr-only" : "text-sm text-destructive"}>
                {closedStartMessage}
              </p>
              {start !== null && selectedSlot && selectedSlot.start !== start ? (
                <p className="text-sm text-destructive">
                  {selectedSlot.start > start
                    ? "That time isn't open. Showing the next open time."
                    : "No open times after that. Showing the first open time."}
                </p>
              ) : null}
              {completed || inProgress ? <p className="text-sm">{completed ? "Completed · Unpaid" : "In progress · Unpaid"}</p> : null}
              {completed ? <p className="text-xs text-muted-foreground">Past work · Verify service and staff. No guest notification.</p> : null}
              {review?.problem ? <p role="alert" className="text-sm text-destructive">{review.problem}</p> : null}
              {review?.warnings.map(warning => <p key={warning} className="text-sm text-muted-foreground">{warning}</p>)}
              {review?.needsReason ? <div className="grid gap-2"><Label htmlFor="na-reason">Reason for the historical overlap</Label><Input id="na-reason" required maxLength={500} value={historicalReason} onChange={event => setHistoricalReason(event.target.value)} /></div> : null}
              {stay ? null : (
                <>
                  <StayAttachPicker date={date} value={attachedStay} onChange={setAttachedStay} />
                  <div className="grid gap-2">
                    <Label htmlFor="na-name">Guest name (optional)</Label>
                    <Input id="na-name" name="guestName" defaultValue={rebook?.guestName} />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="na-phone">Phone (optional)</Label>
                      <Input id="na-phone" name="guestPhone" type="tel" defaultValue={rebook?.guestPhone} />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="na-email">Email (optional)</Label>
                      <Input id="na-email" name="guestEmail" type="email" defaultValue={rebook?.guestEmail} />
                    </div>
                  </div>
                </>
              )}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </fieldset>
          </div>
          <DialogFooter className="shrink-0 border-t border-border bg-card pt-3">
            <Button type="submit" disabled={saving || !selectedSlot || review === undefined || Boolean(review.problem) || Boolean(review.needsReason && !historicalReason.trim())}>
              {saving ? <Spinner className="text-current" /> : null}
              {service && selectedSlot ? `Book ${service.name}${multiple && option ? ` · ${option.durationMin} min` : ""} · ${resortTime24(selectedSlot.start)}` : rebook ? "Book again" : "Book appointment"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** D20: the first open time on a later date for the chosen service, length and staff, within a bounded window. */
export function NextOpenTime({ args, onChoose }: {
  args: FunctionArgs<typeof api.services.admin.findNextOpenSlot>;
  onChoose: (slot: { date: string; start: number }) => void;
}) {
  const next = useQuery(api.services.admin.findNextOpenSlot, args);
  if (next === undefined) return <span role="status" className="w-full text-xs">Looking for the next open time…</span>;
  if (!next.slot) {
    return (
      <span className="w-full text-xs">
        No open times from {staffDate(resortMidnight(next.from), { weekday: true })} through {staffDate(resortMidnight(next.through), { weekday: true })} for these choices. Change the date, staff or length.
      </span>
    );
  }
  const slot = next.slot;
  return (
    <Button type="button" size="sm" className="w-full sm:w-auto" onClick={() => onChoose(slot)}>
      Next open: {staffDate(slot.start, { weekday: true })} · {resortTime24(slot.start)}
    </Button>
  );
}

type AttachableStay = FunctionReturnType<typeof api.bookings.admin.searchBookings>[number];

/** Stays a Spa appointment on `date` may join: not cancelled and covering that date (the server re-checks). */
export function attachableStays(stays: readonly AttachableStay[], date: string) {
  return stays.filter((stay) => stay.status !== "cancelled" && stay.checkIn <= date && date <= stay.checkOut);
}

/** D19: search hotel stays (admin search) and attach one explicitly; choosing a stay charges nothing. */
export function StayAttachPicker({ date, value, onChange }: { date: string; value: AttachableStay | null; onChange: (stay: AttachableStay | null) => void }) {
  const [query, setQuery] = useState("");
  const found = useQuery(api.bookings.admin.searchBookings, query.trim().length >= 2 && !value ? { query: query.trim() } : "skip");
  const eligible = found ? attachableStays(found, date) : [];
  const label = (stay: AttachableStay) => `${stay.guestName} · ${staffDate(resortMidnight(stay.checkIn))} → ${staffDate(resortMidnight(stay.checkOut))} · ${stay.confirmationCode}`;
  if (value) {
    return (
      <div className="grid gap-1 rounded-lg border border-border px-3 py-2 text-sm">
        <span className="text-xs text-muted-foreground">Attached hotel stay</span>
        <span className="flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{label(value)}</span>
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)}>Remove</Button>
        </span>
        <span className="text-xs text-muted-foreground">The appointment goes on this stay&apos;s checkout order. Nothing is charged until staff take payment. Guest contact below stays as you enter it.</span>
      </div>
    );
  }
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Attach to a hotel stay (optional)</summary>
      <div className="mt-2 grid gap-2">
        <Label htmlFor="na-stay">Find the stay by guest name, phone, email or code</Label>
        <Input id="na-stay" value={query} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        {found === undefined ? null : eligible.length === 0 ? (
          <p className="text-xs text-muted-foreground">No stay that includes {staffDate(resortMidnight(date), { weekday: true })} matches.</p>
        ) : (
          <ul className="grid gap-1">
            {eligible.map((stay) => (
              <li key={stay._id}>
                <Button type="button" variant="outline" size="sm" className="h-auto w-full justify-start whitespace-normal py-2 text-start" onClick={() => onChange(stay)}>
                  {label(stay)}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
