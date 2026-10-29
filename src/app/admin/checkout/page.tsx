"use client";

import type { Id } from "convex/_generated/dataModel";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { CheckoutBackendProvider, type BillId } from "@/components/checkout/backend";
import { parseCheckoutSource } from "@/components/checkout/checkout-source";
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
  const { openFor } = convexCheckoutBackend.useActions();
  // The refused link's message, shown only while that link is the page's URL.
  const [openError, setOpenError] = useState<{ target: string; message: string } | null>(null);
  const opened = useRef<string | null>(null);
  const current = useRef<string | null>(null);

  // ?booking= / ?appointment=: open (or reuse) that guest's bill, then switch the URL to ?bill=.
  // If the cashier opens another bill meanwhile (the URL changes), the late result is dropped.
  const target = source.kind === "booking" || source.kind === "appointment" ? `${source.kind}:${source.id}` : null;
  useEffect(() => {
    current.current = target;
    if (!target || opened.current === target) return;
    opened.current = target;
    const [kind, id] = target.split(":");
    const args = kind === "booking" ? { bookingId: id as Id<"bookings"> } : { appointmentId: id as Id<"serviceAppointments"> };
    openFor(args).then(
      ({ billId }) => current.current === target && router.replace(`/admin/checkout?bill=${billId}`),
      (err: unknown) => current.current === target && setOpenError({ target, message: errorText(err, "Couldn't open that booking at checkout.") }),
    );
  }, [target, openFor, router]);

  const onBillChange = useCallback(
    (billId: BillId | null) => router.replace(billId ? `/admin/checkout?bill=${billId}` : "/admin/checkout"),
    [router],
  );
  const onPaid = useCallback((billId: BillId) => router.push(`/admin/receipt/${billId}`), [router]);

  return (
    <CheckoutView
      billId={source.kind === "bill" ? (source.id as BillId) : null}
      onBillChange={onBillChange}
      onPaid={onPaid}
      notice={source.kind === "invalid" ? source.reason : openError?.target === target ? openError.message : undefined}
    />
  );
}
