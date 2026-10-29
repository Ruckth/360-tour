"use client";

import { useConvex } from "convex/react";
import { useEffect, useState } from "react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import {
  calendarMonths,
  monthOf,
  monthBounds,
  stayMonths,
} from "@/lib/booking/blocked-months";
import {
  dateToIso,
  nightsBetweenIso,
  rangeIntersectsDates,
  todayIsoLocal,
} from "@/lib/booking/dates";

/** One bounded calendar load shared by manual creation and editing, including historical stays. */
export function useAdminBookingDates(
  propertyId: Id<"properties"> | undefined,
  { checkIn, checkOut }: { checkIn: string; checkOut: string },
  excludeBookingId?: Id<"bookings">,
) {
  const today = todayIsoLocal();
  const [visibleMonth, setVisibleMonth] = useState(
    monthOf(checkOut || checkIn || today),
  );
  const nights = nightsBetweenIso(checkIn, checkOut);
  const validStay = nights > 0 && nights <= 365;
  // Never enumerate an arbitrary multi-year selection. The server enforces the same stay limit.
  const months = calendarMonths({
    visibleMonth,
    checkIn: validStay ? checkIn : "",
    checkOut: validStay ? checkOut : "",
    today,
    allowPast: true,
  });
  const { blockedDates, pendingMonths, failedMonths, retry } =
    useAdminBlockedMonths(propertyId, months, excludeBookingId);
  const unknownMonths = new Set([...pendingMonths, ...failedMonths]);
  const blocked = new Set(blockedDates);
  const conflicts = rangeIntersectsDates(blockedDates, checkIn, checkOut);
  const stayUnknown =
    validStay &&
    stayMonths(checkIn, checkOut).some((month) => unknownMonths.has(month));
  const dateError =
    checkIn && checkOut && !validStay
      ? nights > 365
        ? "A stay cannot exceed 365 nights."
        : "Check-out must be after check-in."
      : "";

  return {
    blockedDates,
    conflicts,
    dateError,
    canSubmit: Boolean(propertyId && validStay && !stayUnknown && !conflicts),
    loading: pendingMonths.length > 0,
    failed: failedMonths.length > 0,
    retry,
    onMonthChange: (month: Date) => setVisibleMonth(monthOf(dateToIso(month))),
    isDateDisabled: (date: Date) => {
      const iso = dateToIso(date);
      const month = monthOf(iso);
      return (
        !propertyId ||
        !months.includes(month) ||
        unknownMonths.has(month) ||
        blocked.has(iso)
      );
    },
  };
}

/** Keep only the requested villa-month subscriptions alive, including server-side errors and retry. */
function useAdminBlockedMonths(
  propertyId: Id<"properties"> | undefined,
  months: string[],
  excludeBookingId?: Id<"bookings">,
) {
  const client = useConvex();
  const [attempt, setAttempt] = useState(0);
  const monthsKey = months.join(",");
  const scope = `${propertyId}:${excludeBookingId}:${monthsKey}:${attempt}`;
  // Per month: blocked dates, null after an error or timeout, absent while loading.
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    results: Record<string, string[] | null>;
  }>({ scope: "", results: {} });

  useEffect(() => {
    if (!propertyId) return;
    let active = true;
    const publish = (month: string, result: string[] | null) => {
      if (!active) return;
      setSnapshot((previous) => ({
        scope,
        results: {
          ...(previous.scope === scope ? previous.results : {}),
          [month]: result,
        },
      }));
    };
    const cleanups = monthsKey.split(",").filter(Boolean).map((month) => {
      const watch = client.watchQuery(api.availability.getAdminBlockedDates, {
        propertyId,
        ...monthBounds(month),
        excludeBookingId,
      });
      // A slow month fails closed; a later live result still replaces it.
      const timeout = setTimeout(() => publish(month, null), 8000);
      const read = () => {
        try {
          const result = watch.localQueryResult();
          if (result === undefined) return;
          clearTimeout(timeout);
          publish(month, result);
        } catch {
          clearTimeout(timeout);
          publish(month, null);
        }
      };
      const unsubscribe = watch.onUpdate(read);
      read();
      return () => {
        clearTimeout(timeout);
        unsubscribe();
      };
    });
    return () => {
      active = false;
      cleanups.forEach((cleanup) => cleanup());
    };
  }, [client, propertyId, excludeBookingId, monthsKey, scope]);

  const results = snapshot.scope === scope ? snapshot.results : {};
  return {
    blockedDates: months.flatMap((month) => results[month] ?? []),
    pendingMonths: months.filter((month) => results[month] === undefined),
    failedMonths: months.filter((month) => results[month] === null),
    retry: () => setAttempt((current) => current + 1),
  };
}
