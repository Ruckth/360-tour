"use client";

import type { Id } from "convex/_generated/dataModel";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckoutBackendProvider, type OrderId } from "@/components/checkout/backend";
import { orderPath, parseCheckoutSource, receiptPath } from "@/components/checkout/checkout-source";
import { CheckoutView } from "@/components/checkout/CheckoutView";
import { convexCheckoutBackend } from "@/components/checkout/convex-backend";
import { errorText } from "@/lib/staff-bookings";

export default function AdminCheckoutPage() {
  return (
    <CheckoutBackendProvider backend={convexCheckoutBackend}>
      <CheckoutPage />
    </CheckoutBackendProvider>
  );
}

function CheckoutPage() {
  const router = useRouter();
  const params = useSearchParams();
  const source = parseCheckoutSource(params);
  const { openOrderFor } = convexCheckoutBackend.useActions();
  // The refused link's message, shown only while that link is the page's URL.
  const [openError, setOpenError] = useState<{ target: string; message: string } | null>(null);
  const opened = useRef<string | null>(null);
  const current = useRef<string | null>(null);

  // ?booking= / ?appointment=: open (or reuse) its order, then switch the URL to ?order=.
  // If the cashier opens another order meanwhile (the URL changes), the late result is dropped.
  const target = source.kind === "booking" || source.kind === "appointment" ? `${source.kind}:${source.id}` : null;
  useEffect(() => {
    current.current = target;
    if (!target || opened.current === target) return;
    opened.current = target;
    const [kind, id] = target.split(":");
    const args = kind === "booking" ? { bookingId: id as Id<"bookings"> } : { appointmentId: id as Id<"serviceAppointments"> };
    openOrderFor(args).then(
      ({ orderId }) => current.current === target && router.replace(orderPath(orderId)),
      (err: unknown) => current.current === target && setOpenError({ target, message: errorText(err, "Couldn't open that booking at checkout.") }),
    );
  }, [target, openOrderFor, router]);

  // Old `?bill=` links (from before orders) open the same order under its new URL.
  const legacyBill = source.kind === "order" && source.legacy ? source.id : null;
  useEffect(() => {
    if (legacyBill) router.replace(orderPath(legacyBill));
  }, [legacyBill, router]);

  const onOrderChange = useCallback(
    (orderId: OrderId | null) => router.replace(orderId ? orderPath(orderId) : "/admin/checkout"),
    [router],
  );
  const onPaid = useCallback((orderId: OrderId) => router.push(receiptPath(orderId)), [router]);

  return (
    <CheckoutView
      orderId={source.kind === "order" ? (source.id as OrderId) : null}
      onOrderChange={onOrderChange}
      onPaid={onPaid}
      notice={source.kind === "invalid" ? source.reason : openError?.target === target ? openError.message : undefined}
    />
  );
}
