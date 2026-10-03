import de from "../../../messages/de.json";
import en from "../../../messages/en.json";
import es from "../../../messages/es.json";
import fr from "../../../messages/fr.json";
import hi from "../../../messages/hi.json";
import it from "../../../messages/it.json";
import ja from "../../../messages/ja.json";
import ko from "../../../messages/ko.json";
import ru from "../../../messages/ru.json";
import th from "../../../messages/th.json";
import zhCN from "../../../messages/zh-CN.json";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";
import type { PublicMessages } from "@/lib/i18n/public-content";

/**
 * The ONLY module that statically imports every locale dictionary. Nothing with a
 * `'use client'` directive (transitively) may import it — the `locale-payloads`
 * import-graph test fails the build if a client module reaches here or any
 * `messages/*.json`. Client components read the active locale's messages from the
 * next-intl provider (`useMessages()`) and pass that object into the pure helpers
 * in `public-content.ts`; server code uses `@/lib/i18n/server-content`.
 */
const messagesByLocale = {
  de,
  en,
  es,
  fr,
  hi,
  it,
  ja,
  ko,
  ru,
  th,
  "zh-CN": zhCN,
} satisfies Record<Locale, PublicMessages>;

export function normalizePublicLocale(locale?: string): Locale {
  if (locale && isLocale(locale)) return locale;
  if (locale?.toLowerCase() === "zh-cn") return "zh-CN";
  return defaultLocale;
}

/** The active locale's full message dictionary, falling back to the default locale. */
export function getPublicMessages(locale?: string): PublicMessages {
  return messagesByLocale[normalizePublicLocale(locale)];
}
