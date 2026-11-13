"use client";

import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { useRouter } from "next/navigation";
import { createContext, createElement, useCallback, useContext, type ReactNode } from "react";
import type { CheckoutActions, CheckoutBackend } from "@/components/checkout/backend";
import { orderPath } from "@/components/checkout/checkout-source";
import { DAY_MS, errorText, resortMidnight } from "@/lib/staff-bookings";

/*
 * A stay's unpaid spa appointments, and checking the stay out with them.
 *
 * UI seam: there is no backend read for "this stay's appointments" yet, so the list comes from
 * adminServices.listSchedule over the stay's own days (listSchedule serves at most 14 days; a
 * longer stay reports `complete: false`). A dedicated query by booking (by_booking index) should
 * replace it; see the P5 report.
 */

/** listSchedule's limit. */
const MAX_SCHEDULE_DAYS = 14;

type Appointment = Doc<"serviceAppointments">;
type StayRef = { _id: Id<"bookings">; checkIn: string; checkOut: string; currency: string };

export type StaySpa = {
  /** Unpaid, chargeable appointments booked on this stay, earliest first. */
  appointments: Appointment[];
  total: number;
  /** False when the stay is longer than one schedule read covers, so some may be missing. */
  complete: boolean;
};

/** Booked or done, not yet paid: what checkout can still charge (as pos.appointmentAttachable). */
export function spaChargeable(appointment: Pick<Appointment, "status" | "paymentStatus">) {
  return appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" && appointment.status !== "no_show";
}

/** undefined while loading, or with no stay. */
export function useStaySpa(stay: StayRef | null | undefined): StaySpa | undefined {
  const from = stay ? resortMidnight(stay.checkIn) : 0;
  const end = stay ? resortMidnight(stay.checkOut) + DAY_MS : 0;
  const to = Math.min(end, from + MAX_SCHEDULE_DAYS * DAY_MS);
  const schedule = useQuery(api.adminServices.listSchedule, stay && to > from ? { from, to } : "skip");
  if (!stay || !schedule) return undefined;
  const appointments = schedule.appointments.filter(
    (a) => a.bookingId === stay._id && spaChargeable(a) && a.currency === stay.currency,
  );
  const total = Math.round(appointments.reduce((sum, a) => sum + a.price, 0) * 100) / 100;
  return { appointments, total, complete: end <= to };
}

type DeskActions = Pick<CheckoutActions, "openOrderFor" | "attach">;
const DeskCheckoutContext = createContext<DeskActions | null>(null);

/** Desk screens open orders on this checkout backend instead of Convex (browser fixtures). */
export function DeskCheckoutProvider({ backend, children }: { backend: CheckoutBackend; children: ReactNode }) {
  const { openOrderFor, attach } = backend.useActions();
  return createElement(DeskCheckoutContext.Provider, { value: { openOrderFor, attach } }, children);
}

/**
 * Opens checkout for a stay. Without spa appointments it is the plain `?booking=` link (checkout
 * opens or reuses the stay's order). With them, the stay's order is opened the same way
 * (pos.openOrderFor) and each appointment is added to it (pos.attach) before checkout opens on
 * that order. Nothing is paid here; the existing permission and revision checks run server-side.
 * Returns the problems, if any; then checkout is not opened.
 */
export function useStayCheckout() {
  const fixture = useContext(DeskCheckoutContext);
  const convexOpen = useMutation(api.pos.openOrderFor);
  const convexAttach = useMutation(api.pos.attach);
  const openOrderFor = fixture?.openOrderFor ?? convexOpen;
  const attach = fixture?.attach ?? convexAttach;
  const router = useRouter();
  return useCallback(
    async (bookingId: Id<"bookings">, spa: readonly Appointment[]): Promise<string[]> => {
      if (spa.length === 0) {
        router.push(`/admin/checkout?booking=${bookingId}`);
        return [];
      }
      const { orderId } = await openOrderFor({ bookingId });
      const problems: string[] = [];
      for (const appointment of spa) {
        try {
          await attach({ orderId, appointmentId: appointment._id });
        } catch (err) {
          const message = errorText(err, "Couldn't add it to the order.");
          // Opened twice, or from two devices: it is already where it should be.
          if (!/already on this order/i.test(message)) problems.push(`${appointment.serviceNameSnapshot ?? "Spa"}: ${message}`);
        }
      }
      if (problems.length === 0) router.push(orderPath(orderId));
      return problems;
    },
    [attach, openOrderFor, router],
  );
}
