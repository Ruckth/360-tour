"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { CreditCard, ShieldCheck } from "lucide-react";
import { useState } from "react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { useOptionalConvex } from "@/lib/react/convex";

export function PayClient() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const convex = useOptionalConvex();
  const bookingId = searchParams.get("bookingId") ?? "demo";
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function confirmPayment() {
    setLoading(true);
    setError("");
    try {
      if (convex && bookingId !== "demo") {
        await convex.mutation(api.bookings.confirmDemoPayment, {
          bookingId,
        } as never);
      }
      router.push(`/booking/success?bookingId=${bookingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Payment could not be confirmed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
      <div className="w-full rounded-2xl border border-border bg-card p-6 shadow-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10">
          <CreditCard className="h-6 w-6 text-gold" />
        </div>
        <h1 className="mt-5 font-serif text-3xl font-semibold text-foreground">
          Confirm demo payment
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          This migration keeps the booking flow testable locally. Confirming
          marks the booking as paid when Convex is connected, then sends you to
          the success screen.
        </p>
        <div className="mt-5 flex items-center gap-2 rounded-xl bg-muted p-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-4 w-4 text-gold" />
          Booking ID: {bookingId}
        </div>
        {error ? <p className="mt-4 text-sm text-destructive">{error}</p> : null}
        <div className="mt-6 grid gap-3">
          <Button onClick={confirmPayment} disabled={loading}>
            {loading ? "Confirming..." : "Confirm Payment"}
          </Button>
          <Link
            href="/booking"
            className="text-center text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Back to booking
          </Link>
        </div>
      </div>
    </div>
  );
}
