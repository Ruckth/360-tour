"use client";

import { BOOKING_RULE_DEFAULTS } from "convex/shared/siteSettings";
import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { dateToIso, isoToDate, nightsBetweenIso } from "@/lib/booking/dates";
import { displayDate, serverTodayIso } from "./admin-bookings-shared";

type Range = { checkIn: string; checkOut: string };
/** Desk dates use the same short date as sheets. Availability remains owned by the caller. */
export function DeskBookingRangePicker({
  checkIn,
  checkOut,
  onChange,
  isDateDisabled,
  unavailableDates,
  onMonthChange,
}: Range & {
  onChange: (range: Range) => void;
  isDateDisabled: (date: Date) => boolean;
  unavailableDates: string[];
  onMonthChange: (date: Date) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<keyof Range>("checkIn");
  const unavailable = new Set(unavailableDates);
  const minNights = BOOKING_RULE_DEFAULTS.minNights;
  const disabled = (date: Date) =>
    isDateDisabled(date) ||
    (active === "checkOut" &&
      Boolean(checkIn) &&
      dateToIso(date) > checkIn &&
      nightsBetweenIso(checkIn, dateToIso(date)) < minNights);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div className="grid grid-cols-2 gap-4">
        {(["checkIn", "checkOut"] as const).map((field) => {
          const id = `booking-${field === "checkIn" ? "check-in" : "check-out"}`;
          const label = field === "checkIn" ? "Check-in" : "Check-out";
          const value = field === "checkIn" ? checkIn : checkOut;
          return (
            <div key={field} className="grid gap-1.5">
              <Label htmlFor={id}>{label}</Label>
              <PopoverTrigger asChild>
                <Button
                  id={id}
                  data-testid={id}
                  data-selected-date={value}
                  variant="outline"
                  className="h-12 justify-start px-2 text-[13px] font-normal pointer-coarse:text-sm"
                  onClick={() => {
                    setActive(field);
                    onMonthChange(
                      isoToDate(checkOut || checkIn || serverTodayIso())!,
                    );
                  }}
                >
                  <CalendarDays
                    aria-hidden
                    className="size-4 text-muted-foreground"
                  />
                  <span>{value ? displayDate(value) : label}</span>
                </Button>
              </PopoverTrigger>
            </div>
          );
        })}
      </div>
      <PopoverContent className="w-auto p-2" align="start">
        <p className="px-2 py-2 text-sm font-medium">
          {active === "checkIn" ? "Choose check-in" : "Choose check-out"}
        </p>
        <Calendar
          mode="range"
          appearance="booking"
          initialFocus
          defaultMonth={isoToDate(checkOut || checkIn) ?? undefined}
          selected={
            checkIn
              ? {
                  from: isoToDate(checkIn)!,
                  to: isoToDate(checkOut) ?? undefined,
                }
              : undefined
          }
          disabled={disabled}
          onMonthChange={onMonthChange}
          modifiers={{
            unavailable: (date) => unavailable.has(dateToIso(date)),
          }}
          modifiersClassNames={{
            unavailable:
              "rounded-md bg-destructive/10 text-destructive !opacity-100 line-through [&>button]:!text-destructive [&>button]:!opacity-100",
          }}
          onDayClick={(date) => {
            if (disabled(date)) return;
            const value = dateToIso(date);
            if (active === "checkOut" && checkIn && value > checkIn) {
              onChange({ checkIn, checkOut: value });
              setOpen(false);
            } else {
              onChange({
                checkIn: value,
                checkOut:
                  checkOut > value &&
                  nightsBetweenIso(value, checkOut) >= minNights
                    ? checkOut
                    : "",
              });
              setActive("checkOut");
            }
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
