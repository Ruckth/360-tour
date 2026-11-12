"use client";

import type { Id } from "convex/_generated/dataModel";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CustomerDisplayControl } from "@/components/admin/CustomerDisplayDialog";
import { useShowOrderOnDisplay } from "@/components/admin/useShowOrderOnDisplay";
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
  const opened = useRef<{ target: string } | null>(null);
  const [retry, setRetry] = useState(0);

  // ?booking= / ?appointment=: open (or reuse) its order, then switch the URL to ?order=.
  // If the cashier opens another order meanwhile (the URL changes), the late result is dropped.
  const target = source.kind === "booking" || source.kind === "appointment" ? `${source.kind}:${source.id}` : null;
  useEffect(() => {
    if (!target) {
      opened.current = null;
      return;
    }
    if (opened.current?.target === target) return;
    const attempt = { target };
    opened.current = attempt;
    const [kind, id] = target.split(":");
    const args = kind === "booking" ? { bookingId: id as Id<"bookings"> } : { appointmentId: id as Id<"appointments"> };
    openOrderFor(args).then(
      ({ orderId }) => opened.current === attempt && router.replace(orderPath(orderId)),
      (err: unknown) => opened.current === attempt && setOpenError({ target, message: errorText(err, "Couldn't open that booking at checkout.") }),
    );
  }, [target, openOrderFor, router, retry]);

  // Old `?bill=` links (from before orders) open the same order under its new URL.
  const legacyBill = source.kind === "order" && source.legacy ? source.id : null;
  useEffect(() => {
    if (legacyBill) router.replace(orderPath(legacyBill));
  }, [legacyBill, router]);

  const onOrderChange = useCallback(
    (orderId: OrderId | null) => router.replace(orderId ? orderPath(orderId) : "/admin/checkout"),
    [router],
  );
  // Paying, or opening an order that is already paid, moves on to the receipt in place: the paid
  // order's checkout URL would only redirect again, so Back from the receipt must not land there.
  const onPaid = useCallback((orderId: OrderId) => router.replace(receiptPath(orderId)), [router]);
  const orderId = source.kind === "order" ? (source.id as OrderId) : null;
  const linkFailed = openError?.target === target;
  // While a booking link is still opening its order, the display keeps what it shows (no welcome flash).
  const shownOrder = target && !linkFailed ? undefined : orderId;
  const display = useShowOrderOnDisplay(shownOrder);

  return (
    <CheckoutView
      orderId={orderId}
      onOrderChange={onOrderChange}
      onPaid={onPaid}
      onNoticeRetry={linkFailed ? () => {
        opened.current = null;
        setOpenError(null);
        setRetry((value) => value + 1);
      } : display.error ? display.retry : undefined}
      notice={source.kind === "invalid" ? source.reason : linkFailed ? openError.message : (display.error ?? undefined)}
      displayControl={<CustomerDisplayControl orderId={shownOrder} />}
    />
  );
}
