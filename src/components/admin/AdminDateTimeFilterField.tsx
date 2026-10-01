"use client";

import { DateTimePicker } from "@/components/ui/date-time-picker";
import { Label } from "@/components/ui/label";

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
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="admin-eyebrow">
        {label}
      </Label>
      <DateTimePicker
        id={id}
        label={label}
        value={value}
        onValueChange={onChange}
        defaultTime={`${defaultHour}:${defaultMinute}`}
      />
    </div>
  );
}
