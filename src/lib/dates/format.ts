import type { DayPickerProps } from "react-day-picker";
import { isoToDate } from "./values";

export function calendarIntlLocale(locale: string) {
  return locale === "th"
    ? "th-TH-u-ca-buddhist"
    : locale === "en"
      ? "en-US"
      : locale;
}

// Keep repeated calendar renders cheap without retaining every possible locale forever.
const formatterCache = new Map<string, {
  date: Intl.DateTimeFormat;
  calendar: NonNullable<DayPickerProps["formatters"]>;
}>();

function getFormatters(locale: string) {
  const intlLocale = calendarIntlLocale(locale);
  const cached = formatterCache.get(intlLocale);
  if (cached) return cached;
  const date = new Intl.DateTimeFormat(intlLocale, {
    month: "short", day: "numeric", year: "numeric",
  });
  const month = new Intl.DateTimeFormat(intlLocale, {
    month: "long", year: "numeric",
  });
  const weekday = new Intl.DateTimeFormat(intlLocale, { weekday: "short" });
  const formatters = {
    date,
    calendar: {
      formatCaption: (value: Date) => month.format(value),
      formatWeekdayName: (value: Date) => weekday.format(value).replace(/\.$/, ""),
    },
  };
  if (formatterCache.size >= 8) {
    formatterCache.delete(formatterCache.keys().next().value!);
  }
  formatterCache.set(intlLocale, formatters);
  return formatters;
}

export function formatPickerDate(
  value: string,
  locale = "en",
  placeholder = "Select date",
) {
  const date = isoToDate(value);
  return date ? getFormatters(locale).date.format(date) : placeholder;
}

export function getCalendarFormatters(
  locale: string,
): NonNullable<DayPickerProps["formatters"]> {
  return getFormatters(locale).calendar;
}
