import type { FunctionReturnType } from "convex/server";
import type { api } from "convex/_generated/api";
import type { Doc, Id } from "convex/_generated/dataModel";
import { TURNAROUND_STEP_MIN, turnaroundMinutes } from "convex/lib/appointmentWindow";
import type { RosterBreak } from "convex/lib/serviceSlots";
import { formatResortFullDate, formatResortTime, resortIsoDate, resortTime24 } from "@/lib/staff-bookings";

/** Pure helpers behind the calendar's proposed changes: nothing here saves anything. */

const MINUTE = 60_000;

type Appointment = Doc<"serviceAppointments">;
export type ScheduleData = FunctionReturnType<typeof api.adminServices.listSchedule>;
/** A roster break on the calendar, with the date and day plan it was read from. */
export type BreakBlock = Extract<ScheduleData["blocks"][number], { kind: "break" }>;
export type ScheduleProposal = { start: number; staffId: Id<"staff"> };
export type ChangeRow = { label: string; before: string; after: string };
type Occupancy = Pick<Appointment, "start" | "end" | "blockedUntil"> & { staffName: string };

/** A drop on another time or staff column; a drop where it started is not a proposal. */
export function moveProposal(
  appointment: Pick<Appointment, "start" | "staffId">,
  drop: { start: number; staffId?: Id<"staff"> },
): ScheduleProposal | null {
  const staffId = drop.staffId ?? appointment.staffId;
  return drop.start === appointment.start && staffId === appointment.staffId ? null : { start: drop.start, staffId };
}

/** Turnaround minutes for a resized tail, rounded to the 5-minute step. */
export function turnaroundFromTail(appointment: Pick<Appointment, "end">, tailEnd: number): number {
  const step = TURNAROUND_STEP_MIN * MINUTE;
  return Math.max(0, Math.round((tailEnd - appointment.end) / step) * TURNAROUND_STEP_MIN);
}

/** Resort-local times for a dragged break, or null when it left its date or didn't change. */
export function breakFromDrag(
  block: { date: string; original: RosterBreak },
  start: number,
  end: number,
): Pick<RosterBreak, "start" | "end"> | null {
  if (end <= start || resortIsoDate(start) !== block.date || resortIsoDate(end - 1) !== block.date) return null;
  const next = { start: resortTime24(start), end: resortTime24(end) === "00:00" ? "24:00" : resortTime24(end) };
  return next.start === block.original.start && next.end === block.original.end ? null : next;
}

/** Include the end date when a service or cleanup crosses midnight in Bangkok. */
export const endTime = (start: number, end: number) => resortIsoDate(start) === resortIsoDate(end)
  ? formatResortTime(end)
  : `${formatResortFullDate(end)}, ${formatResortTime(end)}`;

export const timeRange = (start: number, end: number) => `${formatResortTime(start)} – ${endTime(start, end)}`;

function occupiedUntil(occupancy: Occupancy) {
  const turnaround = turnaroundMinutes(occupancy);
  return turnaround ? `${endTime(occupancy.start, occupancy.blockedUntil)} (${turnaround} min turnaround)` : endTime(occupancy.start, occupancy.blockedUntil);
}

/** Date, service time, staff and the end of the turnaround, before and after a schedule change. */
export function scheduleRows(before: Occupancy, after: Occupancy): ChangeRow[] {
  return [
    { label: "Date", before: formatResortFullDate(before.start), after: formatResortFullDate(after.start) },
    { label: "Service time", before: timeRange(before.start, before.end), after: timeRange(after.start, after.end) },
    { label: "Staff", before: before.staffName, after: after.staffName },
    { label: "Occupied until", before: occupiedUntil(before), after: occupiedUntil(after) },
  ];
}

export const breakText = (item: RosterBreak) => `${item.label} ${item.start}–${item.end}`;

/** Where a proposed change is drawn until it's confirmed or dismissed, by calendar event id. */
export type Ghost = { start: number; end: number; staffId: Id<"staff"> };
