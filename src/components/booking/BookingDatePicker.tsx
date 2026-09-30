"use client";

import { useMemo, useState } from "react";
import { CalendarDays, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import type { DateRange, DayPickerProps } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";
import { dateToIso, formatDisplayDate, isoToDate, todayIsoLocal } from "@/lib/booking/dates";
import { cn } from "@/lib/utils";

type BookingRange = { checkIn: string; checkOut: string };
type ActiveDateField = "checkIn" | "checkOut";

type BookingRangePickerProps = {
  checkIn: string;
  checkOut: string;
  onChange: (range: BookingRange) => void;
  isDateDisabled: (date: Date) => boolean;
  unavailableDates?: string[];
  helperText?: string;
  compact?: boolean;
  className?: string;
  contentClassName?: string;
  onRangeChange?: () => void;
  /** Called with the first day of the month the calendar shows, so callers can load that month. */
  onMonthChange?: (month: Date) => void;
};

export function BookingDatePicker({
  checkIn,
  checkOut,
  onChange,
  isDateDisabled,
  unavailableDates = [],
  helperText,
  onMonthChange,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (range: BookingRange) => void;
  isDateDisabled: (date: Date) => boolean;
  unavailableDates?: string[];
  helperText?: string;
  onMonthChange?: (month: Date) => void;
}) {
  return (
    <BookingRangePicker
      checkIn={checkIn}
      checkOut={checkOut}
      onChange={onChange}
      isDateDisabled={isDateDisabled}
      unavailableDates={unavailableDates}
      helperText={helperText}
      onMonthChange={onMonthChange}
    />
  );
}

export function BookingRangePicker({
  checkIn,
  checkOut,
  onChange,
  isDateDisabled,
  unavailableDates = [],
  helperText,
  compact = false,
  className,
  contentClassName,
  onRangeChange,
  onMonthChange,
}: BookingRangePickerProps) {
  const t = useTranslations("Booking");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const calendarFormatters = useMemo(() => getCalendarFormatters(locale), [locale]);
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveDateField>("checkIn");
  const checkInLabel = checkIn ? formatPickerDate(checkIn, locale) : t("checkIn");
  const checkOutLabel = checkOut ? formatPickerDate(checkOut, locale) : t("checkOut");
  const checkInDate = isoToDate(checkIn);
  const checkOutDate = isoToDate(checkOut);
  const todayIso = todayIsoLocal();
  const unavailableDateSet = new Set(unavailableDates);
  const selectedRange: DateRange | undefined = checkInDate
    ? { from: checkInDate, to: checkOutDate ?? checkInDate }
    : undefined;
  const clearLabel = activeField === "checkOut" ? t("checkOut") : t("checkIn");
  const calendarPopoverClassName = cn(
    "w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-2.5 shadow-xl shadow-black/15 sm:p-3",
    compact && "z-[80] w-[min(21rem,calc(100vw-2rem))]",
    contentClassName,
  );
  const unavailableDayClassName =
    "rounded-md bg-destructive/10 text-destructive !opacity-100 after:absolute after:left-1/2 after:top-1/2 after:h-px after:w-5 after:-translate-x-1/2 after:-translate-y-1/2 after:-rotate-45 after:bg-destructive/75 [&>button]:!text-destructive [&>button]:!opacity-100";

  function isUnavailableDate(date: Date) {
    const iso = dateToIso(date);
    return iso >= todayIso && unavailableDateSet.has(iso);
  }

  function updateRange(range: BookingRange) {
    onChange(range);
    onRangeChange?.();
  }

  function selectDate(date: Date) {
    if (isDateDisabled(date)) return;
    const iso = dateToIso(date);

    if (activeField === "checkOut") {
      if (!checkIn || iso <= checkIn) {
        updateRange({ checkIn: iso, checkOut: "" });
        setActiveField("checkOut");
        return;
      }

      updateRange({ checkIn, checkOut: iso });
      setOpen(false);
      return;
    }

    updateRange({
      checkIn: iso,
      checkOut: checkOut && checkOut > iso ? checkOut : "",
    });
    setActiveField("checkOut");
    setOpen(true);
  }

  function clearActiveDate() {
    if (activeField === "checkOut") {
      updateRange({ checkIn, checkOut: "" });
      return;
    }

    updateRange({ checkIn: "", checkOut: "" });
    setActiveField("checkIn");
  }

  function openPicker(field: ActiveDateField) {
    setActiveField(field);
    setOpen(true);
  }

  const popoverContent = (
    <RangePickerContent
      className={calendarPopoverClassName}
      checkInValue={checkIn ? formatPickerDate(checkIn, locale) : t("checkIn")}
      checkOutValue={checkOut ? formatPickerDate(checkOut, locale) : t("checkOut")}
      activeField={activeField}
      compact={compact}
      calendarFormatters={calendarFormatters}
      selectedRange={selectedRange}
      defaultMonth={checkOutDate ?? checkInDate}
      isDateDisabled={isDateDisabled}
      isUnavailableDate={isUnavailableDate}
      unavailableDayClassName={unavailableDayClassName}
      clearLabel={clearLabel}
      onActivateField={setActiveField}
      onClear={clearActiveDate}
      onSelectDate={selectDate}
      onMonthChange={onMonthChange}
    />
  );

  return (
    <div className={cn("space-y-2", className)}>
      <Popover open={open} onOpenChange={setOpen}>
        <DateTriggerFields
          compact={compact}
          checkInLabel={checkInLabel}
          checkOutLabel={checkOutLabel}
          checkIn={checkIn}
          checkOut={checkOut}
          checkInText={t("checkIn")}
          checkOutText={t("checkOut")}
          onOpenPicker={openPicker}
        />
        {popoverContent}
      </Popover>
      {helperText ? (
        <p className="text-xs leading-relaxed text-muted-foreground">{helperText}</p>
      ) : null}
    </div>
  );
}

function DateTriggerFields({
  compact,
  checkInLabel,
  checkOutLabel,
  checkIn,
  checkOut,
  checkInText,
  checkOutText,
  onOpenPicker,
}: {
  compact: boolean;
  checkInLabel: string;
  checkOutLabel: string;
  checkIn: string;
  checkOut: string;
  checkInText: string;
  checkOutText: string;
  onOpenPicker: (field: ActiveDateField) => void;
}) {
  return (
    <div className={cn("grid gap-3 sm:grid-cols-2", compact && "gap-2")}>
      <DateTriggerField
        field="checkIn"
        compact={compact}
        label={checkInText}
        value={checkIn}
        displayValue={checkInLabel}
        onOpen={onOpenPicker}
      />
      <DateTriggerField
        field="checkOut"
        compact={compact}
        label={checkOutText}
        value={checkOut}
        displayValue={checkOutLabel}
        onOpen={onOpenPicker}
      />
    </div>
  );
}

function DateTriggerField({
  field,
  compact,
  label,
  value,
  displayValue,
  onOpen,
}: {
  field: ActiveDateField;
  compact: boolean;
  label: string;
  value: string;
  displayValue: string;
  onOpen: (field: ActiveDateField) => void;
}) {
  const id = compact ? `chat-booking-${field === "checkIn" ? "check-in" : "check-out"}` : `booking-${field === "checkIn" ? "check-in" : "check-out"}`;
  return (
    <div className={cn("space-y-2", compact && "space-y-1.5")}>
      <Label
        htmlFor={id}
        className={cn(compact && "text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground")}
      >
        {label}
      </Label>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          data-testid={id}
          data-selected-date={value}
          onClick={() => onOpen(field)}
          className={cn(
            "w-full justify-start border-input bg-background px-3 text-left font-medium",
            compact ? "h-10 rounded-xl text-sm" : "h-12",
            !value && "text-muted-foreground",
          )}
        >
          <CalendarDays className={cn("text-muted-foreground", compact ? "h-3.5 w-3.5" : "h-4 w-4")} />
          <span className="truncate">{displayValue}</span>
        </Button>
      </PopoverTrigger>
    </div>
  );
}

function RangePickerContent({
  className,
  checkInValue,
  checkOutValue,
  activeField,
  compact,
  calendarFormatters,
  selectedRange,
  defaultMonth,
  isDateDisabled,
  isUnavailableDate,
  unavailableDayClassName,
  clearLabel,
  onActivateField,
  onClear,
  onSelectDate,
  onMonthChange,
}: {
  className: string;
  checkInValue: string;
  checkOutValue: string;
  activeField: ActiveDateField;
  compact: boolean;
  calendarFormatters: NonNullable<DayPickerProps["formatters"]>;
  selectedRange: DateRange | undefined;
  defaultMonth: Date | undefined;
  isDateDisabled: (date: Date) => boolean;
  isUnavailableDate: (date: Date) => boolean;
  unavailableDayClassName: string;
  clearLabel: string;
  onActivateField: (field: ActiveDateField) => void;
  onClear: () => void;
  onSelectDate: (date: Date) => void;
  onMonthChange?: (month: Date) => void;
}) {
  return (
    <PopoverContent align="center" collisionPadding={16} className={className}>
      <RangeHeader
        checkInValue={checkInValue}
        checkOutValue={checkOutValue}
        activeField={activeField}
        compact={compact}
        clearLabel={clearLabel}
        onActivateField={onActivateField}
        onClear={onClear}
      />
      <RangeCalendarBody
        compact={compact}
        calendarFormatters={calendarFormatters}
        selectedRange={selectedRange}
        defaultMonth={defaultMonth}
        isDateDisabled={isDateDisabled}
        isUnavailableDate={isUnavailableDate}
        unavailableDayClassName={unavailableDayClassName}
        onSelectDate={onSelectDate}
        onMonthChange={onMonthChange}
      />
    </PopoverContent>
  );
}

function RangeHeader({
  checkInValue,
  checkOutValue,
  activeField,
  compact,
  clearLabel,
  onActivateField,
  onClear,
}: {
  checkInValue: string;
  checkOutValue: string;
  activeField: ActiveDateField;
  compact: boolean;
  clearLabel: string;
  onActivateField: (field: ActiveDateField) => void;
  onClear: () => void;
}) {
  return (
    <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      <RangeSummaryButton
        field="checkIn"
        value={checkInValue}
        active={activeField === "checkIn"}
        onClick={() => onActivateField("checkIn")}
        compact={compact}
      />
      <div className="relative">
        <RangeSummaryButton
          field="checkOut"
          value={checkOutValue}
          active={activeField === "checkOut"}
          onClick={() => onActivateField("checkOut")}
          compact={compact}
        />
        <ClearDateButton label={clearLabel} onClear={onClear} />
      </div>
    </div>
  );
}

function ClearDateButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={`Clear ${label}`}
      onClick={onClear}
      className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-muted-foreground/25 text-background transition hover:bg-muted-foreground/40 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40"
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

function RangeCalendarBody({
  compact,
  calendarFormatters,
  selectedRange,
  defaultMonth,
  isDateDisabled,
  isUnavailableDate,
  unavailableDayClassName,
  onSelectDate,
  onMonthChange,
}: {
  compact: boolean;
  calendarFormatters: NonNullable<DayPickerProps["formatters"]>;
  selectedRange: DateRange | undefined;
  defaultMonth: Date | undefined;
  isDateDisabled: (date: Date) => boolean;
  isUnavailableDate: (date: Date) => boolean;
  unavailableDayClassName: string;
  onSelectDate: (date: Date) => void;
  onMonthChange?: (month: Date) => void;
}) {
  return (
    <Calendar
      mode="range"
      selected={selectedRange}
      defaultMonth={defaultMonth}
      onMonthChange={onMonthChange}
      onDayClick={onSelectDate}
      disabled={isDateDisabled}
      modifiers={{ unavailable: isUnavailableDate }}
      modifiersClassNames={{ unavailable: unavailableDayClassName }}
      formatters={calendarFormatters}
      classNames={{
        month_caption: "pointer-events-none flex h-8 items-center justify-start px-0 pr-16",
        caption_label: cn("font-semibold text-foreground", compact ? "text-base" : "text-lg"),
        nav: "pointer-events-none absolute right-0 top-0 z-10 flex items-center gap-1",
        button_previous:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent p-0 text-muted-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30",
        button_next:
          "pointer-events-auto inline-flex h-8 w-8 items-center justify-center rounded-full bg-transparent p-0 text-foreground transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-30",
        weekday:
          "flex h-8 items-center justify-center rounded-md text-sm font-medium text-foreground",
        week: "mt-1 grid grid-cols-7",
        day: "relative flex h-9 w-full items-center justify-center p-0 text-center text-base",
        day_button:
          "inline-flex h-8 w-8 items-center justify-center rounded-full border border-transparent bg-transparent p-0 text-base font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-selected:opacity-100 disabled:pointer-events-none disabled:opacity-40",
        outside: "text-muted-foreground opacity-45",
        disabled: "text-muted-foreground opacity-30",
        today: "font-semibold text-foreground",
        range_start:
          "rounded-l-full bg-gold text-navy [&>button]:bg-gold [&>button]:text-navy hover:[&>button]:bg-gold",
        range_end:
          "rounded-r-full bg-gold text-navy [&>button]:bg-gold [&>button]:text-navy hover:[&>button]:bg-gold",
        range_middle:
          "rounded-none bg-gold/70 text-navy [&>button]:rounded-none [&>button]:bg-transparent [&>button]:text-navy hover:[&>button]:bg-transparent",
      }}
      initialFocus
    />
  );
}

function RangeSummaryButton({
  field,
  value,
  active,
  compact,
  onClick,
}: {
  field: ActiveDateField;
  value: string;
  active: boolean;
  compact: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-testid={`booking-range-${field}`}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "min-w-0 rounded-lg px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
        active
          ? "border border-border bg-background shadow-sm"
          : "border border-transparent text-foreground hover:bg-background/50",
        field === "checkOut" && "pr-8",
        compact && "px-2.5 py-1.5",
      )}
    >
      <span className={cn("block truncate font-semibold leading-tight", active ? "text-primary" : "text-foreground", compact ? "text-xs" : "text-sm")}>
        {value}
      </span>
    </button>
  );
}

function formatPickerDate(value: string, locale: string) {
  const date = isoToDate(value);
  if (!date) return formatDisplayDate(value);
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

function getCalendarIntlLocale(locale: Locale) {
  const localesByAppLocale: Record<Locale, string> = {
    en: "en-US",
    th: "th-TH-u-ca-buddhist",
    "zh-CN": "zh-CN",
    ja: "ja-JP",
    ko: "ko-KR",
    fr: "fr-FR",
    de: "de-DE",
    es: "es-ES",
    ru: "ru-RU",
    it: "it-IT",
    hi: "hi-IN",
  };
  return localesByAppLocale[locale];
}

function getCalendarFormatters(locale: Locale): NonNullable<DayPickerProps["formatters"]> {
  const intlLocale = getCalendarIntlLocale(locale);
  const monthFormatter = new Intl.DateTimeFormat(intlLocale, {
    month: "long",
    year: "numeric",
  });
  const weekdayFormatter = new Intl.DateTimeFormat(intlLocale, {
    weekday: "short",
  });

  return {
    formatCaption: (month) => monthFormatter.format(month),
    formatWeekdayName: (weekday) => weekdayFormatter.format(weekday).replace(/\.$/, ""),
  };
}
