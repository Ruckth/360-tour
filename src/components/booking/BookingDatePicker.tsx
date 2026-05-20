"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { useTranslations } from "next-intl";
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
  const [openField, setOpenField] = useState<"checkIn" | "checkOut" | null>(null);
  const checkInLabel = checkIn ? formatDisplayDate(checkIn) : t("checkIn");
  const checkOutLabel = checkOut ? formatDisplayDate(checkOut) : t("checkOut");
  const checkInDate = isoToDate(checkIn);
  const checkOutDate = isoToDate(checkOut);

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
          <PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-[24rem] p-4 sm:w-auto">
            <Calendar
              mode="single"
              selected={checkInDate}
              onSelect={selectCheckIn}
              disabled={isDateDisabled}
              initialFocus
            />
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
          <PopoverContent align="start" className="w-[calc(100vw-2rem)] max-w-[24rem] p-4 sm:w-auto">
            <Calendar
              mode="single"
              selected={checkOutDate}
              onSelect={selectCheckOut}
              disabled={(date) => {
                if (isDateDisabled(date)) return true;
                return Boolean(checkIn && dateToIso(date) <= checkIn);
              }}
              initialFocus
            />
          </PopoverContent>
        </Popover>
      </div>
      {helperText ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}
