import { properties } from "@/lib/data/properties";
import { nightsBetweenIso } from "@/lib/booking/dates";

export type ChatBookingContext = {
  hasBookingIntent: boolean;
  checkIn: string;
  checkOut: string;
  propertySlug?: string;
  guests?: number;
};

export type ChatBookingMissingField = "villa" | "checkIn" | "checkOut";

export type ChatBookingContextInput = {
  latestUserMessage?: string;
  latestAssistantMessage?: string;
  activePropertySlug?: string;
  now?: Date;
};

const EN_MONTHS: Record<string, number> = {
  jan: 1,
  january: 1,
  feb: 2,
  february: 2,
  mar: 3,
  march: 3,
  apr: 4,
  april: 4,
  may: 5,
  jun: 6,
  june: 6,
  jul: 7,
  july: 7,
  aug: 8,
  august: 8,
  sep: 9,
  sept: 9,
  september: 9,
  oct: 10,
  october: 10,
  nov: 11,
  november: 11,
  dec: 12,
  december: 12,
};

const TH_MONTHS: Record<string, number> = {
  มกราคม: 1,
  มค: 1,
  กุมภาพันธ์: 2,
  กพ: 2,
  มีนาคม: 3,
  มีค: 3,
  เมษายน: 4,
  เมย: 4,
  พฤษภาคม: 5,
  พค: 5,
  มิถุนายน: 6,
  มิย: 6,
  กรกฎาคม: 7,
  กค: 7,
  สิงหาคม: 8,
  สค: 8,
  กันยายน: 9,
  กย: 9,
  ตุลาคม: 10,
  ตค: 10,
  พฤศจิกายน: 11,
  พย: 11,
  ธันวาคม: 12,
  ธค: 12,
};

const MONTH_LOOKUP = new Map<string, number>(
  Object.entries({ ...EN_MONTHS, ...TH_MONTHS }).map(([name, month]) => [
    normalizeMonthName(name),
    month,
  ]),
);

const MONTH_LABELS = [
  ...Object.keys(EN_MONTHS),
  "มกราคม",
  "ม.ค.",
  "กุมภาพันธ์",
  "ก.พ.",
  "มีนาคม",
  "มี.ค.",
  "เมษายน",
  "เม.ย.",
  "พฤษภาคม",
  "พ.ค.",
  "มิถุนายน",
  "มิ.ย.",
  "กรกฎาคม",
  "ก.ค.",
  "สิงหาคม",
  "ส.ค.",
  "กันยายน",
  "ก.ย.",
  "ตุลาคม",
  "ต.ค.",
  "พฤศจิกายน",
  "พ.ย.",
  "ธันวาคม",
  "ธ.ค.",
];

const MONTH_PATTERN = MONTH_LABELS.map(escapeRegExp).join("|");
const RANGE_SEPARATOR = String.raw`(?:to|until|through|till|[-–—]|ถึง|จนถึง)`;
const DAY_MONTH_RANGE = new RegExp(
  String.raw`\b(\d{1,2})\s+(${MONTH_PATTERN})(?:\s+(\d{2,4}))?\s*${RANGE_SEPARATOR}\s*(\d{1,2})\s+(${MONTH_PATTERN})(?:\s+(\d{2,4}))?`,
  "iu",
);
const MONTH_DAY_RANGE = new RegExp(
  String.raw`\b(${MONTH_PATTERN})\s+(\d{1,2})(?:,?\s+(\d{2,4}))?\s*${RANGE_SEPARATOR}\s*(${MONTH_PATTERN})\s+(\d{1,2})(?:,?\s+(\d{2,4}))?`,
  "iu",
);
const BOOKING_KEYWORDS = [
  "book",
  "booking",
  "reserve",
  "reservation",
  "available",
  "availability",
  "check in",
  "check-in",
  "checkout",
  "check out",
  "dates",
  "nights",
  "จอง",
  "ว่าง",
  "เช็คอิน",
  "เช็กอิน",
  "เช็คเอาท์",
  "เช็กเอาต์",
  "วันที่",
  "คืน",
];

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeMonthName(value: string) {
  return value.toLocaleLowerCase().replace(/[.\s]/g, "");
}

function monthNumber(value: string) {
  return MONTH_LOOKUP.get(normalizeMonthName(value)) ?? 0;
}

function normalizeYear(value?: string) {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  if (parsed > 2400) return parsed - 543;
  if (parsed < 100) return 2000 + parsed;
  return parsed;
}

function toIso(year: number, month: number, day: number) {
  const date = new Date(year, month - 1, day);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return "";
  }

  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

function compareIso(left: string, right: string) {
  return left.localeCompare(right);
}

function todayStart(now: Date) {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function inferStartYear(day: number, month: number, yearText: string | undefined, now: Date) {
  const explicitYear = normalizeYear(yearText);
  if (explicitYear) return explicitYear;

  const thisYear = now.getFullYear();
  const candidate = new Date(thisYear, month - 1, day);
  return candidate < todayStart(now) ? thisYear + 1 : thisYear;
}

function inferEndYear(
  day: number,
  month: number,
  yearText: string | undefined,
  startIso: string,
  startYear: number,
) {
  const explicitYear = normalizeYear(yearText);
  if (explicitYear) return explicitYear;

  let year = startYear;
  const firstTry = toIso(year, month, day);
  if (firstTry && compareIso(firstTry, startIso) <= 0) year += 1;
  return year;
}

function validRange(checkIn: string, checkOut: string) {
  return Boolean(checkIn && checkOut && nightsBetweenIso(checkIn, checkOut) > 0);
}

function dateRangeFromParts({
  startDay,
  startMonth,
  startYearText,
  endDay,
  endMonth,
  endYearText,
  now,
}: {
  startDay: number;
  startMonth: number;
  startYearText?: string;
  endDay: number;
  endMonth: number;
  endYearText?: string;
  now: Date;
}) {
  const startYear = inferStartYear(startDay, startMonth, startYearText, now);
  const checkIn = toIso(startYear, startMonth, startDay);
  const endYear = inferEndYear(endDay, endMonth, endYearText, checkIn, startYear);
  const checkOut = toIso(endYear, endMonth, endDay);

  return validRange(checkIn, checkOut) ? { checkIn, checkOut } : { checkIn: "", checkOut: "" };
}

function parseIsoDateRanges(text: string) {
  const matches = [...text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)];
  if (matches.length < 2) return null;

  const [first, second] = matches;
  const checkIn = toIso(normalizeYear(first[1]) ?? 0, Number(first[2]), Number(first[3]));
  const checkOut = toIso(normalizeYear(second[1]) ?? 0, Number(second[2]), Number(second[3]));
  return validRange(checkIn, checkOut) ? { checkIn, checkOut } : null;
}

function parseNamedMonthDateRanges(text: string, now: Date) {
  const dayMonth = DAY_MONTH_RANGE.exec(text);
  if (dayMonth) {
    return dateRangeFromParts({
      startDay: Number(dayMonth[1]),
      startMonth: monthNumber(dayMonth[2]),
      startYearText: dayMonth[3],
      endDay: Number(dayMonth[4]),
      endMonth: monthNumber(dayMonth[5]),
      endYearText: dayMonth[6],
      now,
    });
  }

  const monthDay = MONTH_DAY_RANGE.exec(text);
  if (monthDay) {
    return dateRangeFromParts({
      startDay: Number(monthDay[2]),
      startMonth: monthNumber(monthDay[1]),
      startYearText: monthDay[3],
      endDay: Number(monthDay[5]),
      endMonth: monthNumber(monthDay[4]),
      endYearText: monthDay[6],
      now,
    });
  }

  return null;
}

export function parseChatDateRange(text: string, now = new Date()) {
  return parseIsoDateRanges(text) ?? parseNamedMonthDateRanges(text, now) ?? { checkIn: "", checkOut: "" };
}

export function inferChatPropertySlug(text: string, activePropertySlug?: string) {
  if (activePropertySlug) return activePropertySlug;

  const normalized = text.toLocaleLowerCase();
  for (const property of properties) {
    const aliases = [
      property.id,
      property.name,
      property.name.replace(/\s+/g, ""),
      property.id.replace(/-/g, " "),
    ].map((value) => value.toLocaleLowerCase());
    if (aliases.some((alias) => normalized.includes(alias))) return property.id;
  }

  return undefined;
}

export function inferChatGuestCount(text: string) {
  const patterns = [
    /\b(\d{1,2})\s*(?:guests?|people|persons?|adults?)\b/i,
    /\b(?:for|hosts?|sleeps?|รองรับ(?:ได้)?|อยู่ได้)\s*(\d{1,2})\b/i,
    /(\d{1,2})\s*คน/i,
  ];

  for (const pattern of patterns) {
    const match = pattern.exec(text);
    const value = match ? Number(match[1]) : 0;
    if (value > 0 && value <= 30) return value;
  }

  return undefined;
}

export function hasChatBookingIntent(text: string) {
  const normalized = text.toLocaleLowerCase();
  return BOOKING_KEYWORDS.some((keyword) => normalized.includes(keyword));
}

export function extractChatBookingContext({
  latestUserMessage = "",
  latestAssistantMessage = "",
  activePropertySlug,
  now = new Date(),
}: ChatBookingContextInput): ChatBookingContext {
  const combined = `${latestUserMessage}\n${latestAssistantMessage}`;
  const range = parseChatDateRange(combined, now);
  const hasDates = Boolean(range.checkIn && range.checkOut);
  const hasBookingIntent = hasDates || hasChatBookingIntent(combined);

  return {
    hasBookingIntent,
    checkIn: range.checkIn,
    checkOut: range.checkOut,
    propertySlug: inferChatPropertySlug(combined, activePropertySlug),
    guests: inferChatGuestCount(combined),
  };
}

export function getMissingChatBookingFields(
  context: Pick<ChatBookingContext, "checkIn" | "checkOut" | "propertySlug">,
): ChatBookingMissingField[] {
  const missing: ChatBookingMissingField[] = [];
  if (!context.propertySlug) missing.push("villa");
  if (!context.checkIn) missing.push("checkIn");
  if (!context.checkOut) missing.push("checkOut");
  return missing;
}

export function getBookingPromptKey(
  context: Pick<ChatBookingContext, "checkIn" | "checkOut" | "propertySlug">,
) {
  const missing = getMissingChatBookingFields(context);
  const missingDates = missing.includes("checkIn") || missing.includes("checkOut");

  if (!missing.length) return "bookingPromptReady";
  if (missing.includes("villa") && missingDates) return "bookingPromptMissingVillaAndDates";
  if (missing.includes("villa")) return "bookingPromptMissingVilla";
  if (missing.includes("checkIn") && missing.includes("checkOut")) return "bookingPromptMissingDates";
  if (missing.includes("checkIn")) return "bookingPromptMissingCheckIn";
  return "bookingPromptMissingCheckOut";
}
