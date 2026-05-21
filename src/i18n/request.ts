import { getRequestConfig } from "next-intl/server";
import de from "../../messages/de.json";
import en from "../../messages/en.json";
import es from "../../messages/es.json";
import fr from "../../messages/fr.json";
import hi from "../../messages/hi.json";
import it from "../../messages/it.json";
import ja from "../../messages/ja.json";
import ko from "../../messages/ko.json";
import ru from "../../messages/ru.json";
import th from "../../messages/th.json";
import zhCN from "../../messages/zh-CN.json";
import { defaultLocale, isLocale, type Locale } from "@/i18n/routing";

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
} satisfies Record<Locale, IntlMessages>;

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = requested && isLocale(requested) ? requested : defaultLocale;

  return {
    locale,
    messages: messagesByLocale[locale],
  };
});
