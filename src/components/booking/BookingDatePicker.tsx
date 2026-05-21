"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateToIso, formatDisplayDate, isoToDate, todayIsoLocal } from "@/lib/booking/dates";
import { cn } from "@/lib/utils";

export function BookingDatePicker({
  checkIn,
  checkOut,
  onChange,
  isDateDisabled,
  unavailableDates = [],
  helperText,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (range: { checkIn: string; checkOut: string }) => void;
  isDateDisabled: (date: Date) => boolean;
  unavailableDates?: string[];
  helperText?: string;
}) {
  const t = useTranslations("Booking");
  const [openField, setOpenField] = useState<"checkIn" | "checkOut" | null>(null);
  const checkInLabel = checkIn ? formatDisplayDate(checkIn) : t("checkIn");
  const checkOutLabel = checkOut ? formatDisplayDate(checkOut) : t("checkOut");
  const checkInDate = isoToDate(checkIn);
  const checkOutDate = isoToDate(checkOut);
  const todayIso = todayIsoLocal();
  const unavailableDateSet = new Set(unavailableDates);
  const calendarPopoverClassName = "w-[min(22rem,calc(100vw-2rem))] p-3 sm:p-4";
  const unavailableDayClassName =
    "rounded-md bg-destructive/10 text-destructive opacity-100 after:absolute after:left-1/2 after:top-1/2 after:h-px after:w-5 after:-translate-x-1/2 after:-translate-y-1/2 after:-rotate-45 after:bg-destructive/70 [&>button]:text-destructive [&>button]:opacity-100";
  const invalidCheckoutClassName =
    "rounded-md bg-muted/70 text-muted-foreground opacity-50 [&>button]:text-muted-foreground";

  function isUnavailableDate(date: Date) {
    const iso = dateToIso(date);
    return iso >= todayIso && unavailableDateSet.has(iso);
  }

  function isInvalidCheckoutDate(date: Date) {
    return Boolean(checkIn && dateToIso(date) <= checkIn && !isUnavailableDate(date));
  }

  function selectCheckIn(date: Date | undefined) {
    const nextCheckIn = dateToIso(date);
    const nextCheckOut =
      nextCheckIn && checkOut && checkOut <= nextCheckIn ? "" : checkOut;
    onChange({ checkIn: nextCheckIn, checkOut: nextCheckOut });
    setOpenField(null);
  }

  function selectCheckOut(date: Date | undefined) {
    onChange({ checkIn, checkOut: dateToIso(date) });
    setOpenField(null);
  }

  return (
    <div className="space-y-2">
      <div className="grid gap-3 sm:grid-cols-2">
        <Popover
          open={openField === "checkIn"}
          onOpenChange={(nextOpen) => setOpenField(nextOpen ? "checkIn" : null)}
        >
          <div className="space-y-2">
            <Label htmlFor="booking-check-in">{t("checkIn")}</Label>
            <PopoverTrigger asChild>
              <Button
                id="booking-check-in"
                type="button"
                variant="outline"
                className={cn(
                  "h-12 w-full justify-start border-input bg-background px-3 text-left font-medium",
                  !checkIn && "text-muted-foreground",
                )}
              >
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{checkInLabel}</span>
              </Button>
            </PopoverTrigger>
          </div>
          <PopoverContent align="center" className={calendarPopoverClassName}>
            <Calendar
              mode="single"
              selected={checkInDate}
              defaultMonth={checkInDate}
              onSelect={selectCheckIn}
              disabled={isDateDisabled}
              modifiers={{ unavailable: isUnavailableDate }}
              modifiersClassNames={{ unavailable: unavailableDayClassName }}
              initialFocus
            />
            <CalendarLegend />
          </PopoverContent>
        </Popover>

        <Popover
          open={openField === "checkOut"}
          onOpenChange={(nextOpen) => setOpenField(nextOpen ? "checkOut" : null)}
        >
          <div className="space-y-2">
            <Label htmlFor="booking-check-out">{t("checkOut")}</Label>
            <PopoverTrigger asChild>
              <Button
                id="booking-check-out"
                type="button"
                variant="outline"
                className={cn(
                  "h-12 w-full justify-start border-input bg-background px-3 text-left font-medium",
                  !checkOut && "text-muted-foreground",
                )}
              >
                <CalendarDays className="h-4 w-4 text-muted-foreground" />
                <span className="truncate">{checkOutLabel}</span>
              </Button>
            </PopoverTrigger>
          </div>
          <PopoverContent align="center" className={calendarPopoverClassName}>
            <Calendar
              mode="single"
              selected={checkOutDate}
              defaultMonth={checkOutDate ?? checkInDate}
              onSelect={selectCheckOut}
              disabled={(date) => {
                if (isDateDisabled(date)) return true;
                return Boolean(checkIn && dateToIso(date) <= checkIn);
              }}
              modifiers={{ unavailable: isUnavailableDate, invalidCheckout: isInvalidCheckoutDate }}
              modifiersClassNames={{
                unavailable: unavailableDayClassName,
                invalidCheckout: invalidCheckoutClassName,
              }}
              initialFocus
            />
            <CalendarLegend />
          </PopoverContent>
        </Popover>
      </div>
      {helperText ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}

function CalendarLegend() {
  const t = useTranslations("Booking");
  const items = [
    {
      label: t("calendarLegendAvailable"),
      swatch: "border-border bg-background",
    },
    {
      label: t("calendarLegendUnavailable"),
      swatch:
        "border-destructive/30 bg-destructive/10 after:absolute after:left-1/2 after:top-1/2 after:h-px after:w-4 after:-translate-x-1/2 after:-translate-y-1/2 after:-rotate-45 after:bg-destructive/70",
    },
    {
      label: t("calendarLegendPast"),
      swatch: "border-border bg-muted opacity-40",
    },
  ];

  return (
    <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5 border-t border-border pt-3 text-[11px] font-medium text-muted-foreground">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("relative h-3 w-3 rounded border", item.swatch)} aria-hidden="true" />
          {item.label}
        </span>
      ))}
    </div>
  );
}
