"use client";

import {
  CalendarDays,
  CheckCircle2,
  Home,
  Mail,
  Minus,
  Pencil,
  Phone,
  Plus,
  Shield,
  User,
  Users,
} from "lucide-react";
import { useTranslations } from "@/platform/intl";
import { useState, type ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { formatDisplayDate } from "@/lib/booking/dates";
import { isValidEmail } from "@/lib/booking/booking";
import {
  chooseGuestPhoneCountry,
  formatGuestPhone,
  guestPhoneE164,
  phoneCountries,
  phoneCountryLabel,
  shownPhoneCountry,
  type GuestPhoneDraft,
} from "@/lib/booking/guest-phone";
import type { CountryCode } from "libphonenumber-js/min";
import type { BookingProperty } from "@/lib/booking/booking";

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
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("removeAdult")}
              onClick={() => updateAdults(adults - 1)}
              disabled={adults <= 1}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-lg font-semibold">{adults}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("addAdult")}
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
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("removeChild")}
              onClick={() => updateChildren(childCount - 1)}
              disabled={childCount <= 0}
            >
              <Minus className="h-4 w-4" />
            </Button>
            <span className="w-8 text-center text-lg font-semibold">{childCount}</span>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label={t("addChild")}
              onClick={() => updateChildren(childCount + 1)}
              disabled={remainingCapacity <= 0}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
      <p role="status" className="mt-3 text-sm text-muted-foreground">
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
  guestPhone: GuestPhoneDraft;
  onGuestNameChange: (value: string) => void;
  onGuestEmailChange: (value: string) => void;
  onGuestPhoneChange: (value: GuestPhoneDraft) => void;
}) {
  const t = useTranslations("Booking");
  const a11y = useTranslations("A11y");
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>({});
  const shownCountry = shownPhoneCountry(guestPhone);
  const countryOptions = phoneCountries.some((item) => item.country === shownCountry)
    ? phoneCountries
    : [...phoneCountries, { country: shownCountry, label: phoneCountryLabel(shownCountry), example: "" }];
  const phoneExample = phoneCountries.find((item) => item.country === guestPhone.country)?.example ?? "";
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
  const phoneValid = Boolean(guestPhoneE164(guestPhone));
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
            <span className="sr-only"> {t("required")}</span>
          </Label>
        </div>
        <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-2">
          <Select
            value={shownCountry}
            onValueChange={(country) => {
              onGuestPhoneChange(chooseGuestPhoneCountry(guestPhone, country as CountryCode));
              setTouchedFields((current) => ({ ...current, "booking-guest-phone": true }));
            }}
          >
            <SelectTrigger
              aria-label={a11y("countryCode")}
              data-testid="booking-phone-country"
              className="h-12 rounded-xl px-3 text-base font-semibold md:h-11 md:text-sm"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="min-w-[14rem]">
              {countryOptions.map((item) => (
                <SelectItem key={item.country} value={item.country}>
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
              value={guestPhone.text}
              autoComplete="tel"
              inputMode="tel"
              autoCapitalize="none"
              autoCorrect="off"
              maxLength={28}
              required
              aria-required="true"
              aria-invalid={showPhoneError}
              aria-describedby={showPhoneError ? `booking-guest-phone-hint ${phoneErrorId}` : "booking-guest-phone-hint"}
              placeholder={phoneExample}
              onBlur={() => setTouchedFields((current) => ({ ...current, "booking-guest-phone": true }))}
              onChange={(event) => {
                // The guest's text is kept exactly as typed so an invalid number stays editable.
                onGuestPhoneChange({ country: guestPhone.country, text: event.target.value });
                if (phoneTouched || event.target.value.trim()) {
                  setTouchedFields((current) => ({ ...current, "booking-guest-phone": true }));
                }
              }}
              className={cn(
                "h-12 rounded-xl pl-10 pr-10 text-base md:h-11 md:text-sm",
                showPhoneError && "border-destructive focus-visible:ring-destructive/30",
              )}
            />
            {phoneValid ? (
              <CheckCircle2
                className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gold"
                aria-hidden="true"
              />
            ) : null}
          </div>
        </div>
        <p id="booking-guest-phone-hint" className="text-xs leading-5 text-muted-foreground">
          {t("phoneHint")}
        </p>
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
  contact,
  onEditContact,
  price,
  coupon,
}: {
  property: BookingProperty;
  guests: number;
  nights: number;
  checkIn: string;
  checkOut: string;
  /** The guest's contact details as they will be booked; `phone` is E.164. */
  contact: { name: string; email: string; phone: string };
  onEditContact: () => void;
  /** The price lines, shown here on phones where the summary card sits below the step. */
  price?: ReactNode;
  /** "Have a code?" and the attached code. */
  coupon?: ReactNode;
}) {
  const t = useTranslations("Booking");
  const chatT = useTranslations("Chat");
  const villaT = useTranslations("Villa");
  const reviewDetails = [
    {
      icon: Home,
      label: property.name,
      testId: "booking-review-property",
    },
    {
      icon: CalendarDays,
      label: `${formatDisplayDate(checkIn)} - ${formatDisplayDate(checkOut)} · ${chatT("bookingCardNights", { count: nights })}`,
      testId: "booking-review-dates",
    },
    {
      icon: Users,
      label: villaT("guests", { count: guests }),
      testId: "booking-review-guests",
    },
  ];

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-foreground">{t("reviewPay")}</h2>
      <div className="rounded-xl bg-muted p-4">
        <ul className="space-y-3 text-sm text-muted-foreground">
          {reviewDetails.map((item) => {
            const Icon = item.icon;
            return (
              <li
                key={item.testId}
                data-testid={item.testId}
                className="flex items-start gap-3 leading-relaxed"
              >
                <Icon className="mt-0.5 h-4 w-4 shrink-0 text-gold" aria-hidden="true" />
                <span className="min-w-0">{item.label}</span>
              </li>
            );
          })}
        </ul>
      </div>
      <section aria-labelledby="booking-review-contact-title" className="rounded-xl border border-border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 id="booking-review-contact-title" className="text-sm font-semibold text-foreground">{t("guestDetails")}</h3>
          <Button type="button" variant="outline" size="sm" className="min-h-11 sm:min-h-9" onClick={onEditContact}>
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
            {t("editGuestDetails")}
          </Button>
        </div>
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-[auto_minmax(0,1fr)] sm:gap-x-4">
          <dt className="text-muted-foreground">{t("fullName")}</dt>
          <dd data-testid="booking-review-name" className="min-w-0 break-words font-medium text-foreground">{contact.name}</dd>
          <dt className="text-muted-foreground">{t("email")}</dt>
          <dd data-testid="booking-review-email" className="min-w-0 break-all font-medium text-foreground">{contact.email}</dd>
          <dt className="text-muted-foreground">{t("phone")}</dt>
          <dd data-testid="booking-review-phone" className="min-w-0 font-medium text-foreground" dir="ltr">{contact.phone ? formatGuestPhone(contact.phone) : ""}</dd>
        </dl>
      </section>
      {price ? <div className="rounded-xl border border-border px-4 py-3 text-xs text-muted-foreground lg:hidden">{price}</div> : null}
      {coupon}
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Shield className="h-4 w-4 text-gold" />
        {t("livePaymentNote")}
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
