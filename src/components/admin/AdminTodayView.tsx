"use client";

import { api } from "convex/_generated/api";
import { useQuery } from "convex/react";
import { BedDouble, CalendarClock, MessageCircle, type LucideIcon } from "lucide-react";
import { type ReactNode } from "react";
import { isOpenAppointmentStartingIn, resortIsoDate, resortMidnight, useNow } from "@/lib/staff-bookings";
import { Skeleton } from "@/components/ui/skeleton";
import Link from "@/platform/link";
import { staffCalendarHref } from "@/lib/staff-links";
import { canOpenResortDesk } from "./admin-access";
import { useStaffAccess } from "./staff-access";
import { todayBookingArgs, todayGroups, type TodayGroup } from "./TodayStrip";
import { waitingBadge } from "./waiting-chats";

const DAY_MS = 86_400_000;

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
 * open its page. Hotel and Chats are the primary-resort desks, while Spa uses operations access.
 */
export function AdminTodayView() {
  const access = useStaffAccess();
  const canOpenHotel = canOpenResortDesk(access, "bookings");
  const canOpenChats = canOpenResortDesk(access, "chats");
  const canOpenSpa = access.capabilities.services;
  const today = resortIsoDate(useNow());
  const stays = useQuery(api.bookings.admin.listForAdmin, canOpenHotel ? todayBookingArgs(today) : "skip");
  const start = resortMidnight(today);
  const schedule = useQuery(api.services.admin.listSchedule, canOpenSpa ? { from: start, to: start + DAY_MS } : "skip");
  const queue = useQuery(api.messaging.adminChat.queueCounts, canOpenChats ? {} : "skip");

  const groups = stays ? todayGroups(stays.bookings, today) : null;
  const appointments = schedule?.appointments.filter((appointment) => isOpenAppointmentStartingIn(appointment, start, start + DAY_MS));
  const waitingText = queue === undefined ? undefined : waitingBadge(queue?.waiting)?.text ?? (queue === null ? "—" : "0");

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:px-6">
      <div className="grid gap-4 md:grid-cols-3">
        {canOpenHotel ? (
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
        {canOpenSpa ? (
          <Tile title="Spa" icon={CalendarClock}>
            <CountLink href={staffCalendarHref({ date: today, openOnly: true })} label="Open appointments today" count={appointments?.length} />
          </Tile>
        ) : null}
        {canOpenChats ? (
          <Tile title="Chats" icon={MessageCircle}>
            <CountLink href="/admin/chats" label="Needs you" count={waitingText} />
          </Tile>
        ) : null}
      </div>
    </div>
  );
}
