import { isCalendarDate } from "convex/shared/dates";

/**
 * Deep links into the Spa calendar and roster. Both pages read these once on arrival; every value is
 * validated here and the destination still applies its own authorization (listSchedule/getWeek).
 */
export type StaffCalendarLink = { date?: string; staffId?: string; appointmentId?: string; openOnly?: true };
export type StaffRosterLink = { date?: string; staffId?: string };

const ID = /^[\w-]{1,64}$/;
const validDate = (value: string | null) => (value && isCalendarDate(value) ? value : undefined);
const validId = (value: string | null) => (value && ID.test(value) ? value : undefined);

function withParams(path: string, params: Record<string, string | undefined>) {
  const query = new URLSearchParams(Object.entries(params).filter((entry): entry is [string, string] => Boolean(entry[1]))).toString();
  return query ? `${path}?${query}` : path;
}

export function staffCalendarHref(link: StaffCalendarLink = {}) {
  return withParams("/admin/staff/calendar", { date: link.date, staff: link.staffId, appointment: link.appointmentId, scope: link.date && link.openOnly ? "open" : undefined });
}

export function parseStaffCalendarLink(params: URLSearchParams): StaffCalendarLink {
  const date = validDate(params.get("date"));
  return { date, staffId: validId(params.get("staff")), appointmentId: validId(params.get("appointment")), ...(date && params.get("scope") === "open" ? { openOnly: true } : {}) };
}

/** `date` is any day of the week to open; the roster opens that week (and that day on phones). */
export function staffRosterHref(link: StaffRosterLink = {}) {
  return withParams("/admin/staff/roster", { date: link.date, staff: link.staffId });
}

export function parseStaffRosterLink(params: URLSearchParams): StaffRosterLink {
  return { date: validDate(params.get("date")), staffId: validId(params.get("staff")) };
}
