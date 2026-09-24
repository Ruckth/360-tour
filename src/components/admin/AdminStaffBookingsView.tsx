"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CalendarDays, Clock, Filter, Loader2, PlusIcon, Users } from "lucide-react";
import { useCallback, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { EventCalendarNav, EventCalendarToolbar } from "@/components/reui/event-calendar/event-calendar-nav";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { AdminStaffServicesManager } from "@/components/admin/AdminStaffServicesManager";
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
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import {
  APPOINTMENT_STATUS,
  DAY_MS,
  RESORT_ZONE,
  displayStatus,
  errorText,
  formatResortDate,
  formatResortTime,
  initials,
  money,
  resortIsoDate,
  resortMidnight,
  useNow,
  type AppointmentStatus,
} from "@/lib/staff-bookings";
import { cn } from "@/lib/utils";

type Staff = Doc<"staff">;
type Service = Doc<"services">;
type Appointment = Doc<"serviceAppointments">;
type Block = {
  staffId: Id<"staff">;
  start: number;
  end: number;
  label: string;
  kind: "break" | "time_off" | "turnaround";
  timeOffId?: Id<"staffTimeOff">;
};
type EventData = { kind: "appointment"; appointment: Appointment } | { kind: "block"; block: Block };
type Move = { start: number; end: number; staffId: Id<"staff"> };
type Draft = { date: string; staffId?: Id<"staff">; start?: number };

const SOURCE_LABELS: Record<Appointment["source"], string> = {
  web: "Website",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  line: "LINE",
  instagram: "Instagram",
  admin: "Manual",
};
const STATUS_FILTERS: AppointmentStatus[] = ["booked", "arrived", "in_service", "completed", "no_show", "cancelled"];
const BLOCK_COLOR = "var(--color-zinc-500)";
const MINUTE = 60_000;

function todayRange() {
  const from = resortMidnight(resortIsoDate(Date.now()));
  return { from, to: from + DAY_MS };
}

export function AdminStaffBookingsView() {
  const [tab, setTab] = useState<"calendar" | "staff" | "services">("calendar");

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <nav className="mb-4 flex gap-6 border-b border-border" aria-label="Staff bookings sections">
        {([["calendar", "Calendar"], ["staff", "Staff"], ["services", "Services"]] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            aria-current={tab === key ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors",
              tab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === "calendar" ? <StaffCalendar /> : <AdminStaffServicesManager section={tab} />}
    </div>
  );
}

function StaffCalendar() {
  const [range, setRange] = useState(todayRange);
  const [view, setView] = useState<CalendarView>("resource");
  const [date, setDate] = useState(() => new Date());
  const [hiddenStaff, setHiddenStaff] = useState<Set<string>>(() => new Set());
  const [hiddenServices, setHiddenServices] = useState<Set<string>>(() => new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(() => new Set());
  const [moves, setMoves] = useState<Map<string, Move>>(() => new Map());
  const [selectedId, setSelectedId] = useState<Id<"serviceAppointments"> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState("");
  const now = useNow();

  const data = useQuery(api.adminServices.listSchedule, range);
  const reschedule = useMutation(api.adminServices.rescheduleAppointment);
  const removeTimeOff = useMutation(api.adminServices.removeTimeOff);

  const staffById = useMemo(() => new Map((data?.staff ?? []).map((s) => [s._id as string, s])), [data?.staff]);
  const serviceById = useMemo(() => new Map((data?.services ?? []).map((s) => [s._id as string, s])), [data?.services]);
  const activeServices = useMemo(() => (data?.services ?? []).filter((s) => s.status === "active"), [data?.services]);

  const visibleStaff = useMemo(
    () => (data?.staff ?? []).filter((s) => !hiddenStaff.has(s._id)),
    [data?.staff, hiddenStaff],
  );

  const appointments = useMemo(
    () =>
      (data?.appointments ?? []).filter(
        (a) => !hiddenStaff.has(a.staffId) && !hiddenServices.has(a.serviceId) && !hiddenStatuses.has(a.status),
      ),
    [data?.appointments, hiddenStaff, hiddenServices, hiddenStatuses],
  );

  const bookedCount = appointments.filter((a) => a.status !== "cancelled" && a.status !== "no_show").length;
  const countByStaff = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      if (a.status !== "cancelled") counts.set(a.staffId, (counts.get(a.staffId) ?? 0) + 1);
    }
    return counts;
  }, [appointments]);

  const resources = useMemo<EventCalendarResource[]>(
    () => visibleStaff.map((s) => ({ id: s._id, title: s.name, color: s.color })),
    [visibleStaff],
  );

  const events = useMemo<CalendarEvent<EventData>[]>(() => {
    if (!data) return [];
    const appointmentEvents = appointments.map((appointment): CalendarEvent<EventData> => {
      const move = moves.get(appointment._id);
      const service = serviceById.get(appointment.serviceId);
      const staff = staffById.get(appointment.staffId);
      const editable = appointment.status === "booked" && appointment.start > now;
      return {
        id: appointment._id,
        title: `${appointment.guestName} · ${service?.name ?? "Service"}${staff ? ` · ${staff.name}` : ""}`,
        start: new Date(move?.start ?? appointment.start),
        end: new Date(move?.end ?? appointment.end),
        resourceId: move?.staffId ?? appointment.staffId,
        color: APPOINTMENT_STATUS[displayStatus(appointment)].color,
        readOnly: !editable,
        priority: 1,
        data: { kind: "appointment", appointment },
      };
    });
    // Every staff member's daily breaks side by side are noise in the week view.
    const blockEvents = data.blocks
      .filter((block) => !hiddenStaff.has(block.staffId) && (view === "resource" || block.kind === "time_off"))
      .map((block): CalendarEvent<EventData> => ({
        id: `block-${block.staffId}-${block.start}`,
        title: `${block.label} · ${staffById.get(block.staffId)?.name ?? "Staff"}`,
        start: new Date(block.start),
        end: new Date(block.end),
        resourceId: block.staffId,
        color: BLOCK_COLOR,
        readOnly: true,
        data: { kind: "block", block },
      }));
    // Cleanup/travel after a service blocks the staff member too, so show it.
    const turnaroundEvents = view === "resource"
      ? appointments
          .filter((a) => a.blockedUntil > a.end && a.status !== "cancelled" && a.status !== "no_show")
          .map((appointment): CalendarEvent<EventData> => {
            const move = moves.get(appointment._id);
            const start = move?.end ?? appointment.end;
            const block: Block = {
              staffId: move?.staffId ?? appointment.staffId,
              start,
              end: start + appointment.blockedUntil - appointment.end,
              label: "Turnaround",
              kind: "turnaround",
            };
            return {
              id: `turnaround-${appointment._id}`,
              title: "Turnaround",
              start: new Date(block.start),
              end: new Date(block.end),
              resourceId: block.staffId,
              color: BLOCK_COLOR,
              readOnly: true,
              data: { kind: "block", block },
            };
          })
      : [];
    return [...blockEvents, ...turnaroundEvents, ...appointmentEvents];
  }, [data, appointments, moves, serviceById, staffById, hiddenStaff, now, view]);

  const renderEvent = useCallback(
    ({ occurrence, view: currentView }: { occurrence: { event: CalendarEvent<EventData> }; view: CalendarView }) => {
      const eventData = occurrence.event.data;
      if (!eventData) return null;
      if (eventData.kind === "block") {
        return (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-[inherit] bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-foreground)_9%,transparent)_7px_8px)] text-xs font-medium text-muted-foreground">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{eventData.block.label}</span>
          </span>
        );
      }
      const { appointment } = eventData;
      const status = APPOINTMENT_STATUS[displayStatus(appointment)];
      const service = serviceById.get(appointment.serviceId);
      const staffName = currentView === "resource" ? null : staffById.get(appointment.staffId)?.name;
      return (
        <span className="flex h-full min-w-0 flex-1 flex-col gap-0.5 self-start">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-background/80 text-[9px] font-semibold text-foreground">
              {initials(appointment.guestName)}
            </span>
            <span className="truncate text-[13px] font-semibold">{appointment.guestName}</span>
            <span
              className="hidden shrink-0 rounded-md border px-1.5 text-[11px] leading-5 font-medium @[12rem]:inline"
              style={{ color: status.color, borderColor: `color-mix(in oklab, ${status.color} 45%, transparent)` }}
            >
              {status.label}
            </span>
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {formatResortTime(appointment.start)} • {service?.name ?? "Service"}
            {staffName ? ` · ${staffName}` : ""}
          </span>
        </span>
      );
    },
    [serviceById, staffById],
  );

  const renderResourceHeader = useCallback(
    ({ resource }: { resource: EventCalendarResource }) => {
      const person = staffById.get(resource.id);
      if (!person) return resource.title;
      const count = countByStaff.get(resource.id) ?? 0;
      return (
        <span className="flex min-w-0 items-center gap-2.5 py-1 text-start">
          <StaffAvatar staff={person} className="size-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{person.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {count === 1 ? "1 appointment" : `${count} appointments`}
            </span>
          </span>
        </span>
      );
    },
    [staffById, countByStaff],
  );

  const selected = data?.appointments.find((a) => a._id === selectedId) ?? null;
  const filterCount = hiddenServices.size + hiddenStatuses.size;

  return (
    <>
      <div className="border border-border bg-card [&_*]:border-border">
        <EventCalendar<EventData>
          events={events}
          view={view}
          onViewChange={setView}
          date={date}
          onDateChange={setDate}
          views={["resource", "week"]}
          resources={resources}
          timeZone={RESORT_ZONE}
          dayStartHour={6}
          dayEndHour={23}
          interval={60}
          snapDuration={15}
          scrollToHour={8}
          i18n={{ viewNames: { resource: "Day" } }}
          interactions={{ drag: true, resize: true, selectSlot: false }}
          renderEvent={renderEvent}
          renderResourceHeader={renderResourceHeader}
          onEventClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "appointment") setSelectedId(eventData.appointment._id);
            if (eventData?.kind === "block" && eventData.block.timeOffId) {
              const { timeOffId, label } = eventData.block;
              if (window.confirm(`Remove "${label}" time off?`)) {
                removeTimeOff({ timeOffId }).catch((err: unknown) => setError(errorText(err, "Could not remove time off.")));
              }
            }
          }}
          onSlotClick={(slot) => {
            if (slot.allDay || !data || activeServices.length === 0) return;
            const start = slot.date.getTime();
            setDraft({
              date: resortIsoDate(start),
              staffId: slot.resourceId as Id<"staff"> | undefined,
              start: start > Date.now() ? start : undefined,
            });
          }}
          onEventUpdate={(update) => {
            const eventData = update.event.data;
            if (update.source === "api" || eventData?.kind !== "appointment") return false;
            const { appointment } = eventData;
            const move: Move = {
              start: update.start.getTime(),
              end: update.end.getTime(),
              staffId: (update.resourceId ?? appointment.staffId) as Id<"staff">,
            };
            setMoves((current) => new Map(current).set(appointment._id, move));
            setError("");
            reschedule({
              appointmentId: appointment._id,
              start: move.start,
              staffId: move.staffId,
              durationMin: Math.round((move.end - move.start) / MINUTE),
            })
              .catch((err: unknown) => setError(errorText(err, "Could not move the appointment.")))
              .finally(() =>
                setMoves((current) => {
                  const next = new Map(current);
                  next.delete(appointment._id);
                  return next;
                }),
              );
            return true;
          }}
          onRangeChange={({ range: visible }) => {
            const from = visible.start.getTime();
            const to = visible.end.getTime();
            setRange((current) => (current.from === from && current.to === to ? current : { from, to }));
          }}
          className="h-[calc(100vh-230px)] min-h-[600px] w-full"
        >
          <div className="flex flex-wrap items-center gap-2 border-b border-border pe-2">
            <EventCalendarNav className="min-w-0 flex-1" />
            <EventCalendarToolbar>
              {data === undefined ? <Loader2 className="size-4 animate-spin text-gold" /> : null}
              <span className="hidden items-center gap-1.5 px-1 text-xs text-muted-foreground lg:flex">
                <CalendarDays aria-hidden className="size-3.5" />
                {bookedCount} booked in view
              </span>
              <CheckList
                icon={<Users aria-hidden className="size-4" />}
                label={`${visibleStaff.length} of ${data?.staff.length ?? 0} staff`}
                groups={[
                  {
                    title: "Staff",
                    items: (data?.staff ?? []).map((s) => ({ id: s._id, label: s.name, detail: s.role })),
                    hidden: hiddenStaff,
                    onChange: setHiddenStaff,
                  },
                ]}
              />
              <CheckList
                icon={<Filter aria-hidden className="size-4" />}
                label="Filters"
                count={filterCount}
                groups={[
                  {
                    title: "Services",
                    items: (data?.services ?? []).map((s) => ({ id: s._id, label: s.name })),
                    hidden: hiddenServices,
                    onChange: setHiddenServices,
                  },
                  {
                    title: "Status",
                    items: STATUS_FILTERS.map((status) => ({ id: status, label: APPOINTMENT_STATUS[status].label })),
                    hidden: hiddenStatuses,
                    onChange: setHiddenStatuses,
                  },
                ]}
              />
              <Button
                size="sm"
                disabled={!data || activeServices.length === 0}
                onClick={() => setDraft({ date: resortIsoDate(Math.max(range.from, Date.now())) })}
              >
                <PlusIcon aria-hidden className="size-4" />
                New appointment
              </Button>
            </EventCalendarToolbar>
          </div>
          {error ? (
            <p role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <EventCalendarContent />
        </EventCalendar>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {Object.values(APPOINTMENT_STATUS).map((status) => (
            <span key={status.label} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
          ))}
          <span className="flex items-center gap-1.5">
            <Clock aria-hidden className="size-3" />
            Break / time off
          </span>
          <span className="ms-auto hidden sm:inline">Drag a booked appointment to move it. Click an empty slot to book.</span>
        </div>
      </div>

      <AppointmentSheet
        appointment={selected}
        service={selected ? serviceById.get(selected.serviceId) : undefined}
        staff={selected ? staffById.get(selected.staffId) : undefined}
        onClose={() => setSelectedId(null)}
      />
      {data && draft ? (
        <NewAppointmentDialog
          key={`${draft.date}-${draft.staffId ?? ""}-${draft.start ?? ""}`}
          draft={draft}
          services={activeServices}
          staff={data.staff}
          onClose={() => setDraft(null)}
          onCreated={(id, start) => {
            setDraft(null);
            setDate(new Date(start));
            setSelectedId(id);
          }}
        />
      ) : null}
    </>
  );
}

type CheckGroup = {
  title: string;
  items: Array<{ id: string; label: string; detail?: string }>;
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
};

function CheckList({ icon, label, count, groups }: { icon: ReactNode; label: string; count?: number; groups: CheckGroup[] }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline">
          {icon}
          {label}
          {count ? (
            <Badge variant="secondary" className="ms-0.5 h-5 min-w-5 justify-center rounded-full px-1.5">
              {count}
            </Badge>
          ) : null}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-0">
        {groups.map((group) => (
          <fieldset key={group.title} className="border-b border-border p-2 last:border-b-0">
            <div className="flex items-center justify-between px-2 pb-1">
              <legend className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{group.title}</legend>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground"
                onClick={() => group.onChange(new Set())}
              >
                Show all
              </button>
            </div>
            {group.items.map((item) => (
              <label key={item.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                <input
                  type="checkbox"
                  className="size-4 accent-foreground"
                  checked={!group.hidden.has(item.id)}
                  onChange={(event) => {
                    const next = new Set(group.hidden);
                    if (event.target.checked) next.delete(item.id);
                    else next.add(item.id);
                    group.onChange(next);
                  }}
                />
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {item.detail ? <span className="truncate text-xs text-muted-foreground">{item.detail}</span> : null}
              </label>
            ))}
          </fieldset>
        ))}
      </PopoverContent>
    </Popover>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

type SheetAction = "arrived" | "in_service" | "completed" | "no_show" | "cancel" | "paid";

const NEXT_ACTIONS: Record<AppointmentStatus, SheetAction[]> = {
  booked: ["arrived", "in_service", "completed", "no_show", "cancel"],
  arrived: ["in_service", "completed", "no_show", "cancel"],
  in_service: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

const ACTION_LABELS: Record<SheetAction, string> = {
  arrived: "Mark arrived",
  in_service: "Start service",
  completed: "Complete",
  no_show: "No-show",
  cancel: "Cancel appointment",
  paid: "Mark paid",
};

function AppointmentSheet({
  appointment,
  service,
  staff,
  onClose,
}: {
  appointment: Appointment | null;
  service?: Service;
  staff?: Staff;
  onClose: () => void;
}) {
  const updateStatus = useMutation(api.adminServices.updateAppointmentStatus);
  const markPaid = useMutation(api.adminServices.markAppointmentPaid);
  const cancel = useMutation(api.adminServices.cancelAppointment);
  const [pending, setPending] = useState<SheetAction | null>(null);
  const [error, setError] = useState("");
  const now = useNow();

  async function run(action: SheetAction) {
    if (!appointment) return;
    if (action === "cancel" && !window.confirm("Cancel this appointment and free the staff member's time?")) return;
    setPending(action);
    setError("");
    try {
      if (action === "cancel") await cancel({ appointmentId: appointment._id });
      else if (action === "paid") await markPaid({ appointmentId: appointment._id });
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
      ]
    : [];
  const status = appointment ? APPOINTMENT_STATUS[displayStatus(appointment)] : null;

  return (
    <Sheet
      open={Boolean(appointment)}
      onOpenChange={(open) => {
        if (!open) {
          setError("");
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {appointment && status ? (
          <div className="grid gap-5">
            <div>
              <SheetTitle className="font-serif text-2xl font-semibold">{appointment.guestName}</SheetTitle>
              <SheetDescription className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                {status.label} · {appointment.confirmationCode}
              </SheetDescription>
            </div>
            <dl className="divide-y divide-border border-y border-border">
              <Detail label="Service">{service?.name ?? "—"}</Detail>
              <Detail label="Staff">
                {staff ? (
                  <span className="flex items-center gap-2">
                    <StaffAvatar staff={staff} className="size-6 text-[10px]" />
                    {staff.name} <span className="text-muted-foreground">· {staff.role}</span>
                  </span>
                ) : (
                  "—"
                )}
              </Detail>
              <Detail label="When">
                {formatResortDate(appointment.start)}, {formatResortTime(appointment.start)} –{" "}
                {formatResortTime(appointment.end)}
              </Detail>
              <Detail label="Price">{money(appointment.price, appointment.currency)}</Detail>
              <Detail label="Payment">{appointment.paymentStatus}</Detail>
              <Detail label="Phone">{appointment.guestPhone}</Detail>
              <Detail label="Email">{appointment.guestEmail ?? "—"}</Detail>
              <Detail label="Villa stay">{appointment.bookingId ? "Linked to a villa booking" : "—"}</Detail>
              <Detail label="Source">
                <Badge variant="outline">{SOURCE_LABELS[appointment.source]}</Badge>
              </Detail>
            </dl>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {actions.length ? (
              <div className="flex flex-wrap gap-2">
                {actions.map((action) => (
                  <Button
                    key={action}
                    variant={action === "cancel" || action === "no_show" ? "outline" : action === "paid" ? "secondary" : "default"}
                    onClick={() => run(action)}
                    disabled={pending !== null}
                  >
                    {pending === action ? <Loader2 className="size-4 animate-spin" /> : null}
                    {ACTION_LABELS[action]}
                  </Button>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function NewAppointmentDialog({
  draft,
  services,
  staff,
  onClose,
  onCreated,
}: {
  draft: Draft;
  services: Service[];
  staff: Staff[];
  onClose: () => void;
  onCreated: (id: Id<"serviceAppointments">, start: number) => void;
}) {
  const createAppointment = useMutation(api.adminServices.createAppointment);
  const [serviceId, setServiceId] = useState<Id<"services">>(
    () => (services.find((s) => !draft.staffId || s.staffIds.includes(draft.staffId)) ?? services[0])._id,
  );
  const service = services.find((s) => s._id === serviceId);
  const qualified = staff.filter((person) => service?.staffIds.includes(person._id));
  const [staffChoice, setStaffChoice] = useState<string>(draft.staffId ?? "any");
  const staffId = qualified.some((person) => person._id === staffChoice) ? (staffChoice as Id<"staff">) : undefined;
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState<number | null>(draft.start ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = resortIsoDate(useNow());

  const slots = useQuery(api.adminServices.findOpenSlots, date >= today ? { serviceId, date, staffId } : "skip");
  const selectedSlot = slots?.find((slot) => slot.start === start);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setSaving(true);
    setError("");
    try {
      const result = await createAppointment({
        serviceId,
        start: selectedSlot.start,
        staffId,
        guestName: text("guestName"),
        guestPhone: text("guestPhone"),
        guestEmail: text("guestEmail") || undefined,
      });
      onCreated(result.appointmentId, selectedSlot.start);
    } catch (err) {
      setError(errorText(err, "Could not create the appointment."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New appointment</DialogTitle>
          <DialogDescription>Only open times are shown. Booking blocks the staff member&apos;s time.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label>Service</Label>
              <Select
                value={serviceId}
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
              <Label>Staff</Label>
              <Select
                value={staffId ?? "any"}
                onValueChange={(value) => {
                  setStaffChoice(value);
                  setStart(null);
                }}
              >
                <SelectTrigger className="rounded-lg" aria-label="Staff">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any available</SelectItem>
                  {qualified.map((person) => (
                    <SelectItem key={person._id} value={person._id}>
                      {person.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {service ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              {service.durationMin} min · {money(service.price, service.currency)}
              {service.bufferMin ? ` · ${service.bufferMin} min turnaround` : ""}
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label htmlFor="na-date">Date</Label>
            <Input
              id="na-date"
              type="date"
              min={today}
              value={date}
              onChange={(event) => {
                setDate(event.target.value);
                setStart(null);
              }}
              required
            />
          </div>
          <div className="grid gap-2">
            <Label>Time</Label>
            {slots === undefined ? (
              <Loader2 className="size-4 animate-spin text-muted-foreground" />
            ) : slots.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                No open times on this date.
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setDate(resortIsoDate(resortMidnight(date) + DAY_MS))}
                >
                  Next day
                </Button>
              </p>
            ) : (
              <div className="grid max-h-40 grid-cols-4 gap-1.5 overflow-y-auto sm:grid-cols-5">
                {slots.map((slot) => (
                  <Button
                    key={slot.start}
                    type="button"
                    size="sm"
                    variant={slot.start === start ? "default" : "outline"}
                    aria-pressed={slot.start === start}
                    onClick={() => setStart(slot.start)}
                  >
                    {formatResortTime(slot.start)}
                  </Button>
                ))}
              </div>
            )}
            {start !== null && slots && !selectedSlot ? (
              <p className="text-sm text-destructive">That time isn&apos;t open. Pick another.</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="na-name">Guest name</Label>
            <Input id="na-name" name="guestName" required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-2">
              <Label htmlFor="na-phone">Phone</Label>
              <Input id="na-phone" name="guestPhone" type="tel" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="na-email">Email (optional)</Label>
              <Input id="na-email" name="guestEmail" type="email" />
            </div>
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !selectedSlot}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Book appointment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
