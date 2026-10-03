import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";

/**
 * Load ONLY the requested locale's dictionary, so the server request path (and the
 * NextIntlClientProvider payload it feeds) never pulls in all 11 messages/*.json files.
 * An unsupported/absent locale falls back to the default locale, exactly as before.
 */
async function loadMessages(locale: Locale) {
  const messages = await import(`../../messages/${locale}.json`);
  return messages.default;
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
