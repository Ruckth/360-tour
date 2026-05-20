import { getRequestConfig } from "next-intl/server";
import { defaultLocale, isLocale } from "@/i18n/routing";

async function loadMessages(locale: string) {
  try {
    return (await import(`../../messages/${locale}.json`)).default;
  } catch {
    return (await import(`../../messages/${defaultLocale}.json`)).default;
  }
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
  };
});
