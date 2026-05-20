"use client";

import { Globe2 } from "lucide-react";
import { useLocale } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import {
  defaultLocale,
  isLocale,
  localeLabels,
  locales,
  stripLocalePrefix,
  type Locale,
} from "@/i18n/routing";
import { cn } from "@/lib/utils";

export function LanguageSwitcher({
  solid = true,
  className,
}: {
  solid?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = isLocale(locale) ? locale : defaultLocale;

  function changeLocale(nextLocale: Locale) {
    const basePath = stripLocalePrefix(pathname);
    const nextPath =
      nextLocale === defaultLocale
        ? basePath
        : `/${nextLocale}${basePath === "/" ? "" : basePath}`;
    const query = searchParams.toString();
    const hash = window.location.hash;
    window.location.assign(`${nextPath}${query ? `?${query}` : ""}${hash}`);
  }

  return (
    <label
      className={cn(
        "inline-flex h-9 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold",
        solid
          ? "border-border bg-background text-foreground"
          : "border-white/15 bg-white/10 text-white backdrop-blur-md",
        className,
      )}
    >
      <Globe2 className="h-3.5 w-3.5" />
      <select
        value={currentLocale}
        aria-label="Language"
        onChange={(event) => changeLocale(event.target.value as Locale)}
        className={cn(
          "max-w-[7.5rem] bg-transparent outline-none",
          solid ? "text-foreground" : "text-white",
        )}
      >
        {locales.map((item) => (
          <option key={item} value={item} className="text-foreground">
            {localeLabels[item]}
          </option>
        ))}
      </select>
    </label>
  );
}
