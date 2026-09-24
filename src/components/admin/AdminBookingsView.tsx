"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { AdminBooking } from "convex/adminBookings";
import { addDays, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from "date-fns";
import { Loader2, PlusIcon } from "lucide-react";
import { useMemo, useState, type FormEvent } from "react";
import { EventCalendar } from "@/components/reui/event-calendar/event-calendar";
import { EventCalendarContent } from "@/components/reui/event-calendar/event-calendar-content";
import type {
  CalendarEvent,
  EventCalendarResource,
} from "@/components/reui/event-calendar/event-calendar-types";
import { BookingRangePicker } from "@/components/booking/BookingDatePicker";
import { AdminCalendarHeader } from "@/components/admin/AdminCalendarHeader";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { addDaysIso, dateToIso, isDateInIsoList, rangeIntersectsDates, todayIsoLocal } from "@/lib/booking/dates";
import { IcalSourcesDialog } from './IcalSourcesDialog';

/** One source of truth for booking state: drives chip colours and the legend. */
const STATUS = {
  pending: { label: "Pending", color: "var(--color-amber-500)" },
  confirmed: { label: "Confirmed", color: "var(--color-blue-500)" },
  paid: { label: "Paid", color: "var(--color-emerald-500)" },
  cancelled: { label: "Cancelled", color: "var(--color-zinc-400)" },
  blocked: { label: "Blocked (iCal / host)", color: "var(--color-rose-500)" },
} as const;

type StatusKey = keyof typeof STATUS;

// Stable reference: the calendar rebuilds its settings when this object changes.
const CALENDAR_I18N = { viewNames: { resource: "Villas", agenda: "List" } };

const SOURCE_LABELS: Record<string, string> = {
  web: "Website",
  whatsapp: "WhatsApp",
  messenger: "Messenger",
  line: "LINE",
  instagram: "Instagram",
  admin: "Manual",
};

// Villa stays: afternoon check-in, late-morning check-out.
const CHECK_IN_TIME = "T14:00:00";
const CHECK_OUT_TIME = "T11:00:00";

type EventData = { kind: "booking"; booking: AdminBooking } | { kind: "block"; source: string };

type Property = { _id: Id<"properties">; slug: string; name: string; maxGuests: number };

function isoDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function statusKey(booking: AdminBooking): StatusKey {
  if (booking.status === "cancelled") return "cancelled";
  if (booking.paymentStatus === "paid") return "paid";
  if (booking.status === "confirmed" || booking.status === "completed") return "confirmed";
  return "pending";
}

function money(booking: AdminBooking) {
  return `${booking.currency} ${booking.total.toLocaleString()}`;
}

/** Collapses per-day block rows into contiguous ranges per villa. */
function blockRanges(blocks: Array<{ propertyId: string; date: string; source: string }>) {
  const ranges: Array<{ propertyId: string; start: string; end: string; source: string }> = [];
  const sorted = [...blocks].sort((a, b) =>
    a.propertyId === b.propertyId ? a.date.localeCompare(b.date) : a.propertyId.localeCompare(b.propertyId),
  );
  for (const block of sorted) {
    const last = ranges.at(-1);
    if (last && last.propertyId === block.propertyId && last.end === block.date) {
      last.end = isoDate(addDays(new Date(`${block.date}T00:00:00`), 1));
    } else {
      ranges.push({
        propertyId: block.propertyId,
        start: block.date,
        end: isoDate(addDays(new Date(`${block.date}T00:00:00`), 1)),
        source: block.source,
      });
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
  const [managingCalendars, setManagingCalendars] = useState(false);

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

    const blockEvents = blockRanges(data.blocks)
      .filter((b) => visible(b.propertyId))
      .map((block): CalendarEvent<EventData> => ({
        id: `block-${block.propertyId}-${block.start}`,
        title: `Blocked · ${names.get(block.propertyId) ?? "Villa"}`,
        start: new Date(`${block.start}T00:00:00`),
        end: new Date(`${block.end}T00:00:00`),
        allDay: true,
        resourceId: block.propertyId,
        color: STATUS.blocked.color,
        readOnly: true,
        data: { kind: "block", source: block.source },
      }));

    return [...bookingEvents, ...blockEvents];
  }, [data, villa, showCancelled]);

  const selected = data?.bookings.find((b) => b._id === selectedId) ?? null;
  const selectedVilla = data?.properties.find((p) => p._id === selected?.propertyId);

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
          }}
          onRangeChange={({ range: visible }) =>
            setRange({ from: isoDate(visible.start), to: isoDate(addDays(visible.end, 1)) })
          }
          className="h-[calc(100vh-190px)] min-h-[560px] w-full"
        >
          <AdminCalendarHeader>
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
            {data === undefined ? <Loader2 aria-label="Loading" className="size-4 animate-spin text-gold" /> : null}
            <div className="flex flex-wrap items-center gap-2 sm:ms-auto">
              <Button size="sm" variant="outline" onClick={() => setManagingCalendars(true)} disabled={!data}>
                OTA calendars
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

      <BookingSheet
        booking={selected}
        villaName={selectedVilla?.name}
        onClose={() => setSelectedId(null)}
      />
      {data ? (
        <IcalSourcesDialog open={managingCalendars} onClose={() => setManagingCalendars(false)} properties={data.properties} />
      ) : null}
      {data ? (
        <NewBookingDialog
          open={creating}
          properties={data.properties}
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

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words text-foreground">{children}</dd>
    </div>
  );
}

function BookingSheet({
  booking,
  villaName,
  onClose,
}: {
  booking: AdminBooking | null;
  villaName?: string;
  onClose: () => void;
}) {
  const updateBooking = useMutation(api.adminBookings.updateBooking);
  const resendBookingEmails = useMutation(api.adminBookings.resendBookingEmails);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function run(action: "confirm" | "cancel" | "markPaid") {
    if (!booking) return;
    if (action === "cancel" && !window.confirm("Cancel this booking and release its dates?")) return;
    setPending(action);
    setError("");
    try {
      await updateBooking({ bookingId: booking._id, action });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update the booking.");
    } finally {
      setPending(null);
    }
  }

  async function resendEmails() {
    if (!booking) return;
    setPending('resend');
    setError('');
    try { await resendBookingEmails({ bookingId: booking._id }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Could not queue emails.'); }
    finally { setPending(null); }
  }

  const status = booking ? STATUS[statusKey(booking)] : null;
  const isCancelled = booking?.status === "cancelled";

  return (
    <Sheet
      open={Boolean(booking)}
      onOpenChange={(open) => {
        if (!open) {
          setError("");
          onClose();
        }
      }}
    >
      <SheetContent className="w-full overflow-y-auto sm:max-w-md">
        {booking && status ? (
          <div className="grid gap-5">
            <div>
              <SheetTitle className="font-serif text-2xl font-semibold">{booking.guestName}</SheetTitle>
              <SheetDescription className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                <span className="size-2 rounded-full" style={{ backgroundColor: status.color }} />
                {status.label}
                {booking.confirmationCode ? ` · ${booking.confirmationCode}` : ""}
              </SheetDescription>
            </div>
            <dl className="divide-y divide-border border-y border-border">
              <Detail label="Villa">{villaName ?? "—"}</Detail>
              <Detail label="Stay">
                {booking.checkIn} → {booking.checkOut} ({booking.nights} nights)
              </Detail>
              <Detail label="Guests">{booking.guests}</Detail>
              <Detail label="Total">{money(booking)}</Detail>
              <Detail label="Payment">
                {booking.paymentStatus}
                {booking.paymentMethod ? ` (${booking.paymentMethod})` : ""}
              </Detail>
              <Detail label="Phone">{booking.guestPhone}</Detail>
              <Detail label="Email">{booking.guestEmail ?? "—"}</Detail>
              <Detail label="Source">
                <Badge variant="outline">{SOURCE_LABELS[booking.source] ?? booking.source}</Badge>
              </Detail>
            </dl>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            {!isCancelled ? (
              <div className="flex flex-wrap gap-2">
                {booking.status === "pending" ? (
                  <Button onClick={() => run("confirm")} disabled={pending !== null}>
                    {pending === "confirm" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Confirm
                  </Button>
                ) : null}
                {booking.paymentStatus !== "paid" ? (
                  <Button variant="secondary" onClick={() => run("markPaid")} disabled={pending !== null}>
                    {pending === "markPaid" ? <Loader2 className="size-4 animate-spin" /> : null}
                    Mark paid
                  </Button>
                ) : null}
                {booking.status === 'confirmed' ? (
                  <Button variant="outline" onClick={resendEmails} disabled={pending !== null}>
                    {pending === 'resend' ? <Loader2 className="size-4 animate-spin" /> : null}
                    Resend emails
                  </Button>
                ) : null}
                <Button variant="outline" onClick={() => run("cancel")} disabled={pending !== null}>
                  {pending === "cancel" ? <Loader2 className="size-4 animate-spin" /> : null}
                  Cancel booking
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function NewBookingDialog({
  open,
  properties,
  onClose,
  onCreated,
}: {
  open: boolean;
  properties: Property[];
  onClose: () => void;
  onCreated: (id: Id<"bookings">) => void;
}) {
  const createBooking = useMutation(api.adminBookings.createBooking);
  const [propertySlug, setPropertySlug] = useState(properties[0]?.slug ?? "");
  const [dates, setDates] = useState({ checkIn: "", checkOut: "" });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // Same date rules as the public booking flow: no past dates, no blocked nights.
  const today = todayIsoLocal();
  const propertyId = properties.find((p) => p.slug === propertySlug)?._id;
  const blockedDates =
    useQuery(
      api.availability.getBlockedDates,
      propertyId ? { propertyId, startDate: today, endDate: addDaysIso(today, 365) } : "skip",
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
      });
      onCreated(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the booking.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError("");
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New booking</DialogTitle>
          <DialogDescription>For phone or walk-in guests. It starts as pending.</DialogDescription>
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
              <Input id="nb-guests" name="guests" type="number" min={1} defaultValue={2} required />
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
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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
