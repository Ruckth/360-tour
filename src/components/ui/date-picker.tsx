"use client";

import {
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { CalendarDays } from "lucide-react";
import type { DayPickerProps, Matcher } from "react-day-picker";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import {
  PickerFormControl,
  usePickerValue,
  type PickerValueProps,
} from "./picker-field";
import { dateToIso, dateValueProblem, isoToDate } from "@/lib/dates/values";
import { formatPickerDate, getCalendarFormatters } from "@/lib/dates/format";
import { cn } from "@/lib/utils";

export type DatePickerProps = PickerValueProps & {
  id?: string;
  locale?: string;
  placeholder?: string;
  min?: string;
  max?: string;
  disabledDates?: Matcher | Matcher[];
  clearable?: boolean;
  weekStartsOn?: DayPickerProps["weekStartsOn"];
  triggerLabel?: ReactNode;
  variant?: ComponentProps<typeof Button>["variant"];
  size?: ComponentProps<typeof Button>["size"];
  className?: string;
  onBlur?: () => void;
  "aria-label"?: string;
  "aria-invalid"?: ComponentProps<typeof Button>["aria-invalid"];
  "aria-describedby"?: string;
};

export function DatePicker({
  locale = "en",
  placeholder = "Select date",
  clearable = false,
  min,
  max,
  disabledDates,
  weekStartsOn,
  triggerLabel,
  variant = "outline",
  size,
  className,
  ...props
}: DatePickerProps) {
  const field = usePickerValue(props);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const selected = isoToDate(field.value);
  const formatters = useMemo(() => getCalendarFormatters(locale), [locale]);
  const disabled: Matcher[] = [
    ...(min && isoToDate(min) ? [{ before: isoToDate(min)! }] : []),
    ...(max && isoToDate(max) ? [{ after: isoToDate(max)! }] : []),
    ...(Array.isArray(disabledDates)
      ? disabledDates
      : disabledDates
        ? [disabledDates]
        : []),
  ];
  return (
    <div className="min-w-0">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            id={props.id}
            type="button"
            variant={variant}
            size={size}
            disabled={props.disabled}
            aria-label={props["aria-label"]}
            aria-invalid={props["aria-invalid"]}
            aria-describedby={props["aria-describedby"]}
            onBlur={props.onBlur}
            className={cn(
              "w-full justify-start text-left font-normal",
              !selected && "text-muted-foreground",
              className,
            )}
          >
            <CalendarDays
              aria-hidden
              className="size-4 shrink-0 text-muted-foreground"
            />
            <span className="min-w-0 truncate">
              {triggerLabel ??
                formatPickerDate(field.value, locale, placeholder)}
            </span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          collisionPadding={12}
          className="w-[min(20rem,calc(100vw-2rem))] p-3"
        >
          <Calendar
            mode="single"
            required
            selected={selected}
            defaultMonth={selected ?? isoToDate(min ?? "")}
            disabled={disabled}
            weekStartsOn={weekStartsOn}
            formatters={formatters}
            initialFocus
            onSelect={(date) => {
              const value = dateToIso(date);
              if (!value || dateValueProblem(value, { min, max })) return;
              field.change(value);
              setOpen(false);
            }}
          />
          {clearable ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 w-full"
              disabled={!field.value}
              onClick={() => {
                field.change("");
                setOpen(false);
              }}
            >
              Clear
            </Button>
          ) : null}
        </PopoverContent>
      </Popover>
      <PickerFormControl
        name={props.name}
        value={field.value}
        disabled={props.disabled}
        problem={dateValueProblem(field.value, {
          required: props.required,
          min,
          max,
        })}
        focusRef={trigger}
        onReset={field.reset}
      />
    </div>
  );
}
