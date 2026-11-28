"use client";

import { useQuery } from "convex/react";
import { api } from "convex/_generated/api";
type AdminBooking = import("convex/server").FunctionReturnType<typeof import("convex/_generated/api").api.bookings.admin.listForAdmin>["bookings"][number];
import { ChevronDown } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { addDaysIso } from "@/lib/booking/dates";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatMoney } from "./labels";
import { canEditBooking, paymentText, serverTodayIso } from "./admin-bookings-shared";

import { Button } from "@/components/ui/button";
import { errorText } from "@/lib/staff-bookings";
import { useStayCheckout, useStaySpa } from "./stay-spa";

export type TodayGroup = "arriving" | "leaving" | "inHouse" | "balanceDue";
const GROUPS: { key: TodayGroup; label: string }[] = [
  { key: "arriving", label: "Arriving" },
  { key: "leaving", label: "Leaving" },
  { key: "inHouse", label: "In house" },
  { key: "balanceDue", label: "Balance due" },
];

export function todayGroups(bookings: readonly AdminBooking[], today: string): Record<TodayGroup, AdminBooking[]> {
  const live = bookings.filter((b) => b.status !== "cancelled").sort((a, b) => a.guestName.localeCompare(b.guestName));
  const arriving = live.filter((b) => !b.stayStatus && b.checkIn === today);
  const leaving = live.filter((b) => b.checkOut === today || (b.stayStatus === "checked_in" && b.checkOut < today));
  const inHouse = live.filter((b) => b.stayStatus === "checked_in" || (!b.stayStatus && b.checkIn < today && b.checkOut > today));
  const balanceDue = live.filter((b) => b.owed > 0 && (b.stayStatus === "checked_in" || (b.checkIn <= today && b.checkOut >= today)));
  return { arriving, leaving, inHouse, balanceDue };
}

/** Arriving · Leaving · In house · Balance due. A tile lists its guests; a guest opens their stay's actions. */
export function TodayStrip({ villaName, onOpen }: { villaName: (id: string) => string; onOpen: (booking: AdminBooking, element: Element) => void }) {
  const today = serverTodayIso();
  // Stays touching today: from yesterday so a check-out today is included.
  const data = useQuery(api.bookings.admin.listForAdmin, {
    from: addDaysIso(today, -1), to: addDaysIso(today, 1), bookingsOnly: true,
  });
  const [open, setOpen] = useState<TodayGroup | null>(null);
  const bookings = data?.bookings;
  const groups = useMemo(() => bookings ? todayGroups(bookings, today) : null, [bookings, today]);
  const list = open && groups ? groups[open] : [];
  const totals = new Map<string, number>();
  for (const booking of groups?.balanceDue ?? []) {
    totals.set(booking.currency, (totals.get(booking.currency) ?? 0) + booking.owed);
  }
  const amounts = [...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, amount]) => `${formatMoney(amount, currency)} ${currency}`);
  const balanceLabel = amounts.length ? amounts.join(", ") : "No balance due";

  return (
    <section aria-label="Today" className="grid shrink-0 gap-2">
      {data?.complete === false ? <p role="status" className="text-xs text-muted-foreground">Some of today’s stays could not be loaded.</p> : null}
      <div className="grid grid-cols-[1fr_1fr_1fr_1.7fr] gap-1.5 sm:grid-cols-4 sm:gap-3">
        {GROUPS.map(({ key, label }) => (
          <button
            key={key}
            type="button"
            aria-label={key === "balanceDue" ? `Balance due ${groups ? balanceLabel : "loading"}` : undefined}
            aria-expanded={open === key}
            aria-controls="today-list"
            disabled={!groups}
            onClick={() => setOpen((current) => (current === key ? null : key))}
            className={cn(
              "grid min-h-14 min-w-0 content-start gap-2 rounded-xl border border-border bg-card px-2 py-2 sm:min-h-20 sm:px-4 sm:py-4 text-start transition-colors hover:border-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60",
              open === key && "border-foreground/40 bg-muted",
            )}
          >
            <span className="flex items-center justify-between gap-0.5 whitespace-nowrap text-xs leading-tight font-normal text-muted-foreground sm:text-xs">{label}<ChevronDown aria-hidden className={cn("size-2.5 shrink-0 transition-transform sm:size-3", open === key && "rotate-180")} /></span>
            {groups ? <span className="money font-sans text-lg leading-none font-semibold tracking-tight tabular-nums sm:text-[28px]">{key === "balanceDue" ? amounts.length ? amounts.map((amount) => <span key={amount} className="block text-pretty wrap-anywhere">{amount}</span>) : "—" : groups[key].length}</span> : <Skeleton className="h-6 w-10" />}
            {key === "balanceDue" ? <span className="text-pretty text-xs text-muted-foreground">Today’s guests · all villas</span> : null}
          </button>
        ))}
      </div>
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
                  {villaName(booking.propertyId)} · {paymentText(booking)} · {booking.stayStatus === "checked_in" ? "Checked in" : booking.stayStatus === "checked_out" ? "Checked out" : "Scheduled"}
                </span>
              </button>
              {open === "balanceDue" && canEditBooking(booking) && booking.paymentStatus !== "failed" ? <StayPayment booking={booking} /> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function StayPayment({ booking }: { booking: AdminBooking }) {
  const detail = useQuery(api.bookings.admin.getForAdmin, { bookingId: booking._id });
  const spa = useStaySpa(booking);
  const checkout = useStayCheckout();
  const busy = useRef(false);
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState("");
  const ready = detail && canEditBooking(detail) && detail.paymentStatus !== "failed" && detail.money.owed > 0 && !detail.checkoutLive && spa?.complete;
  async function pay() {
    if (!ready || busy.current) return;
    busy.current = true;
    setOpening(true);
    setError("");
    try {
      setError((await checkout(booking._id)).join(" "));
    } catch (err) {
      setError(errorText(err, "Couldn't open checkout for this stay."));
    } finally {
      busy.current = false;
      setOpening(false);
    }
  }
  return (
    <div className="grid justify-items-start px-3 pb-2">
      <Button size="sm" disabled={!ready || opening} onClick={() => void pay()}>{opening ? "Opening checkout…" : "Take payment"}</Button>
      {detail?.checkoutLive ? <p className="text-xs">Guest checkout is in progress.</p> : null}
      {spa?.complete === false ? <p className="text-xs">Review linked appointments before collecting payment.</p> : null}
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
