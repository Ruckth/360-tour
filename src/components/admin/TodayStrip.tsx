"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { AdminBooking } from "convex/adminBookings";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { addDaysIso } from "@/lib/booking/dates";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney } from "./labels";
import { paymentText, serverTodayIso } from "./admin-bookings-shared";

export type TodayGroup = "arriving" | "leaving" | "inHouse" | "balanceDue";
const GROUPS: { key: TodayGroup; label: string }[] = [
  { key: "arriving", label: "Arriving" },
  { key: "leaving", label: "Leaving" },
  { key: "inHouse", label: "In house" },
  { key: "balanceDue", label: "Balance due" },
];

/**
 * Today's stays by where the guest is, from the dates alone (stays have no checked-in state):
 * arriving today, leaving today, staying on (arrived before today, leaving after), and any of
 * those not yet paid in full.
 */
export function todayGroups(bookings: readonly AdminBooking[], today: string): Record<TodayGroup, AdminBooking[]> {
  const live = bookings.filter((b) => b.status !== "cancelled").sort((a, b) => a.guestName.localeCompare(b.guestName));
  const arriving = live.filter((b) => b.checkIn === today);
  const leaving = live.filter((b) => b.checkOut === today);
  const inHouse = live.filter((b) => b.checkIn < today && b.checkOut > today);
  const balanceDue = [...leaving, ...inHouse, ...arriving].filter((b) => b.owed > 0);
  return { arriving, leaving, inHouse, balanceDue };
}

/** Arriving · Leaving · In house · Balance due. A tile lists its guests; a guest opens their stay's actions. */
export function TodayStrip({ villaName, onOpen }: { villaName: (id: string) => string; onOpen: (booking: AdminBooking, element: Element) => void }) {
  const today = serverTodayIso();
  // Stays touching today: from yesterday so a check-out today is included.
  const data = useQuery(api.adminBookings.listForAdmin, { from: addDaysIso(today, -1), to: addDaysIso(today, 1) });
  const [open, setOpen] = useState<TodayGroup | null>(null);
  const groups = data ? todayGroups(data.bookings, today) : null;
  const list = open && groups ? groups[open] : [];
  const owed = groups?.balanceDue.filter((b) => b.currency === "THB").reduce((sum, b) => sum + b.owed, 0) ?? 0;

  return (
    <section aria-label="Today" className="grid shrink-0 gap-2">
      <div className="grid grid-cols-4 gap-1.5 sm:gap-3">
        {GROUPS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-label={key === "balanceDue" ? `Due · Balance due ${groups ? formatMoney(owed, "THB") : "loading"}` : undefined}
            aria-expanded={open === key}
            aria-controls="today-list"
            disabled={!groups}
            onClick={() => setOpen((current) => (current === key ? null : key))}
            className={cn(
              "grid min-h-14 min-w-0 content-between gap-2 rounded-xl border border-border bg-card px-2 py-2 sm:min-h-20 sm:px-4 sm:py-4 text-start transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              open === key && "border-foreground/40 bg-muted",
            )}
          >
            <span className="flex items-center justify-between gap-1 text-xs leading-tight font-normal text-muted-foreground sm:text-xs">{key === "balanceDue" ? <><span className="sm:hidden">Due</span><span className="hidden sm:inline">{label}</span></> : label}<ChevronDown aria-hidden className={cn("size-3 shrink-0 transition-transform", open === key && "rotate-180")} /></span>
            {groups ? <span className="money font-sans text-lg leading-none font-semibold tracking-tight tabular-nums sm:text-[28px]">{key === "balanceDue" ? formatMoney(owed, "THB") : groups[key].length}</span> : <Skeleton className="h-6 w-10" />}

          </button>
        ))}
      </div>
      {open === "balanceDue" ? <p className="text-xs text-muted-foreground">Due from today’s guests</p> : null}
      {open ? (
        <ul id="today-list" aria-label={GROUPS.find((g) => g.key === open)!.label} className="grid gap-1 rounded-xl border border-border bg-card p-1 sm:grid-cols-2 lg:grid-cols-3">
          {list.length === 0 ? <li className="px-3 py-2 text-sm text-muted-foreground">No one today.</li> : null}
          {list.map((booking) => (
            <li key={booking._id}>
              <button
                type="button"
                className="grid min-h-11 w-full rounded-lg px-3 py-1.5 text-start text-sm hover:bg-muted focus-visible:bg-muted focus-visible:outline-none"
                onClick={(event) => onOpen(booking, event.currentTarget)}
              >
                <span className="truncate font-medium">{booking.guestName}</span>
                <span className="truncate text-xs text-muted-foreground">
                  {villaName(booking.propertyId)} · {paymentText(booking)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
