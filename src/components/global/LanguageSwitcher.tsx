"use client";

import { Check, ChevronDown } from "lucide-react";
import { useHydrated } from "@/platform/hydration";
import { useLocale, useTranslations } from "@/platform/intl";
import { usePathname, useSearchParams } from "@/platform/navigation";
import { useSyncExternalStore, type MouseEvent } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  defaultLocale,
  isLocale,
  localeLabels,
  locales,
  stripLocalePrefix,
  type Locale,
} from "@/i18n/routing";
import { bypassesI18n } from "@/lib/i18n-exempt";
import { cn } from "@/lib/utils";

function subscribeToHash(onChange: () => void) {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

function writeLocaleCookie(nextLocale: Locale) {
  document.cookie = `NEXT_LOCALE=${nextLocale}; path=/; max-age=31536000; SameSite=Lax`;
}

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
  const hydrated = useHydrated();
  const locale = useLocale();
  const a11y = useTranslations("A11y");
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentLocale = isLocale(locale) ? locale : defaultLocale;
  // Read on every render (route changes re-render via the hooks above) and on hashchange; "" on the server.
  const hash = useSyncExternalStore(subscribeToHash, () => window.location.hash, () => "");

  function handleLocaleClick(event: MouseEvent<HTMLAnchorElement>, nextLocale: Locale) {
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    ) {
      return;
    }
    event.preventDefault();
    writeLocaleCookie(nextLocale);
    const targetUrl = new URL(event.currentTarget.href, window.location.origin);
    if (!targetUrl.hash && window.location.hash) {
      targetUrl.hash = window.location.hash;
    }
    window.location.assign(targetUrl.toString());
  }

  function getLocaleHref(nextLocale: Locale) {
    const basePath = stripLocalePrefix(pathname);
    const nextPath = bypassesI18n(basePath)
      ? basePath
      : nextLocale === defaultLocale
        ? basePath
        : `/${nextLocale}${basePath === "/" ? "" : basePath}`;
    const query = searchParams.toString();

    return `${nextPath}${query ? `?${query}` : ""}${hash}`;
  }

  return (
    <Popover>
      <PopoverTrigger
        data-testid="language-switcher"
        disabled={!hydrated}
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
              onClick={(event) => handleLocaleClick(event, item)}
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
