"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
import type { DateRange } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { dateToIso, formatDisplayDate, isoToDate } from "@/lib/booking/dates";
import { cn } from "@/lib/utils";

export function BookingDatePicker({
  checkIn,
  checkOut,
  onChange,
  isDateDisabled,
  helperText,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (range: { checkIn: string; checkOut: string }) => void;
  isDateDisabled: (date: Date) => boolean;
  helperText?: string;
}) {
  const t = useTranslations("Booking");
  const selected: DateRange | undefined =
    checkIn || checkOut
      ? {
          from: isoToDate(checkIn),
          to: isoToDate(checkOut),
        }
      : undefined;
  const [open, setOpen] = useState(false);
  const checkInLabel = checkIn ? formatDisplayDate(checkIn) : t("checkIn");
  const checkOutLabel = checkOut ? formatDisplayDate(checkOut) : t("checkOut");

  return (
    <div className="space-y-2">
      <Popover open={open} onOpenChange={setOpen}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t("checkIn")}</Label>
            <PopoverTrigger asChild>
              <Button
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
          <div className="space-y-2">
            <Label>{t("checkOut")}</Label>
            <PopoverTrigger asChild>
              <Button
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
        </div>
        <PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-[24rem] p-4 sm:w-auto">
          <Calendar
            mode="range"
            selected={selected}
            onSelect={(range) => {
              const nextCheckIn = dateToIso(range?.from);
              const nextCheckOut = dateToIso(range?.to);
              onChange({ checkIn: nextCheckIn, checkOut: nextCheckOut });
              if (nextCheckIn && nextCheckOut) setOpen(false);
            }}
            disabled={isDateDisabled}
            excludeDisabled
            initialFocus
            max={60}
            min={1}
          />
        </PopoverContent>
      </Popover>
      {helperText ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}
