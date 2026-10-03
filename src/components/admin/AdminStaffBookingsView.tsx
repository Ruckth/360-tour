"use client";

import { useQuery } from "convex/react";
import { useRouter, useSelectedLayoutSegment } from "next/navigation";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { canEditTurnaround, canReschedule, turnaroundMinutes } from "convex/lib/appointmentWindow";
import { CalendarDays, Clock, Filter, History, PlusIcon, Users } from "lucide-react";
import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { AdminCalendarHeader } from "@/components/admin/AdminCalendarHeader";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarProposedUpdate,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { AdminStaffServicesManager, TimeOffDialog } from "@/components/admin/AdminStaffServicesManager";
import { AppointmentSheet } from "@/components/admin/AppointmentSheet";
import { BreakEditDialog } from "@/components/admin/BreakEditDialog";
import { adminStaffTabPath, isAdminStaffTab, type AdminStaffTab } from "@/components/admin/admin-routes";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { NewAppointmentDialog, type AppointmentDraft } from "@/components/admin/NewAppointmentDialog";
import { RescheduleDialog } from "@/components/admin/RescheduleDialog";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { StaffRosterView } from "@/components/admin/StaffRosterView";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TurnaroundDialog } from "@/components/admin/TurnaroundDialog";
import { CALENDAR_TONE_COLORS } from "@/components/admin/status-tones";
import { Badge } from "@/components/ui/badge";
import { Button, ButtonLink } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Spinner } from "@/components/ui/spinner";
import {
  breakFromDrag,
  moveProposal,
  turnaroundFromTail,
  type BreakBlock,
  type Ghost,
  type ScheduleData,
} from "@/lib/schedule-changes";
import {
  appointmentGuestLabel,
  APPOINTMENT_STATUSES,
  DAY_MS,
  RESORT_ZONE,
  appointmentStatus,
  appointmentStatusColor,
  displayStatus,
  formatResortTime,
  resortIsoDate,
  resortMidnight,
  useNow,
  type AppointmentStatus,
} from "@/lib/staff-bookings";
import { UNSAVED_CHANGES_MESSAGE, hasUnsavedChanges } from "@/lib/react/use-unsaved-changes";
import { cn } from "@/lib/utils";

type Appointment = Doc<"serviceAppointments">;
type EventData =
  | { kind: "appointment"; appointment: Appointment }
  /** The appointment's turnaround; it moves with the appointment and only its end resizes. */
  | { kind: "turnaround"; appointment: Appointment }
  | { kind: "block"; block: ScheduleData["blocks"][number] }
  | { kind: "off" };
/** The one change waiting for confirmation; `ghostId` is the calendar event drawn at the proposed place. */
type Proposal = { ghostId: string; ghost?: Ghost } & (
  | { kind: "reschedule"; appointment: Appointment; start: number; staffId: Id<"staff"> }
  | { kind: "turnaround"; appointment: Appointment; turnaroundMin?: number }
  | { kind: "break"; block: BreakBlock; times?: { start: string; end: string } }
);

// Cancelled appointments have their own toggle.
const STATUS_FILTERS: AppointmentStatus[] = ["booked", "arrived", "in_service", "completed", "no_show"];
const BLOCK_COLOR = CALENDAR_TONE_COLORS.muted;
/** listSchedule's limit. */
const MAX_SCHEDULE_DAYS = 14;
// Stable reference: the calendar rebuilds its settings when this object changes.
const CALENDAR_I18N = { viewNames: { resource: "Day" } };

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

/**
 * The Staff bookings tab strip and panel. It lives in the staff layout, so it stays mounted
 * (and keeps keyboard focus) while each tab is its own route.
 */
export function AdminStaffTabs({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segment = useSelectedLayoutSegment();
  const tab = segment && isAdminStaffTab(segment) ? segment : null;
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const confirm = useConfirm();

  async function openTab(index: number) {
    const target = (index + TABS.length) % TABS.length;
    const key = TABS[target][0];
    if (key === tab) return;
    if (
      hasUnsavedChanges() &&
      !(await confirm({ title: UNSAVED_CHANGES_MESSAGE, confirmLabel: "Discard", cancelLabel: "Keep editing", destructive: true }))
    ) {
      return;
    }
    tabRefs.current[target]?.focus();
    router.push(adminStaffTabPath(key));
  }

  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    void openTab(moves[event.key]);
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
            onClick={() => void openTab(index)}
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
      <div
        role="tabpanel"
        id="staff-tabpanel"
        aria-labelledby={tab ? `staff-tab-${tab}` : undefined}
        className="flex min-h-0 flex-1 flex-col"
      >
        {children}
      </div>
    </div>
  );
}

/** One Staff bookings tab's content; the page for each [tab] route. */
export function AdminStaffBookingsView({ tab }: { tab: AdminStaffTab }) {
  return tab === "calendar" ? <StaffCalendar /> : tab === "roster" ? <StaffRosterView /> : <AdminStaffServicesManager section={tab} />;
}

function StaffCalendar() {
  const [range, setRange] = useState(todayRange);
  const [view, setView] = useState<CalendarView>("resource");
  const [date, setDate] = useState(() => new Date());
  const [hiddenStaff, setHiddenStaff] = useState<Set<string>>(() => new Set());
  const [hiddenServices, setHiddenServices] = useState<Set<string>>(() => new Set());
  const [hiddenStatuses, setHiddenStatuses] = useState<Set<string>>(() => new Set());
  // Cancelled appointments are kept but stay out of the working grid unless asked for.
  const [showCancelled, setShowCancelled] = useState(false);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selectedId, setSelectedId] = useState<Id<"serviceAppointments"> | null>(null);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [editingTimeOff, setEditingTimeOff] = useState<Doc<"staffTimeOff"> | null>(null);
  const [error, setError] = useState("");
  const now = useNow();

  const data = useQuery(api.adminServices.listSchedule, range);

  const staffById = useMemo(() => new Map((data?.staff ?? []).map((s) => [s._id as string, s])), [data?.staff]);
  const serviceById = useMemo(() => new Map((data?.services ?? []).map((s) => [s._id as string, s])), [data?.services]);
  const activeServices = useMemo(() => (data?.services ?? []).filter((s) => s.status === "active"), [data?.services]);

  const visibleStaff = useMemo(
    () => (data?.staff ?? []).filter((s) => !hiddenStaff.has(s._id)),
    [data?.staff, hiddenStaff],
  );

  const cancelledCount = (data?.appointments ?? []).filter((a) => a.status === "cancelled").length;
  const appointments = useMemo(
    () =>
      (data?.appointments ?? []).filter(
        (a) =>
          !hiddenStaff.has(a.staffId) &&
          !hiddenServices.has(a.serviceId) &&
          !hiddenStatuses.has(a.status) &&
          (showCancelled || a.status !== "cancelled"),
      ),
    [data?.appointments, hiddenStaff, hiddenServices, hiddenStatuses, showCancelled],
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
    const ghostFor = (id: string) => proposal?.ghostId === id ? proposal.ghost : undefined;
    if (!data) return [];
    const appointmentEvents = appointments.map((appointment): CalendarEvent<EventData> => {
      const ghost = ghostFor(appointment._id);
      const service = serviceById.get(appointment.serviceId);
      const staff = staffById.get(ghost?.staffId ?? appointment.staffId);
      return {
        id: appointment._id,
        title: `${appointmentGuestLabel(appointment)} · ${service?.name ?? "Service"}${staff ? ` · ${staff.name}` : ""}`,
        start: new Date(ghost?.start ?? appointment.start),
        end: new Date(ghost?.end ?? appointment.end),
        resourceId: ghost?.staffId ?? appointment.staffId,
        color: appointmentStatusColor(displayStatus(appointment)),
        readOnly: !canReschedule(appointment, now),
        // The booked length is kept; a different length is a different service.
        resizable: false,
        priority: 1,
        data: { kind: "appointment", appointment },
      };
    });
    // Every staff member's daily breaks side by side are noise in the week view.
    const blockEvents = data.blocks
      .filter((block) => !hiddenStaff.has(block.staffId) && (view === "resource" || block.kind === "time_off"))
      .map((block): CalendarEvent<EventData> => {
        const id = `block-${block.staffId}-${block.start}`;
        const ghost = ghostFor(id);
        const editable = block.kind === "break" && staffById.get(block.staffId)?.status === "active";
        return {
          id,
          title: `${block.label} · ${staffById.get(block.staffId)?.name ?? "Staff"}`,
          start: new Date(ghost?.start ?? block.start),
          end: new Date(ghost?.end ?? block.end),
          resourceId: block.staffId,
          color: BLOCK_COLOR,
          readOnly: !editable,
          data: { kind: "block", block },
        };
      });
    // Shade time outside each person's rostered shifts.
    const offEvents = view === "resource"
      ? visibleStaff.flatMap((person) => {
          const gaps: Array<{ start: number; end: number }> = [];
          let cursor = range.from;
          for (const shift of data.shifts.filter((s) => s.staffId === person._id).sort((a, b) => a.start - b.start)) {
            if (shift.start > cursor) gaps.push({ start: cursor, end: shift.start });
            cursor = Math.max(cursor, shift.end);
          }
          if (cursor < range.to) gaps.push({ start: cursor, end: range.to });
          return gaps.map((gap): CalendarEvent<EventData> => ({
            id: `off-${person._id}-${gap.start}`,
            title: `Not working · ${person.name}`,
            start: new Date(gap.start),
            end: new Date(gap.end),
            resourceId: person._id,
            color: BLOCK_COLOR,
            readOnly: true,
            data: { kind: "off" },
          }));
        })
      : [];
    // Cleanup/travel after a service blocks the staff member too. It follows its appointment
    // and only its end can be resized.
    const turnaroundEvents = view === "resource"
      ? appointments
          .filter((a) => a.blockedUntil > a.end && a.status !== "cancelled" && a.status !== "no_show")
          .map((appointment): CalendarEvent<EventData> => {
            const id = `turnaround-${appointment._id}`;
            const moved = ghostFor(appointment._id);
            const resized = ghostFor(id);
            const start = moved?.end ?? appointment.end;
            return {
              id,
              title: "Turnaround",
              start: new Date(start),
              end: new Date(resized?.end ?? start + appointment.blockedUntil - appointment.end),
              resourceId: moved?.staffId ?? appointment.staffId,
              color: BLOCK_COLOR,
              readOnly: !canEditTurnaround(appointment),
              draggable: false,
              snapDuration: 5,
              minDuration: 0,
              data: { kind: "turnaround", appointment },
            };
          })
      : [];
    return [...offEvents, ...blockEvents, ...turnaroundEvents, ...appointmentEvents];
  }, [data, appointments, proposal, serviceById, staffById, hiddenStaff, now, view, visibleStaff, range]);

  const renderEvent = useCallback(
    ({ occurrence, view: currentView }: { occurrence: { event: CalendarEvent<EventData> }; view: CalendarView }) => {
      const eventData = occurrence.event.data;
      if (!eventData) return null;
      if (eventData.kind === "off") {
        return <span aria-label="Not working" className="absolute inset-0 rounded-[inherit] bg-muted" />;
      }
      if (eventData.kind !== "appointment") {
        return (
          <span className="absolute inset-0 flex items-center justify-center gap-1.5 rounded-[inherit] bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-foreground)_9%,transparent)_7px_8px)] text-xs font-medium text-muted-foreground">
            <Clock aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{eventData.kind === "turnaround" ? "Turnaround" : eventData.block.label}</span>
          </span>
        );
      }
      const { appointment } = eventData;
      const service = serviceById.get(appointment.serviceId);
      const staffName = currentView === "resource" ? null : staffById.get(occurrence.event.resourceId ?? appointment.staffId)?.name;
      // Short timed chips only have room for one row. Keep their identity visible.
      if (!appointment.guestName && currentView !== "agenda" && occurrence.event.end.getTime() - occurrence.event.start.getTime() < 45 * 60_000) {
        return (
          <span className="flex min-w-0 flex-1 items-center gap-1 text-xs leading-4 text-muted-foreground">
            <span className="truncate">Unnamed</span>
            <span className="shrink-0 font-mono text-[10px]" title={appointment.confirmationCode}>
              {appointment.confirmationCode.slice(-6)}
            </span>
          </span>
        );
      }
      return (
        <span className="flex h-full min-w-0 flex-1 flex-col gap-0.5 self-start">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className={cn("truncate text-sm font-semibold", !appointment.guestName && "text-muted-foreground")}>
              {appointment.guestName || "Unnamed guest"}
            </span>
            <StatusBadge {...appointmentStatus(displayStatus(appointment))} className="hidden @[12rem]:inline-flex" />
          </span>
          {!appointment.guestName ? <span className="font-mono text-[10px] text-muted-foreground" title={appointment.confirmationCode}>Ref {appointment.confirmationCode.slice(-6)}</span> : null}
          <span className="truncate text-xs text-muted-foreground">
            {formatResortTime(occurrence.event.start.getTime())} • {service?.name ?? "Service"}
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

  /** Drops the calendar can't turn into a proposal are refused before they land. */
  const canDropEvent = useCallback(
    (update: EventCalendarProposedUpdate<EventData>) => {
      const eventData = update.event.data;
      if (!eventData) return false;
      if (eventData.kind === "appointment") {
        const staffId = update.resourceId ?? eventData.appointment.staffId;
        return serviceById.get(eventData.appointment.serviceId)?.staffIds.includes(staffId as Id<"staff">) ?? false;
      }
      if (eventData.kind === "turnaround") {
        return update.source === "resize-end" && (update.resourceId ?? eventData.appointment.staffId) === eventData.appointment.staffId;
      }
      // A break stays in its own staff column and on its own date.
      if (eventData.kind === "block" && eventData.block.kind === "break") {
        const { block } = eventData;
        return (update.resourceId ?? block.staffId) === block.staffId && breakFromDrag(block, update.start.getTime(), update.end.getTime()) !== null;
      }
      return false;
    },
    [serviceById],
  );

  function propose(next: Proposal, ghostId: string, ghost: Ghost) {
    setProposal({ ...next, ghostId, ghost });
    setError("");
  }

  function dismissProposal() {
    setProposal(null);
  }

  const selected = data?.appointments.find((a) => a._id === selectedId) ?? null;
  const filterCount = hiddenServices.size + hiddenStatuses.size;
  const proposedAppointment = proposal && proposal.kind !== "break"
    ? proposal.appointment
    : undefined;

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
          // listSchedule serves at most 14 days; the list defaults to 30.
          agendaDayCount={7}
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
          canDropEvent={canDropEvent}
          onEventClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "appointment") setSelectedId(eventData.appointment._id);
            if (eventData?.kind === "turnaround" && canEditTurnaround(eventData.appointment)) {
              setProposal({ kind: "turnaround", appointment: eventData.appointment, ghostId: occurrence.event.id });
            }
            if (eventData?.kind === "block" && eventData.block.kind === "time_off") setEditingTimeOff(eventData.block.timeOff);
            if (eventData?.kind === "block" && eventData.block.kind === "break" && !occurrence.event.readOnly) {
              setProposal({ kind: "break", block: eventData.block, ghostId: occurrence.event.id });
            }
          }}
          onSlotClick={(slot) => {
            if (slot.allDay || !data || activeServices.length === 0) return;
            const start = slot.date.getTime();
            setDraft({
              // A click on a past day books from today: open times are only searched from today on.
              date: resortIsoDate(Math.max(start, Date.now())),
              staffId: slot.resourceId as Id<"staff"> | undefined,
              start: start > Date.now() ? start : undefined,
            });
          }}
          onEventUpdate={(update) => {
            const eventData = update.event.data;
            // One pending change at a time; nothing is saved until it's confirmed.
            if (update.source === "api" || !eventData || proposal) return false;
            const start = update.start.getTime();
            const end = update.end.getTime();
            const id = update.event.id;
            if (eventData.kind === "appointment") {
              const { appointment } = eventData;
              const next = moveProposal(appointment, { start, staffId: update.resourceId as Id<"staff"> | undefined });
              if (!next) return false;
              propose({ kind: "reschedule", appointment, ghostId: id, ...next }, id, { start, end, staffId: next.staffId });
              return true;
            }
            if (eventData.kind === "turnaround" && update.source === "resize-end") {
              const { appointment } = eventData;
              const turnaroundMin = turnaroundFromTail(appointment, end);
              if (turnaroundMin === turnaroundMinutes(appointment)) return false;
              propose({ kind: "turnaround", appointment, ghostId: id, turnaroundMin }, id, { start: appointment.end, end, staffId: appointment.staffId });
              return true;
            }
            if (eventData.kind === "block" && eventData.block.kind === "break") {
              const { block } = eventData;
              const times = breakFromDrag(block, start, end);
              if (!times) return false;
              propose({ kind: "break", block, ghostId: id, times }, id, { start, end, staffId: block.staffId });
              return true;
            }
            return false;
          }}
          onRangeChange={({ range: visible }) => {
            const from = visible.start.getTime();
            // Never ask for more than listSchedule serves, whatever the view.
            const to = Math.min(visible.end.getTime(), from + MAX_SCHEDULE_DAYS * DAY_MS);
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
            <Button size="sm" variant={showCancelled ? "secondary" : "outline"} aria-pressed={showCancelled} onClick={() => setShowCancelled(!showCancelled)}>
              <History aria-hidden className="size-4" />
              {showCancelled ? "Hide cancelled" : "Show cancelled"}
              {cancelledCount ? (
                <Badge variant="secondary" className="ms-0.5 h-5 min-w-5 justify-center rounded-full px-1.5">
                  {cancelledCount}
                </Badge>
              ) : null}
            </Button>
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
            Break / turnaround / time off
          </span>
          <span className="ms-auto hidden sm:inline">
            Drag a booking or break to propose a change; you confirm before it saves. Times are Bangkok time.
          </span>
        </div>
      </div>

      <AppointmentSheet
        key={selected?._id ?? "closed"}
        appointment={selected}
        services={activeServices}
        staffById={staffById}
        serviceById={serviceById}
        onBookAgain={(appointment) => {
          if (activeServices.length === 0) return;
          setSelectedId(null);
          setDraft({ date: resortIsoDate(Math.max(appointment.start, Date.now())), staffId: appointment.staffId, rebook: appointment });
        }}
        onClose={() => setSelectedId(null)}
      />
      {proposal?.kind === "reschedule" && proposedAppointment ? (
        <RescheduleDialog
          appointment={proposedAppointment}
          serviceName={serviceById.get(proposedAppointment.serviceId)?.name ?? "Service"}
          staffById={staffById}
          initial={{ start: proposal.start, staffId: proposal.staffId }}
          onClose={dismissProposal}
          onFailed={setError}
        />
      ) : null}
      {proposal?.kind === "turnaround" && proposedAppointment ? (
        <TurnaroundDialog
          appointment={proposedAppointment}
          serviceDefaultMin={serviceById.get(proposedAppointment.serviceId)?.bufferMin}
          initialMin={proposal.turnaroundMin}
          onClose={dismissProposal}
        />
      ) : null}
      {proposal?.kind === "break" ? (
        <BreakEditDialog
          block={proposal.block}
          staffName={staffById.get(proposal.block.staffId)?.name ?? "Staff"}
          initial={proposal.times}
          onClose={dismissProposal}
        />
      ) : null}
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
          key={`${draft.date}-${draft.staffId ?? ""}-${draft.start ?? ""}-${draft.rebook?._id ?? ""}`}
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
