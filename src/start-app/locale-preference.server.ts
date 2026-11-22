import { match } from "@formatjs/intl-localematcher";
import Negotiator from "negotiator";
import { defaultLocale, isLocale, locales } from "@/i18n/routing";

const available = [...locales].sort((a, b) => b.length - a.length);

export function requestLanguage(header: string | null) {
  const accepted = new Negotiator({ headers: { "accept-language": header ?? undefined } }).languages();
  try {
    const language = match(accepted, available, defaultLocale);
    return isLocale(language) ? language : undefined;
  } catch {
    return undefined;
  }
}
