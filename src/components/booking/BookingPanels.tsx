"use client";

import { CheckCircle2, Mail, Minus, Phone, Plus, Shield, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatDisplayDate } from "@/lib/booking/dates";
import type { BookingMode, BookingProperty } from "@/lib/booking/booking";

function clampGuestCount(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function GuestCountsPanel({
  property,
  adults,
  childCount,
  onChangeAdults,
  onChangeChildren,
}: {
  property: BookingProperty;
  adults: number;
  childCount: number;
  onChangeAdults: (guests: number) => void;
  onChangeChildren: (guests: number) => void;
}) {
  const t = useTranslations("Booking");
  const totalGuests = adults + childCount;
  const remainingCapacity = Math.max(0, property.maxGuests - totalGuests);

  function updateAdults(nextAdults: number) {
    const clampedAdults = clampGuestCount(nextAdults, 1, property.maxGuests);
    const maxChildren = Math.max(0, property.maxGuests - clampedAdults);
    onChangeAdults(clampedAdults);
    if (childCount > maxChildren) onChangeChildren(maxChildren);
  }

  function updateChildren(nextChildren: number) {
    onChangeChildren(clampGuestCount(nextChildren, 0, Math.max(0, property.maxGuests - adults)));
  }

  return (
    <div>
      <h2 className="text-xl font-semibold text-foreground">{t("guests")}</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        {t("guestCapacity", { propertyName: property.name, count: property.maxGuests })}
      </p>
      <div className="mt-6 space-y-3">
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("adults")}</p>
            <p className="text-xs text-muted-foreground">{t("adultsAge")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="icon" onClick={() => updateAdults(adults - 1)} disabled={adults <= 1}>
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-lg font-semibold">{adults}</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => updateAdults(adults + 1)}
              disabled={remainingCapacity <= 0}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-xl border border-border bg-card p-4">
          <div>
            <p className="text-sm font-semibold text-foreground">{t("children")}</p>
            <p className="text-xs text-muted-foreground">{t("childrenAge")}</p>
          </div>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              onClick={() => updateChildren(childCount - 1)}
              disabled={childCount <= 0}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-lg font-semibold">{childCount}</span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => updateChildren(childCount + 1)}
              disabled={remainingCapacity <= 0}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        {t("totalGuests", { count: totalGuests })}
      </p>
    </div>
  );
}

export function GuestDetailsPanel({
  guestName,
  guestEmail,
  guestPhone,
  onGuestNameChange,
  onGuestEmailChange,
  onGuestPhoneChange,
}: {
  guestName: string;
  guestEmail: string;
  guestPhone: string;
  onGuestNameChange: (value: string) => void;
  onGuestEmailChange: (value: string) => void;
  onGuestPhoneChange: (value: string) => void;
}) {
  const t = useTranslations("Booking");
  const fields = [
    {
      id: "booking-guest-name",
      icon: User,
      label: t("fullName"),
      value: guestName,
      set: onGuestNameChange,
      type: "text",
      autoComplete: "name",
    },
    {
      id: "booking-guest-email",
      icon: Mail,
      label: t("email"),
      value: guestEmail,
      set: onGuestEmailChange,
      type: "email",
      autoComplete: "email",
    },
    {
      id: "booking-guest-phone",
      icon: Phone,
      label: t("phone"),
      value: guestPhone,
      set: onGuestPhoneChange,
      type: "tel",
      autoComplete: "tel",
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">{t("guestDetails")}</h2>
      {fields.map((field) => {
        const Icon = field.icon;
        return (
          <div key={field.label} className="space-y-2">
            <Label htmlFor={field.id}>{field.label}</Label>
            <div className="relative">
              <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={field.id}
                type={field.type}
                value={field.value}
                autoComplete={field.autoComplete}
                onChange={(event) => field.set(event.target.value)}
                className="pl-10"
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function ReviewPanel({
  property,
  guests,
  nights,
  checkIn,
  checkOut,
  bookingMode,
}: {
  property: BookingProperty;
  guests: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  bookingMode: BookingMode;
}) {
  const t = useTranslations("Booking");
  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">{t("reviewPay")}</h2>
      <div className="rounded-xl bg-muted p-4 text-sm text-muted-foreground">
        {t("reviewSummary", {
          propertyName: property.name,
          guests,
          nights,
          checkIn: formatDisplayDate(checkIn),
          checkOut: formatDisplayDate(checkOut),
        })}
      </div>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shield className="h-4 w-4 text-gold" />
        {bookingMode === "live" ? t("livePaymentNote") : t("demoPaymentNote")}
      </div>
    </div>
  );
}

export function DateStatus({
  dateWarning,
  conflicts,
  propertyName,
  nights,
  discountPercent,
}: {
  dateWarning: string;
  conflicts: boolean;
  propertyName: string;
  nights: number;
  discountPercent: number;
}) {
  const t = useTranslations("Booking");
  return (
    <>
      {dateWarning ? (
        <Alert variant="warning">
          <AlertDescription>{dateWarning}</AlertDescription>
        </Alert>
      ) : null}
      {conflicts ? (
        <Alert variant="destructive">
          <AlertTitle>{t("datesBlocked")}</AlertTitle>
          <AlertDescription>
            {t("notAvailable", { propertyName })}
          </AlertDescription>
        </Alert>
      ) : null}
      {nights > 0 && !conflicts ? (
        <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-gold" />
          {t("directSavings", { count: nights, discountPercent })}
        </div>
      ) : null}
    </>
  );
}
