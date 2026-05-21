"use client";

import { CheckCircle2, Mail, Minus, Phone, Plus, Shield, User } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/booking/dates";
import { isValidEmail, isValidPhone } from "@/lib/booking/booking";
import type { BookingMode, BookingProperty } from "@/lib/booking/booking";

function clampGuestCount(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

const phoneCountries = [
  { code: "+66", country: "Thailand", label: "TH +66", example: "81 234 5678" },
  { code: "+1", country: "United States", label: "US +1", example: "555 123 4567" },
  { code: "+44", country: "United Kingdom", label: "UK +44", example: "7400 123456" },
  { code: "+61", country: "Australia", label: "AU +61", example: "412 345 678" },
  { code: "+65", country: "Singapore", label: "SG +65", example: "8123 4567" },
  { code: "+81", country: "Japan", label: "JP +81", example: "90 1234 5678" },
  { code: "+82", country: "South Korea", label: "KR +82", example: "10 1234 5678" },
  { code: "+86", country: "China", label: "CN +86", example: "138 0013 8000" },
  { code: "+49", country: "Germany", label: "DE +49", example: "151 23456789" },
  { code: "+33", country: "France", label: "FR +33", example: "6 12 34 56 78" },
] as const;

function splitPhoneValue(value: string) {
  const clean = value.trim();
  const country = phoneCountries.find((item) => clean.startsWith(item.code)) ?? phoneCountries[0];
  const number = clean.startsWith(country.code) ? clean.slice(country.code.length).trim() : clean;
  return { country, number };
}

function formatPhoneValue(countryCode: string, number: string) {
  return `${countryCode} ${number.replace(/^\+\d+\s*/, "").trim()}`.trim();
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
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const { country: selectedPhoneCountry, number: phoneNumber } = splitPhoneValue(guestPhone);
  const fields = [
    {
      id: "booking-guest-name",
      icon: User,
      label: t("fullName"),
      helper: t("fullNameHint"),
      placeholder: t("fullNameExample"),
      error: t("fullNameError"),
      value: guestName,
      set: onGuestNameChange,
      type: "text",
      autoComplete: "name",
      inputMode: "text" as const,
      autoCapitalize: "words",
      autoCorrect: "off",
      maxLength: 80,
      isValid: (value: string) => value.trim().length >= 2,
    },
    {
      id: "booking-guest-email",
      icon: Mail,
      label: t("email"),
      helper: "",
      placeholder: t("emailExample"),
      error: t("emailError"),
      value: guestEmail,
      set: onGuestEmailChange,
      type: "email",
      autoComplete: "email",
      inputMode: "email" as const,
      autoCapitalize: "none",
      autoCorrect: "off",
      maxLength: 120,
      isValid: isValidEmail,
    },
  ];
  const phoneValid = isValidPhone(guestPhone);
  const phoneTouched = Boolean(touchedFields["booking-guest-phone"]);
  const showPhoneError = phoneTouched && !phoneValid;
  const phoneErrorId = "booking-guest-phone-error";

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">{t("guestDetails")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">{t("guestDetailsIntro")}</p>
      </div>
      {fields.map((field) => {
        const Icon = field.icon;
        const hasValue = field.value.trim().length > 0;
        const showError = Boolean(touchedFields[field.id] && !field.isValid(field.value));
        const helperId = `${field.id}-hint`;
        const errorId = `${field.id}-error`;
        return (
          <div key={field.id} className="space-y-2">
            <div>
              <Label htmlFor={field.id} className="text-base font-semibold md:text-sm">
                {field.label}
                <span className="ml-1 text-gold" aria-hidden="true">
                  *
                </span>
                <span className="sr-only"> required</span>
              </Label>
            </div>
            <div className="relative">
              <Icon className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id={field.id}
                type={field.type}
                value={field.value}
                autoComplete={field.autoComplete}
                inputMode={field.inputMode}
                autoCapitalize={field.autoCapitalize}
                autoCorrect={field.autoCorrect}
                maxLength={field.maxLength}
                required
                aria-required="true"
                aria-invalid={showError}
                aria-describedby={showError ? `${field.helper ? `${helperId} ` : ""}${errorId}` : field.helper ? helperId : undefined}
                placeholder={field.placeholder}
                onBlur={() => setTouchedFields((current) => ({ ...current, [field.id]: true }))}
                onChange={(event) => {
                  field.set(event.target.value);
                  if (touchedFields[field.id] || event.target.value.trim()) {
                    setTouchedFields((current) => ({ ...current, [field.id]: true }));
                  }
                }}
                className={cn(
                  "h-12 rounded-xl pl-10 pr-10 text-base md:h-11 md:text-sm",
                  showError && "border-destructive focus-visible:ring-destructive/30",
                )}
              />
              {hasValue && field.isValid(field.value) ? (
                <CheckCircle2
                  className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold"
                  aria-hidden="true"
                />
              ) : null}
            </div>
            {field.helper ? (
              <p id={helperId} className="text-xs leading-5 text-muted-foreground">
                {field.helper}
              </p>
            ) : null}
            {showError ? (
              <p id={errorId} className="text-xs font-medium leading-5 text-destructive">
                {field.error}
              </p>
            ) : null}
          </div>
        );
      })}
      <div className="space-y-2">
        <div>
          <Label htmlFor="booking-guest-phone" className="text-base font-semibold md:text-sm">
            {t("phone")}
            <span className="ml-1 text-gold" aria-hidden="true">
              *
            </span>
            <span className="sr-only"> required</span>
          </Label>
        </div>
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
          <Select
            value={selectedPhoneCountry.code}
            onValueChange={(code) => {
              onGuestPhoneChange(formatPhoneValue(code, phoneNumber));
              setTouchedFields((current) => ({ ...current, "booking-guest-phone": true }));
            }}
          >
            <SelectTrigger
              aria-label="Country code"
              className="h-12 rounded-xl px-3 text-base font-semibold md:h-11 md:text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[14rem]">
              {phoneCountries.map((item) => (
                <SelectItem key={item.code} value={item.code}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="relative min-w-0">
            <Phone className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="booking-guest-phone"
              type="tel"
              value={phoneNumber}
              autoComplete="tel-national"
              inputMode="tel"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={28}
              required
              aria-required="true"
              aria-invalid={showPhoneError}
              aria-describedby={showPhoneError ? phoneErrorId : undefined}
              placeholder={selectedPhoneCountry.example}
              onBlur={() => setTouchedFields((current) => ({ ...current, "booking-guest-phone": true }))}
              onChange={(event) => {
                onGuestPhoneChange(formatPhoneValue(selectedPhoneCountry.code, event.target.value));
                if (phoneTouched || event.target.value.trim()) {
                  setTouchedFields((current) => ({ ...current, "booking-guest-phone": true }));
                }
              }}
              className={cn(
                "h-12 rounded-xl pl-10 pr-10 text-base md:h-11 md:text-sm",
                showPhoneError && "border-destructive focus-visible:ring-destructive/30",
              )}
            />
            {phoneNumber.trim() && phoneValid ? (
              <CheckCircle2
                className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold"
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
        {showPhoneError ? (
          <p id={phoneErrorId} className="text-xs font-medium leading-5 text-destructive">
            {t("phoneError")}
          </p>
        ) : null}
      </div>
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
}: {
  dateWarning: string;
  conflicts: boolean;
  propertyName: string;
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
    </>
  );
}
