"use client";

import { useMemo, useState } from "react";
import { getCountryCallingCode, type Country } from "react-phone-number-input";
import flags from "react-phone-number-input/flags";
import { Button } from "@/components/ui/button";
import { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList, ComboboxTrigger } from "@/components/ui/combobox";

/** Desk-local adapter: keep the dial prefix visible without changing shared phone input. */
export function DeskPhoneCountrySelect({ disabled, value, options, onChange }: {
  disabled?: boolean;
  value?: Country;
  options: Array<{ label: string; value?: Country }>;
  onChange: (country: Country) => void;
}) {
  const [search, setSearch] = useState("");
  const countries = useMemo(() => options.filter((option): option is { label: string; value: Country } => Boolean(option.value)), [options]);
  const filtered = countries.filter(option => option.label.toLowerCase().includes(search.toLowerCase()));
  const Flag = value ? flags[value] : undefined;
  const selected = countries.find(option => option.value === value);
  return <Combobox items={filtered.map(option => option.value)} filter={null} value={value ?? null} disabled={disabled} onOpenChange={() => setSearch("")} onValueChange={country => { if (country) onChange(country); }}>
    <ComboboxTrigger aria-label={`Country: ${selected?.label ?? "International"}${value ? ` +${getCountryCallingCode(value)}` : ""}`} render={<Button variant="outline" disabled={disabled} className="gap-1.5 rounded-s-lg rounded-e-none border-e-0 px-2.5 font-normal" />}>
      {Flag ? <span className="w-4 [&_svg]:w-full"><Flag title={selected?.label ?? value!} /></span> : null}
      <span className="font-sans text-sm tabular-nums">{value ? `+${getCountryCallingCode(value)}` : "+"}</span>
    </ComboboxTrigger>
    <ComboboxContent className="w-[min(20rem,calc(100vw-2rem))]">
      <ComboboxInput showTrigger={false} aria-label="Search countries" placeholder="e.g. United States" value={search} onChange={event => setSearch(event.target.value)} className="pointer-coarse:min-h-11" />
      <ComboboxEmpty className="px-3 py-2 text-sm">No country found.</ComboboxEmpty>
      <ComboboxList>{filtered.map(option => <ComboboxItem key={option.value} value={option.value} className="pointer-coarse:min-h-11"><span className="flex-1">{option.label}</span><span className="font-sans tabular-nums text-muted-foreground">+{getCountryCallingCode(option.value)}</span></ComboboxItem>)}</ComboboxList>
    </ComboboxContent>
  </Combobox>;
}
