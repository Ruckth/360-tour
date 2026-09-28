"use client";

import { CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

const timeHours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const timeMinutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

function dateTimeValueFromParts(date: Date, hour: string, minute: string) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function parseDateTimeValue(value: string, defaultHour: string, defaultMinute: string) {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/);
  if (!match) {
    return {
      date: undefined,
      hour: defaultHour,
      minute: defaultMinute,
    };
  }

  const [, year, month, day, hour, minute] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  const validDate =
    date.getFullYear() === Number(year) &&
    date.getMonth() === Number(month) - 1 &&
    date.getDate() === Number(day);

  return {
    date: validDate ? date : undefined,
    hour: timeHours.includes(hour) ? hour : defaultHour,
    minute: timeMinutes.includes(minute) ? minute : defaultMinute,
  };
}

export function AdminDateTimeFilterField({
  id,
  label,
  value,
  onChange,
  defaultHour,
  defaultMinute,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  defaultHour: string;
  defaultMinute: string;
}) {
  const { date, hour, minute } = parseDateTimeValue(value, defaultHour, defaultMinute);
  const dateLabel = date
    ? new Intl.DateTimeFormat(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date)
    : "Select date";

  function updateTime(nextHour: string, nextMinute: string) {
    if (!date) return;
    onChange(dateTimeValueFromParts(date, nextHour, nextMinute));
  }

  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </Label>
      <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_5.5rem] gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              id={id}
              type="button"
              variant="outline"
              className={cn(
                "h-10 justify-start rounded-lg px-3 text-left text-sm",
                !date && "text-muted-foreground",
              )}
            >
              <CalendarDays className="h-4 w-4 text-gold" />
              <span className="min-w-0 truncate">{dateLabel}</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-auto p-3">
            <Calendar
              mode="single"
              selected={date}
              onSelect={(selectedDate) => {
                if (!selectedDate) return;
                onChange(dateTimeValueFromParts(selectedDate, hour, minute));
              }}
            />
          </PopoverContent>
        </Popover>
        <Select value={hour} onValueChange={(nextHour) => updateTime(nextHour, minute)} disabled={!date}>
          <SelectTrigger className="h-10 rounded-lg" aria-label={`${label} hour`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeHours.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={minute} onValueChange={(nextMinute) => updateTime(hour, nextMinute)} disabled={!date}>
          <SelectTrigger className="h-10 rounded-lg" aria-label={`${label} minute`}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {timeMinutes.map((option) => (
              <SelectItem key={option} value={option}>
                {option}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
