"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { AdminBooking } from '../../lib/admin/booking-types';
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { Check, CircleDashed, Clock, Ban, PlusIcon, XIcon } from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { useEffect, useMemo, useState } from "react";
import { VillaPicker } from "@/components/admin/VillaPicker";
import { EventCalendar, useEventCalendarNavigation } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import type {
  CalendarEvent,
  CalendarView,
  EventCalendarProposedUpdate,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { AdminCalendarHeader, AdminCalendarSearch } from "@/components/admin/AdminCalendarHeader";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Card } from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { addDaysIso, nightsBetweenIso } from '@/lib/booking/dates';
import { resortTodayIso } from 'convex/shared/time';
import { errorText } from "@/lib/staff-bookings";
import { STAFF_CALENDAR_FORMATS, staffDateTime } from "@/lib/staff-time";
import { Toast, useToast } from "@/components/ui/toast";
import { useAdminBranch } from "@/components/admin/branch/branch-context";
import { hotelPanel } from "@/components/admin/admin-routes";
import { useRouter, useSearchParams } from "@/platform/navigation";
import { useStoredState } from "@/lib/use-stored-state";
import { BookingCleanupDialog } from "./BookingCleanupDialog";
import { NotifyGuestField } from "./BookingMoneyFields";
import { BookingQuickActions, type QuickAction, type QuickTarget } from "./BookingQuickActions";
import { RecordPaymentDialog } from "./BookingFinancials";
import { CancelStayDialog } from "./BookingCorrectionDialogs";
import { NewAppointmentDialog, type AppointmentDraft } from "./NewAppointmentDialog";
import { TodayStrip } from "./TodayStrip";
import { MoreMenu } from "@/components/ui/more-menu";
import { BookingSheet, useBookingEditQuote, type BookingSheetAction } from "./BookingSheet";
import { bookingEditPrice, reviewedPrice } from "./booking-edit-price";
import { DateBlockDialog, type BlockTarget } from "./DateBlockDialog";
import { IcalSourcesDialog } from "./IcalSourcesDialog";
import { NewBookingDialog, type NewBookingPrefill } from "./NewBookingDialog";
import { OtaRatesDialog } from "./OtaRatesDialog";
import { StatusBadge } from "./StatusBadge";
import { formatMoney, sourceLabel } from "./labels";
import {
  HOTEL_STATUSES,
  balanceText,
  paidForPreview,
  displayDate,
  hotelStatus,
  hotelStatusColor,
  notifyDefault,
  serverTodayIso,
  statusKey,
  stayConflicts,
  type AdminProperty,
} from "./admin-bookings-shared";
import {
  buildHotelCalendarEvents,
  isoDate,
  type HotelEventData,
} from "@/lib/admin/booking-calendar-events";

// Stable reference: the calendar rebuilds its settings when this object changes.
const CALENDAR_I18N = { viewNames: { resource: "Villas", agenda: "List" }, formats: STAFF_CALENDAR_FORMATS };
const VIEWS = ["month", "resource", "agenda"] as const satisfies CalendarView[];
type HotelView = (typeof VIEWS)[number];

// Until Settings load, fall back to the defaults (afternoon check-in, late-morning check-out).
const DEFAULT_CHECK_IN = "14:00";
const DEFAULT_CHECK_OUT = "11:00";

// Calendar chip payload and ISO/day helpers now live in the pure, tested module alongside the
// event transformation. `EventData` keeps its local name so the rest of the view is unchanged.
type EventData = HotelEventData;

export type Move = { booking: AdminBooking; propertyId: string; checkIn: string; checkOut: string };

function initialRange() {
  const today = new Date();
  return {
    from: isoDate(startOfWeek(startOfMonth(today))),
    to: isoDate(addDays(endOfWeek(endOfMonth(today)), 1)),
  };
}

/** A dragged or resized booking chip as new villa + dates; null when it isn't a valid stay. */
function proposedMove(update: EventCalendarProposedUpdate<EventData>): Move | null {
  const eventData = update.event.data;
  if (eventData?.kind !== "booking") return null;
  const move = {
    booking: eventData.booking,
    propertyId: update.resourceId ?? eventData.booking.propertyId,
    checkIn: isoDate(update.start),
    checkOut: isoDate(update.end),
  };
  return move.checkOut > move.checkIn ? move : null;
}

function isUnchanged({ booking, propertyId, checkIn, checkOut }: Move) {
  return propertyId === booking.propertyId && checkIn === booking.checkIn && checkOut === booking.checkOut;
}

/** The hotel calendar and today's stays. */
export function AdminBookingsView() {
  return <HotelBookings />;
}

function HotelBookings() {
  const branchId = useAdminBranch().current?.id;
  const [range, setRange] = useState(initialRange);
  const [storedView, setView] = useStoredState("admin.hotel.view", "auto");
  const [storedVilla, setVilla] = useStoredState(branchId ? `admin.hotel.villa:${branchId}` : "admin.hotel.villa", "all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<{ id: Id<"bookings">; initialAction?: BookingSheetAction } | null>(null);
  const [quick, setQuick] = useState<QuickTarget | null>(null);
  const [creating, setCreating] = useState<NewBookingPrefill | null>(null);
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [managingCalendars, setManagingCalendars] = useState(false);
  // `?panel=ota-calendars` (the setup checklist's link) opens OTA calendars; closing clears it, so
  // Back still returns to where the link was followed.
  const searchParams = useSearchParams();
  const router = useRouter();
  const linkedPanel = hotelPanel(searchParams.get("panel"));
  const calendarsOpen = managingCalendars || linkedPanel === "ota-calendars";
  // `?booking=<id>` (an admin Search result) opens that stay; its query re-checks access.
  const linkedBooking = searchParams.get("booking");
  const linkedSelection = !selected && linkedBooking && /^[a-z0-9]{20,40}$/.test(linkedBooking) ? { id: linkedBooking as Id<"bookings"> } : null;
  function clearLinkParam(name: "panel" | "booking") {
    if (!searchParams.has(name)) return;
    const params = new URLSearchParams(searchParams.toString());
    params.delete(name);
    router.replace(params.size ? `/admin/hotel?${params}` : "/admin/hotel", { scroll: false });
  }
  function closeCalendars() {
    setManagingCalendars(false);
    clearLinkParam("panel");
  }
  const [managingRates, setManagingRates] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  // Errors and "can't drag that" hints replace the drag hint for a few seconds; successes go to the toast.
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const toast = useToast();
  const report = (next: { text: string; error?: boolean }) => (next.error ? setNotice(next) : toast.show(next.text));
  const [moving, setMoving] = useState<Move | null>(null);
  const [stayDialog, setStayDialog] = useState<Extract<QuickAction, { kind: "pay" | "cancel" }> | null>(null);
  const [spaDraft, setSpaDraft] = useState<AppointmentDraft | null>(null);
  // Below `sm` the villa filter moves into ⋯ and search folds to an icon.
  const phone = useIsMobile(640);

  const picker = useQuery(api.bookings.admin.listCalendarProperties, storedVilla === "all" ? "skip" : {});
  const selectedVilla = picker?.find((property) => property._id === storedVilla);
  const villa = selectedVilla?._id ?? "all";
  // Wait for the picker to validate a remembered selection before reading its calendar.
  const rangeArgs = selectedVilla ? { ...range, propertyId: selectedVilla._id } : range;
  const data = useQuery(api.bookings.admin.listForAdmin,
    storedVilla !== "all" && picker === undefined ? "skip" : rangeArgs);
  const properties = storedVilla === "all" ? data?.properties : picker;
  const profile = useQuery(api.settings.settings.publicProfile, {});
  const checkInTime = profile?.checkInTime ?? DEFAULT_CHECK_IN;
  const checkOutTime = profile?.checkOutTime ?? DEFAULT_CHECK_OUT;
  const today = resortTodayIso();

  const view: HotelView = (VIEWS as readonly string[]).includes(storedView) ? (storedView as HotelView) : phone ? "agenda" : "month";
  const villaName = (id: string) => properties?.find((p) => p._id === id)?.name ?? "Villa";

  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(id);
  }, [notice]);

  const resources = useMemo<EventCalendarResource[]>(
    () =>
      (data?.properties ?? [])
        .filter((p) => villa === "all" || p._id === villa)
        .map((p) => ({ id: p._id, title: p.name })),
    [data?.properties, villa],
  );

  const events = useMemo<CalendarEvent<EventData>[]>(
    () => buildHotelCalendarEvents({ data, villa, showCancelled, checkInTime, checkOutTime, sourceLabel }).map(event => {
      const item = event.data;
      return item?.kind === "booking" ? { ...event, title: `${item.booking.guestName}, ${data?.properties.find(p => p._id === item.booking.propertyId)?.name ?? "Villa"}, ${displayDate(item.booking.checkIn)} to ${displayDate(item.booking.checkOut)}, ${hotelStatus(statusKey(item.booking)).label}` } : event;
    }),
    [data, villa, showCancelled, checkInTime, checkOutTime],
  );

  function openDetails(id: Id<"bookings">, initialAction?: BookingSheetAction) {
    setSelected({ id, initialAction });
  }

  function openFromSearch(booking: AdminBooking) {
    if (villa !== "all" && villa !== booking.propertyId) setVilla("all");
    if (booking.status === "cancelled") setShowCancelled(true);
    openDetails(booking._id);
  }

  /** Where a drag may drop: an active villa, no past check-in (unless unchanged), no overlap with held dates. */
  function canMove(move: Move) {
    if (!data || isUnchanged(move)) return true;
    const property = data.properties.find((p) => p._id === move.propertyId);
    if (!property || property.status !== "active") return false;
    if (move.checkIn !== move.booking.checkIn && move.checkIn < today) return false;
    return !stayConflicts(data, move.propertyId, move.checkIn, move.checkOut, move.booking._id);
  }

  /** A drop opens the move dialog with the booking exactly as the calendar showed it (its revision included). */
  function confirmMove(move: Move) {
    setQuick(null);
    setMoving(move);
  }

  /** Villa for a drag-selected range: the filtered villa, else the first active villa free on those nights. */
  function villaFor(checkIn: string, checkOut: string) {
    if (villa !== "all") return villa;
    const active = (data?.properties ?? []).filter((p) => p.status === "active");
    return (active.find((p) => data && !stayConflicts(data, p._id, checkIn, checkOut)) ?? active[0])?._id;
  }

  function quickAction(action: QuickAction) {
    if (action.kind !== "bookSpa") {
      setStayDialog(action);
      return;
    }
    openStaySpa(action.booking, villaName(action.booking.propertyId));
  }

  function openStaySpa(booking: AdminBooking, name: string) {
    // Today while the guest is staying, else the first day of the stay.
    const resortToday = serverTodayIso();
    const date = booking.checkIn > resortToday ? booking.checkIn : resortToday;
    setSpaDraft({
      date,
      stay: {
        bookingId: booking._id, guestName: booking.guestName, guestPhone: booking.guestPhone,
        guestEmail: booking.guestEmail, villaName: name,
      },
    });
  }

  function openQuick(booking: AdminBooking, element: Element) {
    const { left, top, width, height } = element.getBoundingClientRect();
    setQuick({ booking, rect: { left, top, width, height } });
  }

  function openNew(checkIn: string, checkOut: string, propertyId?: string) {
    setQuick(null);
    setCreating({ propertyId: propertyId ?? villaFor(checkIn, checkOut), checkIn, checkOut });
  }

  return (
    // Month rows grow with their stays; the page carries the full month.
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-3 py-4 sm:px-6">
      <TodayStrip villaName={villaName} onOpen={openQuick} />

      {phone && villa !== "all" ? <Button variant="outline" onClick={() => setVilla("all")} aria-label={`Showing ${villaName(villa)} only. Show all villas`}>{villaName(villa)}<XIcon aria-hidden className="size-4" /></Button> : null}
      <Card className="flex min-h-0 flex-1 flex-col overflow-hidden [&_*]:border-border">
        <EventCalendar<EventData>
          events={events}
          view={view}
          onViewChange={setView}
          views={[...VIEWS]}
          resources={resources}
          fixedWeeks={false}
          agendaDayCount={14}
          renderEvent={({ occurrence }) => {
            const item = occurrence.event.data;
            if (item?.kind !== "booking") return <span className="w-full truncate bg-[repeating-linear-gradient(135deg,transparent_0_7px,color-mix(in_oklab,var(--color-foreground)_12%,transparent)_7px_8px)] text-xs">{occurrence.event.title}</span>;
            const b = item.booking;
            const status = statusKey(b);
            const Icon = status === "paid" ? Check : status === "cancelled" ? Ban : status === "pending" ? CircleDashed : Clock;
            return <span className={`flex w-full min-w-0 items-start gap-1.5 ${status === "cancelled" ? "line-through" : ""}`}>
              <Icon aria-hidden className="mt-0.5 size-3 shrink-0" />
              <span className="grid min-w-0 text-xs leading-4">
                <span className="truncate font-medium">{b.guestName}</span>
                <span className="truncate font-normal">{villaName(b.propertyId)}</span>
              </span>
              {status === "pending" ? <span aria-hidden className="absolute inset-0 rounded-[inherit] border border-dashed border-current" /> : null}
            </span>;
          }}
          renderAgendaEvent={({ occurrence, segment }) => {
            const item = occurrence.event.data;
            if (item?.kind !== "booking") return <span className="text-sm">{occurrence.event.title}</span>;
            const b = item.booking;
            const day = isoDate(segment.day);
            const phase = day === b.checkIn ? "Arrives" : day === b.checkOut ? "Leaves" : "In house";
            return <span className="flex w-full min-w-0 items-center justify-between gap-3">
              <span className="grid min-w-0 gap-1 text-left">
                <span className="truncate text-[15px] font-medium">{b.guestName}</span>
                <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"><span className="truncate">{villaName(b.propertyId)}</span><span className="shrink-0">· {phase}</span></span>
                <span className="text-xs text-muted-foreground">{displayDate(b.checkIn)} → {displayDate(b.checkOut)}</span>
              </span>
              <span className="grid shrink-0 justify-items-end gap-1">
                {b.owed > 0 || statusKey(b) !== "paid" ? <span className={`money font-sans text-[15px] font-medium tabular-nums ${b.owed <= 0 ? "text-emerald-700" : ""}`}>{b.owed > 0 ? `${formatMoney(b.owed, b.currency)} due` : "Paid"}</span> : null}
                <StatusBadge {...hotelStatus(statusKey(b))} />
              </span>
            </span>;
          }}
          renderNoEvents={() => <div className="grid justify-items-center gap-3"><p className="text-sm text-muted-foreground">No stays in this period.</p><Button onClick={() => setCreating({})} disabled={!data}>New booking</Button></div>}
          dayStartHour={8}
          dayEndHour={20}
          interval={60}
          i18n={CALENDAR_I18N}
          interactions={{ drag: true, resize: true, selectSlot: true }}
          canSelectSlot={(slot) => isoDate(slot.start) >= today}
          onSelectSlot={(slot) => {
            const checkIn = isoDate(slot.start);
            if (checkIn < today) return;
            const end = slot.allDay ? isoDate(slot.end) : "";
            openNew(checkIn, end > checkIn ? end : addDaysIso(checkIn, 1), slot.resourceId);
          }}
          onSlotClick={(slot) => {
            // The tap that dismisses a booking's quick actions only closes them; it never starts a booking underneath.
            if (quick) {
              setQuick(null);
              return;
            }
            // In the Villas view a click on a villa's all-day cell starts a one-night booking there.
            const checkIn = isoDate(slot.date);
            if (slot.view === "month" && checkIn >= today) openNew(checkIn, addDaysIso(checkIn, 1));
            if (slot.view === "resource" && slot.allDay && slot.resourceId && checkIn >= today) {
              openNew(checkIn, addDaysIso(checkIn, 1), slot.resourceId);
            }
          }}
          canDropEvent={(update) => {
            const move = proposedMove(update);
            return move !== null && canMove(move);
          }}
          onEventUpdate={(update) => {
            // Never apply locally: confirm first, then the server result flows back through the query.
            const move = proposedMove(update);
            if (move && !isUnchanged(move) && canMove(move)) confirmMove(move);
            return false;
          }}
          onDragBlocked={(occurrence) =>
            setNotice({
              text:
                occurrence.event.data?.kind === "booking"
                  ? "Cancelled and refunded bookings can't be moved."
                  : "Blocks can't be dragged. Click one to edit it.",
            })
          }
          onEventClick={(occurrence, event) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "booking") {
              const chip =
                (event.target as HTMLElement).closest("[data-slot=event-calendar-event]") ?? (event.currentTarget as HTMLElement);
              openQuick(eventData.booking, chip);
            } else if (eventData?.kind === "hostBlock") setBlockTarget({ kind: "host", block: eventData.block });
            else if (eventData?.kind === "otaBlock") setBlockTarget({ ...eventData, kind: "ota" });
          }}
          onEventDoubleClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "booking") {
              setQuick(null);
              openDetails(eventData.booking._id);
            }
          }}
          onRangeChange={({ range: visible }) =>
            setRange({ from: isoDate(addDays(visible.start, -1)), to: isoDate(addDays(visible.end, 1)) })
          }
          classNames={{
            monthCellFooter: "absolute left-0 top-1 justify-start pb-0",
            monthDayNumber: "text-[13px] tabular-nums in-data-[outside=true]:text-muted-foreground",
            monthCellContent: "pt-7",
            monthBarOverlay: "pt-7",
            moreIndicator: "mt-auto h-6 pointer-coarse:h-11 w-fit max-w-full shrink-0 rounded-full bg-muted px-2 text-xs",
          }}
          loading={data === undefined}
          scrollMode={view === "month" || (phone && view === "agenda") ? "page" : "contained"}
          className={view === "month" || (phone && view === "agenda") ? "[--ec-month-bar-h:2.375rem] w-full" : "[--ec-month-bar-h:2.375rem] h-[calc(100dvh-13rem)] min-h-96 w-full"}
        >
          <AdminCalendarHeader compact primaryAction={<Button size="sm" aria-label="New booking" disabled={!data} onClick={() => setCreating({ propertyId: villa !== "all" ? villa : undefined })}><PlusIcon aria-hidden className="size-4" /><span className="sm:hidden">New</span><span className="hidden sm:inline">New booking</span></Button>}>
            <GuestSearch properties={properties ?? []} onPick={openFromSearch} />
            {phone ? (
              villa !== "all" ? (
                // The villa filter lives in ⋯ on a phone; a filtered calendar says so and clears in one tap.
                <Button size="sm" variant="secondary" className="hidden max-w-40 sm:inline-flex" aria-label={`Showing ${villaName(villa)} only. Show all villas`} onClick={() => setVilla("all")}>
                  <span className="truncate">{villaName(villa)}</span>
                  <XIcon aria-hidden className="size-3.5" />
                </Button>
              ) : null
            ) : (
              <VillaPicker
                properties={properties ?? []} value={villa} onChange={setVilla}
                includeAll compact disabled={!properties}
                className="w-36"
              />
            )}
            {data === undefined ? <Spinner label="Loading bookings" /> : null}
            <div className="ms-auto flex items-center gap-2">
              <MoreMenu
                label="More calendar tools"
                disabled={!properties}
                items={[
                  ...(phone
                    ? [
                        { label: "All villas", checked: villa === "all", onSelect: () => setVilla("all") },
                        ...(properties ?? []).map((p) => ({ label: p.name, checked: villa === p._id, onSelect: () => setVilla(p._id) })),
                      ]
                    : []),
                  { label: "Show cancelled", checked: showCancelled, onSelect: () => setShowCancelled((value) => !value) },
                  { label: "Block dates", onSelect: () => setBlockTarget({ kind: "new", propertyId: villa !== "all" ? villa : undefined }) },
                  { label: "OTA calendars", onSelect: () => setManagingCalendars(true) },
                  { label: "OTA rates", onSelect: () => setManagingRates(true) },
                  { label: "Clean up old bookings", onSelect: () => setCleaningUp(true) },
                ]}
              />
            </div>
          </AdminCalendarHeader>
          {data && data.properties.length === 0 ? (
            <div className="flex flex-wrap items-center gap-3 border-b border-border bg-muted/40 px-4 py-3 text-sm">
              <p className="min-w-0 flex-1 text-muted-foreground">No villas yet. Add one to start taking bookings.</p>
              <ButtonLink href="/admin/properties" size="sm">
                Add a villa
              </ButtonLink>
            </div>
          ) : null}
          {data && !data.complete ? (
            <p role="alert" className="border-b border-border bg-destructive/10 px-4 py-2 text-sm text-destructive">
              Some bookings or blocks may be missing here: a villa has more records around these dates than one load
              can check. Try a shorter view, or search for the guest.
            </p>
          ) : null}
          <EventCalendarContent />
        </EventCalendar>
        <div className={view === "agenda" ? "hidden" : "hidden shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground sm:flex"}>
          {HOTEL_STATUSES.map((key) => {
            const Icon = key === "paid" ? Check : key === "cancelled" ? Ban : key === "pending" ? CircleDashed : Clock;
            return <span key={key} className="flex items-center gap-1.5">
              {key === "hostBlock" || key === "otaBlock" ? <span aria-hidden className="size-3 rounded-sm bg-muted bg-[repeating-linear-gradient(135deg,transparent_0_3px,color-mix(in_oklab,var(--color-foreground)_20%,transparent)_3px_4px)]" /> : <Icon aria-hidden className="size-3.5" style={{ color: hotelStatusColor(key) }} />}
              {key === "pending" ? "Pending · dashed border" : key === "confirmed" ? "Confirmed · balance due" : hotelStatus(key).label}
            </span>;
          })}
          <span role="status" className={notice?.error ? "text-destructive sm:ms-auto" : "sm:ms-auto"}>
            {/* The drag hint is for a mouse or pen; on touch the chips open on a tap. */}
            {notice?.text ?? <span className="pointer-coarse:hidden">Drag across days to book or block · drag a booking to move it, or its edge to change dates</span>}
          </span>
        </div>
      </Card>

      <BookingSheet
        bookingId={(selected ?? linkedSelection)?.id ?? null}
        initialAction={selected?.initialAction}
        properties={properties ?? []}
        onClose={() => { setSelected(null); clearLinkParam("booking"); }}
        onBookSpa={(booking) => {
          setSelected(null);
          clearLinkParam("booking");
          openStaySpa(booking, booking.propertyName);
        }}
      />
      {quick ? (
        <BookingQuickActions
          key={quick.booking._id}
          target={quick}
          villaName={villaName(quick.booking.propertyId)}
          onClose={() => setQuick(null)}
          onOpenDetails={() => openDetails(quick.booking._id)}
          onAction={quickAction}
          onNotice={report}
        />
      ) : null}
      {stayDialog?.kind === "pay" ? (
        <RecordPaymentDialog
          booking={stayDialog.booking}
          owed={stayDialog.booking.money.owed}
          onClose={(done) => {
            const name = stayDialog.booking.guestName;
            setStayDialog(null);
            if (done) toast.show(`${name}: ${done}`);
          }}
        />
      ) : null}
      {stayDialog?.kind === "cancel" ? <CancelStayDialog booking={stayDialog.booking} onClose={() => setStayDialog(null)} /> : null}
      {spaDraft ? (
        <NewAppointmentDialog
          draft={spaDraft}
          services={[]}
          staff={[]}
          onClose={() => setSpaDraft(null)}
          onCreated={(_id, start) => {
            const name = spaDraft.stay?.guestName ?? "Guest";
            setSpaDraft(null);
            toast.show(`${name}: spa booked for ${staffDateTime(start)}, added to the balance due.`);
          }}
        />
      ) : null}
      {properties && blockTarget ? (
        <DateBlockDialog target={blockTarget} properties={properties} onClose={() => setBlockTarget(null)} />
      ) : null}
      {properties ? (
        <IcalSourcesDialog open={calendarsOpen} onClose={closeCalendars} properties={properties} />
      ) : null}
      {properties ? (
        <OtaRatesDialog open={managingRates} onClose={() => setManagingRates(false)} properties={properties} />
      ) : null}
      {properties && cleaningUp ? <BookingCleanupDialog properties={properties} onClose={() => setCleaningUp(false)} /> : null}
      {properties && moving ? (
        <MoveBookingDialog
          key={`${moving.booking._id}:${moving.propertyId}:${moving.checkIn}:${moving.checkOut}`}
          move={moving}
          properties={properties}
          onClose={() => setMoving(null)}
          onMoved={(text) => {
            setMoving(null);
            toast.show(text);
          }}
          onOpenBooking={(id) => {
            setMoving(null);
            openDetails(id);
          }}
        />
      ) : null}
      {properties && creating ? (
        <NewBookingDialog
          // Archived villas are offered only for past stays, inside the dialog; drafts never.
          properties={properties.filter((p) => p.status !== "draft")}
          prefill={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null);
            openDetails(id);
          }}
          onBlockInstead={(target) => {
            setCreating(null);
            setBlockTarget({ kind: "new", ...target });
          }}
        />
      ) : null}
      <Toast {...toast} />
    </div>
  );
}

const CUSTOM_PRICE_REFUSAL = /custom price/i;

/**
 * Confirms a dragged or resized booking. It sends the revision the calendar showed when the chip
 * was dropped, so a change made meanwhile is refused rather than overwritten, and always says
 * whether the guest is emailed (sent explicitly). A stay with a custom price is not re-priced at
 * the villa rate here: the dialog explains and offers to open the booking to set the new price.
 * While saving it can't be closed or sent twice; a failure keeps it open for a retry.
 */
export function MoveBookingDialog({
  move,
  properties,
  onClose,
  onMoved,
  onOpenBooking,
}: {
  move: Move;
  properties: AdminProperty[];
  onClose: () => void;
  onMoved: (notice: string) => void;
  onOpenBooking: (bookingId: Id<"bookings">) => void;
}) {
  const { booking, propertyId, checkIn, checkOut } = move;
  const editBooking = useMutation(api.bookings.commands.editBooking.editBooking);
  const detail = useQuery(api.bookings.admin.getForAdmin, { bookingId: booking._id });
  const [notifyChoice, setNotifyChoice] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const property = properties.find((p) => p._id === propertyId);
  const fromVilla = properties.find((p) => p._id === booking.propertyId)?.name ?? "Villa";
  const nights = nightsBetweenIso(checkIn, checkOut);
  const customPrice = detail?.priceOverride ?? null;
  const changedMeanwhile = detail ? detail.revision !== booking.revision : false;
  const quote = useBookingEditQuote(
    detail && property && !customPrice && !changedMeanwhile
      ? { bookingId: booking._id, propertySlug: property.slug, checkIn, checkOut, guests: booking.guests }
      : null,
  );
  const price = bookingEditPrice({ current: booking, quote });
  const expectedPrice = reviewedPrice(price);
  const newTotal = expectedPrice?.total ?? booking.total;
  const currency = expectedPrice?.currency ?? booking.currency;
  const difference = currency === booking.currency ? newTotal - booking.total : null;
  const paid = paidForPreview(booking);
  const balance = paid !== undefined && currency === booking.currency ? balanceText(newTotal, booking, booking.currency) : null;
  const notify = notifyChoice ?? notifyDefault({ checkIn, guestEmailsOff: detail?.guestEmailsOff });
  const customRefused = CUSTOM_PRICE_REFUSAL.test(error);
  const ready = detail !== undefined && detail !== null && !customPrice && !changedMeanwhile && Boolean(property) && Boolean(expectedPrice);

  async function save() {
    if (!ready || !expectedPrice || saving) return;
    setSaving(true);
    setError("");
    try {
      await editBooking({
        bookingId: booking._id,
        expectedRevision: booking.revision,
        propertyId: propertyId as Id<"properties">,
        checkIn,
        checkOut,
        guests: booking.guests,
        guestName: booking.guestName,
        guestPhone: booking.guestPhone,
        guestEmail: booking.guestEmail,
        notifyGuest: notify,
        expectedPrice,
      });
      onMoved(`${booking.guestName}: moved to ${displayDate(checkIn)} → ${displayDate(checkOut)}.`);
    } catch (err) {
      setError(errorText(err, "Could not move the booking."));
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => (open || saving ? undefined : onClose())}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{`Move ${booking.guestName}'s booking?`}</DialogTitle>
          <DialogDescription>
            {propertyId !== booking.propertyId ? `${fromVilla} → ${property?.name ?? "Villa"}` : (property?.name ?? fromVilla)} ·{" "}
            {displayDate(checkIn)} → {displayDate(checkOut)} · {nights} {nights === 1 ? "night" : "nights"}
          </DialogDescription>
        </DialogHeader>
        {detail === undefined ? (
          <Spinner label="Loading the booking" />
        ) : detail === null ? (
          <p role="alert" className="text-sm text-destructive">This booking no longer exists.</p>
        ) : customPrice ? (
          <div className="grid gap-1 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <p className="font-medium">
              This stay has a custom price of {formatMoney(customPrice.total, booking.currency)}: {customPrice.reason}
            </p>
            <p className="text-muted-foreground">
              Moving it needs the price for the new dates, so it isn’t moved here. Open the booking and use Edit to set
              the new price, or return it to the villa rate.
            </p>
          </div>
        ) : changedMeanwhile ? (
          <p role="alert" className="text-sm text-destructive">
            This booking changed since the calendar showed it. Close this and drag it again to see the latest details.
          </p>
        ) : price.kind === "loading" || price.kind === "idle" ? (
          <Spinner label="Checking the price" />
        ) : price.kind === "error" ? (
          <p role="alert" className="text-sm text-destructive">{price.message}</p>
        ) : (
          <div className="grid gap-3 text-sm">
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <p className="font-medium">
                New total {formatMoney(newTotal, currency)}{" "}
                <span className="font-normal text-muted-foreground">
                  (was {formatMoney(booking.total, booking.currency)}
                  {difference === null ? "" : `, ${difference === 0 ? "no change" : `${difference > 0 ? "+" : "−"}${formatMoney(Math.abs(difference), booking.currency)}`}`})
                </span>
              </p>
              {price.kind === "changed" && price.note ? <p className="text-muted-foreground">{price.note}</p> : null}
              {paid !== undefined && currency === booking.currency ? (
                <p className="text-muted-foreground">
                  Guest paid {formatMoney(paid, booking.currency)}.{" "}
                  {balance ? <span className={`font-medium ${balance.tone}`}>{balance.text}</span> : "Fully paid."}
                </p>
              ) : null}
            </div>
            <NotifyGuestField id="move-notify" guestEmail={booking.guestEmail} checked={notify} onChange={setNotifyChoice} action="the new dates" />
          </div>
        )}
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Keep dates
          </Button>
          {customPrice || customRefused ? (
            <Button type="button" onClick={() => onOpenBooking(booking._id)} disabled={saving}>
              Open booking
            </Button>
          ) : (
            <Button type="button" onClick={() => void save()} disabled={!ready || saving}>
              {saving ? <Spinner className="text-current" /> : null}
              {error ? "Try again" : "Move booking"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Finds a booking by guest name, phone, email or confirmation code and jumps the calendar to it. */
function GuestSearch({ properties, onPick }: { properties: AdminProperty[]; onPick: (booking: AdminBooking) => void }) {
  const { goTo } = useEventCalendarNavigation();
  const [text, setText] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const active = query.length >= 2 && text.trim().length >= 2;
  const results = useQuery(api.bookings.admin.searchBookings, active ? { query } : "skip");
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Villa";
  return (
    <AdminCalendarSearch label="Search bookings" placeholder="Guest, phone or code" value={text} onChange={setText} open={searchOpen} onOpenChange={setSearchOpen}>
      {active ? (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-80 min-w-72 overflow-y-auto rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg">
          {results === undefined ? (
            <p role="status" className="px-3 py-2 text-sm text-muted-foreground">Searching…</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No bookings found.</p>
          ) : (
            <ul>
              {results.map((booking) => (
                <li key={booking._id}>
                  <button
                    type="button"
                    className="grid w-full gap-0.5 rounded-md px-3 py-2 text-left text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                    onClick={() => {
                      goTo(new Date(`${booking.checkIn}T12:00:00`));
                      onPick(booking);
                      setText("");
                      setSearchOpen(false);
                    }}
                  >
                    <span className="flex items-center justify-between gap-2 font-medium">
                      <span className="min-w-0 truncate">{booking.guestName}</span>
                      <StatusBadge {...hotelStatus(statusKey(booking))} />
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {villaName(booking.propertyId)} · {displayDate(booking.checkIn)} → {displayDate(booking.checkOut)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {[booking.confirmationCode, booking.guestPhone].filter(Boolean).join(" · ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </AdminCalendarSearch>
  );
}
