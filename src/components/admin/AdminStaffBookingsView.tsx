"use client";

import { useQuery } from "convex/react";
import { useRouter, useSearchParams, useSelectedLayoutSegment } from "@/platform/navigation";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { canEditTurnaround, canCorrectAppointmentTime, turnaroundMinutes } from "convex/shared/appointmentWindow";
import { Ban, CalendarDays, Check, CircleDollarSign, Clock, Coffee, Filter, Play, PlusIcon, Timer, UserCheck, UserX, Users } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { EventCalendar, useEventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import { AdminCalendarHeader, AdminCalendarSearch } from "@/components/admin/AdminCalendarHeader";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarProposedUpdate,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { AdminStaffServicesManager, TimeOffDialog } from "@/components/admin/AdminStaffServicesManager";
import { AppointmentSheet } from "@/components/admin/AppointmentSheet";
import { BreakEditDialog } from "@/components/admin/BreakEditDialog";
import { ADMIN_STAFF_TABS, ADMIN_STAFF_TAB_LABELS, adminStaffTabPath, isAdminStaffTab, type AdminStaffTab } from "@/components/admin/admin-routes";
import { useConfirm } from "@/components/admin/ConfirmDialog";
import { DisabledReason } from "@/components/admin/DisabledReason";
import { NewAppointmentDialog, type AppointmentDraft } from "@/components/admin/NewAppointmentDialog";
import { RescheduleDialog } from "@/components/admin/RescheduleDialog";
import { StaffAvatar } from "@/components/admin/StaffAvatar";
import { StaffRosterView } from "@/components/admin/StaffRosterView";
import { StatusBadge } from "@/components/admin/StatusBadge";
import { TurnaroundDialog } from "@/components/admin/TurnaroundDialog";
import { CALENDAR_TONE_COLORS } from "@/components/admin/status-tones";
import { useIsMobile } from "@/hooks/use-mobile";
import { Card } from "@/components/ui/card";
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
  resortIsoDate,
  resortMidnight,
  useNow,
  type AppointmentStatus,
} from "@/lib/staff-bookings";
import { STAFF_CALENDAR_FORMATS, staffDate, staffTime } from "@/lib/staff-time";
import { UNSAVED_CHANGES_MESSAGE, hasUnsavedChanges } from "@/lib/react/use-unsaved-changes";
import { appointmentServiceLabel } from "@/lib/service-options";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { useStoredState } from "@/lib/use-stored-state";
import { cn } from "@/lib/utils";
import { parseStaffCalendarLink, staffRosterHref } from "@/lib/staff-links";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type Appointment = Doc<"appointments">;
type EventData =
  | { kind: "appointment"; appointment: Appointment }
  /** The appointment's turnaround; it moves with the appointment and only its end resizes. */
  | { kind: "turnaround"; appointment: Appointment }
  | { kind: "block"; block: ScheduleData["blocks"][number] }
  | { kind: "off"; staffId: Id<"staff">; start: number; end: number };
/** The one change waiting for confirmation; `ghostId` is the calendar event drawn at the proposed place. */
type Proposal = { ghostId: string; ghost?: Ghost } & (
  | { kind: "reschedule"; appointment: Appointment; start: number; staffId: Id<"staff"> }
  | { kind: "turnaround"; appointment: Appointment; turnaroundMin?: number }
  | { kind: "break"; block: BreakBlock; times?: { start: string; end: string } }
);

// Cancelled appointments have their own toggle.
const STATUS_FILTERS: AppointmentStatus[] = ["booked", "arrived", "in_service", "completed", "no_show"];
const STATUS_ICONS = { booked: Clock, arrived: UserCheck, in_service: Play, completed: Check, unpaid: CircleDollarSign, no_show: UserX, cancelled: Ban };
const BLOCK_COLOR = CALENDAR_TONE_COLORS.muted;
/** listSchedule's limit. */
const MAX_SCHEDULE_DAYS = 14;
// Stable reference: the calendar rebuilds its settings when this object changes.
const CALENDAR_I18N = { viewNames: { resource: "Day", agenda: "List" }, formats: STAFF_CALENDAR_FORMATS };

function todayRange() {
  const from = resortMidnight(resortIsoDate(Date.now()));
  return { from, to: from + DAY_MS };
}

const STAFF_VIEWS = ["resource", "week", "agenda"] as const satisfies CalendarView[];

/** A set of ids remembered on this device (JSON in localStorage). */
function useStoredSet(key: string): [Set<string>, (next: Set<string>) => void] {
  const [stored, setStored] = useStoredState(key, "[]");
  const value = useMemo(() => {
    try {
      const parsed: unknown = JSON.parse(stored);
      return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
    } catch {
      return new Set<string>();
    }
  }, [stored]);
  const update = useCallback((next: Set<string>) => setStored(JSON.stringify([...next])), [setStored]);
  return [value, update];
}

/** The staff filter trigger, e.g. "4 of 5 staff · 3 hidden appts": hiding people never hides their bookings silently. */
export function staffFilterLabel(visible: number, total: number, hiddenAppointments: number) {
  return `${visible} of ${total} staff${hiddenAppointments ? ` · ${hiddenAppointments} hidden ${hiddenAppointments === 1 ? "appt" : "appts"}` : ""}`;
}

const TABS = ADMIN_STAFF_TABS.map((tab) => [tab, ADMIN_STAFF_TAB_LABELS[tab]] as const);

/**
 * The Staff bookings tab strip and panel. It lives in the staff layout, so it stays mounted
 * (and keeps keyboard focus) while each tab is its own route.
 */
export function AdminStaffTabs({ children }: { children: ReactNode }) {
  const router = useRouter();
  const segment = useSelectedLayoutSegment("/admin/staff");
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

  // Manual activation: arrows, Home and End only move focus; Enter or Space (the button's click) opens the
  // focused route through openTab, which keeps the unsaved-draft confirmation.
  function onTabKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const moves: Record<string, number> = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: TABS.length - 1 };
    if (!(event.key in moves)) return;
    event.preventDefault();
    tabRefs.current[(moves[event.key] + TABS.length) % TABS.length]?.focus();
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
              "-mb-px min-h-11 shrink-0 border-b-2 px-1 pb-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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
  const branchId = useAdminBranch().current?.id;
  // A deep link (?date=&staff=&appointment=) opens that day, shows that person and the appointment once on arrival.
  const searchParams = useSearchParams();
  const [link] = useState(() => parseStaffCalendarLink(searchParams));
  const [range, setRange] = useState(() => link.date ? { from: resortMidnight(link.date), to: resortMidnight(link.date) + DAY_MS } : todayRange());
  const [search, setSearch] = useState("");
  // This device remembers the view and filters (rule 5); the date always starts today.
  const [storedView, setView] = useStoredState("admin.staff.view", "auto");
  const phone = useIsMobile(640);
  const view: CalendarView = (STAFF_VIEWS as readonly string[]).includes(storedView) ? (storedView as CalendarView) : phone ? "agenda" : "resource";
  const [date, setDate] = useState(() => (link.date ? new Date(resortMidnight(link.date)) : new Date()));
  const [hiddenStaff, setHiddenStaff] = useStoredSet(branchId ? `admin.staff.hiddenStaff:${branchId}` : "admin.staff.hiddenStaff");
  const [hiddenServices, setHiddenServices] = useStoredSet(branchId ? `admin.staff.hiddenServices:${branchId}` : "admin.staff.hiddenServices");
  const [hiddenStatuses, setHiddenStatuses] = useStoredSet("admin.staff.hiddenStatuses");
  // Cancelled appointments are kept but stay out of the working grid unless asked for.
  const [storedCancelled, setStoredCancelled] = useStoredState("admin.staff.showCancelled", "no");
  const showCancelled = storedCancelled === "yes";
  const setShowCancelled = (next: boolean) => setStoredCancelled(next ? "yes" : "no");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [selectedId, setSelectedId] = useState<Id<"appointments"> | null>((link.appointmentId as Id<"appointments"> | undefined) ?? null);
  const [allDatesQuery, setAllDatesQuery] = useState<string | null>(null);
  const [offShift, setOffShift] = useState<{ staffId: Id<"staff">; start: number; end: number } | null>(null);
  const linkedStaffShown = useRef(false);
  useEffect(() => {
    if (linkedStaffShown.current || !link.staffId) return;
    linkedStaffShown.current = true;
    if (hiddenStaff.has(link.staffId)) {
      const next = new Set(hiddenStaff);
      next.delete(link.staffId);
      setHiddenStaff(next);
    }
  }, [link.staffId, hiddenStaff, setHiddenStaff]);
  const [draft, setDraft] = useState<AppointmentDraft | null>(null);
  const [editingTimeOff, setEditingTimeOff] = useState<Doc<"staffTimeOff"> | null>(null);
  const [error, setError] = useState("");
  const now = useNow();

  const data = useQuery(api.services.admin.listSchedule, range);

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
        (a) =>
          !hiddenStaff.has(a.staffId) &&
          (!search.trim() || `${appointmentGuestLabel(a)} ${serviceById.get(a.serviceId)?.name ?? ""} ${staffById.get(a.staffId)?.name ?? ""}`.toLowerCase().includes(search.trim().toLowerCase())) &&
          !hiddenServices.has(a.serviceId) &&
          !hiddenStatuses.has(a.status) &&
          (showCancelled || a.status !== "cancelled"),
      ),
    [data?.appointments, hiddenStaff, hiddenServices, hiddenStatuses, showCancelled, search, serviceById, staffById],
  );

  const appointmentsInRange = appointments.filter(a => a.start < range.to && a.end > range.from);
  const noSearchMatches = data !== undefined && search.trim() !== "" && appointmentsInRange.length === 0;
  const visibleStarts = appointmentsInRange.filter(a => a.status !== "cancelled").map(a => Number(staffTime(a.start).split(":")[0]));
  const firstAppointmentHour = visibleStarts.length ? Math.min(...visibleStarts) : 8;
  // Scroll to the earliest appointment once per range, when data first arrives — never again while staff
  // search, filter or another device books an earlier slot.
  const scrollKey = `${range.from}:${range.to}`;
  const [initialScroll, setInitialScroll] = useState<{ key: string; hour: number } | null>(null);
  if (data && initialScroll?.key !== scrollKey) setInitialScroll({ key: scrollKey, hour: firstAppointmentHour });
  const scrollToHour = initialScroll?.key === scrollKey ? initialScroll.hour : firstAppointmentHour;
  const bookedCount = appointmentsInRange.filter((a) => a.status !== "cancelled" && a.status !== "no_show").length;
  const countByStaff = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of appointments) {
      if (a.status !== "cancelled") counts.set(a.staffId, (counts.get(a.staffId) ?? 0) + 1);
    }
    return counts;
  }, [appointments]);
  // Appointment coverage per person in the loaded range, independent of the staff filter, so hiding someone never hides their bookings silently.
  const allCountByStaff = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of data?.appointments ?? []) {
      if (a.status !== "cancelled" && a.start < range.to && a.end > range.from) counts.set(a.staffId, (counts.get(a.staffId) ?? 0) + 1);
    }
    return counts;
  }, [data?.appointments, range]);
  const hiddenAppointmentCount = [...hiddenStaff].reduce((sum, id) => sum + (allCountByStaff.get(id) ?? 0), 0);

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
        title: `${appointmentGuestLabel(appointment)} · ${appointmentServiceLabel(service, appointment)}${staff ? ` · ${staff.name}` : ""}`,
        start: new Date(ghost?.start ?? appointment.start),
        end: new Date(ghost?.end ?? appointment.end),
        resourceId: ghost?.staffId ?? appointment.staffId,
        color: appointment.status === "booked" ? "var(--color-slate-700)" : appointmentStatusColor(displayStatus(appointment)),
        readOnly: !canCorrectAppointmentTime(appointment, now),
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
            data: { kind: "off", staffId: person._id, start: gap.start, end: gap.end },
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
        return <span data-calendar-off className="absolute inset-0 flex items-center justify-center rounded-[inherit] bg-muted bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-foreground)_9%,transparent)_7px_8px)] text-xs text-muted-foreground">Not working</span>;
      }
      if (eventData.kind !== "appointment") {
        if (currentView === "agenda") return <span className="text-sm">{occurrence.event.title}</span>;
        return (
          <span className={cn("absolute inset-0 flex items-center justify-center gap-1.5 rounded-[inherit] text-xs font-medium text-muted-foreground", eventData.kind === "turnaround" ? "border border-dashed border-border bg-muted/60" : "bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-foreground)_9%,transparent)_7px_8px)]")}>
            {eventData.kind === "turnaround" ? <Timer aria-hidden className="size-3.5 shrink-0" /> : <Coffee aria-hidden className="size-3.5 shrink-0" />}
            <span className="truncate">{eventData.kind === "turnaround" ? "Turnaround" : eventData.block.label}</span>
          </span>
        );
      }
      const { appointment } = eventData;
      const service = serviceById.get(appointment.serviceId);
      const staffName = currentView === "resource" ? null : staffById.get(occurrence.event.resourceId ?? appointment.staffId)?.name;
      const status = displayStatus(appointment);
      const StatusIcon = STATUS_ICONS[status];
      // Short timed chips only have room for one row. Keep their identity visible.
      if (!appointment.guestName && currentView !== "agenda" && occurrence.event.end.getTime() - occurrence.event.start.getTime() < 45 * 60_000) {
        return (
          <span data-appointment-chip className="flex min-w-0 flex-1 items-center gap-1 text-xs leading-4 text-muted-foreground">
            <StatusIcon aria-label={appointmentStatus(status).label} className="size-3 shrink-0" />
            <span className="truncate">Unnamed</span>
            <span className="shrink-0 font-mono text-xs" title={appointment.confirmationCode}>
              {appointment.confirmationCode.slice(-6)}
            </span>
          </span>
        );
      }
      if (currentView === "agenda") return (
        <span className="flex w-full min-w-0 items-center justify-between gap-3">
          <span className="grid min-w-0 gap-1 text-left">
            <span className={cn("text-[15px] font-medium", appointment.status === "cancelled" && "line-through")}>{appointment.guestName || "Unnamed guest"}</span>
            {!appointment.guestName ? <span className="font-mono text-xs text-muted-foreground">Ref {appointment.confirmationCode.slice(-6)}</span> : null}
            <span className="text-xs text-muted-foreground">{staffTime(occurrence.event.start.getTime())}–{staffTime(occurrence.event.end.getTime())} · {appointmentServiceLabel(service, appointment)}{staffName ? ` · ${staffName}` : ""}</span>
          </span>
          <span className="grid shrink-0 justify-items-end gap-1"><StatusBadge {...appointmentStatus(status)} /></span>
        </span>
      );
      return (
        <span data-appointment-chip className="flex h-full min-w-0 flex-1 flex-col gap-0.5 self-start">
          <span className="flex min-w-0 items-center gap-1.5">
            <StatusIcon aria-label={appointmentStatus(status).label} className="size-3 shrink-0 @[12rem]:hidden" />
            <span className={cn("truncate text-sm font-semibold", !appointment.guestName && "text-muted-foreground", appointment.status === "cancelled" && "line-through")}>
              {appointment.guestName || "Unnamed guest"}
            </span>
            <StatusBadge {...appointmentStatus(status)} className={cn("hidden @[12rem]:inline-flex", appointment.status === "cancelled" && "border border-current bg-transparent")} />
          </span>
          {!appointment.guestName ? <span className="font-mono text-xs text-muted-foreground" title={appointment.confirmationCode}>Ref {appointment.confirmationCode.slice(-6)}</span> : null}
          <span className="truncate text-xs text-muted-foreground">
            {staffTime(occurrence.event.start.getTime())} · {appointmentServiceLabel(service, appointment)}
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
        <span className="relative flex min-h-11 w-full min-w-0 items-center gap-2.5 py-1 pr-28 text-start">
          <StaffAvatar staff={person} className="size-9" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-foreground">{person.name}</span>
            <span className="block truncate text-xs font-normal text-muted-foreground">
              {person.status === "archived" ? "Archived · " : ""}
              {count === 1 ? "1 appointment" : `${count} appointments`}
            </span>
          </span>
          <OffscreenAppointmentCue resourceId={resource.id} appointments={appointments.filter(a => a.staffId === resource.id && a.status !== "cancelled")} />
        </span>
      );
    },
    [staffById, countByStaff, appointments],
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
      <Card className="flex min-h-0 flex-1 flex-col gap-0 overflow-hidden py-0 [&_*]:border-border">
        <EventCalendar<EventData>
          events={events}
          view={view}
          onViewChange={setView}
          date={date}
          onDateChange={setDate}
          views={[...STAFF_VIEWS]}
          // listSchedule serves at most 14 days; the list defaults to 30.
          agendaDayCount={7}
          resources={resources}
          timeZone={RESORT_ZONE}
          dayStartHour={6}
          dayEndHour={23}
          interval={60}
          snapDuration={15}
          scrollToHour={Math.max(6, Math.min(22, scrollToHour))}
          i18n={CALENDAR_I18N}
          interactions={{ drag: true, resize: true, selectSlot: false }}
          classNames={{ noEvents: noSearchMatches ? "hidden" : undefined, event: "[&:has([data-appointment-chip])]:border-l-[3px] [&:has([data-appointment-chip])]:border-l-(--ec-event-color) [&:has([data-appointment-chip])]:bg-card [&:has([data-appointment-chip])]:hover:bg-muted", dayColumn: "[&>div:has([data-calendar-off])]:w-full! [&>div:has([data-calendar-off])]:left-0!" }}
          renderEvent={renderEvent}
          renderAgendaEvent={renderEvent}
          renderResourceHeader={renderResourceHeader}
          renderNoEvents={() => <div className="grid justify-items-center gap-3"><p className="text-sm text-muted-foreground">No appointments.</p>{data && !search.trim() ? <NextAppointmentJump from={range.to} onOpen={(start) => setDate(new Date(start))} /> : null}<Button disabled={!data || activeServices.length === 0} onClick={() => setDraft({ date: resortIsoDate(range.from) })}>New appointment</Button></div>}
          canDropEvent={canDropEvent}
          onEventClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "appointment") setSelectedId(eventData.appointment._id);
            if (eventData?.kind === "off") setOffShift({ staffId: eventData.staffId, start: eventData.start, end: eventData.end });
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
              // Preserve the selected historical slot for staff record entry.
              date: resortIsoDate(start),
              staffId: slot.resourceId as Id<"staff"> | undefined,
              start,
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
          // Only the phone list grows with the page; from tablet up the calendar fills a fixed-height card and scrolls inside it.
          scrollMode={view === "agenda" && phone ? "page" : "contained"}
          className={view === "agenda" && phone ? "w-full" : "h-[calc(100dvh-10rem)] min-h-96 w-full md:h-auto md:min-h-0 md:flex-1"}
        >
          <AdminCalendarHeader search={<AdminCalendarSearch inline label="Search appointments" placeholder="Guest, service or staff" value={search} onChange={setSearch} />} primaryAction={<DisabledReason reason={data && activeServices.length === 0 && "Add a service first: appointments are for a service."}>
                <Button
                  size="sm"
                  aria-label="New appointment"
                  disabled={!data || activeServices.length === 0}
                  onClick={() => setDraft({ date: resortIsoDate(Math.max(range.from, Date.now())) })}
                >
                  <PlusIcon aria-hidden className="size-4" />
                  <span className="sm:hidden">New</span><span className="hidden sm:inline">New appointment</span>
                </Button>
              </DisabledReason>}>
            <span className="hidden items-center gap-1.5 px-1 text-xs text-muted-foreground lg:flex">
              <CalendarDays aria-hidden className="size-3.5" />
              {bookedCount} {bookedCount === 1 ? "appointment" : "appointments"}
            </span>
            <CheckList
              icon={<Users aria-hidden className="size-4" />}
              label={staffFilterLabel(visibleStaff.length, data?.staff.length ?? 0, hiddenAppointmentCount)}
              groups={[
                {
                  title: "Staff",
                  items: (data?.staff ?? []).map((s) => ({ id: s._id, label: `${s.name} · ${allCountByStaff.get(s._id) ?? 0}`, detail: s.role })),
                  hidden: hiddenStaff,
                  onChange: setHiddenStaff,
                },
              ]}
            />
            <CheckList
              icon={<Filter aria-hidden className="size-4" />}
              label="Filters"
              count={filterCount}
              extra={<label className="flex min-h-11 items-center gap-2 border-t border-border px-4 text-sm"><input type="checkbox" checked={showCancelled} onChange={e => setShowCancelled(e.target.checked)} className="size-4 accent-foreground" />Show cancelled</label>}
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
          </AdminCalendarHeader>
          <p role="status" className="border-b border-border px-4 py-2 text-sm text-muted-foreground empty:sr-only">
            {search.trim() ? (
              <>
                {noSearchMatches ? "No matching appointments" : "Searching"} in {scopeLabel(range)}.{" "}
                {search.trim().length >= 2 ? (
                  <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => setAllDatesQuery(search.trim())}>
                    Search all dates
                  </button>
                ) : null}
              </>
            ) : null}
          </p>
          {allDatesQuery ? (
            <AllDatesResults
              query={allDatesQuery}
              staffById={staffById}
              serviceById={serviceById}
              onOpen={(result) => {
                setAllDatesQuery(null);
                setDate(new Date(result.start));
                setSelectedId(result._id);
              }}
              onClose={() => setAllDatesQuery(null)}
            />
          ) : null}
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
        <div className={view === "agenda" ? "hidden" : "hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex"}>
          {APPOINTMENT_STATUSES.map((key) => {
            const StatusIcon = STATUS_ICONS[key];
            return <span key={key} className="flex items-center gap-1.5">
              <StatusIcon aria-hidden className="size-3" style={{ color: key === "booked" ? "var(--color-slate-700)" : appointmentStatusColor(key) }} />
              {appointmentStatus(key).label}
            </span>;
          })}
          <span className="flex items-center gap-1.5">
            <Coffee aria-hidden className="size-3" />
            Break or time off
          </span>
          <span className="flex items-center gap-1.5"><Timer aria-hidden className="size-3 rounded-sm border border-dashed border-border bg-muted/60" />Turnaround</span>
          <span className="flex items-center gap-1.5"><span aria-hidden className="size-3 rounded-sm bg-muted bg-[repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--color-foreground)_20%,transparent)_3px_4px)]" />Not working</span>
          <span className="ms-auto hidden sm:inline pointer-coarse:hidden">
            Drag a booking or break to propose a change · Bangkok time
          </span>
        </div>
      </Card>

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
      {offShift ? (
        <Dialog open onOpenChange={(open) => !open && setOffShift(null)}>
          <DialogContent className="sm:max-w-sm">
            <DialogHeader>
              <DialogTitle>{staffById.get(offShift.staffId)?.name ?? "Staff"} is not working</DialogTitle>
              <DialogDescription>
                {staffDate(offShift.start, { weekday: true })} · {staffTime(offShift.start)}–{offShift.end - offShift.start >= DAY_MS ? "end of day" : staffTime(offShift.end)} is outside their rostered shift, so it can&apos;t be booked here.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter className="gap-2">
              <Button variant="outline" onClick={() => setOffShift(null)}>Close</Button>
              <ButtonLink href={staffRosterHref({ date: resortIsoDate(offShift.start), staffId: offShift.staffId })}>Open roster week</ButtonLink>
            </DialogFooter>
          </DialogContent>
        </Dialog>
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

function scopeLabel(range: { from: number; to: number }) {
  const last = range.to - 1;
  return resortIsoDate(range.from) === resortIsoDate(last)
    ? staffDate(range.from, { weekday: true })
    : `${staffDate(range.from, { weekday: true })} – ${staffDate(last, { weekday: true })}`;
}

type SearchResult = FunctionReturnType<typeof api.services.admin.searchAppointments>["results"][number];

/** D14: a bounded, authorized lookup beyond the loaded dates; choosing a result opens it on its date. */
export function AllDatesResults({ query, staffById, serviceById, onOpen, onClose }: {
  query: string;
  staffById: ReadonlyMap<string, Doc<"staff">>;
  serviceById: ReadonlyMap<string, Doc<"services">>;
  onOpen: (result: SearchResult) => void;
  onClose: () => void;
}) {
  const found = useQuery(api.services.admin.searchAppointments, { query });
  return (
    <section aria-label="Appointments on all dates" className="border-b border-border px-4 py-2 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="font-medium">
          {found === undefined ? "Searching all dates…" : `${found.results.length === 0 ? "No" : found.results.length} ${found.results.length === 1 ? "match" : "matches"} for “${query}” within ${Math.round(found.windowDays / 30)} months of today`}
        </p>
        <Button size="sm" variant="ghost" onClick={onClose}>Close</Button>
      </div>
      {found?.results.length ? (
        <ul className="mt-1 grid gap-1">
          {found.results.map((result) => (
            <li key={result._id}>
              <button type="button" className="flex min-h-11 w-full items-center justify-between gap-3 rounded-md px-2 text-start hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" onClick={() => onOpen(result)}>
                <span className="min-w-0">
                  <span className={cn("block truncate font-medium", result.status === "cancelled" && "line-through")}>{result.guestName || `Ref ${result.confirmationCode.slice(-6)}`}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {serviceById.get(result.serviceId)?.name ?? "Service"} · {staffById.get(result.staffId)?.name ?? "Staff"}
                  </span>
                </span>
                <span className="shrink-0 text-xs tabular-nums">{staffDate(result.start, { weekday: true })} · {staffTime(result.start)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

/** D21: from an empty range, jump to the next appointment within a bounded window, or say none was found. */
export function NextAppointmentJump({ from, onOpen }: { from: number; onOpen: (start: number) => void }) {
  const next = useQuery(api.services.admin.nextAppointment, { from });
  if (next === undefined) return null;
  if (!next.appointment) return <p className="text-xs text-muted-foreground">None in the 30 days after {staffDate(from, { weekday: true })} either. Use the date controls to look further.</p>;
  const { start } = next.appointment;
  return <Button variant="outline" onClick={() => onOpen(start)}>Next appointment: {staffDate(start, { weekday: true })} · {staffTime(start)}</Button>;
}

/** A column's next off-screen booking remains reachable without guessing a scroll. */
function OffscreenAppointmentCue({ resourceId, appointments }: { resourceId: string; appointments: Appointment[] }) {
  const anchor = useRef<HTMLSpanElement>(null);
  const [cue, setCue] = useState<{ start: number; direction: string } | null>(null);
  useEffect(() => {
    const root = anchor.current?.closest('[data-slot="event-calendar-resource-view"]');
    const viewport = root?.querySelector<HTMLElement>('[data-slot="scroll-area-viewport"]');
    const column = Array.from(root?.querySelectorAll<HTMLElement>('[data-ec-resource]') ?? []).find(el => el.dataset.ecResource === resourceId && el.dataset.slot === 'event-calendar-day-column');
    if (!viewport || !column) return;
    const update = () => {
      const windowRect = viewport.getBoundingClientRect();
      const columnRect = column.getBoundingClientRect();
      const start = Number(column.dataset.ecBoundsStart);
      const minutes = Number(column.dataset.ecBoundsEnd) - start;
      const offscreen = appointments.map(a => {
        const [h, m] = staffTime(a.start).split(':').map(Number);
        const top = columnRect.top + (h * 60 + m - start) / minutes * columnRect.height;
        return { start: a.start, top };
      }).sort((a, b) => a.start - b.start).find(a => a.top > windowRect.bottom - 24 || a.top < windowRect.top);
      setCue(offscreen ? { start: offscreen.start, direction: offscreen.top < windowRect.top ? '↑' : '↓' } : null);
    };
    update();
    viewport.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update); observer.observe(viewport);
    return () => { viewport.removeEventListener('scroll', update); observer.disconnect(); };
  }, [resourceId, appointments]);
  const calendar = useEventCalendar();
  return <span ref={anchor} className="absolute right-0 top-1/2 -translate-y-1/2">{cue ? <Button size="sm" variant="ghost" className="min-h-11 px-2 text-[13px] pointer-coarse:text-sm" aria-label={`Show appointment at ${staffTime(cue.start)}`} onClick={() => calendar.api.scrollToTime(new Date(cue.start))}>{cue.direction === "↓" ? "Next" : "Earlier"} {staffTime(cue.start)} {cue.direction}</Button> : null}</span>;
}

type CheckGroup = {
  title: string;
  items: Array<{ id: string; label: string; detail?: string }>;
  hidden: Set<string>;
  onChange: (next: Set<string>) => void;
};

function CheckList({ icon, label, count, groups, extra }: { icon: ReactNode; label: string; count?: number; groups: CheckGroup[]; extra?: ReactNode }) {
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
        {extra}
        {groups.map((group) => (
          <div key={group.title} role="group" aria-label={group.title} className="border-b border-border p-2 last:border-b-0">
            <div className="flex items-center justify-between px-2 pb-1">
              <span aria-hidden className="admin-eyebrow">
                {group.title}
              </span>
              <button
                type="button"
                className="min-h-11 rounded-sm px-2 text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onClick={() => group.onChange(new Set())}
              >
                Show all
              </button>
            </div>
            {group.items.map((item) => (
              <label key={item.id} className="flex min-h-11 cursor-pointer items-center gap-2 rounded-md focus-within:ring-2 focus-within:ring-ring px-2 py-1.5 text-sm hover:bg-muted">
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
