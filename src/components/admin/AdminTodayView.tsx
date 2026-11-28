"use client";

import { api } from "convex/_generated/api";
import { useQueries } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { BedDouble, CalendarClock, MessageCircle, type LucideIcon } from "lucide-react";
import { useMemo, type ReactNode } from "react";
import { isOpenAppointmentStartingIn, resortMidnight, useResortBusinessDate } from "@/lib/staff-bookings";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import Link from "@/platform/link";
import { staffCalendarHref } from "@/lib/staff-links";
import { canOpenResortDesk } from "./admin-access";
import { useStaffAccess } from "./staff-access";
import { todayBookingArgs, todayGroups, type TodayGroup } from "./TodayStrip";
import { useSafeQueueCounts, waitingBadge } from "./waiting-chats";

const DAY_MS = 86_400_000;

/** A link to the exact list a count describes: Hotel opens with that Today group expanded. */
export function hotelTodayHref(group: TodayGroup) {
  return `/admin/hotel?today=${group}`;
}

function Tile({ title, icon: Icon, className, children }: { title: string; icon: LucideIcon; className?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className={cn("grid min-w-0 content-start gap-2 rounded-xl border border-border bg-card p-3 sm:p-4", className)}>
      <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground sm:text-base">
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
        {title}
      </h2>
      {children}
    </section>
  );
}

/** One count as a tappable stat: the label stays first so the link reads "Arriving 2". */
function CountLink({ href, label, count }: { href: string; label: string; count: number | string | undefined }) {
  return (
    <Link href={href} className="flex min-h-16 min-w-0 flex-col justify-between gap-1 rounded-lg bg-muted/40 px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
      <span className="text-muted-foreground">{label}</span>
      <span role="status" className={cn("font-semibold tabular-nums text-foreground", count !== undefined && !/[a-z]/i.test(String(count)) ? "text-2xl leading-none" : "text-sm")}>{count === undefined ? <><span className="sr-only">Loading count</span><Skeleton className="h-6 w-8" /></> : count}</span>
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
  const today = useResortBusinessDate();
  const start = resortMidnight(today);
  // Convex refreshes its subscription when the request object changes identity.
  const deskQueries = useMemo(() => ({
    ...(canOpenHotel ? { stays: { query: api.bookings.admin.listForAdmin, args: todayBookingArgs(today) } } : {}),
    ...(canOpenSpa ? { spa: { query: api.services.admin.listSchedule, args: { from: start, to: start + DAY_MS } } } : {}),
  }), [canOpenHotel, canOpenSpa, start, today]);
  const { stays: stayResult, spa: scheduleResult } = useQueries(deskQueries) as {
    stays?: FunctionReturnType<typeof api.bookings.admin.listForAdmin> | Error;
    spa?: FunctionReturnType<typeof api.services.admin.listSchedule> | Error;
  };
  const hotelFailed = stayResult instanceof Error;
  const spaFailed = scheduleResult instanceof Error;
  const stays = hotelFailed ? undefined : stayResult;
  const schedule = spaFailed ? undefined : scheduleResult;
  const queue = useSafeQueueCounts(canOpenChats);

  const groups = stays ? todayGroups(stays.bookings, today) : null;
  const appointments = schedule?.appointments.filter((appointment) => isOpenAppointmentStartingIn(appointment, start, start + DAY_MS));
  const waitingText = queue === undefined ? undefined : waitingBadge(queue?.waiting)?.text ?? (queue === null ? "Count unavailable" : "0");

  // Spa or Chats alone fills the row instead of leaving an empty half.
  const soloDesk = canOpenSpa !== canOpenChats;
  const hotelCount = (group: TodayGroup) => hotelFailed ? "Count unavailable" : groups ? stays?.complete === false ? `${groups[group].length} (partial)` : groups[group].length : undefined;

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4 px-4 py-4 sm:px-6">
      <p className="text-sm text-muted-foreground">Bangkok business date <time dateTime={today}>{today}</time></p>
      {!canOpenHotel && !canOpenSpa && !canOpenChats ? <p className="rounded-xl border p-4 text-sm">Your staff access has no Hotel, Spa or Chats queues on Today. Use the navigation to open your available workspaces.</p> : null}
      {/* Phones and tablets keep every count above the fold: Hotel is one row (or a 2×2 on
          phones) and Spa and Chats sit side by side; desktop fits all three tiles on one row. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {canOpenHotel ? (
          <Tile title="Hotel" icon={BedDouble} className="col-span-2">
            {stays?.complete === false ? <p role="status" className="text-xs text-muted-foreground">Some of today’s stays could not be loaded.</p> : null}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <CountLink href={hotelTodayHref("arriving")} label="Arriving" count={hotelCount("arriving")} />
              <CountLink href={hotelTodayHref("leaving")} label="Leaving" count={hotelCount("leaving")} />
              <CountLink href={hotelTodayHref("inHouse")} label="In house" count={hotelCount("inHouse")} />
              <CountLink href={hotelTodayHref("balanceDue")} label="Balance due" count={hotelCount("balanceDue")} />
            </div>
          </Tile>
        ) : null}
        {canOpenSpa ? (
          <Tile title="Spa" icon={CalendarClock} className={soloDesk ? "col-span-2" : undefined}>
            <CountLink href={staffCalendarHref({ date: today, openOnly: true })} label="Open appointments today" count={spaFailed ? "Count unavailable" : appointments?.length} />
          </Tile>
        ) : null}
        {canOpenChats ? (
          <Tile title="Chats" icon={MessageCircle} className={soloDesk ? "col-span-2" : undefined}>
            <CountLink href="/admin/chats" label={queue === null ? "Open chat queue" : "Needs you"} count={waitingText} />
          </Tile>
        ) : null}
      </div>
    </div>
  );
}
