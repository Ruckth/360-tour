"use client";

import { Check, ChevronDown } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  defaultLocale,
  isLocale,
  localeLabels,
  locales,
  stripLocalePrefix,
  type Locale,
} from "@/i18n/routing";
import { cn } from "@/lib/utils";

const compactLocaleLabels: Record<Locale, string> = {
  en: "EN",
  th: "TH",
  "zh-CN": "ZH",
  ja: "JA",
  ko: "KO",
  fr: "FR",
  de: "DE",
  es: "ES",
  ru: "RU",
  it: "IT",
  hi: "HI",
};

export function LanguageSwitcher({
  solid = true,
  compact = false,
  className,
}: {
  solid?: boolean;
  compact?: boolean;
  className?: string;
}) {
  const locale = useLocale();
  const a11y = useTranslations("A11y");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = isLocale(locale) ? locale : defaultLocale;
  const [hash, setHash] = useState("");

  useEffect(() => {
    setHash(window.location.hash);
  }, [pathname, searchParams]);

  useEffect(() => {
    function onLocaleInteraction(event: PointerEvent | MouseEvent) {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest<HTMLAnchorElement>("[data-locale-href]");
      if (!link) return;
      event.preventDefault();
      const nextLocale = link.dataset.locale;
      if (nextLocale) {
        document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
      }
      window.location.assign(link.href);
    }

    document.addEventListener("pointerdown", onLocaleInteraction, true);
    document.addEventListener("click", onLocaleInteraction, true);
    return () => {
      document.removeEventListener("pointerdown", onLocaleInteraction, true);
      document.removeEventListener("click", onLocaleInteraction, true);
    };
  }, []);

  function getLocaleHref(nextLocale: Locale) {
    const basePath = stripLocalePrefix(pathname);
    const nextPath =
      nextLocale === defaultLocale
        ? basePath
        : `/${nextLocale}${basePath === "/" ? "" : basePath}`;
    const query = searchParams.toString();

    return `${nextPath}${query ? `?${query}` : ""}${hash}`;
  }

  return (
    <Popover>
      <PopoverTrigger
        aria-label={a11y("language")}
        className={cn(
          "inline-flex h-9 items-center justify-between gap-2 rounded-full border text-xs font-semibold shadow-sm transition focus:outline-none focus:ring-3 focus:ring-ring/40",
          compact ? "w-[4.25rem] px-3" : "w-[8rem] px-3",
          solid
            ? "border-border bg-background/90 text-foreground hover:bg-muted"
            : "border-white/20 bg-white/10 text-white shadow-white/5 backdrop-blur-md hover:bg-white/15",
          className,
        )}
      >
        <span>{compact ? compactLocaleLabels[currentLocale] : localeLabels[currentLocale]}</span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-75" />
      </PopoverTrigger>
      <PopoverContent
        align="end"
        data-testid="language-menu"
        className={cn(
          "pointer-events-auto overflow-y-auto p-1",
          compact ? "max-h-[13.5rem] w-[9.5rem]" : "max-h-96 w-[11rem]",
        )}
      >
        <div className="grid gap-0.5">
          {locales.map((item) => (
            <a
              key={item}
              href={getLocaleHref(item)}
              data-locale-href=""
              data-locale={item}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg text-left outline-none transition hover:bg-muted focus:bg-muted",
                compact ? "px-2 py-1.5 text-xs" : "px-3 py-2 text-sm",
                currentLocale === item && "bg-muted",
              )}
            >
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                {currentLocale === item ? <Check className="h-4 w-4" /> : null}
              </span>
              <span className="flex min-w-0 flex-1 items-center justify-between gap-3">
                <span className="truncate">{localeLabels[item]}</span>
                <span className="text-xs font-semibold text-muted-foreground">
                  {compactLocaleLabels[item]}
                </span>
              </span>
            </a>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
