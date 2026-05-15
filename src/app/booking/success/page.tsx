import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

export default async function BookingSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ bookingId?: string }>;
}) {
  const { bookingId = "demo" } = await searchParams;

  return (
    <div className="mx-auto flex min-h-screen max-w-lg items-center px-5 py-24">
      <div className="w-full rounded-2xl border border-border bg-card p-6 text-center shadow-xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/10">
          <CheckCircle2 className="h-7 w-7 text-gold" />
        </div>
        <h1 className="mt-5 font-serif text-3xl font-semibold text-foreground">
          Booking confirmed
        </h1>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          Your reservation request is confirmed. The host can follow up with
          arrival details, airport pickup, and any special requests.
        </p>
        <p className="mt-4 rounded-xl bg-muted px-3 py-2 text-sm text-muted-foreground">
          Reference: {bookingId}
        </p>
        <div className="mt-6 grid gap-3">
          <Link
            href="/"
            className="inline-flex items-center justify-center rounded-lg bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
          >
            Return Home
          </Link>
          <Link
            href="/#villas"
            className="text-sm font-medium text-muted-foreground transition hover:text-foreground"
          >
            Explore more villas
          </Link>
        </div>
      </div>
    </div>
  );
}
