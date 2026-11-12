"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { AdminBooking } from "convex/bookings/model";
import { addDays, endOfMonth, endOfWeek, startOfMonth, startOfWeek } from "date-fns";
import { PlusIcon, SearchIcon } from "lucide-react";
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
import { AdminCalendarHeader } from "@/components/admin/AdminCalendarHeader";
import { Button, ButtonLink } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { addDaysIso, nightsBetweenIso, todayIsoLocal } from "@/lib/booking/dates";
import { errorText } from "@/lib/staff-bookings";
import { useStoredState } from "@/lib/use-stored-state";
import { BookingCleanupDialog } from "./BookingCleanupDialog";
import { NotifyGuestField } from "./BookingMoneyFields";
import { BookingQuickActions, type QuickTarget } from "./BookingQuickActions";
import { BookingSheet, useBookingEditQuote } from "./BookingSheet";
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
  displayDate,
  hotelStatus,
  hotelStatusColor,
  notifyDefault,
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
const CALENDAR_I18N = { viewNames: { resource: "Villas", agenda: "List" } };
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

export function AdminBookingsView() {
  const [range, setRange] = useState(initialRange);
  const [storedView, setView] = useStoredState("admin.hotel.view", "month");
  const [storedVilla, setVilla] = useStoredState("admin.hotel.villa", "all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedId, setSelectedId] = useState<Id<"bookings"> | null>(null);
  const [quick, setQuick] = useState<QuickTarget | null>(null);
  const [creating, setCreating] = useState<NewBookingPrefill | null>(null);
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [managingCalendars, setManagingCalendars] = useState(false);
  const [managingRates, setManagingRates] = useState(false);
  const [cleaningUp, setCleaningUp] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [moving, setMoving] = useState<Move | null>(null);

  const data = useQuery(api.bookings.admin.listForAdmin, range);
  const profile = useQuery(api.settings.publicProfile, {});
  const checkInTime = profile?.checkInTime ?? DEFAULT_CHECK_IN;
  const checkOutTime = profile?.checkOutTime ?? DEFAULT_CHECK_OUT;
  const today = todayIsoLocal();

  const view: HotelView = (VIEWS as readonly string[]).includes(storedView) ? (storedView as HotelView) : "month";
  // A remembered villa that no longer exists falls back to all villas.
  const villa = storedVilla === "all" || !data || data.properties.some((p) => p._id === storedVilla) ? storedVilla : "all";
  const villaName = (id: string) => data?.properties.find((p) => p._id === id)?.name ?? "Villa";

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
    () => buildHotelCalendarEvents({ data, villa, showCancelled, checkInTime, checkOutTime, sourceLabel }),
    [data, villa, showCancelled, checkInTime, checkOutTime],
  );

  function openFromSearch(booking: AdminBooking) {
    if (villa !== "all" && villa !== booking.propertyId) setVilla("all");
    if (booking.status === "cancelled") setShowCancelled(true);
    setSelectedId(booking._id);
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

  function openNew(checkIn: string, checkOut: string, propertyId?: string) {
    setQuick(null);
    setCreating({ propertyId: propertyId ?? villaFor(checkIn, checkOut), checkIn, checkOut });
  }

  return (
    // From tablet up it fills the viewport under the 4rem admin header: the calendar scrolls inside, the legend stays in view.
    <div className="mx-auto flex w-full max-w-7xl flex-col px-4 py-4 sm:px-6 md:h-[calc(100dvh-4rem)] md:min-h-[36rem]">
      <div className="flex min-h-0 flex-1 flex-col border border-border bg-card [&_*]:border-border">
        <EventCalendar<EventData>
          events={events}
          view={view}
          onViewChange={setView}
          views={[...VIEWS]}
          resources={resources}
          dayStartHour={8}
          dayEndHour={20}
          interval={60}
          i18n={CALENDAR_I18N}
          interactions={{ drag: true, resize: true, selectSlot: true }}
          canSelectSlot={(slot) => isoDate(slot.start) >= today}
          onSelectSlot={(slot) => {
            const checkIn = isoDate(slot.start);
            const end = slot.allDay ? isoDate(slot.end) : "";
            openNew(checkIn, end > checkIn ? end : addDaysIso(checkIn, 1), slot.resourceId);
          }}
          onSlotClick={(slot) => {
            // In the Villas view a click on a villa's all-day cell starts a one-night booking there.
            const checkIn = isoDate(slot.date);
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
              const { left, top, width, height } = chip.getBoundingClientRect();
              setQuick({ booking: eventData.booking, rect: { left, top, width, height } });
            } else if (eventData?.kind === "hostBlock") setBlockTarget({ kind: "host", block: eventData.block });
            else if (eventData?.kind === "otaBlock") setBlockTarget({ ...eventData, kind: "ota" });
          }}
          onEventDoubleClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "booking") {
              setQuick(null);
              setSelectedId(eventData.booking._id);
            }
          }}
          onRangeChange={({ range: visible }) =>
            setRange({ from: isoDate(visible.start), to: isoDate(addDays(visible.end, 1)) })
          }
          loading={data === undefined}
          className="h-[36rem] w-full md:h-auto md:min-h-0 md:flex-1"
        >
          <AdminCalendarHeader>
            <GuestSearch properties={data?.properties ?? []} onPick={openFromSearch} />
            <VillaPicker
              properties={data?.properties ?? []} value={villa} onChange={setVilla}
              includeAll compact disabled={!data}
              className="flex-1 sm:w-48 sm:flex-none"
            />
            <Button
              size="sm"
              variant={showCancelled ? "secondary" : "outline"}
              aria-pressed={showCancelled}
              onClick={() => setShowCancelled((value) => !value)}
            >
              Show cancelled
            </Button>
            {data === undefined ? <Spinner label="Loading bookings" /> : null}
            <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
              <Button size="sm" variant="outline" onClick={() => setManagingCalendars(true)} disabled={!data}>
                OTA calendars
              </Button>
              <Button size="sm" variant="outline" onClick={() => setManagingRates(true)} disabled={!data}>
                OTA rates
              </Button>
              <Button size="sm" variant="outline" onClick={() => setCleaningUp(true)} disabled={!data}>
                Clean up
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setBlockTarget({ kind: "new", propertyId: villa !== "all" ? villa : undefined })}
                disabled={!data}
              >
                Block dates
              </Button>
              <Button
                size="sm"
                onClick={() => setCreating({ propertyId: villa !== "all" ? villa : undefined })}
                disabled={!data}
              >
                <PlusIcon aria-hidden="true" className="size-4" />
                New booking
              </Button>
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
        <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {HOTEL_STATUSES.map((key) => (
            <span key={key} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: hotelStatusColor(key) }} />
              {hotelStatus(key).label}
            </span>
          ))}
          <span role="status" className={notice?.error ? "text-destructive sm:ms-auto" : "sm:ms-auto"}>
            {notice?.text ?? "Drag across days to book or block · drag a booking to move it, or its edge to change dates"}
          </span>
        </div>
      </div>

      <BookingSheet bookingId={selectedId} properties={data?.properties ?? []} onClose={() => setSelectedId(null)} />
      {quick ? (
        <BookingQuickActions
          key={quick.booking._id}
          target={quick}
          villaName={villaName(quick.booking.propertyId)}
          onClose={() => setQuick(null)}
          onOpenDetails={() => setSelectedId(quick.booking._id)}
          onNotice={setNotice}
        />
      ) : null}
      {data && blockTarget ? (
        <DateBlockDialog target={blockTarget} properties={data.properties} onClose={() => setBlockTarget(null)} />
      ) : null}
      {data ? (
        <IcalSourcesDialog open={managingCalendars} onClose={() => setManagingCalendars(false)} properties={data.properties} />
      ) : null}
      {data ? (
        <OtaRatesDialog open={managingRates} onClose={() => setManagingRates(false)} properties={data.properties} />
      ) : null}
      {data && cleaningUp ? <BookingCleanupDialog properties={data.properties} onClose={() => setCleaningUp(false)} /> : null}
      {data && moving ? (
        <MoveBookingDialog
          key={`${moving.booking._id}:${moving.propertyId}:${moving.checkIn}:${moving.checkOut}`}
          move={moving}
          properties={data.properties}
          onClose={() => setMoving(null)}
          onMoved={(text) => {
            setMoving(null);
            setNotice({ text });
          }}
          onOpenBooking={(id) => {
            setMoving(null);
            setSelectedId(id);
          }}
        />
      ) : null}
      {data && creating ? (
        <NewBookingDialog
          // Archived villas are offered only for past stays, inside the dialog; drafts never.
          properties={data.properties.filter((p) => p.status !== "draft")}
          prefill={creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => {
            setCreating(null);
            setSelectedId(id);
          }}
          onBlockInstead={(target) => {
            setCreating(null);
            setBlockTarget({ kind: "new", ...target });
          }}
        />
      ) : null}
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
  const balance = booking.amountPaid !== undefined && currency === booking.currency ? balanceText(newTotal, booking.amountPaid, booking.currency) : null;
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
              {booking.amountPaid !== undefined && currency === booking.currency ? (
                <p className="text-muted-foreground">
                  Guest paid {formatMoney(booking.amountPaid, booking.currency)}.{" "}
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
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(text.trim()), 250);
    return () => clearTimeout(id);
  }, [text]);
  const active = query.length >= 2 && text.trim().length >= 2;
  const results = useQuery(api.bookings.admin.searchBookings, active ? { query } : "skip");
  const villaName = (id: string) => properties.find((p) => p._id === id)?.name ?? "Villa";

  return (
    <div className="relative min-w-0 flex-1 sm:w-64 sm:flex-none">
      <SearchIcon aria-hidden className="pointer-events-none absolute start-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setText("");
        }}
        placeholder="Guest, phone or code"
        aria-label="Search bookings"
        className="h-9 ps-8"
      />
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
    </div>
  );
}
