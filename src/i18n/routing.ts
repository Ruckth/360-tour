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

export const routing = {
  locales,
  defaultLocale,
  localePrefix: "as-needed",
} as const;

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
  if (/^(?:https?:\/\/|mailto:|tel:|\/\/)/i.test(href)) {
    return href;
  }

  const safeLocale = isLocale(locale) ? locale : defaultLocale;
  const separator = href.search(/[?#]/);
  const path = separator < 0 ? href : href.slice(0, separator);
  const suffix = separator < 0 ? "" : href.slice(separator);
  const normalizedPath = stripLocalePrefix(path.startsWith("/") ? path : `/${path}`);
  const localizedPath =
    safeLocale === defaultLocale
      ? normalizedPath
      : `/${safeLocale}${normalizedPath === "/" ? "" : normalizedPath}`;

  return localizedPath + suffix;
}
