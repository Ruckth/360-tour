"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { AdminBooking } from "convex/adminBookings";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { Loader2, PlusIcon, SearchIcon } from "lucide-react";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { EventCalendar, useEventCalendarNavigation } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import type {
  CalendarEvent,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { AdminCalendarHeader } from "@/components/admin/AdminCalendarHeader";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { addDaysIso, dateToIso, isDateInIsoList, rangeIntersectsDates, todayIsoLocal } from "@/lib/booking/dates";
import { errorText, money } from "@/lib/staff-bookings";
import { BookingSheet } from "./BookingSheet";
import { DateBlockDialog, type BlockTarget } from "./DateBlockDialog";
import { IcalSourcesDialog } from "./IcalSourcesDialog";
import { OtaRatesDialog } from "./OtaRatesDialog";
import {
  STATUS,
  SOURCE_LABELS,
  displayDate,
  statusKey,
  type AdminProperty,
  type DateBlock,
} from "./admin-bookings-shared";

// Stable reference: the calendar rebuilds its settings when this object changes.
const CALENDAR_I18N = { viewNames: { resource: "Villas", agenda: "List" } };

// Villa stays: afternoon check-in, late-morning check-out.
const CHECK_IN_TIME = "T14:00:00";
const CHECK_OUT_TIME = "T11:00:00";

type EventData =
  | { kind: "booking"; booking: AdminBooking }
  | { kind: "hostBlock"; block: DateBlock }
  | { kind: "otaBlock"; propertyId: string; start: string; end: string; source: string };

function isoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

/** Collapses per-night OTA block rows into contiguous ranges per villa and source. */
function blockRanges(blocks: Array<{ propertyId: string; date: string; source: string }>) {
  const ranges: Array<{ propertyId: string; start: string; end: string; source: string }> = [];
  const sorted = [...blocks].sort(
    (a, b) =>
      a.propertyId.localeCompare(b.propertyId) || a.source.localeCompare(b.source) || a.date.localeCompare(b.date),
  );
  for (const block of sorted) {
    const last = ranges.at(-1);
    if (last && last.propertyId === block.propertyId && last.source === block.source && last.end === block.date) {
      last.end = addDaysIso(block.date, 1);
    } else {
      ranges.push({ propertyId: block.propertyId, start: block.date, end: addDaysIso(block.date, 1), source: block.source });
    }
  }
  return ranges;
}

function initialRange() {
  const today = new Date();
  return {
    from: isoDate(startOfWeek(startOfMonth(today))),
    to: isoDate(addDays(endOfWeek(endOfMonth(today)), 1)),
  };
}

export function AdminBookingsView() {
  const [range, setRange] = useState(initialRange);
  const [villa, setVilla] = useState("all");
  const [showCancelled, setShowCancelled] = useState(false);
  const [selectedId, setSelectedId] = useState<Id<"bookings"> | null>(null);
  const [creating, setCreating] = useState(false);
  const [blockTarget, setBlockTarget] = useState<BlockTarget | null>(null);
  const [managingCalendars, setManagingCalendars] = useState(false);
  const [managingRates, setManagingRates] = useState(false);

  const data = useQuery(api.adminBookings.listForAdmin, range);

  const resources = useMemo<EventCalendarResource[]>(
    () =>
      (data?.properties ?? [])
        .filter((p) => villa === "all" || p._id === villa)
        .map((p) => ({ id: p._id, title: p.name })),
    [data?.properties, villa],
  );

  const events = useMemo<CalendarEvent<EventData>[]>(() => {
    if (!data) return [];
    const names = new Map(data.properties.map((p) => [p._id as string, p.name]));
    const visible = (propertyId: string) => villa === "all" || propertyId === villa;
    const allDay = (start: string, end: string) => ({
      start: new Date(`${start}T00:00:00`),
      end: new Date(`${end}T00:00:00`),
      allDay: true,
    });

    const bookingEvents = data.bookings
      .filter((b) => visible(b.propertyId) && (showCancelled || b.status !== "cancelled"))
      .map((booking): CalendarEvent<EventData> => ({
        id: booking._id,
        title: `${booking.guestName} · ${names.get(booking.propertyId) ?? "Villa"}`,
        start: new Date(`${booking.checkIn}${CHECK_IN_TIME}`),
        end: new Date(`${booking.checkOut}${CHECK_OUT_TIME}`),
        resourceId: booking.propertyId,
        color: STATUS[statusKey(booking)].color,
        readOnly: true,
        data: { kind: "booking", booking },
      }));

    const hostBlockEvents = data.dateBlocks
      .filter((block) => visible(block.propertyId))
      .map((block): CalendarEvent<EventData> => ({
        id: `host-block-${block._id}`,
        title: `Blocked: ${block.reason} · ${names.get(block.propertyId) ?? "Villa"}`,
        ...allDay(block.start, block.end),
        resourceId: block.propertyId,
        color: STATUS.hostBlock.color,
        readOnly: true,
        data: { kind: "hostBlock", block },
      }));

    const otaBlockEvents = blockRanges(data.blocks)
      .filter((block) => visible(block.propertyId))
      .map((block): CalendarEvent<EventData> => ({
        id: `ota-block-${block.propertyId}-${block.source}-${block.start}`,
        title: `${SOURCE_LABELS[block.source] ?? block.source} · ${names.get(block.propertyId) ?? "Villa"}`,
        ...allDay(block.start, block.end),
        resourceId: block.propertyId,
        color: STATUS.otaBlock.color,
        readOnly: true,
        data: { kind: "otaBlock", ...block },
      }));

    return [...bookingEvents, ...hostBlockEvents, ...otaBlockEvents];
  }, [data, villa, showCancelled]);

  function openFromSearch(booking: AdminBooking) {
    if (villa !== "all" && villa !== booking.propertyId) setVilla("all");
    if (booking.status === "cancelled") setShowCancelled(true);
    setSelectedId(booking._id);
  }

  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6">
      <div className="border border-border bg-card [&_*]:border-border">
        <EventCalendar<EventData>
          events={events}
          defaultView="month"
          views={["month", "resource", "agenda"]}
          resources={resources}
          dayStartHour={8}
          dayEndHour={20}
          interval={60}
          i18n={CALENDAR_I18N}
          interactions={{ drag: false, resize: false, selectSlot: false }}
          onEventClick={(occurrence) => {
            const eventData = occurrence.event.data;
            if (eventData?.kind === "booking") setSelectedId(eventData.booking._id);
            else if (eventData?.kind === "hostBlock") setBlockTarget({ kind: "host", block: eventData.block });
            else if (eventData?.kind === "otaBlock") setBlockTarget({ ...eventData, kind: "ota" });
          }}
          onRangeChange={({ range: visible }) =>
            setRange({ from: isoDate(visible.start), to: isoDate(addDays(visible.end, 1)) })
          }
          className="h-[calc(100dvh-190px)] min-h-[560px] w-full"
        >
          <AdminCalendarHeader>
            <GuestSearch properties={data?.properties ?? []} onPick={openFromSearch} />
            <Select value={villa} onValueChange={setVilla}>
              <SelectTrigger className="h-9 min-w-0 flex-1 rounded-lg sm:w-48 sm:flex-none" aria-label="Villa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All villas</SelectItem>
                {data?.properties.map((p) => (
                  <SelectItem key={p._id} value={p._id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant={showCancelled ? "secondary" : "outline"}
              aria-pressed={showCancelled}
              onClick={() => setShowCancelled((value) => !value)}
            >
              Show cancelled
            </Button>
            {data === undefined ? (
              <Loader2 role="status" aria-label="Loading" className="size-4 animate-spin text-gold" />
            ) : null}
            <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
              <Button size="sm" variant="outline" onClick={() => setManagingCalendars(true)} disabled={!data}>
                OTA calendars
              </Button>
              <Button size="sm" variant="outline" onClick={() => setManagingRates(true)} disabled={!data}>
                OTA rates
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBlockTarget({ kind: "new" })} disabled={!data}>
                Block dates
              </Button>
              <Button size="sm" onClick={() => setCreating(true)} disabled={!data}>
                <PlusIcon aria-hidden="true" className="size-4" />
                New booking
              </Button>
            </div>
          </AdminCalendarHeader>
          <EventCalendarContent />
        </EventCalendar>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {Object.values(STATUS).map((status) => (
            <span key={status.label} className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
              {status.label}
            </span>
          ))}
        </div>
      </div>

      <BookingSheet bookingId={selectedId} properties={data?.properties ?? []} onClose={() => setSelectedId(null)} />
      {data && blockTarget ? (
        <DateBlockDialog target={blockTarget} properties={data.properties} onClose={() => setBlockTarget(null)} />
      ) : null}
      {data ? (
        <IcalSourcesDialog open={managingCalendars} onClose={() => setManagingCalendars(false)} properties={data.properties} />
      ) : null}
      {data ? (
        <OtaRatesDialog open={managingRates} onClose={() => setManagingRates(false)} properties={data.properties} />
      ) : null}
      {data && creating ? (
        <NewBookingDialog
          properties={data.properties.filter((p) => p.status === "active")}
          onClose={() => setCreating(false)}
          onCreated={(id) => {
            setCreating(false);
            setSelectedId(id);
          }}
        />
      ) : null}
    </div>
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
  const results = useQuery(api.adminBookings.searchBookings, active ? { query } : "skip");
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
                    <span className="flex items-center gap-2 font-medium">
                      <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ backgroundColor: STATUS[statusKey(booking)].color }} />
                      {booking.guestName}
                      <span className="font-normal text-muted-foreground">· {STATUS[statusKey(booking)].label}</span>
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

function NewBookingDialog({
  properties,
  onClose,
  onCreated,
}: {
  properties: AdminProperty[];
  onClose: () => void;
  onCreated: (id: Id<"bookings">) => void;
}) {
  const createBooking = useMutation(api.adminBookings.createBooking);
  const [propertySlug, setPropertySlug] = useState(properties[0]?.slug ?? "");
  const [dates, setDates] = useState({ checkIn: "", checkOut: "" });
  const [confirmed, setConfirmed] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Same date rules as the public booking flow: no past dates, no blocked nights.
  const today = todayIsoLocal();
  const property = properties.find((p) => p.slug === propertySlug);
  const blockedDates =
    useQuery(
      api.availability.getBlockedDates,
      property ? { propertyId: property._id, startDate: today, endDate: addDaysIso(today, 365) } : "skip",
    ) ?? [];
  const blockedDateSet = new Set(blockedDates);
  const conflicts = rangeIntersectsDates(blockedDates, dates.checkIn, dates.checkOut);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setSaving(true);
    setError("");
    try {
      const id = await createBooking({
        propertySlug,
        guestName: text("guestName"),
        guestPhone: text("guestPhone"),
        guestEmail: text("guestEmail") || undefined,
        checkIn: dates.checkIn,
        checkOut: dates.checkOut,
        guests: Number(text("guests")),
        confirmed,
      });
      onCreated(id);
    } catch (err) {
      setError(errorText(err, "Could not create the booking."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>For phone or walk-in guests. Manual bookings never expire automatically.</DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="grid gap-4">
          <div className="grid gap-2">
            <Label>Villa</Label>
            <Select value={propertySlug} onValueChange={setPropertySlug}>
              <SelectTrigger className="rounded-lg" aria-label="Villa">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {properties.map((p) => (
                  <SelectItem key={p._id} value={p.slug}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <BookingRangePicker
            checkIn={dates.checkIn}
            checkOut={dates.checkOut}
            onChange={setDates}
            isDateDisabled={(date) => dateToIso(date) < today || isDateInIsoList(date, blockedDateSet)}
            unavailableDates={blockedDates}
          />
          {conflicts ? (
            <p className="text-sm text-destructive">These dates overlap an existing booking or block.</p>
          ) : null}
          <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-3">
            <div className="grid gap-2">
              <Label htmlFor="nb-name">Guest name</Label>
              <Input id="nb-name" name="guestName" required />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="nb-guests">Guests</Label>
              <Input id="nb-guests" name="guests" type="number" min={1} max={property?.maxGuests} defaultValue={2} required />
            </div>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nb-phone">Phone</Label>
            <Input id="nb-phone" name="guestPhone" type="tel" required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="nb-email">Email (optional)</Label>
            <Input id="nb-email" name="guestEmail" type="email" />
          </div>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-0.5 size-4 accent-foreground"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
            />
            <span>
              Create as confirmed
              <span className="block text-muted-foreground">
                Holds the dates now and emails the guest. Unticked, it stays pending and the dates stay open until you confirm.
              </span>
            </span>
          </label>
          {property && dates.checkIn && dates.checkOut && !conflicts ? (
            <p className="text-sm text-muted-foreground">
              {money(property.pricePerNight, property.currency)} per night
              {property.directDiscountPercent ? `, ${property.directDiscountPercent}% direct discount` : ""}
            </p>
          ) : null}
          {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" disabled={saving || !propertySlug || !dates.checkIn || !dates.checkOut || conflicts}>
              {saving ? <Loader2 className="size-4 animate-spin" /> : null}
              Create booking
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
