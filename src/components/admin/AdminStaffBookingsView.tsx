"use client";

import { useMutation, useQuery } from "convex/react";
import { useRouter } from "next/navigation";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { CalendarDays, Clock, Filter, Pencil, PlusIcon, Users } from "lucide-react";
import { format } from "date-fns";
import { useCallback, useMemo, useRef, useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { AdminCalendarHeader } from "@/components/admin/AdminCalendarHeader";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { AdminStaffServicesManager, TimeOffDialog } from "@/components/admin/AdminStaffServicesManager";
import { adminStaffTabPath, type AdminStaffTab } from "@/components/admin/admin-routes";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { StaffRosterView } from "@/components/admin/StaffRosterView";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { formatMoney, sourceLabel } from "@/components/admin/labels";
import { CALENDAR_TONE_COLORS } from "@/components/admin/status-tones";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  APPOINTMENT_STATUSES,
  DAY_MS,
  PAYMENT_LABELS,
  RESORT_ZONE,
  appointmentStatus,
  appointmentStatusColor,
  displayStatus,
  errorText,
  formatResortDate,
  formatResortTime,
  resortIsoDate,
  resortMidnight,
  resortTime24,
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
  kind: "break" | "time_off" | "turnaround" | "off";
  timeOff?: Doc<"staffTimeOff">;
};
type EventData = { kind: "appointment"; appointment: Appointment } | { kind: "block"; block: Block };
type Move = { start: number; end: number; staffId: Id<"staff"> };
type Draft = { date: string; staffId?: Id<"staff">; start?: number };

const STATUS_FILTERS: AppointmentStatus[] = ["booked", "arrived", "in_service", "completed", "no_show", "cancelled"];
const BLOCK_COLOR = CALENDAR_TONE_COLORS.muted;
const MINUTE = 60_000;
// Stable reference: the calendar rebuilds its settings when this object changes.
const CALENDAR_I18N = { viewNames: { resource: "Day" } };

/** "2026-09-24" → local Date at midnight, for the day picker. */
function isoToLocalDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function todayRange() {
  const from = resortMidnight(resortIsoDate(Date.now()));
  return { from, to: from + DAY_MS };
}

const TABS = [
  ["calendar", "Calendar"],
  ["roster", "Roster"],
  ["staff", "Staff"],
  ["services", "Services"],
] as const satisfies ReadonlyArray<readonly [AdminStaffTab, string]>;

export function AdminStaffBookingsView({ tab }: { tab: AdminStaffTab }) {
  const router = useRouter();
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function openTab(index: number) {
    const target = (index + TABS.length) % TABS.length;
    tabRefs.current[target]?.focus();
    router.push(adminStaffTabPath(TABS[target][0]));
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    openTab(moves[event.key]);
  }

  return (
    // The calendar fills the viewport under the 4rem admin header from tablet up; the other tabs scroll the page.
    <div
      className={cn(
        "mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6",
        tab === "calendar" && "md:h-[calc(100dvh-4rem)] md:min-h-[40rem]",
      )}
    >
      <div role="tablist" aria-label="Staff bookings sections" className="mb-4 flex shrink-0 gap-6 overflow-x-auto border-b border-border">
        {TABS.map(([key, label], index) => (
          <button
            key={key}
            ref={(el) => {
              tabRefs.current[index] = el;
            }}
            id={`staff-tab-${key}`}
            type="button"
            role="tab"
            aria-selected={tab === key}
            aria-controls="staff-tabpanel"
            tabIndex={tab === key ? 0 : -1}
            onClick={() => router.push(adminStaffTabPath(key))}
            onKeyDown={(event) => onTabKeyDown(event, index)}
            className={cn(
              "-mb-px shrink-0 border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              tab === key
                ? "border-foreground text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="staff-tabpanel" aria-labelledby={`staff-tab-${tab}`} className="flex min-h-0 flex-1 flex-col">
        {tab === "calendar" ? <StaffCalendar /> : tab === "roster" ? <StaffRosterView /> : <AdminStaffServicesManager section={tab} />}
      </div>
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
  const [editingTimeOff, setEditingTimeOff] = useState<Doc<"staffTimeOff"> | null>(null);
  const [error, setError] = useState("");
  const now = useNow();

  const data = useQuery(api.adminServices.listSchedule, range);
  const reschedule = useMutation(api.adminServices.rescheduleAppointment);

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
        color: appointmentStatusColor(displayStatus(appointment)),
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
    // Shade time outside each person's rostered shifts.
    const offEvents = view === "resource"
      ? visibleStaff.flatMap((person) => {
          const gaps: Block[] = [];
          let cursor = range.from;
          for (const shift of data.shifts.filter((s) => s.staffId === person._id).sort((a, b) => a.start - b.start)) {
            if (shift.start > cursor) gaps.push({ staffId: person._id, start: cursor, end: shift.start, label: "Not working", kind: "off" });
            cursor = Math.max(cursor, shift.end);
          }
          if (cursor < range.to) gaps.push({ staffId: person._id, start: cursor, end: range.to, label: "Not working", kind: "off" });
          return gaps.map((block): CalendarEvent<EventData> => ({
            id: `off-${block.staffId}-${block.start}`,
            title: `Not working · ${person.name}`,
            start: new Date(block.start),
            end: new Date(block.end),
            resourceId: block.staffId,
            color: BLOCK_COLOR,
            readOnly: true,
            data: { kind: "block", block },
          }));
        })
      : [];
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
    return [...offEvents, ...blockEvents, ...turnaroundEvents, ...appointmentEvents];
  }, [data, appointments, moves, serviceById, staffById, hiddenStaff, now, view, visibleStaff, range]);

  const renderEvent = useCallback(
    ({ occurrence, view: currentView }: { occurrence: { event: CalendarEvent<EventData> }; view: CalendarView }) => {
      const eventData = occurrence.event.data;
      if (!eventData) return null;
      if (eventData.kind === "block") {
        if (eventData.block.kind === "off") {
          return <span aria-label="Not working" className="absolute inset-0 rounded-[inherit] bg-muted" />;
        }
        return (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-[inherit] bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-foreground)_9%,transparent)_7px_8px)] text-xs font-medium text-muted-foreground">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{eventData.block.label}</span>
          </span>
        );
      }
      const { appointment } = eventData;
      const service = serviceById.get(appointment.serviceId);
      const staffName = currentView === "resource" ? null : staffById.get(appointment.staffId)?.name;
      return (
        <span className="flex h-full min-w-0 flex-1 flex-col gap-0.5 self-start">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold">{appointment.guestName}</span>
            <StatusBadge {...appointmentStatus(displayStatus(appointment))} className="hidden @[12rem]:inline-flex" />
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
              {person.status === "archived" ? "Archived · " : ""}
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
      <div className="flex min-h-0 flex-1 flex-col border border-border bg-card [&_*]:border-border">
        <EventCalendar<EventData>
          events={events}
          view={view}
          onViewChange={setView}
          date={date}
          onDateChange={setDate}
          views={["resource", "week", "agenda"]}
          resources={resources}
          timeZone={RESORT_ZONE}
          dayStartHour={6}
          dayEndHour={23}
          interval={60}
          snapDuration={15}
          scrollToHour={8}
          i18n={CALENDAR_I18N}
          interactions={{ drag: true, resize: true, selectSlot: false }}
          renderEvent={renderEvent}
          renderResourceHeader={renderResourceHeader}
          onEventClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "appointment") setSelectedId(eventData.appointment._id);
            if (eventData?.kind === "block" && eventData.block.timeOff) setEditingTimeOff(eventData.block.timeOff);
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
          loading={data === undefined}
          className="h-[36rem] w-full md:h-auto md:min-h-0 md:flex-1"
        >
          <AdminCalendarHeader>
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
                  items: STATUS_FILTERS.map((status) => ({ id: status, label: appointmentStatus(status).label })),
                  hidden: hiddenStatuses,
                  onChange: setHiddenStatuses,
                },
              ]}
            />
            {data === undefined ? <Spinner label="Loading appointments" /> : null}
            <div className="sm:ms-auto">
              <DisabledReason reason={data && activeServices.length === 0 && "Add a service first: appointments are for a service."}>
                <Button
                  size="sm"
                  disabled={!data || activeServices.length === 0}
                  onClick={() => setDraft({ date: resortIsoDate(Math.max(range.from, Date.now())) })}
                >
                  <PlusIcon aria-hidden className="size-4" />
                  New appointment
                </Button>
              </DisabledReason>
            </div>
          </AdminCalendarHeader>
          {data && (data.staff.length === 0 || activeServices.length === 0) ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-sm">
              <p className="min-w-0 flex-1 text-muted-foreground">
                {data.staff.length === 0
                  ? "No staff yet. Add the people who perform services, then the services guests can book."
                  : "No services yet. Add what guests can book and who performs it."}
              </p>
              <ButtonLink href={adminStaffTabPath(data.staff.length === 0 ? "staff" : "services")} size="sm">
                {data.staff.length === 0 ? "Add staff" : "Add a service"}
              </ButtonLink>
            </div>
          ) : null}
          {error ? (
            <p role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <EventCalendarContent />
        </EventCalendar>
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {APPOINTMENT_STATUSES.map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: appointmentStatusColor(key) }} />
              {appointmentStatus(key).label}
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
        services={activeServices}
        onClose={() => setSelectedId(null)}
      />
      {editingTimeOff ? (
        <TimeOffDialog
          key={editingTimeOff._id}
          timeOff={editingTimeOff}
          staffName={staffById.get(editingTimeOff.staffId)?.name}
          onClose={() => setEditingTimeOff(null)}
        />
      ) : null}
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
          <div key={group.title} role="group" aria-label={group.title} className="border-b border-border p-2 last:border-b-0">
            <div className="flex items-center justify-between px-2 pb-1">
              <span aria-hidden className="admin-eyebrow">
                {group.title}
              </span>
              <button
                type="button"
                className="rounded-sm text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
          </div>
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

type SheetAction = "arrived" | "in_service" | "completed" | "no_show" | "cancel" | "paid" | "refund";

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
  refund: "Record refund",
};

function AppointmentSheet({
  appointment,
  service,
  staff,
  services,
  onClose,
}: {
  appointment: Appointment | null;
  service?: Service;
  staff?: Staff;
  /** Active services, for changing the service. */
  services: Service[];
  onClose: () => void;
}) {
  const updateStatus = useMutation(api.adminServices.updateAppointmentStatus);
  const markPaid = useMutation(api.adminServices.markAppointmentPaid);
  const refund = useMutation(api.adminServices.refundAppointment);
  const cancel = useMutation(api.adminServices.cancelAppointment);
  const [pending, setPending] = useState<SheetAction | null>(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const now = useNow();
  const confirm = useConfirm();

  async function run(action: SheetAction) {
    if (!appointment) return;
    if (
      action === "cancel" &&
      !(await confirm({
        title: "Cancel this appointment?",
        description: "The appointment is cancelled and the staff member's time is freed.",
        confirmLabel: "Cancel appointment",
        cancelLabel: "Keep appointment",
        destructive: true,
      }))
    ) {
      return;
    }
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
      if (action === "cancel") await cancel({ appointmentId: appointment._id });
      else if (action === "paid") await markPaid({ appointmentId: appointment._id });
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

  return (
    <Sheet
      open={Boolean(appointment)}
      onOpenChange={(open) => {
        if (!open) {
          setError("");
          setEditing(false);
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {appointment && status ? (
          <div className="grid gap-5">
            <div>
              <SheetTitle className="pe-8">{appointment.guestName}</SheetTitle>
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
                    {formatResortDate(appointment.start)}, {formatResortTime(appointment.start)} –{" "}
                    {formatResortTime(appointment.end)}
                  </Detail>
                  <Detail label="Price">{formatMoney(appointment.price, appointment.currency)}</Detail>
                  <Detail label="Payment">
                    {PAYMENT_LABELS[appointment.paymentStatus]}
                    {appointment.refundedAt ? ` · ${formatResortDate(appointment.refundedAt)}` : ""}
                  </Detail>
                  <Detail label="Phone">{appointment.guestPhone}</Detail>
                  <Detail label="Email">{appointment.guestEmail ?? "—"}</Detail>
                  <Detail label="Notes">
                    <span className="whitespace-pre-wrap">{appointment.notes ?? "—"}</span>
                  </Detail>
                  <Detail label="Villa stay">{appointment.bookingId ? "Linked to a villa booking" : "—"}</Detail>
                  <Detail label="Source">
                    <Badge variant="outline">{sourceLabel(appointment.source)}</Badge>
                  </Detail>
                </dl>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                <div className="flex flex-wrap gap-2">
                  {actions.map((action) => (
                    <Button
                      key={action}
                      variant={
                        action === "cancel" || action === "no_show" || action === "refund"
                          ? "outline"
                          : action === "paid"
                            ? "secondary"
                            : "default"
                      }
                      onClick={() => run(action)}
                      disabled={pending !== null}
                    >
                      {pending === action ? <Spinner className="text-current" /> : null}
                      {ACTION_LABELS[action]}
                    </Button>
                  ))}
                  <Button variant="ghost" onClick={() => setEditing(true)} disabled={pending !== null}>
                    <Pencil aria-hidden className="size-4" />
                    Edit details
                  </Button>
                </div>
              </>
            )}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

/** Guest details and notes can always be edited; the service only while booked or arrived and unpaid. */
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
  const changeService = useMutation(api.adminServices.changeAppointmentService);
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
    setSaving(true);
    setError("");
    try {
      // The service change is the step that can clash, so it goes first.
      if (serviceId !== appointment.serviceId) await changeService({ appointmentId: appointment._id, serviceId });
      await updateDetails({
        appointmentId: appointment._id,
        guestName: text("guestName"),
        guestPhone: text("guestPhone"),
        guestEmail: text("guestEmail"),
        notes: text("notes"),
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
            ? "Same staff member and start time. The length and price follow the new service."
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
          Cancel
        </Button>
        <Button type="submit" disabled={saving}>
          {saving ? <Spinner className="text-current" /> : null}
          Save
        </Button>
      </div>
    </form>
  );
}

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

/** Service → date → time; the least-busy qualified staff member is pre-assigned and can be changed. */
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
  const [serviceId, setServiceId] = useState<Id<"services">>(() => {
    // The last used service, as long as the staff member picked on the calendar performs it.
    const fits = (s: Service) => !draft.staffId || s.staffIds.includes(draft.staffId);
    const last = readLastService();
    return (services.find((s) => s._id === last && fits(s)) ?? services.find(fits) ?? services[0])._id;
  });
  const service = services.find((s) => s._id === serviceId);
  const qualified = staff.filter((person) => service?.staffIds.includes(person._id));
  const [staffChoice, setStaffChoice] = useState<string>(draft.staffId ?? "auto");
  const staffId = qualified.some((person) => person._id === staffChoice) ? (staffChoice as Id<"staff">) : undefined;
  const [changingStaff, setChangingStaff] = useState(false);
  const [date, setDate] = useState(draft.date);
  const [start, setStart] = useState<number | null>(draft.start ?? null);
  const [dateOpen, setDateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const today = resortIsoDate(useNow());

  const slots = useQuery(api.adminServices.findOpenSlots, date >= today ? { serviceId, date, staffId } : "skip");
  // Fall back to the first open time, so the form is always one click from booking.
  const selectedSlot = slots?.find((slot) => slot.start === start) ?? slots?.[0];
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
    if (!selectedSlot) return;
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
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
      });
      rememberService(serviceId);
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
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
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
              <Label htmlFor="na-date">Date</Label>
              <Popover open={dateOpen} onOpenChange={setDateOpen}>
                <PopoverTrigger asChild>
                  <Button id="na-date" type="button" variant="outline" className="justify-start font-normal">
                    <CalendarDays aria-hidden className="size-4 text-muted-foreground" />
                    {formatResortDate(resortMidnight(date))}
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-auto p-3">
                  <Calendar
                    mode="single"
                    selected={isoToLocalDate(date)}
                    defaultMonth={isoToLocalDate(date)}
                    disabled={{ before: isoToLocalDate(today) }}
                    onSelect={(day) => {
                      if (!day) return;
                      setDate(format(day, "yyyy-MM-dd"));
                      setStart(null);
                      setDateOpen(false);
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          {service ? (
            <p className="-mt-2 text-xs text-muted-foreground">
              {service.durationMin} min · {formatMoney(service.price, service.currency)}
              {service.bufferMin ? ` · ${service.bufferMin} min turnaround` : ""}
            </p>
          ) : null}
          <div className="grid gap-2">
            <Label>Time</Label>
            {slots === undefined ? (
              <div role="status" aria-label="Finding open times" className="grid grid-cols-4 gap-1.5 rounded-lg border border-border p-3 sm:grid-cols-6">
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
                  onClick={() => setDate(resortIsoDate(resortMidnight(date) + DAY_MS))}
                >
                  Next day
                </Button>
              </p>
            ) : (
              <div className="grid max-h-64 gap-3 overflow-y-auto rounded-lg border border-border p-3">
                {parts.map((part) => (
                  <fieldset key={part.label}>
                    <legend className="admin-eyebrow mb-1.5">{part.label}</legend>
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
                            {formatResortTime(slot.start).replace(/\s?[AP]M$/, "")}
                          </Button>
                        );
                      })}
                    </div>
                  </fieldset>
                ))}
              </div>
            )}
            {start !== null && slots?.length && !slots.some((slot) => slot.start === start) ? (
              <p className="text-sm text-destructive">That time isn&apos;t open. Showing the next open time.</p>
            ) : null}
          </div>
          <div className="grid gap-2">
            <Label htmlFor="na-staff">Staff</Label>
            {changingStaff ? (
              <Select
                value={staffId ?? "auto"}
                onValueChange={(value) => {
                  setStaffChoice(value);
                  setChangingStaff(false);
                }}
              >
                <SelectTrigger id="na-staff" className="rounded-lg">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="auto">Auto (least busy that day)</SelectItem>
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
                      Assigned to <span className="font-semibold">{assigned.name}</span>
                      {staffId ? null : <span className="text-muted-foreground"> · least busy</span>}
                    </span>
                  </>
                ) : (
                  <span className="text-muted-foreground">Picked automatically once there&apos;s an open time.</span>
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
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !selectedSlot}>
              {saving ? <Spinner className="text-current" /> : null}
              Book appointment
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
