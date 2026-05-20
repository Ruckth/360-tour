import { defineRouting } from "next-intl/routing";

export const locales = [
  "en",
  "th",
  "zh-CN",
  "ja",
  "ko",
  "fr",
  "de",
  "es",
  "ru",
  "it",
  "hi",
] as const;

export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = "en";

export const localeLabels: Record<Locale, string> = {
  en: "English",
  th: "ไทย",
  "zh-CN": "中文",
  ja: "日本語",
  ko: "한국어",
  fr: "Français",
  de: "Deutsch",
  es: "Español",
  ru: "Русский",
  it: "Italiano",
  hi: "हिन्दी",
};

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: "as-needed",
});

export function isLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}

export function stripLocalePrefix(pathname: string) {
  const [, firstSegment, ...rest] = pathname.split("/");
  if (firstSegment && isLocale(firstSegment)) {
    return `/${rest.join("/")}` || "/";
  }
  return pathname || "/";
}

export function localizeHref(href: string, locale: string) {
  if (href.startsWith("http") || href.startsWith("mailto:") || href.startsWith("tel:")) {
    return href;
  }

  const [pathAndQuery, hash = ""] = href.split("#");
  const [path = "/", query = ""] = pathAndQuery.split("?");
  const normalizedPath = stripLocalePrefix(path.startsWith("/") ? path : `/${path}`);
  const localizedPath =
    locale === defaultLocale
      ? normalizedPath
      : `/${locale}${normalizedPath === "/" ? "" : normalizedPath}`;

  return `${localizedPath}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}
