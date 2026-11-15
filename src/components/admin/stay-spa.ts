"use client";
import { roundMoney } from "convex/shared/money";


import { useMutation, useQuery } from "convex/react";
import { api } from "convex/_generated/api";
import type { Id } from "convex/_generated/dataModel";
import type { FunctionReturnType } from "convex/server";
import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { orderPath } from "@/components/checkout/checkout-source";

type Appointment = FunctionReturnType<typeof api.bookings.admin.stayAppointments>["appointments"][number];
type StayRef = { _id: Id<"bookings">; currency: string };

export type StaySpa = {
  /** Unpaid, chargeable appointments booked on this stay, earliest first. */
  appointments: Appointment[];
  total: number;
  /** False when the bounded stay read found more appointments than it can display. */
  complete: boolean;
};

/** Booked or done, not yet paid: what checkout can still charge (as pos.appointmentAttachable). */
export function spaChargeable(appointment: Pick<Appointment, "status" | "paymentStatus">) {
  return appointment.paymentStatus === "unpaid" && appointment.status !== "cancelled" && appointment.status !== "no_show";
}

/** undefined while loading, or with no stay. */
export function useStaySpa(stay: StayRef | null | undefined): StaySpa | undefined {
  const result = useQuery(api.bookings.admin.stayAppointments, stay ? { bookingId: stay._id } : "skip");
  if (!stay || !result) return undefined;
  const appointments = result.appointments.filter((a) => spaChargeable(a) && a.currency === stay.currency);
  const total = roundMoney(appointments.reduce((sum, a) => sum + a.price, 0));
  return { appointments, total, complete: result.complete };
}

/** One transaction opens the stay's order and attaches its appointments before navigation. */
export function useStayCheckout() {
  const openStayCheckout = useMutation(api.pos.commands.openStayCheckout.openStayCheckout);
  const router = useRouter();
  return useCallback(
    async (bookingId: Id<"bookings">): Promise<string[]> => {
      const { orderId, skipped } = await openStayCheckout({ bookingId });
      // Paid/cancelled appointments and rows already on this order need no action from staff.
      const problems = skipped.filter(({ reason }) => !/already on this order|nothing left to pay/i.test(reason)).map(({ reason }) => reason);
      if (problems.length === 0) router.push(orderPath(orderId));
      return problems;
    },
    [openStayCheckout, router],
  );
}
