"use client";

import { DatePicker } from "./date-picker";
import { TimePicker } from "./time-picker";
import { parseLocalDateTime } from "@/lib/dates/values";

export function DateTimePicker({
  id,
  label,
  value,
  onValueChange,
  defaultTime = "00:00",
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  defaultTime?: string;
}) {
  const parts = parseLocalDateTime(value);
  const date = parts?.date ?? "";
  const time = parts?.time ?? defaultTime;
  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_11rem]">
      <DatePicker
        id={id}
        value={date}
        onValueChange={(next) => onValueChange(next ? `${next}T${time}` : "")}
        aria-label={`${label} date`}
        clearable
      />
      <TimePicker
        label={label}
        value={time}
        disabled={!date}
        onValueChange={(next) => onValueChange(`${date}T${next}`)}
      />
    </div>
  );
}
