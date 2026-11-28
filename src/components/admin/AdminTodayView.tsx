"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import { BedDouble, CalendarClock, MessageCircle, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { addDaysIso } from "@/lib/booking/dates";
import { resortMidnight } from "@/lib/staff-bookings";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "@/platform/link";
import { serverTodayIso } from "./admin-bookings-shared";
import { useStaffAccess } from "./staff-access";
import { todayGroups, type TodayGroup } from "./TodayStrip";
import { waitingBadge } from "./waiting-chats";

const DAY_MS = 86_400_000;
const OPEN_APPOINTMENT = new Set(["booked", "arrived", "in_service"]);

/** A link to the exact list a count describes: Hotel opens with that Today group expanded. */
export function hotelTodayHref(group: TodayGroup) {
  return `/admin/hotel?today=${group}`;
}

function Tile({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section aria-label={title} className="grid content-start gap-3 rounded-xl border border-border bg-card p-4">
      <h2 className="flex items-center gap-2 text-base font-semibold text-foreground">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function CountLink({ href, label, count }: { href: string; label: string; count: number | string | undefined }) {
  return (
    <Link href={href} className="flex min-h-11 items-center justify-between gap-3 rounded-lg px-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span>{label}</span>
      {count === undefined ? <Skeleton className="h-4 w-6" /> : <span className="font-semibold tabular-nums">{count}</span>}
    </Link>
  );
}

/**
 * Today for operations staff: each count comes from the same read model as the page it links to,
 * under that page's own server access check. A tile shows only when this person's capabilities
 * open its page; hotel, spa and chats carry no branch, so the counts are company-wide.
 */
export function AdminTodayView() {
  const { capabilities } = useStaffAccess();
  const today = serverTodayIso();
  const stays = useQuery(api.bookings.admin.listForAdmin, capabilities.bookings ? { from: addDaysIso(today, -1), to: addDaysIso(today, 1), bookingsOnly: true } : "skip");
  const start = resortMidnight(today);
  const schedule = useQuery(api.services.admin.listSchedule, capabilities.services ? { from: start, to: start + DAY_MS } : "skip");
  const waiting = useQuery(api.messaging.adminChat.waitingCount, capabilities.chats ? {} : "skip");

  const groups = useMemo(() => (stays ? todayGroups(stays.bookings, today) : null), [stays, today]);
  const appointments = schedule?.appointments.filter((appointment) => appointment.start >= start && appointment.start < start + DAY_MS && OPEN_APPOINTMENT.has(appointment.status));
  const waitingText = waiting === undefined ? undefined : waitingBadge(waiting)?.text ?? (waiting === null ? "—" : "0");

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:px-6">
      <div className="grid gap-4 md:grid-cols-3">
        {capabilities.bookings ? (
          <Tile title="Hotel" icon={BedDouble}>
            {stays?.complete === false ? <p role="status" className="text-xs text-muted-foreground">Some of today’s stays could not be loaded.</p> : null}
            <div className="grid">
              <CountLink href={hotelTodayHref("arriving")} label="Arriving" count={groups?.arriving.length} />
              <CountLink href={hotelTodayHref("leaving")} label="Leaving" count={groups?.leaving.length} />
              <CountLink href={hotelTodayHref("inHouse")} label="In house" count={groups?.inHouse.length} />
              <CountLink href={hotelTodayHref("balanceDue")} label="Balance due" count={groups?.balanceDue.length} />
            </div>
          </Tile>
        ) : null}
        {capabilities.services ? (
          <Tile title="Spa" icon={CalendarClock}>
            <CountLink href="/admin/staff/calendar" label="Appointments today" count={appointments?.length} />
          </Tile>
        ) : null}
        {capabilities.chats ? (
          <Tile title="Chats" icon={MessageCircle}>
            <CountLink href="/admin/chats" label="Needs you" count={waitingText} />
          </Tile>
        ) : null}
      </div>
    </div>
  );
}
