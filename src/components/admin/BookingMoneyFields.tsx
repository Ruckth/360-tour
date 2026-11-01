"use client";

import { useState } from "react";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { resortDateTime, resortIsoDate, resortTime24, useNow } from "@/lib/staff-bookings";
import { MONEY_METHOD_LABELS } from "./admin-bookings-shared";

/**
 * Form pieces shared by the booking money dialogs: the business date something happened (any
 * past date, never the future), how money moved, and whether the guest is emailed.
 */

/** A resort-time date and time, defaulting to when the dialog opened. Returns the timestamp or null. */
export function useEffectiveTime(initial?: number) {
  const now = useNow();
  const [opened] = useState(() => initial ?? Date.now());
  const [date, setDate] = useState(resortIsoDate(opened));
  const [time, setTime] = useState(resortTime24(opened));
  const at = date && /^\d{2}:\d{2}$/.test(time) ? resortDateTime(date, time) : Number.NaN;
  // The server allows a few minutes of clock drift; anything later is a future date.
  const valid = Number.isFinite(at) && at <= Math.max(now, opened) + 5 * 60_000;
  return { date, setDate, time, setTime, at: valid ? at : null, future: Number.isFinite(at) && !valid, today: resortIsoDate(Math.max(now, opened)) };
}

export function EffectiveTimeFields({
  id,
  label,
  value,
}: {
  id: string;
  label: string;
  value: ReturnType<typeof useEffectiveTime>;
}) {
  return (
    <div className="grid gap-2">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8.5rem]">
        <div className="grid gap-2">
          <Label htmlFor={`${id}-date`}>{label}</Label>
          <DatePicker id={`${id}-date`} value={value.date} onValueChange={value.setDate} max={value.today} aria-label={label} />
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`${id}-time`}>Time (Bangkok)</Label>
          <Input id={`${id}-time`} type="time" required value={value.time} onChange={(event) => value.setTime(event.target.value)} />
        </div>
      </div>
      {value.future ? <p className="text-xs text-destructive">Pick a time that has already happened.</p> : null}
    </div>
  );
}

export function MethodPicker<T extends string>({
  label,
  methods,
  value,
  onChange,
}: {
  label: string;
  methods: readonly T[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid gap-2">
      <span className="text-sm font-medium" id={`method-${label}`}>{label}</span>
      <ToggleGroup value={value} onValueChange={onChange} aria-labelledby={`method-${label}`} className="flex-wrap">
        {methods.map((method) => (
          <ToggleGroupItem key={method} value={method} className="min-h-9">
            {MONEY_METHOD_LABELS[method] ?? method}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}

/** "Email the guest" with the current choice spelled out; hidden when the guest has no email. */
export function NotifyGuestField({
  id,
  guestEmail,
  checked,
  onChange,
  action,
}: {
  id: string;
  guestEmail?: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** What the email is about, e.g. "the cancellation". */
  action: string;
}) {
  if (!guestEmail) return <p className="text-xs text-muted-foreground">No guest email on file, so nobody is emailed.</p>;
  return (
    <div className="grid gap-1">
      <label htmlFor={id} className="flex items-center gap-2 text-sm">
        <input id={id} type="checkbox" className="size-4 accent-foreground" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        Email {guestEmail} about {action}
      </label>
      <p className="ps-6 text-xs text-muted-foreground">{checked ? "The guest will be emailed." : "The guest will not be emailed."}</p>
    </div>
  );
}
