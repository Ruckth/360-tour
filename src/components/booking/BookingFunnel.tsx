"use client";

import Image from "next/image";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft, CreditCard, Mail, Phone, Shield, User } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { api } from "convex/_generated/api";
import { Button } from "@/components/ui/Button";
import { useOptionalConvex } from "@/lib/react/convex";
import { properties as demoProperties, type Property } from "@/lib/data/properties";
import { resort } from "@/lib/data/resort-config";
import { cn } from "@/lib/utils";

type Step = "select" | "guests" | "info" | "review";
type BookingProperty = Property & {
  _id?: string;
  slug: string;
  currency: string;
  directDiscountPercent: number;
  source: "live" | "demo";
};

const steps: { key: Step; label: string }[] = [
  { key: "select", label: "Villa & Dates" },
  { key: "guests", label: "Guests" },
  { key: "info", label: "Details" },
  { key: "review", label: "Pay" },
];

const demoInventory: BookingProperty[] = demoProperties.map((property) => ({
  ...property,
  slug: property.id,
  currency: resort.currency,
  directDiscountPercent: 15,
  source: "demo",
}));

function nightsBetween(checkIn: string, checkOut: string) {
  if (!checkIn || !checkOut) return 0;
  return Math.max(
    0,
    Math.round((new Date(checkOut).getTime() - new Date(checkIn).getTime()) / 86400000),
  );
}

export function BookingFunnel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const convex = useOptionalConvex();
  const [step, setStep] = useState<Step>("select");
  const [propertyList, setPropertyList] = useState<BookingProperty[]>(demoInventory);
  const [selectedId, setSelectedId] = useState(searchParams.get("unit") ?? searchParams.get("property") ?? "garden-suite");
  const [checkIn, setCheckIn] = useState(searchParams.get("checkin") ?? "");
  const [checkOut, setCheckOut] = useState(searchParams.get("checkout") ?? "");
  const [guests, setGuests] = useState(Number(searchParams.get("guests") ?? "1"));
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestPhone, setGuestPhone] = useState("");
  const [notice, setNotice] = useState("Live availability is not connected yet, so demo inventory is ready.");
  const [blockedByProperty, setBlockedByProperty] = useState<Record<string, string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!convex) return;
    const client = convex;
    let active = true;
    async function load() {
      try {
        const rows = (await client.query(api.properties.list, {} as never)) as Array<
          Omit<BookingProperty, "id" | "source"> & { _id: string; slug: string }
        >;
        if (!active) return;
        if (rows.length) {
          setPropertyList(
            rows.map((row) => ({
              id: row.slug,
              slug: row.slug,
              _id: row._id,
              name: row.name,
              tagline: row.tagline,
              description: row.description,
              pricePerNight: row.pricePerNight,
              maxGuests: row.maxGuests,
              bedrooms: row.bedrooms,
              bathrooms: row.bathrooms,
              area: row.area,
              images: row.images,
              amenities: row.amenities,
              tourRoomIds: row.tourRoomIds,
              currency: row.currency,
              directDiscountPercent: row.directDiscountPercent,
              source: "live",
            })),
          );
          setNotice("");
        }
        const blocked = (await client.query(api.availability.getBlockedDatesByProperty, {} as never)) as Record<string, string[]>;
        if (active) setBlockedByProperty(blocked ?? {});
      } catch {
        if (active) setNotice("Live inventory is temporarily unavailable, so this page is using demo pricing.");
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [convex]);

  const property = propertyList.find((item) => item.slug === selectedId) ?? propertyList[0];
  const nights = nightsBetween(checkIn, checkOut);
  const subtotal = property.pricePerNight * nights;
  const discount = Math.round(subtotal * (property.directDiscountPercent / 100));
  const total = subtotal - discount;
  const blockedDates = property._id ? blockedByProperty[property._id] ?? [] : [];
  const conflicts = useMemo(
    () => Boolean(checkIn && checkOut && blockedDates.some((date) => date >= checkIn && date < checkOut)),
    [blockedDates, checkIn, checkOut],
  );
  const infoValid =
    guestName.trim().length >= 2 &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(guestEmail) &&
    guestPhone.trim().length >= 6;

  async function submitBooking() {
    setError("");
    if (!property || !checkIn || !checkOut || !nights || conflicts || !infoValid) {
      setError("Please complete valid dates and guest details before payment.");
      return;
    }
    setSubmitting(true);
    try {
      let bookingId = "demo";
      if (convex) {
        const snapshot = {
          name: property.name,
          tagline: property.tagline,
          description: property.description,
          pricePerNight: property.pricePerNight,
          currency: property.currency,
          maxGuests: property.maxGuests,
          bedrooms: property.bedrooms,
          bathrooms: property.bathrooms,
          area: property.area,
          images: property.images,
          amenities: property.amenities,
          tourRoomIds: property.tourRoomIds,
          directDiscountPercent: property.directDiscountPercent,
        };
        bookingId = (await convex.mutation(api.bookings.create, {
          propertySlug: property.slug,
          guestName,
          guestEmail,
          guestPhone,
          checkIn,
          checkOut,
          guests,
          propertySnapshot: snapshot,
        } as never)) as string;
      }
      router.push(`/booking/pay?bookingId=${bookingId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create booking.");
    } finally {
      setSubmitting(false);
    }
  }

  function canContinue() {
    if (step === "select") return Boolean(property && checkIn && checkOut && nights > 0 && !conflicts);
    if (step === "guests") return guests >= 1 && guests <= property.maxGuests;
    if (step === "info") return infoValid;
    return true;
  }

  function next() {
    const index = steps.findIndex((item) => item.key === step);
    setStep(steps[Math.min(steps.length - 1, index + 1)].key);
  }

  function previous() {
    const index = steps.findIndex((item) => item.key === step);
    setStep(steps[Math.max(0, index - 1)].key);
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-24 md:px-6">
      <div className="mb-8">
        <p className="text-xs font-semibold uppercase tracking-[0.25em] text-gold">
          Direct Booking
        </p>
        <h1 className="mt-3 font-serif text-4xl font-semibold text-foreground">
          Reserve your villa
        </h1>
        {notice ? <p className="mt-3 text-sm text-muted-foreground">{notice}</p> : null}
      </div>

      <div className="grid gap-8 lg:grid-cols-[1fr_360px]">
        <section className="rounded-2xl border border-border bg-card p-5 md:p-7">
          <div className="mb-6 grid grid-cols-4 gap-2">
            {steps.map((item, index) => (
              <button
                key={item.key}
                type="button"
                onClick={() => setStep(item.key)}
                className={cn(
                  "rounded-lg px-2 py-2 text-xs font-semibold transition",
                  steps.findIndex((candidate) => candidate.key === step) >= index
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          {step === "select" ? (
            <div className="space-y-5">
              <div className="grid gap-3 md:grid-cols-3">
                {propertyList.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => setSelectedId(item.slug)}
                    className={cn(
                      "overflow-hidden rounded-xl border text-left transition",
                      selectedId === item.slug ? "border-gold ring-2 ring-gold/30" : "border-border hover:border-gold/50",
                    )}
                  >
                    <div className="relative aspect-[4/3]">
                      <Image src={item.images[0]} alt={item.name} fill className="object-cover" />
                    </div>
                    <div className="p-3">
                      <p className="text-sm font-semibold text-foreground">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {resort.currencySymbol}
                        {item.pricePerNight.toLocaleString()}/night
                      </p>
                    </div>
                  </button>
                ))}
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <label className="text-sm font-medium text-foreground">
                  Check-in
                  <input
                    type="date"
                    value={checkIn}
                    min={new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setCheckIn(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2"
                  />
                </label>
                <label className="text-sm font-medium text-foreground">
                  Check-out
                  <input
                    type="date"
                    value={checkOut}
                    min={checkIn || new Date().toISOString().slice(0, 10)}
                    onChange={(event) => setCheckOut(event.target.value)}
                    className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2"
                  />
                </label>
              </div>
              {conflicts ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  Some selected dates are blocked. Please choose another range.
                </p>
              ) : null}
            </div>
          ) : null}

          {step === "guests" ? (
            <div>
              <h2 className="text-xl font-semibold text-foreground">Guests</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                {property.name} hosts up to {property.maxGuests} guests.
              </p>
              <div className="mt-6 flex items-center gap-4">
                <Button variant="outline" onClick={() => setGuests(Math.max(1, guests - 1))}>
                  -
                </Button>
                <span className="min-w-24 text-center text-lg font-semibold">
                  {guests} guest{guests > 1 ? "s" : ""}
                </span>
                <Button variant="outline" onClick={() => setGuests(Math.min(property.maxGuests, guests + 1))}>
                  +
                </Button>
              </div>
            </div>
          ) : null}

          {step === "info" ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">Guest details</h2>
              {[
                { icon: User, label: "Full name", value: guestName, set: setGuestName, type: "text" },
                { icon: Mail, label: "Email", value: guestEmail, set: setGuestEmail, type: "email" },
                { icon: Phone, label: "Phone", value: guestPhone, set: setGuestPhone, type: "tel" },
              ].map((field) => {
                const Icon = field.icon;
                return (
                  <label key={field.label} className="block text-sm font-medium text-foreground">
                    {field.label}
                    <div className="mt-1 flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2">
                      <Icon className="h-4 w-4 text-muted-foreground" />
                      <input
                        type={field.type}
                        value={field.value}
                        onChange={(event) => field.set(event.target.value)}
                        className="min-w-0 flex-1 bg-transparent outline-none"
                      />
                    </div>
                  </label>
                );
              })}
            </div>
          ) : null}

          {step === "review" ? (
            <div className="space-y-4">
              <h2 className="text-xl font-semibold text-foreground">Review and pay</h2>
              <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
                {property.name}, {guests} guest{guests > 1 ? "s" : ""}, {nights} night
                {nights > 1 ? "s" : ""}, {checkIn} to {checkOut}.
              </div>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Shield className="h-4 w-4 text-gold" />
                Demo payment creates a pending booking and then confirms it on the next screen.
              </div>
            </div>
          ) : null}

          {error ? <p className="mt-5 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p> : null}

          <div className="mt-8 flex justify-between gap-3">
            <Button variant="outline" onClick={previous} disabled={step === "select"}>
              <ArrowLeft className="h-4 w-4" />
              Back
            </Button>
            {step === "review" ? (
              <Button onClick={submitBooking} disabled={submitting}>
                <CreditCard className="h-4 w-4" />
                {submitting ? "Creating..." : "Continue to Pay"}
              </Button>
            ) : (
              <Button onClick={next} disabled={!canContinue()}>
                Continue
              </Button>
            )}
          </div>
        </section>

        <aside className="h-fit rounded-2xl border border-border bg-card p-5 shadow-lg">
          <div className="relative aspect-[4/3] overflow-hidden rounded-xl">
            <Image src={property.images[0]} alt={property.name} fill className="object-cover" />
          </div>
          <h2 className="mt-4 font-serif text-2xl font-semibold text-foreground">
            {property.name}
          </h2>
          <div className="mt-4 space-y-2 text-sm text-muted-foreground">
            <div className="flex justify-between">
              <span>{resort.currencySymbol}{property.pricePerNight.toLocaleString()} x {nights || 0}</span>
              <span>{resort.currencySymbol}{subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gold">
              <span>Direct discount</span>
              <span>-{resort.currencySymbol}{discount.toLocaleString()}</span>
            </div>
            <div className="border-t border-border pt-3 flex justify-between text-base font-semibold text-foreground">
              <span>Total</span>
              <span>{resort.currencySymbol}{total.toLocaleString()}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
