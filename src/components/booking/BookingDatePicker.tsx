"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "convex/_generated/api";
import { BOOKING_RULE_DEFAULTS } from "convex/shared/siteSettings";
import { useConvex } from 'convex/react';
import { CalendarDays, X } from "lucide-react";
import { useLocale, useTranslations } from "@/platform/intl";
import type { DateRange, DayPickerProps } from "react-day-picker";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { defaultLocale, isLocale } from "@/i18n/routing";
import { addDaysIso, dateToIso, isoToDate, nightsBetweenIso } from '@/lib/booking/dates';
import { resortTodayIso as todayIsoResort } from 'convex/shared/time';
import { formatPickerDate, getCalendarFormatters } from "@/lib/dates/format";
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
  minNights?: number;
  maxCheckIn?: string;
  compact?: boolean;
  markPastUnavailable?: boolean;
  /** Offer the ✕ that clears the active date; off where both dates are required (staff booking forms). */
  clearable?: boolean;
  className?: string;
  contentClassName?: string;
  onRangeChange?: () => void;
  onCalendarOpening?: (field: ActiveDateField) => void;
  onCalendarOpened?: () => void;
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
  onReady,
}: {
  checkIn: string;
  checkOut: string;
  onChange: (range: BookingRange) => void;
  isDateDisabled: (date: Date) => boolean;
  unavailableDates?: string[];
  helperText?: string;
  onMonthChange?: (month: Date) => void;
  onReady?: () => void;
}) {
  const convex = useConvex();
  const [rules, setRules] = useState(BOOKING_RULE_DEFAULTS);
  useEffect(() => {
    let active = true;
    if (convex) {
      void convex.query(api.settings.settings.publicProfile, {}).then(profile => {
        if (active) setRules(profile.bookingRules);
      }).catch(() => { /* Calendar hints use defaults; the server always enforces current rules. */ });
    }
    return () => { active = false; };
  }, [convex]);
  useEffect(() => { onReady?.(); }, [onReady]);
  return (
    <BookingRangePicker
      minNights={rules.minNights}
      maxCheckIn={addDaysIso(new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" }), rules.maxAdvanceDays)}
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
  minNights = BOOKING_RULE_DEFAULTS.minNights,
  maxCheckIn,
  compact = false,
  markPastUnavailable = false,
  clearable = true,
  className,
  contentClassName,
  onRangeChange,
  onCalendarOpening,
  onCalendarOpened,
  onMonthChange,
}: BookingRangePickerProps) {
  const t = useTranslations("Booking");
  const activeLocale = useLocale();
  const locale = isLocale(activeLocale) ? activeLocale : defaultLocale;
  const calendarFormatters = useMemo(() => getCalendarFormatters(locale), [locale]);
  const [open, setOpen] = useState(false);
  const [activeField, setActiveField] = useState<ActiveDateField>("checkIn");
  const [visibleMonth, setVisibleMonth] = useState<Date>();
  const checkInLabel = checkIn ? formatPickerDate(checkIn, locale) : t("checkIn");
  const checkOutLabel = checkOut ? formatPickerDate(checkOut, locale) : t("checkOut");
  const checkInDate = isoToDate(checkIn);
  const checkOutDate = isoToDate(checkOut);
  const unavailableDateSet = new Set(unavailableDates);
  const selectedRange: DateRange | undefined = checkInDate
    ? { from: checkInDate, to: checkOutDate ?? checkInDate }
    : undefined;
  const clearLabel = activeField === "checkOut"
    ? checkOut && t("clearCheckOut")
    : checkIn && t("clearCheckIn");
  const calendarPopoverClassName = cn(
    "w-[min(22rem,calc(100vw-2rem))] rounded-2xl p-2.5 shadow-xl shadow-black/15 sm:p-3",
    compact && "z-[80] w-[min(21rem,calc(100vw-2rem))]",
    contentClassName,
  );
  const unavailableDayClassName =
    "rounded-md bg-destructive/10 text-destructive !opacity-100 after:absolute after:left-1/2 after:top-1/2 after:h-px after:w-5 after:-translate-x-1/2 after:-translate-y-1/2 after:-rotate-45 after:bg-destructive/75 [&>button]:!text-destructive [&>button]:!opacity-100";

  function isUnavailableDate(date: Date) {
    const iso = dateToIso(date);
    return (markPastUnavailable || iso >= todayIsoResort()) && unavailableDateSet.has(iso);
  }

  function updateRange(range: BookingRange) {
    onChange(range);
    onRangeChange?.();
  }

  function isPickerDateDisabled(date: Date) {
    if (isDateDisabled(date)) return true;
    const iso = dateToIso(date);
    // A departure may be beyond the last allowed arrival date.
    if (activeField === "checkOut" && checkIn && iso > checkIn) return nightsBetweenIso(checkIn, iso) < minNights;
    return Boolean(maxCheckIn && iso > maxCheckIn);
  }

  function selectDate(date: Date) {
    if (isPickerDateDisabled(date)) return;
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
      checkOut: checkOut && nightsBetweenIso(iso, checkOut) >= minNights ? checkOut : "",
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

  function showMonth(date: Date) {
    const month = new Date(date);
    month.setDate(1);
    setVisibleMonth(month);
    onMonthChange?.(month);
  }

  function activateField(field: ActiveDateField) {
    if (field === activeField) return;
    setActiveField(field);
    const date = field === "checkIn" ? checkInDate : checkOutDate;
    if (date) showMonth(date);
  }

  function openPicker(field: ActiveDateField) {
    if (!open) onCalendarOpening?.(field);
    const date = field === "checkIn" ? checkInDate : checkOutDate;
    showMonth(date ?? checkInDate ?? isoToDate(todayIsoResort())!);
    setActiveField(field);
    setOpen(true);
  }

  const popoverContent = (
    <RangePickerContent
      className={calendarPopoverClassName}
      onOpenAutoFocus={onCalendarOpened}
      checkInValue={checkIn ? formatPickerDate(checkIn, locale) : t("checkIn")}
      checkOutValue={checkOut ? formatPickerDate(checkOut, locale) : t("checkOut")}
      activeField={activeField}
      compact={compact}
      calendarFormatters={calendarFormatters}
      selectedRange={selectedRange}
      month={visibleMonth}
      isDateDisabled={isPickerDateDisabled}
      isUnavailableDate={isUnavailableDate}
      unavailableDayClassName={unavailableDayClassName}
      clearLabel={clearLabel}
      onActivateField={activateField}
      onClear={clearable && clearLabel ? clearActiveDate : undefined}
      onSelectDate={selectDate}
      onMonthChange={showMonth}
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
  onOpenAutoFocus,
  checkInValue,
  checkOutValue,
  activeField,
  compact,
  calendarFormatters,
  selectedRange,
  month,
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
  onOpenAutoFocus?: () => void;
  checkInValue: string;
  checkOutValue: string;
  activeField: ActiveDateField;
  compact: boolean;
  calendarFormatters: NonNullable<DayPickerProps["formatters"]>;
  selectedRange: DateRange | undefined;
  month: Date | undefined;
  isDateDisabled: (date: Date) => boolean;
  isUnavailableDate: (date: Date) => boolean;
  unavailableDayClassName: string;
  clearLabel: string;
  onActivateField: (field: ActiveDateField) => void;
  onClear?: () => void;
  onSelectDate: (date: Date) => void;
  onMonthChange: (month: Date) => void;
}) {
  return (
    <PopoverContent align="center" collisionPadding={16} className={className} onOpenAutoFocus={onOpenAutoFocus}>
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
        month={month}
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
  /** Left out where both dates are required. */
  onClear?: () => void;
}) {
  return (
    <div className="mb-2 grid grid-cols-2 gap-1 rounded-xl bg-muted p-1">
      <RangeSummaryButton
        field="checkIn"
        value={checkInValue}
        active={activeField === "checkIn"}
        onClick={() => onActivateField("checkIn")}
        compact={compact}
        clearLabel={clearLabel}
        onClear={activeField === "checkIn" ? onClear : undefined}
      />
      <RangeSummaryButton
        field="checkOut"
        value={checkOutValue}
        active={activeField === "checkOut"}
        onClick={() => onActivateField("checkOut")}
        compact={compact}
        clearLabel={clearLabel}
        onClear={activeField === "checkOut" ? onClear : undefined}
      />
    </div>
  );
}

function ClearDateButton({ label, onClear }: { label: string; onClear: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
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
  month,
  isDateDisabled,
  isUnavailableDate,
  unavailableDayClassName,
  onSelectDate,
  onMonthChange,
}: {
  compact: boolean;
  calendarFormatters: NonNullable<DayPickerProps["formatters"]>;
  selectedRange: DateRange | undefined;
  month: Date | undefined;
  isDateDisabled: (date: Date) => boolean;
  isUnavailableDate: (date: Date) => boolean;
  unavailableDayClassName: string;
  onSelectDate: (date: Date) => void;
  onMonthChange: (month: Date) => void;
}) {
  return (
    <Calendar
      mode="range"
      selected={selectedRange}
      month={month}
      onMonthChange={onMonthChange}
      onDayClick={onSelectDate}
      disabled={isDateDisabled}
      modifiers={{ unavailable: isUnavailableDate }}
      modifiersClassNames={{ unavailable: unavailableDayClassName }}
      formatters={calendarFormatters}
      appearance="booking"
      compact={compact}
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
  clearLabel,
  onClear,
}: {
  field: ActiveDateField;
  value: string;
  active: boolean;
  compact: boolean;
  onClick: () => void;
  clearLabel: string;
  onClear?: () => void;
}) {
  const fieldButton = useRef<HTMLButtonElement>(null);
  return (
    <div className="relative min-w-0">
      <button
        ref={fieldButton}
        type="button"
        data-testid={`booking-range-${field}`}
        aria-pressed={active}
        onClick={onClick}
        className={cn(
          "w-full rounded-lg px-3 py-2 text-left transition focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/40",
          active
            ? "border border-border bg-background shadow-sm"
            : "border border-transparent text-foreground hover:bg-background/50",
          compact && "px-2.5 py-1.5",
          onClear && "pr-8",
        )}
      >
        <span className={cn("block truncate font-semibold leading-tight", active ? "text-primary" : "text-foreground", compact ? "text-xs" : "text-sm")}>
          {value}
        </span>
      </button>
      {onClear ? (
        <ClearDateButton label={clearLabel} onClear={() => {
          onClear();
          fieldButton.current?.focus();
        }} />
      ) : null}
    </div>
  );
}
