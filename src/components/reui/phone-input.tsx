// Adapted from the ReUI phone-input registry component (https://reui.io/r/default/phone-input.json).
"use client";

import { createContext, useContext, useMemo, useState } from "react";
import * as BasePhoneInput from "react-phone-number-input";
import flags from "react-phone-number-input/flags";

import { cn } from "@/lib/utils";
import { GlobeIcon } from "lucide-react";
import { getExampleNumber } from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";
import { Button } from "@/components/ui/button";
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
} from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";

type PhoneInputSize = "sm" | "default" | "lg";

const PhoneInputContext = createContext<{
  variant: PhoneInputSize;
  popupClassName?: string;
}>({ variant: "default" });

type PhoneInputProps = Omit<
  React.ComponentProps<"input">,
  "onChange" | "value" | "ref"
> &
  Omit<
    BasePhoneInput.Props<typeof BasePhoneInput.default>,
    "onChange" | "variant" | "popupClassName"
  > & {
    onChange?: (value: BasePhoneInput.Value | undefined) => void;
    variant?: PhoneInputSize;
    popupClassName?: string;
  };

function PhoneInput({
  className,
  variant = "default",
  popupClassName,
  onChange,
  value,
  ...props
}: PhoneInputProps) {
  const [country, setCountry] = useState<BasePhoneInput.Country | undefined>(
    props.defaultCountry,
  );
  const example = country
    ? getExampleNumber(country, examples)?.formatNational()
    : undefined;
  return (
    <PhoneInputContext.Provider value={{ variant, popupClassName }}>
      <BasePhoneInput.default
        className={cn(
          "flex min-w-0",
          props["aria-invalid"] &&
            "[&_*[data-slot=combobox-trigger]]:border-destructive [&_*[data-slot=combobox-trigger]]:ring-destructive/50",
          className,
        )}
        flagComponent={FlagComponent}
        countrySelectComponent={CountrySelect}
        inputComponent={InputComponent}
        smartCaret={false}
        value={value || undefined}
        {...props}
        placeholder={props.placeholder ?? example ?? "Enter phone number"}
        onCountryChange={(country) => {
          setCountry(country);
          props.onCountryChange?.(country);
        }}
        onChange={(value) => onChange?.(value)}
      />
    </PhoneInputContext.Provider>
  );
}

function InputComponent({
  className,
  ...props
}: React.ComponentProps<typeof Input>) {
  const { variant } = useContext(PhoneInputContext);

  return (
    <Input
      className={cn(
        "min-w-0 rounded-s-none focus:z-1",
        variant === "sm" && "h-7",
        variant === "lg" && "h-9",
        className,
      )}
      {...props}
    />
  );
}

type CountryEntry = {
  label: string;
  value: BasePhoneInput.Country | undefined;
};

type CountrySelectProps = {
  disabled?: boolean;
  value: BasePhoneInput.Country;
  options: CountryEntry[];
  onChange: (country: BasePhoneInput.Country) => void;
};

function CountrySelect({
  disabled,
  value: selectedCountry,
  options: countryList,
  onChange,
}: CountrySelectProps) {
  const { variant, popupClassName } = useContext(PhoneInputContext);
  const [searchValue, setSearchValue] = useState("");

  // Only countries with a code render as rows (the library's "International"
  // option has none), so the rows, the empty state and the list's guard below
  // count the same entries.
  const filteredCountries = useMemo(() => {
    const query = searchValue.toLowerCase();
    return countryList.filter(
      ({ value, label }) => value && label.toLowerCase().includes(query),
    );
  }, [countryList, searchValue]);

  return (
    <Combobox
      items={filteredCountries.map((item) => item.value!)}
      filter={null}
      onOpenChange={() => setSearchValue("")}
      value={selectedCountry || ""}
      onValueChange={(country: BasePhoneInput.Country | null) => {
        if (country) {
          onChange(country);
        }
      }}
    >
      <ComboboxTrigger
        render={
          <Button
            type="button"
            aria-label={`Country: ${countryList.find((country) => country.value === selectedCountry)?.label ?? "International"}`}
            variant="outline"
            size={variant}
            className={cn(
              "rounded-s-lg rounded-e-none flex gap-1 border-e-0 px-2.5 py-0 leading-none hover:bg-transparent focus:z-10 data-pressed:bg-transparent",
              disabled && "opacity-50",
            )}
            disabled={disabled}
          >
            <span className="sr-only">
              <ComboboxValue />
            </span>
            <FlagComponent
              country={selectedCountry}
              countryName={selectedCountry}
            />
          </Button>
        }
      />
      <ComboboxContent
        className={cn(
          "w-xs *:data-[slot=input-group]:bg-transparent",
          popupClassName,
        )}
      >
        <ComboboxInput
          aria-label="Search countries"
          placeholder="e.g. United States"
          value={searchValue}
          onChange={(e) => setSearchValue(e.target.value)}
          showTrigger={false}
          className="border-input focus-visible:border-border rounded-none border-0 px-0 py-2.5 shadow-none ring-0! outline-none! focus-visible:ring-0 focus-visible:ring-offset-0"
        />
        <ComboboxSeparator />
        <ComboboxEmpty className="px-4 py-2.5 text-sm">
          No country found.
        </ComboboxEmpty>
        {/* The rows scroll inside the list's own max height, its per-style
            padding moved inside, so the last country can be reached; the list
            itself must not scroll too. Not rendered while nothing matches: an
            emptied scroll area kept its old thumb below the popup. */}
        <ComboboxList className="p-0">
          {filteredCountries.length > 0 && (
            <div className="relative flex max-h-[inherit]">
              <div className="p-1 flex max-h-[inherit] w-full scroll-pt-2 scroll-pb-2 flex-col overscroll-contain">
                <ScrollArea className="size-full min-h-0 **:data-[slot=scroll-area-scrollbar]:m-0 [&_[data-slot=scroll-area-viewport]]:h-full [&_[data-slot=scroll-area-viewport]]:overscroll-contain">
                  {filteredCountries.map(({ value, label }) => (
                    <ComboboxItem
                      key={value}
                      value={value}
                      className="flex items-center gap-2"
                    >
                      <FlagComponent country={value!} countryName={label} />
                      <span className="flex-1 text-sm">{label}</span>
                      <span className="text-foreground/50 text-sm">
                        {`+${BasePhoneInput.getCountryCallingCode(value!)}`}
                      </span>
                    </ComboboxItem>
                  ))}
                </ScrollArea>
              </div>
            </div>
          )}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  );
}

function FlagComponent({ country, countryName }: BasePhoneInput.FlagProps) {
  const Flag = flags[country];

  return (
    <span className="flex h-4 w-4 items-center justify-center [&_svg:not([class*='size-'])]:size-full! [&_svg:not([class*='size-'])]:rounded-[5px]">
      {Flag ? (
        <Flag title={countryName} />
      ) : (
        <GlobeIcon className="size-4 opacity-60" />
      )}
    </span>
  );
}

export { PhoneInput };
