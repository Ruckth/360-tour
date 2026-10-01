"use client";

import { useRef } from "react";
import { Button } from "./button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./select";
import {
  PickerFormControl,
  usePickerValue,
  type PickerValueProps,
} from "./picker-field";
import {
  isTimeValue,
  timeMinuteOptions,
  timeValueProblem,
} from "@/lib/dates/values";
import { cn } from "@/lib/utils";

const hours = Array.from({ length: 24 }, (_, index) =>
  String(index).padStart(2, "0"),
);

export type TimePickerProps = PickerValueProps & {
  id?: string;
  label: string;
  minuteStep?: number;
  allowEmpty?: boolean;
  className?: string;
  onBlur?: () => void;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export function TimePicker({
  label,
  minuteStep = 1,
  allowEmpty = false,
  className,
  ...props
}: TimePickerProps) {
  const field = usePickerValue(props);
  const trigger = useRef<HTMLButtonElement>(null);
  const [hour, minute] = isTimeValue(field.value)
    ? field.value.split(":")
    : ["", ""];
  // Preserve the value-attribute step base used by native time inputs.
  const stepBase = props.defaultValue ?? props.value ?? "";
  const minutes = timeMinuteOptions(minuteStep, field.value, stepBase);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="flex items-center gap-2">
        <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
          <Select
            value={hour}
            onValueChange={(value) =>
              field.change(`${value}:${minute || "00"}`)
            }
            disabled={props.disabled}
          >
            <SelectTrigger
              ref={trigger}
              id={props.id}
              aria-label={`${label} hour`}
              aria-invalid={props["aria-invalid"]}
              aria-describedby={props["aria-describedby"]}
              onBlur={props.onBlur}
              className="h-10 min-w-0 px-2.5 font-normal tabular-nums"
            >
              <SelectValue placeholder="HH" />
            </SelectTrigger>
            <SelectContent>
              {hours.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select
            value={minute}
            onValueChange={(value) => field.change(`${hour || "00"}:${value}`)}
            disabled={props.disabled}
          >
            <SelectTrigger
              aria-label={`${label} minute`}
              aria-invalid={props["aria-invalid"]}
              aria-describedby={props["aria-describedby"]}
              onBlur={props.onBlur}
              className="h-10 min-w-0 px-2.5 font-normal tabular-nums"
            >
              <SelectValue placeholder="MM" />
            </SelectTrigger>
            <SelectContent>
              {minutes.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {allowEmpty ? (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="px-1.5 text-xs"
            disabled={props.disabled || !field.value}
            onClick={() => field.change("")}
            aria-label={`Clear ${label}`}
          >
            Clear
          </Button>
        ) : null}
      </div>
      <PickerFormControl
        name={props.name}
        value={field.value}
        disabled={props.disabled}
        problem={timeValueProblem(field.value, {
          required: props.required,
          minuteStep,
          stepBase,
        })}
        focusRef={trigger}
        onReset={field.reset}
      />
    </div>
  );
}
