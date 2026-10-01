import type { DayPickerProps } from "react-day-picker";
import { isoToDate } from "./values";

export function calendarIntlLocale(locale: string) {
  return locale === "th"
    ? "th-TH-u-ca-buddhist"
    : locale === "en"
      ? "en-US"
      : locale;
}

export function formatPickerDate(
  value: string,
  locale = "en",
  placeholder = "Select date",
) {
  const date = isoToDate(value);
  return date
    ? new Intl.DateTimeFormat(calendarIntlLocale(locale), {
        month: "short",
        day: "numeric",
        year: "numeric",
      }).format(date)
    : placeholder;
}

export function getCalendarFormatters(
  locale: string,
): NonNullable<DayPickerProps["formatters"]> {
  const intlLocale = calendarIntlLocale(locale);
  const month = new Intl.DateTimeFormat(intlLocale, {
    month: "long",
    year: "numeric",
  });
  const weekday = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
  return {
    formatCaption: (date) => month.format(date),
    formatWeekdayName: (date) => weekday.format(date).replace(/\.$/, ""),
  };
}
