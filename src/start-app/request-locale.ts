import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";

export function pathLocale(pathname: string): Locale {
  const first = pathname.split("/")[1];
  return isLocale(first) ? first : defaultLocale;
}
